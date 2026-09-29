import type { XivanalysisMetricKey, XivanalysisMetricStatus, XivanalysisPlayerAnalysis } from './types'

export const XIVANALYSIS_METRICS: XivanalysisMetricKey[] = [
  'gcdUptime',
  'gcdDowntime',
  'weaving',
  'interrupts',
  'checklist',
  'suggestions',
]

const dependencies: Record<XivanalysisMetricKey, string[]> = {
  gcdUptime: ['abc', 'downtime'],
  gcdDowntime: ['abc'],
  weaving: ['weaving'],
  interrupts: ['interrupts'],
  checklist: ['checklist'],
  suggestions: ['suggestions'],
}

const nonnegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

/** Check errors independently of stored status: old/partial results must not contaminate averages. */
export function getXivanalysisMetricStatus(
  result: XivanalysisPlayerAnalysis,
  key: XivanalysisMetricKey,
): XivanalysisMetricStatus {
  const modules = new Set(dependencies[key])
  const visit = (handle: string) => {
    for (const dependency of result.modules.find((module) => module.handle === handle)?.dependencies ?? []) {
      if (modules.has(dependency)) continue
      modules.add(dependency)
      visit(dependency)
    }
  }
  dependencies[key].forEach(visit)
  const status = (
    state: XivanalysisMetricStatus['state'],
    reason: string | null,
  ): XivanalysisMetricStatus => ({ state, reason, modules: [...modules] })
  const failed = result.modules.filter((module) => modules.has(module.handle) && module.error)
  if (failed.length)
    return status('error', failed.map((module) => `${module.handle}: ${module.error}`).join('; '))

  const supplied = result.metricStatus?.[key]
  if (supplied && supplied.state !== 'measured') return supplied
  if ([...modules].some((handle) => !result.modules.some((module) => module.handle === handle))) {
    return status('unsupported', 'Required analysis module is unavailable.')
  }
  if ((key === 'checklist' || key === 'suggestions') && result.modules.some((module) => module.error)) {
    return status('incomplete', 'One or more contributing modules failed; findings may be incomplete.')
  }

  const uptime = result.uptime
  let valid: boolean
  switch (key) {
    case 'gcdUptime':
      if (uptime.effectiveFightMs === 0) return status('not-applicable', 'No eligible combat time.')
      valid =
        nonnegative(uptime.gcdUptimeMs) &&
        nonnegative(uptime.effectiveFightMs) &&
        uptime.effectiveFightMs > 0 &&
        uptime.gcdUptimeMs <= uptime.effectiveFightMs &&
        nonnegative(uptime.gcdCount) &&
        uptime.gcdCount > 0
      break
    case 'gcdDowntime':
      valid = nonnegative(uptime.gcdDowntimeMs) && nonnegative(uptime.gcdDowntimeCount)
      break
    case 'weaving':
      valid = nonnegative(uptime.weavingDelayMs) && nonnegative(uptime.weavingIssueCount)
      break
    case 'interrupts':
      valid = nonnegative(uptime.interruptedCastDelayMs) && nonnegative(uptime.interruptedCastCount)
      break
    case 'checklist':
      valid = true
      break
    case 'suggestions':
      valid = true
      break
  }
  return valid
    ? status('measured', null)
    : status('incomplete', 'Insufficient valid data to measure this metric.')
}

/** Null invalid numbers at the API boundary as well as guarding aggregation. */
export function sanitizeXivanalysisResult(result: XivanalysisPlayerAnalysis): XivanalysisPlayerAnalysis {
  const metricStatus = Object.fromEntries(
    XIVANALYSIS_METRICS.map((key) => [key, getXivanalysisMetricStatus(result, key)]),
  ) as Record<XivanalysisMetricKey, XivanalysisMetricStatus>
  const uptime = { ...result.uptime }
  if (metricStatus.gcdUptime.state === 'measured') {
    uptime.gcdUptimePercent = (uptime.gcdUptimeMs! / uptime.effectiveFightMs!) * 100
  } else {
    uptime.gcdUptimeMs = null
    uptime.gcdUptimePercent = null
    uptime.gcdCount = null
  }
  if (metricStatus.gcdDowntime.state !== 'measured') {
    uptime.gcdDowntimeMs = null
    uptime.gcdDowntimeCount = null
  }
  if (metricStatus.weaving.state !== 'measured') {
    uptime.weavingDelayMs = null
    uptime.weavingIssueCount = null
  }
  if (metricStatus.interrupts.state !== 'measured') {
    uptime.interruptedCastDelayMs = null
    uptime.interruptedCastCount = null
  }
  if (result.modules.some((module) => module.handle === 'downtime' && module.error)) {
    uptime.unavailableMs = null
    uptime.effectiveFightMs = null
  }
  return { ...result, uptime, metricStatus }
}
