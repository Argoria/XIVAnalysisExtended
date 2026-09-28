import type { Pull } from '../../shared/types'
import type { RawAnalysisEvent, RawReport } from '../fflogs/schema'

export const XIVA_V2_ADAPTER_VERSION = 'fflogs-v2-legacy-compat/1'

export interface XivanalysisCompatActor {
  id: string
  name: string
  type: string
  subType: string | null
  team: 'FRIEND' | 'FOE'
  playerControlled: boolean
  ownerId: string | null
  instanceCount: number | null
}

export type LegacyCompatibleEvent = RawAnalysisEvent & {
  sourceIsFriendly: boolean
  targetIsFriendly: boolean
}

export interface XivanalysisCompatInput {
  adapterVersion: string
  reportCode: string
  reportTimestamp: number
  pull: {
    id: string
    fightId: number
    timestamp: number
    firstEventTimestamp: number
    duration: number
    progress: number | null
    encounterID: number
    difficulty: number | null
    gameZone: { id: number; name: string } | null
  }
  actors: XivanalysisCompatActor[]
  events: LegacyCompatibleEvent[]
}

const ids = (items: { id: number }[] | null | undefined) => (items ?? []).map((item) => item.id)
const clampPercent = (value: number) => Math.max(0, Math.min(100, value))
const compact = (value: string) => value.replace(/[\s_-]/g, '').toLowerCase()

export function buildXivanalysisCompatInput(
  raw: RawReport,
  pull: Pull,
  rawEvents: RawAnalysisEvent[],
): XivanalysisCompatInput {
  const fight = raw.fights.find((candidate) => candidate.id === pull.id)
  if (!fight) throw new Error(`Fight ${pull.id} is missing from the FFLogs report metadata.`)

  const friendlyPlayerIds = new Set(fight.friendlyPlayers ?? [])
  const friendlyIds = new Set([
    ...friendlyPlayerIds,
    ...ids(fight.friendlyNPCs),
    ...ids(fight.friendlyPets),
  ])
  const enemyIds = new Set([
    ...(fight.enemyPlayers ?? []),
    ...ids(fight.enemyNPCs),
    ...ids(fight.enemyPets),
  ])
  const participantIds = new Set([...friendlyIds, ...enemyIds])
  const instanceCounts = new Map<number, number>()
  for (const actor of [
    ...(fight.friendlyNPCs ?? []),
    ...(fight.friendlyPets ?? []),
    ...(fight.enemyNPCs ?? []),
    ...(fight.enemyPets ?? []),
  ]) {
    if (actor.instanceCount != null) instanceCounts.set(actor.id, actor.instanceCount)
  }

  const actors = raw.masterData.actors
    .filter((actor) => participantIds.has(actor.id))
    .map((actor): XivanalysisCompatActor => {
      const limitBreak = [actor.type, actor.subType ?? '', actor.name].some(
        (value) => compact(value) === 'limitbreak',
      )
      return {
        id: String(actor.id),
        name: actor.name,
        type: actor.type,
        subType: actor.subType ?? null,
        team: friendlyIds.has(actor.id) ? 'FRIEND' : 'FOE',
        playerControlled: actor.type === 'Player' && friendlyPlayerIds.has(actor.id) && !limitBreak,
        ownerId: actor.petOwner == null ? null : String(actor.petOwner),
        instanceCount: instanceCounts.get(actor.id) ?? null,
      }
    })

  const duration = fight.endTime - fight.startTime
  const combatTime =
    fight.combatTime != null && fight.combatTime > 0 && fight.combatTime <= duration
      ? fight.combatTime
      : duration
  const combatStart = fight.endTime - combatTime
  const progress =
    fight.kill === true
      ? 100
      : fight.fightPercentage == null
        ? null
        : clampPercent(100 - fight.fightPercentage)

  const events = rawEvents
    .filter(
      (event) =>
        event.timestamp >= fight.startTime &&
        event.timestamp <= fight.endTime &&
        (event.fight == null || event.fight === fight.id),
    )
    .map(
      (event): LegacyCompatibleEvent => ({
        ...event,
        sourceIsFriendly: event.sourceID != null && friendlyIds.has(event.sourceID),
        targetIsFriendly: event.targetID != null && friendlyIds.has(event.targetID),
      }),
    )

  return {
    adapterVersion: XIVA_V2_ADAPTER_VERSION,
    reportCode: raw.code,
    reportTimestamp: raw.startTime,
    pull: {
      id: String(fight.id),
      fightId: fight.id,
      timestamp: raw.startTime + combatStart,
      firstEventTimestamp: raw.startTime + fight.startTime,
      duration: combatTime,
      progress,
      encounterID: fight.encounterID,
      difficulty: fight.difficulty ?? null,
      gameZone: fight.gameZone ?? null,
    },
    actors,
    events,
  }
}
