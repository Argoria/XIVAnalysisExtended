import { expect, it } from 'vitest'
import { progressionMarkers, type EncounterCheckpointDefinition } from '../server/fflogs/progression'
import {
  checkpointKey,
  checkpointOptions,
  furthestCheckpoint,
  reachedCheckpoint,
} from '../shared/progression'
import { normalizeReport } from '../server/fflogs/normalize'
import { event, fixture } from './fixtures'

it('numbers repeated boss casts and ignores player or duplicate casts', () => {
  const pull = normalizeReport(fixture).pulls[0]
  const report = {
    ...fixture,
    masterData: {
      ...fixture.masterData,
      abilities: [...fixture.masterData.abilities, { gameID: 102, name: 'Raidwide' }],
    },
  }
  const markers = progressionMarkers(report, pull, [
    event('cast', 70000, { sourceID: 20, abilityGameID: 100, fight: 1 }),
    event('cast', 70030, { sourceID: 20, abilityGameID: 100, fight: 1 }),
    event('cast', 75000, { sourceID: 1, abilityGameID: 100, fight: 1 }),
    event('cast', 90000, { sourceID: 20, abilityGameID: 100, fight: 1 }),
    event('cast', 100000, { sourceID: 20, abilityGameID: 102, fight: 1 }),
    event('cast', 95000, { sourceID: 20, abilityGameID: 100, fight: 2 }),
  ])
  expect(markers.map(({ name, occurrence }) => `${name} #${occurrence}`)).toEqual([
    'Raidwide #1',
    'Raidwide #2',
    'Raidwide #3',
  ])
})

it('uses selected Vamp Fatale anchors without claiming verified phases or completion', () => {
  const pull = { ...normalizeReport(fixture).pulls[0], name: 'Vamp Fatale' }
  const report = {
    ...fixture,
    masterData: {
      ...fixture.masterData,
      abilities: [
        { gameID: 100, name: 'Sadistic Screech' },
        { gameID: 101, name: 'Attack' },
      ],
    },
  }
  const markers = progressionMarkers(report, pull, [
    event('cast', 70000, { sourceID: 20, abilityGameID: 100 }),
    event('cast', 90000, { sourceID: 20, abilityGameID: 100 }),
    event('cast', 100000, { sourceID: 20, abilityGameID: 101 }),
  ])
  expect(markers[1]).toMatchObject({
    checkpointId: 'vamp-fatale-candidates:sadistic-screech',
    occurrence: 2,
    kind: 'checkpoint',
    confidence: 'provisional',
    reached: true,
    completed: null,
    bossHpPercent: null,
  })
  expect(furthestCheckpoint(markers)).toBe(markers[1])
  expect(reachedCheckpoint(markers, checkpointKey(markers[1]))).toBe(true)
  expect(reachedCheckpoint(markers, 'vamp-fatale-candidates:sadistic-screech#3')).toBe(false)
})

it('takes HP only from a valid casting-boss snapshot, never target or terminal HP', () => {
  const pull = normalizeReport(fixture).pulls[0]
  const markers = progressionMarkers(fixture, pull, [
    event('cast', 70000, {
      sourceID: 20,
      abilityGameID: 100,
      sourceResources: { hitPoints: 800, maxHitPoints: 1000 },
    }),
    event('cast', 80000, {
      sourceID: 20,
      abilityGameID: 100,
      targetResources: { hitPoints: 600, maxHitPoints: 1000 },
    }),
    event('cast', 90000, { sourceID: 20, abilityGameID: 100, sourceResources: { hitPoints: 500 } }),
    event('cast', 100000, {
      sourceID: 20,
      abilityGameID: 100,
      sourceResources: { hitPoints: 500, maxHitPoints: 0 },
    }),
    event('cast', 110000, {
      sourceID: 20,
      abilityGameID: 100,
      sourceResources: { hitPoints: 500, maxHitPoints: 400 },
    }),
  ])
  expect(markers.map((marker) => marker.bossHpPercent)).toEqual([80, null, null, null, null])
})

it('verified definitions require matching encounter, difficulty and ability IDs', () => {
  const pull = normalizeReport(fixture).pulls[0]
  const definitions: EncounterCheckpointDefinition[] = [
    {
      id: 'test-fixture',
      confidence: 'verified',
      encounterID: pull.encounterID,
      difficulty: pull.difficulty,
      checkpoints: [
        { id: 'test-anchor', abilityIds: [100] },
        { id: 'invalid-name-only', abilityName: 'Attack' },
      ],
    },
  ]
  const events = [
    event('cast', 70000, { sourceID: 20, abilityGameID: 100 }),
    event('cast', 80000, { sourceID: 20, abilityGameID: 101 }),
  ]
  expect(progressionMarkers(fixture, pull, events, definitions).map((marker) => marker.confidence)).toEqual([
    'verified',
    'provisional',
  ])
  expect(progressionMarkers(fixture, { ...pull, difficulty: 999 }, events, definitions)[0].confidence).toBe(
    'provisional',
  )
})

it('keeps checkpoint HP comparison scoped to encounter and difficulty with measured coverage', () => {
  const [pull] = normalizeReport(fixture).pulls
  const secondPull = { ...pull, id: 3 }
  const otherDifficulty = { ...pull, id: 4, difficulty: 999 }
  const makeMarkers = (hp?: number) =>
    progressionMarkers(fixture, pull, [
      event('cast', 70000, {
        sourceID: 20,
        abilityGameID: 100,
        ...(hp == null ? {} : { sourceResources: { hitPoints: hp, maxHitPoints: 100 } }),
      }),
    ])
  const options = checkpointOptions([pull, secondPull, otherDifficulty], {
    [pull.id]: makeMarkers(80),
    [secondPull.id]: makeMarkers(),
    [otherDifficulty.id]: makeMarkers(20),
  })
  expect(options).toHaveLength(2)
  expect(options[0]).toMatchObject({
    label: 'Raidwide #1',
    reachedPulls: 2,
    hpMeasuredPulls: 1,
    bestBossHpPercent: 80,
  })
  expect(options[1]).toMatchObject({ difficulty: 999, reachedPulls: 1, bestBossHpPercent: 20 })
})
