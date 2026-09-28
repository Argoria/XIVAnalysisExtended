import type { XivanalysisPlayerAnalysis } from './types'

export interface XivanalysisAggregate {
  pullsAnalyzed: number
  gcdPullsMeasured: number
  gcdUptimeMs: number
  eligibleGcdMs: number
  gcdUptimePercent: number | null
  gcdDowntimeMs: number
  gcdDowntimeCount: number
  weavingDelayMs: number
  weavingIssueCount: number
  interruptedCastDelayMs: number
  interruptedCastCount: number
  checklistRules: number
  checklistPassed: number
  visibleSuggestions: number
  severeSuggestions: number
}

export function summarizeXivanalysis(results: XivanalysisPlayerAnalysis[]): XivanalysisAggregate {
  let gcdUptimeMs = 0
  let eligibleGcdMs = 0
  let gcdPullsMeasured = 0
  let gcdDowntimeMs = 0
  let gcdDowntimeCount = 0
  let weavingDelayMs = 0
  let weavingIssueCount = 0
  let interruptedCastDelayMs = 0
  let interruptedCastCount = 0
  let checklistRules = 0
  let checklistPassed = 0
  let visibleSuggestions = 0
  let severeSuggestions = 0

  for (const result of results) {
    const uptime = result.uptime
    if (
      uptime.gcdUptimeMs != null &&
      uptime.effectiveFightMs != null &&
      uptime.effectiveFightMs > 0
    ) {
      gcdUptimeMs += uptime.gcdUptimeMs
      eligibleGcdMs += uptime.effectiveFightMs
      gcdPullsMeasured++
    }
    gcdDowntimeMs += uptime.gcdDowntimeMs ?? 0
    gcdDowntimeCount += uptime.gcdDowntimeCount ?? 0
    weavingDelayMs += uptime.weavingDelayMs ?? 0
    weavingIssueCount += uptime.weavingIssueCount ?? 0
    interruptedCastDelayMs += uptime.interruptedCastDelayMs ?? 0
    interruptedCastCount += uptime.interruptedCastCount ?? 0

    checklistRules += result.checklist.length
    checklistPassed += result.checklist.filter((rule) => rule.passed).length

    const visible = result.suggestions.filter((suggestion) => suggestion.severityName !== 'ignore')
    visibleSuggestions += visible.length
    severeSuggestions += visible.filter(
      (suggestion) => suggestion.severity === 0 || suggestion.severity === 1,
    ).length
  }

  return {
    pullsAnalyzed: results.length,
    gcdPullsMeasured,
    gcdUptimeMs,
    eligibleGcdMs,
    gcdUptimePercent: eligibleGcdMs > 0 ? (gcdUptimeMs / eligibleGcdMs) * 100 : null,
    gcdDowntimeMs,
    gcdDowntimeCount,
    weavingDelayMs,
    weavingIssueCount,
    interruptedCastDelayMs,
    interruptedCastCount,
    checklistRules,
    checklistPassed,
    visibleSuggestions,
    severeSuggestions,
  }
}
