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

export type DpsMetricKey = 'dps' | 'rdps' | 'ndps' | 'cdps' | 'adps'

export interface DpsMetrics {
  dps: number | null
  rdps: number | null
  ndps: number | null
  cdps: number | null
  /**
   * FFLogs documents aDPS, but it is not currently exposed by ReportRankingMetricType.
   * Keep it explicit rather than aliasing another metric.
   */
  adps: number | null
}

export interface PlayerPullPerformance {
  fightId: number
  playerId: number
  durationMs: number
  metrics: DpsMetrics
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
  averageDps: DpsMetrics
  bestDps: DpsMetrics
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


export interface XivanalysisUptimeMetrics {
  fightDurationMs: number
  unavailableMs: number | null
  effectiveFightMs: number | null
  gcdUptimeMs: number | null
  gcdUptimePercent: number | null
  gcdCount: number | null
  gcdDowntimeMs: number | null
  gcdDowntimeCount: number | null
  weavingDelayMs: number | null
  weavingIssueCount: number | null
  interruptedCastDelayMs: number | null
  interruptedCastCount: number | null
}

export interface XivanalysisChecklistRequirement {
  label: string | null
  percent: number
  value: number | null
  target: number
  weight: number
}

export interface XivanalysisChecklistRule {
  label: string | null
  percent: number
  target: number
  passed: boolean
  requirements: XivanalysisChecklistRequirement[]
}

export interface XivanalysisSuggestion {
  severity: number | null
  severityName: string
  value: number | null
  kind: string
  icon: string | null
  content: string | null
  why: string | null
}

export interface XivanalysisModuleSummary {
  handle: string
  type: string
  error: string | null
}

export interface XivanalysisPlayerAnalysis {
  engineRevision: string
  adapterVersion: string
  reportCode: string
  fightId: number
  actorId: string
  job: string
  encounterKey: string | null
  adaptedEventCount: number
  eventTypes: Record<string, number>
  moduleCount: number
  modules: XivanalysisModuleSummary[]
  uptime: XivanalysisUptimeMetrics
  checklist: XivanalysisChecklistRule[]
  suggestions: XivanalysisSuggestion[]
}
