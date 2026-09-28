import { describe, expect, it } from 'vitest'
import { summarizeXivanalysis } from '../shared/xivanalysis'
import type { XivanalysisPlayerAnalysis } from '../shared/types'

function result(
  fightId: number,
  gcdUptimeMs: number | null,
  effectiveFightMs: number | null,
  checklistPassed: boolean[],
): XivanalysisPlayerAnalysis {
  return {
    engineRevision: 'engine',
    adapterVersion: 'adapter',
    reportCode: 'REPORT',
    fightId,
    actorId: '1',
    job: 'GUNBREAKER',
    encounterKey: null,
    adaptedEventCount: 0,
    eventTypes: {},
    moduleCount: 0,
    modules: [],
    uptime: {
      fightDurationMs: effectiveFightMs ?? 100000,
      unavailableMs: 0,
      effectiveFightMs,
      gcdUptimeMs,
      gcdUptimePercent:
        gcdUptimeMs != null && effectiveFightMs ? (gcdUptimeMs / effectiveFightMs) * 100 : null,
      gcdCount: 10,
      gcdDowntimeMs: 1000,
      gcdDowntimeCount: 1,
      weavingDelayMs: 200,
      weavingIssueCount: 1,
      interruptedCastDelayMs: 0,
      interruptedCastCount: 0,
    },
    checklist: checklistPassed.map((passed, index) => ({
      label: `Rule ${index}`,
      percent: passed ? 100 : 50,
      target: 95,
      passed,
      requirements: [],
    })),
    suggestions: [
      {
        severity: 1,
        severityName: 'major',
        value: 1,
        kind: 'TieredSuggestion',
        icon: null,
        content: 'Major issue',
        why: null,
      },
      {
        severity: null,
        severityName: 'ignore',
        value: 0,
        kind: 'TieredSuggestion',
        icon: null,
        content: 'Ignored',
        why: null,
      },
    ],
  }
}

describe('xivanalysis aggregation', () => {
  it('weights GCD uptime by eligible time instead of averaging pull percentages', () => {
    const summary = summarizeXivanalysis([
      result(1, 9000, 10000, [true, false]),
      result(2, 40000, 50000, [true]),
    ])

    expect(summary.gcdUptimePercent).toBeCloseTo((49000 / 60000) * 100)
    expect(summary.gcdPullsMeasured).toBe(2)
    expect(summary.checklistPassed).toBe(2)
    expect(summary.checklistRules).toBe(3)
    expect(summary.gcdDowntimeMs).toBe(2000)
    expect(summary.weavingDelayMs).toBe(400)
    expect(summary.visibleSuggestions).toBe(2)
    expect(summary.severeSuggestions).toBe(2)
  })

  it('does not turn missing uptime into a measured zero', () => {
    const summary = summarizeXivanalysis([result(1, null, null, [])])
    expect(summary.gcdUptimePercent).toBeNull()
    expect(summary.gcdPullsMeasured).toBe(0)
    expect(summary.pullsAnalyzed).toBe(1)
  })
  it('preserves unavailable delay metrics instead of turning them into zero', () => {
    const missing = result(1, null, null, [])
    missing.uptime.gcdDowntimeMs = null
    missing.uptime.gcdDowntimeCount = null
    missing.uptime.weavingDelayMs = null
    missing.uptime.weavingIssueCount = null
    missing.uptime.interruptedCastDelayMs = null
    missing.uptime.interruptedCastCount = null

    const summary = summarizeXivanalysis([missing])
    expect(summary.gcdDowntimeMs).toBeNull()
    expect(summary.gcdDowntimeCount).toBeNull()
    expect(summary.weavingDelayMs).toBeNull()
    expect(summary.interruptedCastDelayMs).toBeNull()
  })
})
