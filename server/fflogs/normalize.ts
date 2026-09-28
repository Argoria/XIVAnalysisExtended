import type {
  Death,
  DpsMetrics,
  LimitBreakUse,
  Player,
  PlayerPullPerformance,
  Pull,
  PullAnalysis,
  Report,
} from '../../shared/types'
import { emptyDpsMetrics } from './client'
import type { RawActor, RawEvent, RawReport } from './schema'

const jobs: Record<string, [string, Player['role']]> = {
  Paladin: ['PLD', 'tank'],
  Warrior: ['WAR', 'tank'],
  DarkKnight: ['DRK', 'tank'],
  Gunbreaker: ['GNB', 'tank'],
  WhiteMage: ['WHM', 'healer'],
  Scholar: ['SCH', 'healer'],
  Astrologian: ['AST', 'healer'],
  Sage: ['SGE', 'healer'],
  Monk: ['MNK', 'dps'],
  Dragoon: ['DRG', 'dps'],
  Ninja: ['NIN', 'dps'],
  Samurai: ['SAM', 'dps'],
  Reaper: ['RPR', 'dps'],
  Viper: ['VPR', 'dps'],
  Bard: ['BRD', 'dps'],
  Machinist: ['MCH', 'dps'],
  Dancer: ['DNC', 'dps'],
  BlackMage: ['BLM', 'dps'],
  Summoner: ['SMN', 'dps'],
  RedMage: ['RDM', 'dps'],
  Pictomancer: ['PCT', 'dps'],
  BlueMage: ['BLU', 'dps'],
  Beastmaster: ['BST', 'dps'],
}
const compact = (value: string) => value.replace(/[\s_-]/g, '').toLowerCase()
export const isLimitBreak = (actor: RawActor) =>
  [actor.type, actor.subType ?? '', actor.name].some((v) => compact(v) === 'limitbreak')
export const isPlayer = (actor: RawActor) => actor.type === 'Player' && !isLimitBreak(actor)

export function normalizeReport(raw: RawReport): Report {
  const fights = raw.fights
    .filter((f) => f.encounterID > 0 && f.endTime > f.startTime)
    .sort((a, b) => a.startTime - b.startTime)
  if (fights.some((f) => f.friendlyPlayers === null))
    throw new Error(
      'FFLogs did not provide encounter participants. Try again after the report finishes processing.',
    )
  const participants = new Set(fights.flatMap((f) => f.friendlyPlayers ?? []))
  const players = raw.masterData.actors
    .filter((a) => isPlayer(a) && participants.has(a.id))
    .map((a) => {
      const [job, role] = jobs[a.subType ?? ''] ?? [a.subType || 'Unknown', 'unknown']
      return { id: a.id, name: a.name, job, role } as Player
    })
  const playerIds = new Set(players.map((p) => p.id))
  const percent = (value: number | null | undefined) =>
    value != null && value >= 0 && value <= 100 ? value : null
  return {
    code: raw.code,
    title: raw.title,
    startTime: raw.startTime,
    endTime: raw.endTime,
    source: 'fflogs',
    players,
    ignoredSegments: raw.fights.length - fights.length,
    limitBreakActorIds: raw.masterData.actors.filter(isLimitBreak).map((a) => a.id),
    pulls: fights.map((f) => ({
      id: f.id,
      encounterID: f.encounterID,
      name: f.name,
      difficulty: f.difficulty ?? null,
      startTime: f.startTime,
      endTime: f.endTime,
      kill: f.kill === true,
      bossRemaining: f.kill ? 0 : percent(f.bossPercentage),
      fightRemaining: f.kill ? 0 : percent(f.fightPercentage),
      playerIds: [...new Set(f.friendlyPlayers ?? [])].filter((id) => playerIds.has(id)),
    })),
  }
}

export function analyzePull(
  raw: RawReport,
  pull: Pull,
  events: RawEvent[],
  metricsByPlayer: ReadonlyMap<number, DpsMetrics> = new Map(),
): PullAnalysis {
  const abilities = new Map(raw.masterData.abilities.map((a) => [a.gameID, a.name]))
  const actors = new Map(raw.masterData.actors.map((a) => [a.id, a]))
  const name = (id: number | undefined | null) =>
    id ? (abilities.get(id) ?? `Ability ${id}`) : 'Unknown / environment'
  const scoped = events
    .filter(
      (e) =>
        e.timestamp >= pull.startTime &&
        e.timestamp <= pull.endTime &&
        (e.fight == null || e.fight === pull.id),
    )
    .sort((a, b) => a.timestamp - b.timestamp)
  const incoming = new Map<number, RawEvent[]>()
  for (const event of scoped) {
    if (event.type !== 'damage' || event.targetID == null || !pull.playerIds.includes(event.targetID))
      continue
    const list = incoming.get(event.targetID) ?? []
    list.push(event)
    incoming.set(event.targetID, list)
  }
  const seen = new Set<string>()
  const deaths: Death[] = []
  const lastDeath = new Map<number, number>()
  for (const event of scoped) {
    if (event.type !== 'death' || event.targetID == null || !pull.playerIds.includes(event.targetID)) continue
    const id = `${pull.id}:${event.targetID}:${event.timestamp}`
    if (seen.has(id)) continue
    seen.add(id)
    const hits = (incoming.get(event.targetID) ?? []).filter(
      (hit) =>
        hit.timestamp > (lastDeath.get(event.targetID!) ?? -1) &&
        hit.timestamp >= event.timestamp - 5000 &&
        hit.timestamp <= event.timestamp,
    )
    const lethal = [...hits]
      .reverse()
      .find(
        (hit) =>
          event.timestamp - hit.timestamp <= 1000 &&
          ((hit.overkill ?? -1) > 0 || ((hit.amount ?? 0) > 0 && hit.targetResources?.hitPoints === 0)),
      )
    const recorded =
      event.killingAbilityGameID && event.killingAbilityGameID > 0 ? event.killingAbilityGameID : null
    const abilityId = recorded ?? lethal?.abilityGameID ?? null
    deaths.push({
      id,
      fightId: pull.id,
      playerId: event.targetID,
      timestamp: event.timestamp,
      abilityId,
      ability: name(abilityId),
      attribution: recorded ? 'recorded' : lethal?.abilityGameID ? 'lethal-hit' : 'unknown',
      firstDeath: false,
      recentDamage: hits.slice(-10).map((hit) => ({
        timestamp: hit.timestamp,
        abilityId: hit.abilityGameID ?? null,
        ability: name(hit.abilityGameID),
        source: actors.get(hit.sourceID ?? -1)?.name ?? 'Unknown source',
        amount: hit.amount ?? null,
        overkill: hit.overkill ?? null,
      })),
    })
    lastDeath.set(event.targetID, event.timestamp)
  }
  const firstTimestamp = deaths[0]?.timestamp
  for (const death of deaths) death.firstDeath = death.timestamp === firstTimestamp

  const durationMs = Math.max(1, pull.endTime - pull.startTime)
  const performance: PlayerPullPerformance[] = pull.playerIds.map((playerId) => {
    const ownDeaths = deaths.filter((death) => death.playerId === playerId)
    return {
      fightId: pull.id,
      playerId,
      durationMs,
      metrics: metricsByPlayer.get(playerId) ?? emptyDpsMetrics(),
      deaths: ownDeaths.length,
      firstDeath: ownDeaths.some((death) => death.firstDeath),
      bossRemaining: pull.bossRemaining,
      fightRemaining: pull.fightRemaining,
    }
  })

  const limitBreak = new Map<string, LimitBreakUse>()
  for (const event of scoped) {
    if (
      event.type !== 'cast' ||
      !isLimitBreak(actors.get(event.sourceID ?? -1) ?? { id: -1, name: '', type: '' })
    )
      continue
    const key = `${event.timestamp}:${event.abilityGameID ?? 'unknown'}`
    const use = limitBreak.get(key) ?? {
      timestamp: event.timestamp,
      abilityId: event.abilityGameID ?? null,
      ability: name(event.abilityGameID),
      actorIds: [],
    }
    if (!use.actorIds.includes(event.sourceID!)) use.actorIds.push(event.sourceID!)
    limitBreak.set(key, use)
  }
  return {
    fightId: pull.id,
    deaths,
    limitBreak: [...limitBreak.values()],
    performance,
    fetchedAt: Date.now(),
  }
}
