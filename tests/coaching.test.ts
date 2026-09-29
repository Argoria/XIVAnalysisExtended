import { describe, expect, it } from 'vitest'
import { buildSessionReview } from '../shared/coaching'
import type { Pull, PullAnalysis, Report, XivanalysisPlayerAnalysis } from '../shared/types'

const pull = (id: number, changes: Partial<Pull> = {}): Pull => ({
  id,
  encounterID: 1,
  difficulty: 100,
  name: 'Encounter',
  startTime: 0,
  endTime: 100000,
  kill: false,
  bossRemaining: 40,
  fightRemaining: 40,
  playerIds: [1],
  ...changes,
})
const pulls = [pull(1), pull(2), pull(3)]
const report: Report = {
  code: 'REPORT',
  title: 'Test',
  startTime: 0,
  endTime: 1000000,
  pulls,
  players: [{ id: 1, name: 'Player', job: 'GNB', role: 'tank' }],
  limitBreakActorIds: [],
  ignoredSegments: 0,
  source: 'fflogs',
}
const deathAnalysis = (fightId: number): PullAnalysis => ({
  fightId,
  fetchedAt: 0,
  limitBreak: [],
  performance: [],
  deaths: [
    {
      id: `death:${fightId}`,
      fightId,
      playerId: 1,
      firstDeath: true,
      timestamp: 10000,
      abilityId: 10,
      ability: 'Raidwide',
      attribution: 'recorded',
      recentDamage: [],
    },
  ],
})
const deep = (fightId: number): XivanalysisPlayerAnalysis => ({
  reportCode: 'REPORT',
  fightId,
  actorId: '1',
  job: 'GNB',
  engineRevision: 'a',
  adapterVersion: 'b',
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
    fightDurationMs: 100000,
    effectiveFightMs: 100000,
    gcdUptimeMs: 90000,
    gcdUptimePercent: 90,
    gcdCount: 30,
    unavailableMs: 0,
    gcdDowntimeMs: 10000,
    gcdDowntimeCount: 1,
    weavingDelayMs: 0,
    weavingIssueCount: 0,
    interruptedCastDelayMs: 0,
    interruptedCastCount: 0,
  },
  checklist: [{ label: 'Keep rolling', percent: 70, target: 95, passed: false, requirements: [] }],
  suggestions: [
    {
      kind: 'Suggestion',
      severity: 1,
      severityName: 'major',
      value: 1,
      icon: null,
      content: 'Review weaving',
      why: null,
    },
  ],
})

describe('session review evidence', () => {
  it('counts recurring deaths per loaded pull rather than assuming unloaded pulls were clean', () => {
    const review = buildSessionReview(report, pulls, [deathAnalysis(1), deathAnalysis(2)], [])[0]
    expect(review.deathCoverage).toBe(2)
    expect(review.pullCount).toBe(3)
    expect(review.items.find((item) => item.kind === 'deaths')).toMatchObject({
      occurrences: 2,
      evaluated: 2,
      pullId: 1,
      playerId: 1,
    })
    expect(review.items.find((item) => item.kind === 'first-deaths')).toMatchObject({
      occurrences: 2,
      evaluated: 2,
    })
  })

  it('keeps encounter and difficulty comparisons separate and prefers a kill within its own group', () => {
    const mixed = [
      pull(1),
      pull(2, { kill: true }),
      pull(3, { encounterID: 2, fightRemaining: 1 }),
      pull(4, { difficulty: 101, fightRemaining: 2 }),
    ]
    const reviews = buildSessionReview(report, mixed, [], [])
    expect(reviews).toHaveLength(3)
    expect(reviews.map((review) => review.items.find((item) => item.kind === 'progression')?.pullId)).toEqual(
      [2, 3, 4],
    )
  })

  it('counts a checklist denominator only where the measured rule was present', () => {
    const unrelated = deep(3)
    unrelated.checklist = []
    const review = buildSessionReview(report, pulls, [], [deep(1), deep(2), unrelated])[0]
    expect(review.items.find((item) => item.kind === 'checklist')).toMatchObject({
      occurrences: 2,
      evaluated: 2,
    })
    expect(review.items.find((item) => item.kind === 'suggestion')).toMatchObject({
      occurrences: 3,
      evaluated: 3,
    })
  })

  it('deduplicates results and rejects wrong reports, excluded pulls, and failed finding modules', () => {
    const failed = deep(2)
    failed.modules = [{ handle: 'job-module', type: 'Module', error: 'failed' }]
    const wrongReport = { ...deep(2), reportCode: 'OTHER' }
    const review = buildSessionReview(report, pulls, [], [deep(1), deep(1), failed, wrongReport, deep(99)])[0]
    expect(review.deepCoverage).toBe(2)
    expect(review.items.some((item) => item.kind === 'checklist' || item.kind === 'suggestion')).toBe(false)
  })

  it('selects highest measured uptime for the chosen player and rejects stale numbers from failed metrics', () => {
    const good = deep(1)
    const bad = deep(2)
    bad.uptime.gcdUptimeMs = 99000
    bad.modules = [{ handle: 'abc', type: 'Module', error: 'failed' }]
    const review = buildSessionReview(report, pulls, [], [good, bad], 1)[0]
    expect(review.items.find((item) => item.kind === 'uptime')).toMatchObject({ pullId: 1, playerId: 1 })
    expect(review.items.find((item) => item.kind === 'uptime')?.detail).toContain('90.0%')
    expect(
      buildSessionReview(report, pulls, [], [good])[0].items.some((item) => item.kind === 'uptime'),
    ).toBe(false)
  })

  it('keeps the review bounded and links every observation to an eligible example', () => {
    const review = buildSessionReview(
      report,
      pulls,
      pulls.map((p) => deathAnalysis(p.id)),
      pulls.map((p) => deep(p.id)),
      1,
    )[0]
    expect(review.items).toHaveLength(5)
    expect(review.items.every((item) => pulls.some((p) => p.id === item.pullId))).toBe(true)
    expect(review.items.some((item) => item.kind === 'progression')).toBe(true)
    expect(review.items.some((item) => item.kind === 'uptime')).toBe(true)
  })
})
