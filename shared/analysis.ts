import type { AnalysisSummary, CauseSummary, Pull, PullAnalysis, Report } from './types'

export function summarize(report: Report, pulls: Pull[], analyses: PullAnalysis[]): AnalysisSummary {
  const selected = new Set(pulls.map((p) => p.id))
  const completed = new Set(analyses.filter((a) => selected.has(a.fightId)).map((a) => a.fightId))
  const included = pulls.filter((p) => completed.has(p.id))
  const byId = new Map(analyses.map((a) => [a.fightId, a]))
  const deaths = included.flatMap((p) => byId.get(p.id)?.deaths ?? []).sort((a, b) => a.timestamp - b.timestamp)
  const performance = included.flatMap((p) => byId.get(p.id)?.performance ?? [])
  const players = report.players.flatMap((player) => {
    const participated = included.filter((p) => p.playerIds.includes(player.id))
    if (!participated.length) return []
    const own = deaths.filter((d) => d.playerId === player.id)
    const ownPerformance = performance.filter((entry) => entry.playerId === player.id)
    const totalDamage = ownPerformance.reduce((sum, entry) => sum + entry.damage, 0)
    const observedMs = ownPerformance.reduce((sum, entry) => sum + entry.durationMs, 0)
    return [{
      ...player,
      pulls: participated.length,
      deaths: own.length,
      firstDeaths: own.filter((d) => d.firstDeath).length,
      deathFreePulls: participated.length - new Set(own.map((d) => d.fightId)).size,
      deathsPerPull: own.length / participated.length,
      totalDamage,
      averageDps: observedMs ? totalDamage / (observedMs / 1000) : 0,
      bestDps: ownPerformance.reduce((best, entry) => Math.max(best, entry.dps), 0),
    }]
  }).sort((a, b) => b.deathsPerPull - a.deathsPerPull || b.firstDeaths - a.firstDeaths || a.name.localeCompare(b.name))

  const causes = new Map<string, CauseSummary & { pulls: Set<number> }>()
  for (const death of deaths) {
    const key = death.abilityId == null ? 'unknown' : String(death.abilityId)
    const cause = causes.get(key) ?? { key, ability: death.ability, deaths: 0, firstDeaths: 0, affectedPulls: 0, pulls: new Set<number>() }
    cause.deaths++
    cause.firstDeaths += Number(death.firstDeath)
    cause.pulls.add(death.fightId)
    causes.set(key, cause)
  }
  return {
    deaths,
    performance,
    players,
    causes: [...causes.values()].map(({ pulls: causePulls, ...cause }) => ({ ...cause, affectedPulls: causePulls.size })).sort((a, b) => b.deaths - a.deaths),
    totalDuration: included.reduce((sum, p) => sum + p.endTime - p.startTime, 0),
    cleanPulls: included.filter((p) => !byId.get(p.id)?.deaths.length).length,
    kills: included.filter((p) => p.kill).length,
  }
}
