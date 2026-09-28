import { describe, expect, it } from 'vitest'
import { normalizeReport } from '../server/fflogs/normalize'
import { buildXivanalysisCompatInput } from '../server/xivanalysis/v2-adapter'
import { fixture } from './fixtures'

describe('FFLogs v2 → xivanalysis compatibility adapter', () => {
  const pull = normalizeReport(fixture).pulls[0]

  it('uses combatTime for parser timing and v2 0–100 progression semantics', () => {
    const input = buildXivanalysisCompatInput(fixture, pull, [])
    expect(input.pull).toMatchObject({
      id: '1',
      fightId: 1,
      duration: 90000,
      timestamp: fixture.startTime + 70000,
      firstEventTimestamp: fixture.startTime + 60000,
      progress: 35,
      encounterID: 96,
      difficulty: 101,
      gameZone: { id: 1234, name: 'Fixture Arena' },
    })
  })

  it('derives legacy friendliness flags and preserves v2 event payloads unchanged', () => {
    const ability = { guid: 101, name: 'Attack', type: 128, abilityIcon: 'attack.png' }
    const resources = { hitPoints: 90000, maxHitPoints: 100000, x: 10, y: 20 }
    const input = buildXivanalysisCompatInput(fixture, pull, [
      {
        timestamp: 80000,
        type: 'calculateddamage',
        fight: 1,
        sourceID: 1,
        targetID: 20,
        sourceInstance: 2,
        ability,
        targetResources: resources,
        packetID: 42,
        amount: 12345,
      },
      {
        timestamp: 81000,
        type: 'calculatedheal',
        fight: 1,
        sourceID: 12,
        targetID: 1,
        ability: { guid: 102, name: 'Embrace', type: 8 },
      },
    ])

    expect(input.events[0]).toMatchObject({
      sourceIsFriendly: true,
      targetIsFriendly: false,
      sourceInstance: 2,
      ability,
      targetResources: resources,
      packetID: 42,
      amount: 12345,
    })
    expect(input.events[1]).toMatchObject({
      sourceIsFriendly: true,
      targetIsFriendly: true,
    })
  })

  it('retains actor ownership for upstream actor construction without using it for DPS', () => {
    const input = buildXivanalysisCompatInput(fixture, pull, [])
    expect(input.actors.find((actor) => actor.id === '12')).toMatchObject({
      team: 'FRIEND',
      playerControlled: false,
      ownerId: '2',
      instanceCount: 1,
    })
    expect(input.actors.find((actor) => actor.id === '20')).toMatchObject({
      team: 'FOE',
      playerControlled: false,
    })
  })
})
