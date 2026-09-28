import type { PullAnalysis, PullProgression } from '../shared/types'
import { FflogsClient, FflogsError } from './fflogs/client'
import { analyzePull, normalizeReport } from './fflogs/normalize'
import { progressionMarkers } from './fflogs/progression'
import type { RawReport } from './fflogs/schema'
import {
  buildXivanalysisCompatInput,
  XIVA_V2_ADAPTER_VERSION,
  type XivanalysisCompatInput,
} from './xivanalysis/v2-adapter'
import {
  IsolatedXivanalysisRunner,
  XIVA_ENGINE_REVISION,
  type XivanalysisEngineResult,
  type XivanalysisEngineRunner,
} from './xivanalysis/runner'

class Cache<T> {
  private entries = new Map<string, { value: T; expires: number }>()
  constructor(
    private capacity: number,
    private ttl = 60000,
  ) {}
  get(key: string) {
    const entry = this.entries.get(key)
    if (entry && entry.expires > Date.now()) return entry.value
    this.entries.delete(key)
  }
  set(key: string, value: T) {
    this.entries.delete(key)
    if (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value!)
    this.entries.set(key, { value, expires: Date.now() + this.ttl })
  }
}

export class ReportService {
  private reports = new Cache<RawReport>(10)
  private analyses = new Cache<PullAnalysis>(300)
  private progressions = new Cache<PullProgression>(10)
  private xivanalysisInputs = new Cache<XivanalysisCompatInput>(50)
  private xivanalysisResults = new Cache<XivanalysisEngineResult>(300)
  constructor(
    public client: FflogsClient,
    private xivanalysisRunner: XivanalysisEngineRunner = new IsolatedXivanalysisRunner(),
  ) {}

  async report(code: string, refresh = false, signal?: AbortSignal) {
    let raw = refresh ? undefined : this.reports.get(code)
    if (!raw) {
      raw = await this.client.report(code, signal)
      this.reports.set(code, raw)
    }
    return { raw, report: normalizeReport(raw) }
  }

  async pull(code: string, id: number, refresh = false, signal?: AbortSignal) {
    const { raw, report } = await this.report(code, false, signal)
    const pull = report.pulls.find((p) => p.id === id)
    if (!pull) throw new FflogsError('Selected encounter was not found in this report.', 404)
    const key = `${code}:${id}:${pull.endTime}:${raw.endTime}`
    const cached = refresh ? undefined : this.analyses.get(key)
    if (cached) return cached

    const lbFilter = report.limitBreakActorIds.map((actorId) => `source.id = ${actorId}`).join(' OR ')
    const [deathEvents, dpsMetrics, lbEvents] = await Promise.all([
      this.client.events(code, pull, 'Deaths', undefined, signal),
      this.client.dpsMetrics(code, pull, signal),
      lbFilter ? this.client.events(code, pull, 'Casts', lbFilter, signal) : Promise.resolve([]),
    ])
    const damageTakenEvents = deathEvents.length
      ? await this.client.events(code, pull, 'DamageTaken', undefined, signal)
      : []
    const result = analyzePull(raw, pull, [...deathEvents, ...damageTakenEvents, ...lbEvents], dpsMetrics)
    this.analyses.set(key, result)
    return result
  }

  async progression(code: string, signal?: AbortSignal): Promise<PullProgression> {
    const { raw, report } = await this.report(code, false, signal)
    const key = `${code}:${raw.endTime}:progression`
    const cached = this.progressions.get(key)
    if (cached) return cached
    const result: PullProgression = {}
    let index = 0
    async function worker(service: ReportService) {
      while (index < report.pulls.length) {
        signal?.throwIfAborted()
        const pull = report.pulls[index++]
        const events = await service.client.events(code, pull, 'Casts', undefined, signal, 'Enemies')
        result[pull.id] = progressionMarkers(raw, pull, events)
      }
    }
    await Promise.all([worker(this), worker(this)])
    this.progressions.set(key, result)
    return result
  }

  async xivanalysisInput(code: string, id: number, refresh = false, signal?: AbortSignal) {
    const { raw, report } = await this.report(code, false, signal)
    const pull = report.pulls.find((candidate) => candidate.id === id)
    if (!pull) throw new FflogsError('Selected encounter was not found in this report.', 404)
    const key = `${code}:${id}:${pull.endTime}:${raw.endTime}:${XIVA_V2_ADAPTER_VERSION}`
    const cached = refresh ? undefined : this.xivanalysisInputs.get(key)
    if (cached) return cached

    const events = await this.client.analysisEvents(code, pull, signal)
    const result = buildXivanalysisCompatInput(raw, pull, events)
    this.xivanalysisInputs.set(key, result)
    return result
  }

  async xivanalysis(code: string, id: number, actorId: number, refresh = false, signal?: AbortSignal) {
    const input = await this.xivanalysisInput(code, id, refresh, signal)
    const actor = input.actors.find(
      (candidate) => candidate.id === String(actorId) && candidate.playerControlled,
    )
    if (!actor) throw new FflogsError('Selected player did not participate in this pull.', 404)

    const key = [
      code,
      id,
      actorId,
      input.adapterVersion,
      XIVA_ENGINE_REVISION,
      input.pull.duration,
      input.events.length,
    ].join(':')
    const cached = refresh ? undefined : this.xivanalysisResults.get(key)
    if (cached) return cached

    const result = await this.xivanalysisRunner.analyze(input, String(actorId), signal)
    this.xivanalysisResults.set(key, result)
    return result
  }
}
