import { expect, it } from 'vitest'
import { progressionMarkers } from '../server/fflogs/progression'
import { normalizeReport } from '../server/fflogs/normalize'
import { event, fixture } from './fixtures'

it('numbers repeated boss casts and ignores player or duplicate casts', () => {
  const pull = normalizeReport(fixture).pulls[0]
  const markers = progressionMarkers(fixture, pull, [
    event('cast', 70000, { sourceID: 20, abilityGameID: 100, fight: 1 }),
    event('cast', 70030, { sourceID: 20, abilityGameID: 100, fight: 1 }),
    event('cast', 75000, { sourceID: 1, abilityGameID: 100, fight: 1 }),
    event('cast', 90000, { sourceID: 20, abilityGameID: 100, fight: 1 }),
    event('cast', 95000, { sourceID: 20, abilityGameID: 100, fight: 2 }),
  ])
  expect(markers.map(({ name, occurrence }) => `${name} #${occurrence}`)).toEqual([
    'Raidwide #1',
    'Raidwide #2',
  ])
})
