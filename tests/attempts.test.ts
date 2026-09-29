import { describe, expect, it } from 'vitest'
import {
  attemptStorageKey,
  classifyAttempt,
  createAttemptOverride,
  includeAttempt,
  parseAttemptOverrides,
  serializeAttemptOverrides,
} from '../shared/attempts'
import type { Death, Pull, PullAnalysis } from '../shared/types'

const pull: Pull = {
  id: 1,
  encounterID: 96,
  difficulty: 101,
  name: 'Boss',
  startTime: 100_000,
  endTime: 130_000,
  kill: false,
  bossRemaining: 96,
  fightRemaining: 96,
  playerIds: [1, 2, 3, 4, 5, 6, 7, 8],
}
const reference: Pull = { ...pull, id: 2, startTime: 200_000, endTime: 500_000 }
const death = (playerId: number, seconds: number): Death => ({
  id: `${playerId}:${seconds}`,
  fightId: pull.id,
  playerId,
  timestamp: pull.startTime + seconds * 1000,
  abilityId: null,
  ability: 'Unknown',
  attribution: 'unknown',
  firstDeath: false,
  recentDamage: [],
})
const analysis = (deaths: Death[]): PullAnalysis => ({
  fightId: pull.id,
  deaths,
  limitBreak: [],
  performance: [],
  fetchedAt: 0,
})
const cluster = analysis([death(1, 20), death(2, 22), death(3, 24), death(4, 26)])

describe('attempt review suggestions', () => {
  it('suggests an early clustered wipe but retains it until a user confirms', () => {
    const result = classifyAttempt(pull, cluster, [pull, reference])
    expect(result).toMatchObject({ status: 'suspected-reset', source: 'automatic' })
    expect(result.reason).toContain('failed opening mechanic')
    expect(includeAttempt(result)).toBe(true)
  })

  it('never classifies a short duration alone or unloaded deaths as a reset', () => {
    expect(classifyAttempt(pull, undefined, [reference]).status).toBe('normal')
    expect(classifyAttempt(pull, analysis([]), [reference]).status).toBe('normal')
    expect(classifyAttempt(pull, analysis([death(1, 20)]), [reference]).status).toBe('normal')
  })

  it('requires a longer attempt at the same encounter and difficulty', () => {
    for (const references of [
      [],
      [{ ...reference, encounterID: 97 }],
      [{ ...reference, difficulty: 100 }],
      [pull],
    ]) {
      expect(classifyAttempt(pull, cluster, references).status).toBe('normal')
    }
  })

  it('does not mistake a kill, repeated deaths, or unrelated deaths for a reset', () => {
    expect(classifyAttempt({ ...pull, kill: true }, cluster, [reference]).status).toBe('normal')
    expect(
      classifyAttempt(pull, analysis([death(1, 20), death(1, 22), death(1, 24), death(1, 26)]), [reference])
        .status,
    ).toBe('normal')
    expect(
      classifyAttempt(pull, analysis(cluster.deaths.map((d) => ({ ...d, fightId: 3 }))), [reference]).status,
    ).toBe('normal')
    expect(
      classifyAttempt(pull, analysis(cluster.deaths.map((d) => ({ ...d, playerId: d.playerId + 10 }))), [
        reference,
      ]).status,
    ).toBe('normal')
  })

  it('requires clustered deaths followed quickly by the end of the pull', () => {
    const early = analysis([death(1, 1), death(2, 2), death(3, 3), death(4, 4)])
    const spread = analysis([death(1, 2), death(2, 10), death(3, 20), death(4, 28)])
    expect(classifyAttempt(pull, early, [reference]).status).toBe('normal')
    expect(classifyAttempt(pull, spread, [reference]).status).toBe('normal')
    expect(classifyAttempt({ ...pull, endTime: 200_000 }, cluster, [reference]).status).toBe('normal')
  })

  it('lets explicit decisions override suggestions and restores scrapped pulls on request', () => {
    const scrap = createAttemptOverride('scrapped', '  Deliberate reset after disconnect  ')
    const excluded = classifyAttempt(pull, cluster, [reference], scrap)
    expect(excluded).toEqual({
      status: 'scrapped',
      source: 'manual',
      reason: 'Deliberate reset after disconnect',
    })
    expect(includeAttempt(excluded)).toBe(false)
    expect(includeAttempt(excluded, true)).toBe(true)
    expect(
      classifyAttempt(pull, cluster, [reference], createAttemptOverride('normal', 'Opening mechanic failure'))
        .status,
    ).toBe('normal')
    expect(() => createAttemptOverride('scrapped', '   ')).toThrow('reason')
  })
})

describe('attempt decision persistence', () => {
  it('round-trips decisions by report and fight and isolates report/version mismatches', () => {
    const decisions = {
      1: createAttemptOverride('scrapped', 'Reset'),
      2: createAttemptOverride('normal', 'Keep'),
    }
    const raw = serializeAttemptOverrides('reportA', decisions)
    expect(parseAttemptOverrides(raw, 'reportA')).toEqual(decisions)
    expect(parseAttemptOverrides(raw, 'reportB')).toEqual({})
    expect(parseAttemptOverrides(raw.replace('"version":1', '"version":2'), 'reportA')).toEqual({})
    expect(attemptStorageKey('reportA')).not.toBe(attemptStorageKey('reportB'))
  })

  it('tolerates corrupt storage and ignores invalid entries without losing valid decisions', () => {
    expect(parseAttemptOverrides('{broken', 'reportA')).toEqual({})
    expect(parseAttemptOverrides(null, 'reportA')).toEqual({})
    const raw = JSON.stringify({
      version: 1,
      reportCode: 'reportA',
      overrides: {
        1: { status: 'scrapped', reason: 'Keep this' },
        2: { status: 'scrapped', reason: '' },
        3: { status: 'suspected-reset', reason: 'Cannot persist heuristics as manual decisions' },
        bad: { status: 'scrapped', reason: 'Invalid fight' },
        '-1': { status: 'scrapped', reason: 'Invalid fight' },
      },
    })
    expect(parseAttemptOverrides(raw, 'reportA')).toEqual({ 1: { status: 'scrapped', reason: 'Keep this' } })
  })
})
