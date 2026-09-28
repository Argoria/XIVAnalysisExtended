import type { ProgressionMarker, Pull } from '../../shared/types'
import type { RawEvent, RawReport } from './schema'

export function progressionMarkers(raw: RawReport, pull: Pull, events: RawEvent[]): ProgressionMarker[] {
  const fight = raw.fights.find((candidate) => candidate.id === pull.id)
  const enemies = new Set(fight?.enemyNPCs?.map((actor) => actor?.id).filter((id): id is number => id != null))
  const abilities = new Map(raw.masterData.abilities.map((ability) => [ability.gameID, ability.name]))
  const counts = new Map<number, number>()
  const lastCast = new Map<number, number>()
  const markers: ProgressionMarker[] = []

  for (const event of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
    const id = event.abilityGameID
    if (event.type !== 'cast' || id == null || !enemies.has(event.sourceID ?? -1)) continue
    if (event.timestamp < pull.startTime || event.timestamp > pull.endTime) continue
    if (event.fight != null && event.fight !== pull.id) continue
    const name = abilities.get(id)
    if (!name) continue
    // Multiple enemy instances may log the same simultaneous cast.
    if (event.timestamp - (lastCast.get(id) ?? -Infinity) < 250) continue
    lastCast.set(id, event.timestamp)
    const occurrence = (counts.get(id) ?? 0) + 1
    counts.set(id, occurrence)
    markers.push({ abilityId: id, name, occurrence, timestamp: event.timestamp })
  }
  return markers
}
