import { describe, expect, it } from 'vitest'
import { getXivanalysisMetricStatus, summarizeXivanalysis } from '../shared/xivanalysis'
import { sanitizeXivanalysisResult } from '../shared/xivanalysis-integrity'
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
    moduleCount: 6,
    modules: ['abc', 'downtime', 'weaving', 'interrupts', 'checklist', 'suggestions'].map((handle) => ({
      handle,
      type: handle,
      error: null,
    })),
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
    expect(summary.gcdPlayerPullsMeasured).toBe(2)
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
    expect(summary.gcdPlayerPullsMeasured).toBe(0)
    expect(summary.playerPullsAnalyzed).toBe(1)
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

describe('metric integrity', () => {
  it('excludes failed uptime but preserves independent weaving metrics', () => {
    const failed = result(1, 9000, 10000, [true])
    failed.modules = [
      { handle: 'abc', type: 'AlwaysBeCasting', error: 'Cannot calculate uptime' },
      { handle: 'downtime', type: 'Downtime', error: null },
      { handle: 'weaving', type: 'Weaving', error: null },
      { handle: 'checklist', type: 'Checklist', error: null },
      { handle: 'suggestions', type: 'Suggestions', error: null },
    ]
    const summary = summarizeXivanalysis([failed, result(2, 8000, 10000, [true])])
    expect(summary.gcdUptimePercent).toBe(80)
    expect(summary.gcdPlayerPullsMeasured).toBe(1)
    expect(summary.metricCoverage.gcdUptime).toMatchObject({ error: 1, measured: 1 })
    expect(summary.weavingDelayMs).toBe(400)
    expect(summary.checklistRules).toBe(1)
    expect(summary.metricCoverage.checklist.incomplete).toBe(1)
    const sanitized = sanitizeXivanalysisResult(failed)
    expect(sanitized.uptime.gcdUptimePercent).toBeNull()
    expect(sanitized.uptime.weavingDelayMs).toBe(200)
  })

  it('invalidates dependent metrics even if an extraction-time error was not cascaded', () => {
    const failed = result(1, 9000, 10000, [])
    failed.modules = [
      { handle: 'abc', type: 'ABC', error: null, dependencies: ['speed'] },
      { handle: 'speed', type: 'Speed', error: null, dependencies: ['data'] },
      { handle: 'data', type: 'Data', error: 'invalid data' },
      { handle: 'downtime', type: 'Downtime', error: null },
    ]
    expect(getXivanalysisMetricStatus(failed, 'gcdUptime').state).toBe('error')
    expect(summarizeXivanalysis([failed]).gcdUptimePercent).toBeNull()
  })

  it('does not trust stale measured metadata over module failure', () => {
    const failed = sanitizeXivanalysisResult(result(1, 9000, 10000, []))
    failed.modules = [{ handle: 'abc', type: 'ABC', error: 'failure' }]
    expect(getXivanalysisMetricStatus(failed, 'gcdUptime').state).toBe('error')
  })

  it('distinguishes missing support, incomplete measurement, and no eligible combat time', () => {
    const missing = result(1, null, null, [])
    expect(getXivanalysisMetricStatus(missing, 'gcdUptime').state).toBe('incomplete')
    missing.modules = [{ handle: 'checklist', type: 'Checklist', error: null }]
    expect(getXivanalysisMetricStatus(missing, 'gcdUptime').state).toBe('unsupported')
    const unavailable = result(2, 0, 0, [])
    expect(getXivanalysisMetricStatus(unavailable, 'gcdUptime').state).toBe('not-applicable')
  })

  it('does not treat an empty module bundle as measured coverage', () => {
    const empty = result(1, 9000, 10000, [])
    empty.modules = []
    empty.moduleCount = 0
    expect(getXivanalysisMetricStatus(empty, 'gcdUptime').state).toBe('unsupported')
    expect(getXivanalysisMetricStatus(empty, 'checklist').state).toBe('unsupported')
  })

  it('rejects invalid and impossible numeric measurements instead of making a ranking', () => {
    const invalid = result(1, 15000, 10000, [])
    invalid.uptime.weavingDelayMs = -1
    invalid.uptime.interruptedCastDelayMs = Number.NaN
    const summary = summarizeXivanalysis([invalid])
    expect(summary.gcdUptimePercent).toBeNull()
    expect(summary.weavingDelayMs).toBeNull()
    expect(summary.interruptedCastDelayMs).toBeNull()
    expect(summary.metricCoverage.gcdUptime.incomplete).toBe(1)
  })
})
