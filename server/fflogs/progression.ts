import type { ProgressionMarker, Pull } from '../../shared/types'
import type { RawEvent, RawReport } from './schema'

export function progressionMarkers(raw: RawReport, pull: Pull, events: RawEvent[]): ProgressionMarker[] {
  const fight = raw.fights.find((candidate) => candidate.id === pull.id)
  const actorNames = new Map(raw.masterData.actors.map((actor) => [actor.id, actor.name]))
  const enemiesInFight = (fight?.enemyNPCs ?? []).filter((actor): actor is NonNullable<typeof actor> => actor != null)
  const namedBosses = enemiesInFight.filter((actor) =>
    actor && actorNames.get(actor.id)?.localeCompare(pull.name, undefined, { sensitivity: 'base' }) === 0,
  )
  const bossActors = namedBosses.length ? namedBosses : enemiesInFight.length === 1 ? enemiesInFight : []
  const enemies = new Set(bossActors.map((actor) => actor.id))
  const abilities = new Map(raw.masterData.abilities.map((ability) => [ability.gameID, ability.name]))
  const counts = new Map<string, number>()
  const lastCast = new Map<string, number>()
  const markers: ProgressionMarker[] = []

  for (const event of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
    const id = event.abilityGameID
    if (event.type !== 'cast' || id == null || !enemies.has(event.sourceID ?? -1)) continue
    if (event.timestamp < pull.startTime || event.timestamp > pull.endTime) continue
    if (event.fight != null && event.fight !== pull.id) continue
    const name = abilities.get(id)
    if (!name) continue
    // Multiple enemy instances may log the same simultaneous cast.
    if (event.timestamp - (lastCast.get(name) ?? -Infinity) < 250) continue
    lastCast.set(name, event.timestamp)
    const occurrence = (counts.get(name) ?? 0) + 1
    counts.set(name, occurrence)
    markers.push({ abilityId: id, name, occurrence, timestamp: event.timestamp })
  }
  return markers
}
