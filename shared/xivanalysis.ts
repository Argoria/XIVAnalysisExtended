import type { XivanalysisPlayerAnalysis } from './types'

export interface XivanalysisAggregate {
  playerPullsAnalyzed: number
  gcdPlayerPullsMeasured: number
  gcdUptimeMs: number
  eligibleGcdMs: number
  gcdUptimePercent: number | null
  gcdDowntimeMs: number | null
  gcdDowntimeCount: number | null
  weavingDelayMs: number | null
  weavingIssueCount: number | null
  interruptedCastDelayMs: number | null
  interruptedCastCount: number | null
  checklistRules: number
  checklistPassed: number
  visibleSuggestions: number
  severeSuggestions: number
}

export function summarizeXivanalysis(results: XivanalysisPlayerAnalysis[]): XivanalysisAggregate {
  let gcdUptimeMs = 0
  let eligibleGcdMs = 0
  let gcdPlayerPullsMeasured = 0
  let gcdDowntimeMs = 0
  let gcdDowntimeCount = 0
  let gcdDowntimeMeasured = 0
  let weavingDelayMs = 0
  let weavingIssueCount = 0
  let weavingMeasured = 0
  let interruptedCastDelayMs = 0
  let interruptedCastCount = 0
  let interruptedCastMeasured = 0
  let checklistRules = 0
  let checklistPassed = 0
  let visibleSuggestions = 0
  let severeSuggestions = 0

  for (const result of results) {
    const uptime = result.uptime
    if (uptime.gcdUptimeMs != null && uptime.effectiveFightMs != null && uptime.effectiveFightMs > 0) {
      gcdUptimeMs += uptime.gcdUptimeMs
      eligibleGcdMs += uptime.effectiveFightMs
      gcdPlayerPullsMeasured++
    }
    if (uptime.gcdDowntimeMs != null && uptime.gcdDowntimeCount != null) {
      gcdDowntimeMs += uptime.gcdDowntimeMs
      gcdDowntimeCount += uptime.gcdDowntimeCount
      gcdDowntimeMeasured++
    }
    if (uptime.weavingDelayMs != null && uptime.weavingIssueCount != null) {
      weavingDelayMs += uptime.weavingDelayMs
      weavingIssueCount += uptime.weavingIssueCount
      weavingMeasured++
    }
    if (uptime.interruptedCastDelayMs != null && uptime.interruptedCastCount != null) {
      interruptedCastDelayMs += uptime.interruptedCastDelayMs
      interruptedCastCount += uptime.interruptedCastCount
      interruptedCastMeasured++
    }

    checklistRules += result.checklist.length
    checklistPassed += result.checklist.filter((rule) => rule.passed).length

    const visible = result.suggestions.filter((suggestion) => suggestion.severityName !== 'ignore')
    visibleSuggestions += visible.length
    severeSuggestions += visible.filter(
      (suggestion) => suggestion.severity === 0 || suggestion.severity === 1,
    ).length
  }

  return {
    playerPullsAnalyzed: results.length,
    gcdPlayerPullsMeasured,
    gcdUptimeMs,
    eligibleGcdMs,
    gcdUptimePercent: eligibleGcdMs > 0 ? (gcdUptimeMs / eligibleGcdMs) * 100 : null,
    gcdDowntimeMs: gcdDowntimeMeasured ? gcdDowntimeMs : null,
    gcdDowntimeCount: gcdDowntimeMeasured ? gcdDowntimeCount : null,
    weavingDelayMs: weavingMeasured ? weavingDelayMs : null,
    weavingIssueCount: weavingMeasured ? weavingIssueCount : null,
    interruptedCastDelayMs: interruptedCastMeasured ? interruptedCastDelayMs : null,
    interruptedCastCount: interruptedCastMeasured ? interruptedCastCount : null,
    checklistRules,
    checklistPassed,
    visibleSuggestions,
    severeSuggestions,
  }
}
