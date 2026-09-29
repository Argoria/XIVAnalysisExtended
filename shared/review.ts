import type { DpsMetricKey, Pull, PullAnalysis, XivanalysisPlayerAnalysis } from './types'
import { summarizeXivanalysis } from './xivanalysis'

export type ReviewMetric = DpsMetricKey | 'deaths' | 'uptime'
export type PullSort =
  | 'chronological'
  | 'progression'
  | 'boss'
  | 'duration'
  | 'dps'
  | 'uptime'
  | 'fewest-deaths'
  | 'most-deaths'
export const DPS_METRICS: DpsMetricKey[] = ['dps', 'rdps', 'ndps', 'cdps']
export const metricLabel = (metric: ReviewMetric) =>
  ({
    dps: 'DPS',
    rdps: 'rDPS',
    ndps: 'nDPS',
    cdps: 'cDPS',
    adps: 'aDPS',
    deaths: 'Deaths',
    uptime: 'GCD uptime',
  })[metric]

export function playerMetric(
  metric: ReviewMetric,
  analysis?: PullAnalysis,
  playerId?: number,
  deep?: XivanalysisPlayerAnalysis,
): number | null {
  if (metric === 'uptime') return deep ? summarizeXivanalysis([deep]).gcdUptimePercent : null
  if (!analysis || playerId == null) return null
  if (metric === 'deaths') return analysis.deaths.filter((death) => death.playerId === playerId).length
  return analysis.performance.find((entry) => entry.playerId === playerId)?.metrics[metric] ?? null
}

export function pullMetric(
  metric: ReviewMetric,
  pull: Pull,
  analysis?: PullAnalysis,
  deep: XivanalysisPlayerAnalysis[] = [],
): number | null {
  if (metric === 'uptime')
    return summarizeXivanalysis(deep.filter((result) => pull.playerIds.includes(Number(result.actorId))))
      .gcdUptimePercent
  if (!analysis) return null
  if (metric === 'deaths') return analysis.deaths.length
  // A partial roster's sum must never masquerade as raid DPS.
  const values = pull.playerIds.map((id) => playerMetric(metric, analysis, id))
  return values.length && values.every((value) => value != null)
    ? values.reduce<number>((sum, value) => sum + value!, 0)
    : null
}

export function measuredUptimeCoverage(
  pull: Pull,
  deep: XivanalysisPlayerAnalysis[],
  playerId?: number | null,
): number {
  const eligible = playerId == null ? pull.playerIds : pull.playerIds.includes(playerId) ? [playerId] : []
  const measured = new Set(
    deep
      .filter(
        (result) =>
          result.fightId === pull.id &&
          eligible.includes(Number(result.actorId)) &&
          summarizeXivanalysis([result]).gcdUptimePercent != null,
      )
      .map((result) => result.actorId),
  )
  return eligible.length ? (measured.size / eligible.length) * 100 : 0
}

/** Missing values stay last for either sort direction. Encounters never compete. */
export function comparePulls(a: Pull, b: Pull, sort: PullSort, value: (pull: Pull) => number | null): number {
  const encounterOrder = a.encounterID - b.encounterID || (a.difficulty ?? -1) - (b.difficulty ?? -1)
  if (encounterOrder) return encounterOrder
  if (sort === 'chronological') return a.startTime - b.startTime || a.id - b.id
  const av = value(a),
    bv = value(b)
  if (av == null && bv != null) return 1
  if (bv == null && av != null) return -1
  const ascending = sort === 'boss' || sort === 'progression' || sort === 'fewest-deaths'
  return av != null && bv != null && av !== bv
    ? ascending
      ? av - bv
      : bv - av
    : a.startTime - b.startTime || a.id - b.id
}

export function sortValue(
  pull: Pull,
  sort: PullSort,
  metric: DpsMetricKey,
  analysis?: PullAnalysis,
  deep: XivanalysisPlayerAnalysis[] = [],
  playerId?: number | null,
): number | null {
  if (sort === 'boss') return pull.bossRemaining
  if (sort === 'progression') return pull.fightRemaining
  if (sort === 'duration') return pull.endTime - pull.startTime
  if (sort === 'chronological') return pull.startTime
  const selectedMetric = sort === 'dps' ? metric : sort === 'uptime' ? 'uptime' : 'deaths'
  return playerId == null
    ? pullMetric(selectedMetric, pull, analysis, deep)
    : playerMetric(
        selectedMetric,
        analysis,
        playerId,
        deep.find((result) => Number(result.actorId) === playerId),
      )
}
