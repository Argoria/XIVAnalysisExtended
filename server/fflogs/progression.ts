import type { ProgressionMarker, Pull } from '../../shared/types'
import type { RawEvent, RawReport } from './schema'

export interface CheckpointDefinition {
  id: string
  /** Verified definitions must use captured ability IDs; names are only provisional. */
  abilityIds?: number[]
  abilityName?: string
}

export type EncounterCheckpointDefinition = {
  id: string
  checkpoints: CheckpointDefinition[]
} & (
  | { confidence: 'provisional'; encounterName: string }
  | { confidence: 'verified'; encounterID: number; difficulty: number | null }
)

/** User-proposed anchors. These are not verified phase or mechanic-completion rules. */
export const ENCOUNTER_CHECKPOINTS: EncounterCheckpointDefinition[] = [
  {
    id: 'vamp-fatale-candidates',
    confidence: 'provisional',
    encounterName: 'Vamp Fatale',
    checkpoints: [{ id: 'sadistic-screech', abilityName: 'Sadistic Screech' }],
  },
]

function sameName(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0
}

/** Cast source resources describe the casting boss, unlike target resources (often a player). */
function castingBossHp(event: RawEvent): number | null {
  const resources = event.sourceResources
  if (resources == null || typeof resources !== 'object') return null
  const { hitPoints, maxHitPoints } = resources as Record<string, unknown>
  if (
    typeof hitPoints !== 'number' ||
    typeof maxHitPoints !== 'number' ||
    !Number.isFinite(hitPoints) ||
    !Number.isFinite(maxHitPoints) ||
    maxHitPoints <= 0 ||
    hitPoints < 0 ||
    hitPoints > maxHitPoints
  )
    return null
  return (hitPoints / maxHitPoints) * 100
}

export function progressionMarkers(
  raw: RawReport,
  pull: Pull,
  events: RawEvent[],
  definitions: EncounterCheckpointDefinition[] = ENCOUNTER_CHECKPOINTS,
): ProgressionMarker[] {
  const fight = raw.fights.find((candidate) => candidate.id === pull.id)
  const actorNames = new Map(raw.masterData.actors.map((actor) => [actor.id, actor.name]))
  const enemiesInFight = (fight?.enemyNPCs ?? []).filter(
    (actor): actor is NonNullable<typeof actor> => actor != null,
  )
  const namedBosses = enemiesInFight.filter((actor) => sameName(actorNames.get(actor.id) ?? '', pull.name))
  const bossActors = namedBosses.length ? namedBosses : enemiesInFight.length === 1 ? enemiesInFight : []
  const enemies = new Set(bossActors.map((actor) => actor.id))
  const abilities = new Map(raw.masterData.abilities.map((ability) => [ability.gameID, ability.name]))
  const definition = definitions.find((candidate) =>
    candidate.confidence === 'verified'
      ? candidate.encounterID === pull.encounterID && candidate.difficulty === pull.difficulty
      : sameName(candidate.encounterName, pull.name),
  )
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
    // Alternate IDs and simultaneous boss instances can describe the same named cast.
    if (event.timestamp - (lastCast.get(name) ?? -Infinity) < 250) continue
    lastCast.set(name, event.timestamp)
    const occurrence = (counts.get(name) ?? 0) + 1
    counts.set(name, occurrence)
    const checkpoint = definition?.checkpoints.find(
      (candidate) =>
        candidate.abilityIds?.includes(id) ||
        (definition.confidence === 'provisional' &&
          candidate.abilityName != null &&
          sameName(candidate.abilityName, name)),
    )
    markers.push({
      abilityId: id,
      name,
      occurrence,
      timestamp: event.timestamp,
      checkpointId: checkpoint ? `${definition!.id}:${checkpoint.id}` : `cast:${name}`,
      kind: checkpoint ? 'checkpoint' : 'observed-cast',
      confidence: checkpoint ? definition!.confidence : 'provisional',
      reached: true,
      // Even a verified cast anchor does not establish survival or resolution of its mechanic.
      completed: null,
      bossHpPercent: castingBossHp(event),
    })
  }
  return markers
}
