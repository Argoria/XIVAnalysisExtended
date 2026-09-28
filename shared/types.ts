export interface Player {
  id: number
  name: string
  job: string
  role: 'tank' | 'healer' | 'dps' | 'unknown'
}

export interface Pull {
  id: number
  encounterID: number
  name: string
  difficulty: number | null
  startTime: number
  endTime: number
  kill: boolean
  /** API v2 percentages are 0–100. Null means unavailable. */
  bossRemaining: number | null
  fightRemaining: number | null
  playerIds: number[]
}

export interface Report {
  code: string
  title: string
  startTime: number
  endTime: number
  pulls: Pull[]
  players: Player[]
  limitBreakActorIds: number[]
  ignoredSegments: number
  source: 'fflogs' | 'demo'
}

export interface DamageEvidence {
  timestamp: number
  abilityId: number | null
  ability: string
  source: string
  amount: number | null
  overkill: number | null
}

export interface Death {
  id: string
  fightId: number
  playerId: number
  timestamp: number
  abilityId: number | null
  ability: string
  attribution: 'recorded' | 'lethal-hit' | 'unknown'
  firstDeath: boolean
  recentDamage: DamageEvidence[]
}

export interface LimitBreakUse {
  timestamp: number
  abilityId: number | null
  ability: string
  actorIds: number[]
}

/**
 * FFLogs-only performance facts for one participating player in one pull.
 * DPS is raw outgoing damage divided by full pull duration. It is intentionally
 * not presented as FFLogs rDPS/aDPS/nDPS or as an xivanalysis execution score.
 */
export interface PlayerPullPerformance {
  fightId: number
  playerId: number
  durationMs: number
  damage: number
  dps: number
  deaths: number
  firstDeath: boolean
  bossRemaining: number | null
  fightRemaining: number | null
}

export interface PullAnalysis {
  fightId: number
  deaths: Death[]
  limitBreak: LimitBreakUse[]
  performance: PlayerPullPerformance[]
  fetchedAt: number
}

export interface PlayerSummary extends Player {
  pulls: number
  deaths: number
  firstDeaths: number
  deathFreePulls: number
  deathsPerPull: number
  totalDamage: number
  averageDps: number
  bestDps: number
}

export interface CauseSummary {
  key: string
  ability: string
  deaths: number
  firstDeaths: number
  affectedPulls: number
}

export interface AnalysisSummary {
  deaths: Death[]
  performance: PlayerPullPerformance[]
  players: PlayerSummary[]
  causes: CauseSummary[]
  totalDuration: number
  cleanPulls: number
  kills: number
}
