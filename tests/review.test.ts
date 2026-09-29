import { describe, expect, it } from 'vitest'
import { comparePulls, pullMetric, playerMetric, sortValue } from '../shared/review'
import { demoAnalyses, demoReport } from '../shared/demo'
import { classifyAttempt, includeAttempt } from '../shared/attempts'
import { summarize } from '../shared/analysis'

describe('comparable pull review', () => {
  it('uses the selected DPS family and refuses partial raid sums', () => {
    const pull = demoReport.pulls[0]
    const analysis = structuredClone(demoAnalyses[0])
    analysis.performance.forEach((entry, index) => {
      entry.metrics.dps = 100 + index
      entry.metrics.rdps = 200 + index
    })
    expect(playerMetric('rdps', analysis, pull.playerIds[0])).toBe(200)
    expect(pullMetric('rdps', pull, analysis)).toBe(1628)
    analysis.performance[1].metrics.rdps = null
    expect(pullMetric('rdps', pull, analysis)).toBeNull()
    expect(pullMetric('dps', pull, analysis)).toBe(828)
  })

  it('keeps missing values last regardless of sort direction and isolates encounters', () => {
    const a = { ...demoReport.pulls[0], id: 1, bossRemaining: null }
    const b = { ...demoReport.pulls[0], id: 2, bossRemaining: 50 }
    for (const sort of ['boss', 'dps'] as const)
      expect(comparePulls(a, b, sort, (p) => p.bossRemaining)).toBeGreaterThan(0)
    expect(
      comparePulls({ ...a, encounterID: 1 }, { ...b, encounterID: 2 }, 'dps', (p) => p.bossRemaining),
    ).toBeLessThan(0)
  })

  it('does not require damage metrics to compare observed progression', () => {
    const pull = demoReport.pulls[0]
    expect(sortValue(pull, 'boss', 'rdps')).toBe(pull.bossRemaining)
    expect(sortValue(pull, 'dps', 'rdps')).toBeNull()
    expect(playerMetric('uptime')).toBeNull()
  })

  it('excludes a confirmed burst reset consistently from averages and best performance', () => {
    const report = structuredClone(demoReport)
    report.pulls = report.pulls.slice(0, 2)
    const analyses = structuredClone(demoAnalyses.slice(0, 2))
    analyses[0].performance.forEach((entry) => {
      entry.metrics.dps = 30000
    })
    analyses[1].performance.forEach((entry) => {
      entry.metrics.dps = 20000
    })
    const pulls = report.pulls.filter((p) =>
      includeAttempt(
        classifyAttempt(
          p,
          analyses.find((a) => a.fightId === p.id),
          report.pulls,
          p.id === 1 ? { status: 'scrapped', reason: 'Deliberate reset after opening death' } : undefined,
        ),
      ),
    )
    const result = summarize(report, pulls, analyses)
    expect(result.players[0].bestDps.dps).toBe(20000)
    expect(result.players[0].averageDps.dps).toBe(20000)
    expect(result.players[0].pulls).toBe(1)
  })
})
