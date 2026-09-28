import type { Death, Player, Pull, PullAnalysis, Report } from './types'

const players: Player[] = [
  { id: 1, name: 'Argo', job: 'GNB', role: 'tank' },
  { id: 2, name: 'Kira', job: 'WAR', role: 'tank' },
  { id: 3, name: 'Vars', job: 'AST', role: 'healer' },
  { id: 4, name: 'Lumi', job: 'SCH', role: 'healer' },
  { id: 5, name: 'Ren', job: 'VPR', role: 'dps' },
  { id: 6, name: 'Sora', job: 'SAM', role: 'dps' },
  { id: 7, name: 'Mira', job: 'DNC', role: 'dps' },
  { id: 8, name: 'Nova', job: 'PCT', role: 'dps' },
  { id: 9, name: 'Iris', job: 'RDM', role: 'dps' },
]
const durations = [84, 142, 196, 34, 263, 318, 387, 492, 93, 169, 230, 402]
const remaining = [89.4, 76.2, 64.8, 97.1, 48.6, 36.3, 18.7, 0, 79.2, 53.8, 31.4, 0]
let offset = 60000
const pulls: Pull[] = durations.map((duration, index) => {
  const startTime = offset
  offset += duration * 1000 + 78000
  return {
    id: index + 1,
    encounterID: index < 8 ? 96 : 93,
    name: index < 8 ? 'Wicked Thunder' : 'Black Cat',
    difficulty: 101,
    startTime,
    endTime: startTime + duration * 1000,
    kill: remaining[index] === 0,
    bossRemaining: remaining[index],
    fightRemaining: remaining[index],
    playerIds: [1, 2, 3, 4, 5, 6, 7, index === 6 ? 9 : 8],
  }
})

export const demoReport: Report = {
  code: 'DEMO',
  title: 'A night in the Arcadion',
  startTime: Date.UTC(2026, 8, 24, 19),
  endTime: Date.UTC(2026, 8, 24, 19) + offset,
  source: 'demo',
  players,
  pulls,
  limitBreakActorIds: [90, 91],
  ignoredSegments: 6,
}

const patterns = [
  [3, 5, 7, 1],
  [5, 3, 8],
  [3, 7, 1, 4],
  [5, 3, 1, 2, 4, 6, 7, 8],
  [7, 3, 5],
  [3, 8],
  [5, 3, 9],
  [],
  [6, 3, 5],
  [3, 7],
  [5, 4],
  [],
]
const abilityNames = ['Wicked Jolt', 'Electrope Edge', 'Wicked Bolt', 'Unknown / environment']
export const demoAnalyses: PullAnalysis[] = pulls.map((pull, index) => {
  const deaths: Death[] = patterns[index].map((playerId, n) => {
    const timestamp = pull.endTime - 17000 + n * 1800
    const abilityIndex = index < 8 ? (n === 0 ? index % 3 : (index + n) % 4) : (n + 1) % 3
    const ability =
      index < 8 ? abilityNames[abilityIndex] : ['Quadruple Swipe', 'Mouser', 'Bloody Scratch'][abilityIndex]
    const abilityId =
      ability === 'Unknown / environment' ? null : 900000 + (index < 8 ? abilityIndex : abilityIndex + 10)
    return {
      id: `${pull.id}:${playerId}:${timestamp}`,
      fightId: pull.id,
      playerId,
      timestamp,
      abilityId,
      ability,
      attribution: abilityId == null ? 'unknown' : 'recorded',
      firstDeath: n === 0,
      recentDamage:
        abilityId == null
          ? []
          : [
              {
                timestamp: timestamp - 3300,
                abilityId: 1,
                ability: 'Attack',
                source: pull.name,
                amount: 24800,
                overkill: null,
              },
              {
                timestamp: timestamp - 12,
                abilityId,
                ability,
                source: pull.name,
                amount: 113200,
                overkill: 21800,
              },
            ],
    }
  })
  const durationMs = pull.endTime - pull.startTime
  const performance = pull.playerIds.map((playerId) => {
    const player = players.find((candidate) => candidate.id === playerId)!
    const roleBase = player.role === 'dps' ? 24500 : player.role === 'tank' ? 15500 : 10500
    const dps = Math.round(roleBase * (0.91 + ((index + playerId) % 7) * 0.025))
    const ownDeaths = deaths.filter((death) => death.playerId === playerId)
    return {
      fightId: pull.id,
      playerId,
      durationMs,
      metrics: {
        dps,
        rdps: Math.round(dps * 0.98),
        ndps: Math.round(dps * 0.96),
        cdps: Math.round(dps * 1.01),
        adps: null,
      },
      deaths: ownDeaths.length,
      firstDeath: ownDeaths.some((death) => death.firstDeath),
      bossRemaining: pull.bossRemaining,
      fightRemaining: pull.fightRemaining,
    }
  })
  return {
    fightId: pull.id,
    deaths,
    performance,
    fetchedAt: demoReport.endTime,
    limitBreak:
      index === 5 || pull.kill
        ? [
            {
              timestamp: pull.startTime + 220000,
              abilityId: 900099,
              ability: index === 5 ? 'Astral Stasis' : 'Final Heaven',
              actorIds: [index === 5 ? 90 : 91],
            },
          ]
        : [],
  }
})
