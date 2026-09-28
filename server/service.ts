import type { PullAnalysis } from '../shared/types'
import { FflogsClient, FflogsError } from './fflogs/client'
import { analyzePull, normalizeReport } from './fflogs/normalize'
import type { RawReport } from './fflogs/schema'

class Cache<T> {
  private entries = new Map<string, { value: T; expires: number }>()
  constructor(private capacity: number, private ttl = 60000) {}
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
  constructor(public client: FflogsClient) {}

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
    const [deathEvents, damageDoneEvents, lbEvents] = await Promise.all([
      this.client.events(code, pull, 'Deaths', undefined, signal),
      this.client.events(code, pull, 'DamageDone', undefined, signal),
      lbFilter ? this.client.events(code, pull, 'Casts', lbFilter, signal) : Promise.resolve([]),
    ])
    const damageTakenEvents = deathEvents.length
      ? await this.client.events(code, pull, 'DamageTaken', undefined, signal)
      : []
    const result = analyzePull(raw, pull, [
      ...deathEvents,
      ...damageTakenEvents,
      ...damageDoneEvents,
      ...lbEvents,
    ])
    this.analyses.set(key, result)
    return result
  }
}
