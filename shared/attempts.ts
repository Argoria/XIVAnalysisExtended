import type { Pull, PullAnalysis } from './types'

export type AttemptStatus = 'normal' | 'suspected-reset' | 'scrapped'

/** Only a deliberate user decision may exclude an attempt. */
export interface AttemptOverride {
  status: 'normal' | 'scrapped'
  reason: string
}

export type AttemptOverrides = Record<number, AttemptOverride>

export interface AttemptClassification {
  status: AttemptStatus
  source: 'automatic' | 'manual'
  reason: string
}

const VERSION = 1
const MAX_REASON_LENGTH = 500

function validOverride(value: unknown): value is AttemptOverride {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AttemptOverride>
  return (
    (candidate.status === 'normal' || candidate.status === 'scrapped') &&
    typeof candidate.reason === 'string' &&
    candidate.reason.trim().length > 0 &&
    candidate.reason.length <= MAX_REASON_LENGTH
  )
}

export function createAttemptOverride(status: AttemptOverride['status'], reason: string): AttemptOverride {
  const override = { status, reason: reason.trim() }
  if (!validOverride(override)) {
    throw new Error(`Attempt decisions require a reason of 1–${MAX_REASON_LENGTH} characters.`)
  }
  return override
}

/**
 * Conservative review hint, not a claim that players intentionally died.
 * Death timestamps and pull bounds are both report-relative milliseconds.
 * Short pulls without a death cluster or a longer comparable attempt stay normal.
 */
export function classifyAttempt(
  pull: Pull,
  analysis?: PullAnalysis,
  encounterPulls: Pull[] = [],
  override?: AttemptOverride,
): AttemptClassification {
  if (validOverride(override)) {
    return { ...override, reason: override.reason.trim(), source: 'manual' }
  }
  const normal: AttemptClassification = {
    status: 'normal',
    source: 'automatic',
    reason: 'No reset classification. Included in comparisons.',
  }
  if (pull.kill || analysis?.fightId !== pull.id) return normal

  const duration = pull.endTime - pull.startTime
  const referenceDuration = Math.max(
    0,
    ...encounterPulls
      .filter(
        (candidate) =>
          candidate.id !== pull.id &&
          candidate.encounterID === pull.encounterID &&
          candidate.difficulty === pull.difficulty,
      )
      .map((candidate) => candidate.endTime - candidate.startTime)
      .filter(Number.isFinite),
  )
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 45_000 ||
    referenceDuration < 120_000 ||
    duration > referenceDuration * 0.25
  )
    return normal

  const participants = new Set(pull.playerIds)
  // Repeated deaths of one resurrected player cannot impersonate a party wipe.
  const deaths = analysis.deaths
    .filter(
      (death) =>
        death.fightId === pull.id &&
        participants.has(death.playerId) &&
        death.timestamp >= pull.startTime &&
        death.timestamp <= pull.endTime,
    )
    .sort((a, b) => a.timestamp - b.timestamp)
  const minimumCluster = Math.max(3, Math.ceil(participants.size / 2))
  for (let start = 0; start < deaths.length; start++) {
    const first = deaths[start].timestamp
    if (first - pull.startTime > 30_000) break
    const cluster = deaths.filter((death) => death.timestamp >= first && death.timestamp <= first + 8_000)
    if (new Set(cluster.map((death) => death.playerId)).size < minimumCluster) continue
    const last = cluster[cluster.length - 1].timestamp
    if (pull.endTime - last > 15_000) continue
    return {
      status: 'suspected-reset',
      source: 'automatic',
      reason: `${new Set(cluster.map((death) => death.playerId)).size} players died within 8s early in a ${Math.round(duration / 1000)}s pull, against a ${Math.round(referenceDuration / 1000)}s comparable attempt. Possible reset or failed opening mechanic; review before scrapping.`,
    }
  }
  return normal
}

export function includeAttempt(classification: AttemptClassification, includeScrapped = false): boolean {
  return includeScrapped || classification.status !== 'scrapped'
}

export function attemptStorageKey(reportCode: string): string {
  return `xiv-analysis-extended:attempts:v${VERSION}:${encodeURIComponent(reportCode)}`
}

/** Invalid entries are ignored individually; a wrong report/version rejects the envelope. */
export function parseAttemptOverrides(raw: string | null, reportCode: string): AttemptOverrides {
  if (!raw) return {}
  try {
    const saved: unknown = JSON.parse(raw)
    if (!saved || typeof saved !== 'object') return {}
    const envelope = saved as { version?: unknown; reportCode?: unknown; overrides?: unknown }
    if (
      envelope.version !== VERSION ||
      envelope.reportCode !== reportCode ||
      !envelope.overrides ||
      typeof envelope.overrides !== 'object' ||
      Array.isArray(envelope.overrides)
    )
      return {}
    const result: AttemptOverrides = {}
    for (const [fightId, value] of Object.entries(envelope.overrides)) {
      if (!/^[1-9]\d*$/.test(fightId) || !Number.isSafeInteger(Number(fightId)) || !validOverride(value))
        continue
      result[Number(fightId)] = { status: value.status, reason: value.reason.trim() }
    }
    return result
  } catch {
    return {}
  }
}

export function serializeAttemptOverrides(reportCode: string, overrides: AttemptOverrides): string {
  const raw = JSON.stringify({ version: VERSION, reportCode, overrides })
  return JSON.stringify({ version: VERSION, reportCode, overrides: parseAttemptOverrides(raw, reportCode) })
}
