import { describe, expect, it } from 'vitest'
import { analyzePull, normalizeReport } from '../server/fflogs/normalize'
import { summarize } from '../shared/analysis'
import { parseReportInput } from '../shared/report-input'
import { fixture, event } from './fixtures'

describe('report input', () => {
  it('accepts codes and URL query/fragment selections', () => {
    expect(parseReportInput(' nvM2FT6QLkJ4Bb19 ')).toEqual({ code: fixture.code })
    expect(parseReportInput(`https://www.fflogs.com/reports/${fixture.code}?fight=4`).fightId).toBe(4)
    expect(parseReportInput(`https://www.fflogs.com/reports/${fixture.code}#fight=last`).fightId).toBe('last')
  })
  it.each([
    'https://fflogs.com.evil.test/reports/nvM2FT6QLkJ4Bb19',
    'https://evil.test/reports/nvM2FT6QLkJ4Bb19',
    'http://fflogs.com/reports/nvM2FT6QLkJ4Bb19',
    'https://user:password@fflogs.com/reports/nvM2FT6QLkJ4Bb19',
    'not-a-report',
  ])('rejects invalid or lookalike input: %s', (input) => {
    expect(() => parseReportInput(input)).toThrow()
  })
})

describe('encounter and actor isolation', () => {
  it('removes area trash, unrelated players, pets, NPCs and both LB actors', () => {
    const report = normalizeReport(fixture)
    expect(report.ignoredSegments).toBe(1)
    expect(report.pulls.map((p) => p.id)).toEqual([1, 2])
    expect(report.players.map((p) => p.id)).toEqual([1, 2, 3])
    expect(report.pulls[0].playerIds).toEqual([1, 2])
    expect(report.limitBreakActorIds).toEqual([10, 11])
  })
  it('keeps v2 boss health separate from encounter progression, and does not rescale it', () => {
    const report = normalizeReport(fixture)
    expect(report.pulls[0]).toMatchObject({ bossRemaining: 40, fightRemaining: 65 })
    expect(report.pulls[1]).toMatchObject({ bossRemaining: 0, fightRemaining: 0 })
  })
  it('keeps missing progression unknown and rejects missing participation', () => {
    const raw = structuredClone(fixture)
    raw.fights[1].fightPercentage = undefined
    expect(normalizeReport(raw).pulls[0].fightRemaining).toBeNull()
    raw.fights[1].friendlyPlayers = null
    expect(() => normalizeReport(raw)).toThrow('participants')
  })
})

describe('death evidence', () => {
  const pull = normalizeReport(fixture).pulls[0]
  it('prefers the recorded killing ability over a later unrelated hit', () => {
    const result = analyzePull(fixture, pull, [
      event('damage', 80000, { targetID: 1, abilityGameID: 101, sourceID: 20, amount: 100, overkill: 10 }),
      event('death', 80001, { targetID: 1, killingAbilityGameID: 100 }),
    ])
    expect(result.deaths[0]).toMatchObject({ ability: 'Raidwide', attribution: 'recorded', firstDeath: true })
    expect(result.deaths[0].recentDamage[0]).toMatchObject({ source: 'Boss', ability: 'Attack' })
  })
  it('uses a lethal hit only with evidence and keeps arbitrary recent damage unassigned', () => {
    const result = analyzePull(fixture, pull, [
      event('damage', 79000, { targetID: 1, abilityGameID: 101, amount: 100, overkill: -1 }),
      event('death', 80000, { targetID: 1 }),
      event('damage', 89990, { targetID: 2, abilityGameID: 100, amount: 200, overkill: 12 }),
      event('death', 90000, { targetID: 2 }),
    ])
    expect(result.deaths[0]).toMatchObject({ abilityId: null, attribution: 'unknown' })
    expect(result.deaths[1]).toMatchObject({ abilityId: 100, attribution: 'lethal-hit' })
  })
  it('does not turn an old lethal hit into the cause of a later death', () => {
    const result = analyzePull(fixture, pull, [
      event('damage', 75000, { targetID: 1, abilityGameID: 100, overkill: 500 }),
      event('death', 80000, { targetID: 1 }),
    ])
    expect(result.deaths[0].attribution).toBe('unknown')
    expect(result.deaths[0].recentDamage).toHaveLength(1)
  })
  it('deduplicates paginated deaths, preserves later deaths, and isolates prior-life evidence', () => {
    const death = event('death', 80000, { targetID: 1 })
    const result = analyzePull(fixture, pull, [
      event('damage', 79990, { targetID: 1, abilityGameID: 100, overkill: 500 }),
      death,
      { ...death },
      event('resurrect', 81000, { targetID: 1 }),
      event('death', 82000, { targetID: 1 }),
    ])
    expect(result.deaths).toHaveLength(2)
    expect(result.deaths[1]).toMatchObject({ attribution: 'unknown', recentDamage: [], firstDeath: false })
  })
  it('filters out-of-pull, unrelated actor, enemy, pet and LB deaths', () => {
    const result = analyzePull(fixture, pull, [
      event('death', 50000, { targetID: 1 }),
      event('death', 170000, { targetID: 1 }),
      ...[3, 4, 10, 11, 12, 20].map((targetID) => event('death', 80000, { targetID })),
      event('death', 80000, { targetID: 1, fight: 2 }),
    ])
    expect(result.deaths).toHaveLength(0)
  })
  it('sorts events and marks simultaneous first deaths as tied', () => {
    const result = analyzePull(fixture, pull, [
      event('death', 100000, { targetID: 2 }),
      event('death', 80000, { targetID: 2 }),
      event('death', 80000, { targetID: 1 }),
    ])
    expect(result.deaths.map((d) => d.firstDeath)).toEqual([true, true, false])
  })
  it('keeps unknown ability IDs distinct instead of conflating names', () => {
    const result = analyzePull(fixture, pull, [
      event('death', 80000, { targetID: 1, killingAbilityGameID: 98765 }),
    ])
    expect(result.deaths[0]).toMatchObject({
      abilityId: 98765,
      ability: 'Ability 98765',
      attribution: 'recorded',
    })
  })
  it('attaches FFLogs-provided DPS metrics without recomputing damage', () => {
    const metrics = new Map([[1, { dps: 15000, rdps: 14750, ndps: 14500, cdps: 15200, adps: null }]])
    const result = analyzePull(fixture, pull, [], metrics)
    expect(result.performance.find((entry) => entry.playerId === 1)?.metrics).toEqual({
      dps: 15000,
      rdps: 14750,
      ndps: 14500,
      cdps: 15200,
      adps: null,
    })
    expect(result.performance.find((entry) => entry.playerId === 2)?.metrics).toEqual({
      dps: null,
      rdps: null,
      ndps: null,
      cdps: null,
      adps: null,
    })
  })

  it('groups duplicate LB entities while preserving actor IDs and distinct cast times', () => {
    const result = analyzePull(fixture, pull, [
      event('cast', 80000, { sourceID: 10, abilityGameID: 200 }),
      event('cast', 80000, { sourceID: 11, abilityGameID: 200 }),
      event('cast', 100000, { sourceID: 10, abilityGameID: 200 }),
      event('cast', 80000, { sourceID: 1, abilityGameID: 101 }),
    ])
    expect(result.limitBreak).toHaveLength(2)
    expect(result.limitBreak[0].actorIds).toEqual([10, 11])
  })
})

describe('aggregation', () => {
  const report = normalizeReport(fixture)
  const first = analyzePull(fixture, report.pulls[0], [
    event('death', 80000, { targetID: 1, killingAbilityGameID: 100 }),
    event('death', 90000, { targetID: 1, killingAbilityGameID: 100 }),
    event('death', 100000, { targetID: 2 }),
  ])
  const second = analyzePull(fixture, report.pulls[1], [])
  it('uses individual participation denominators and counts clean pulls only when analyzed', () => {
    const summary = summarize(report, report.pulls, [first, second])
    expect(summary.players.find((p) => p.id === 1)).toMatchObject({
      pulls: 2,
      deaths: 2,
      deathsPerPull: 1,
      deathFreePulls: 1,
      averageDps: { dps: null, rdps: null, ndps: null, cdps: null, adps: null },
      bestDps: { dps: null, rdps: null, ndps: null, cdps: null, adps: null },
    })
    expect(summary.players.find((p) => p.id === 2)).toMatchObject({ pulls: 1, deaths: 1, deathsPerPull: 1 })
    expect(summary.players.find((p) => p.id === 3)).toMatchObject({ pulls: 1, deaths: 0, deathFreePulls: 1 })
    expect(summary).toMatchObject({ cleanPulls: 1, totalDuration: 300000, kills: 1 })
    expect(summary.causes[0]).toMatchObject({ deaths: 2, affectedPulls: 1, firstDeaths: 1 })
  })
  it('never treats an unloaded/failed pull as zero deaths', () => {
    const summary = summarize(report, report.pulls, [first])
    expect(summary.cleanPulls).toBe(0)
    expect(summary.players.some((p) => p.id === 3)).toBe(false)
    expect(summary.players.find((p) => p.id === 1)?.deathsPerPull).toBe(2)
    expect(summary.totalDuration).toBe(100000)
  })
  it('excludes cached results outside the selected pulls', () => {
    const summary = summarize(report, [report.pulls[1]], [first, second])
    expect(summary.deaths).toHaveLength(0)
    expect(summary.players.map((p) => p.id)).toEqual([3, 1])
  })
})
