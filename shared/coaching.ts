import type { Pull, PullAnalysis, Report, XivanalysisPlayerAnalysis } from './types'
import { getXivanalysisMetricStatus } from './xivanalysis'

export interface ReviewItem {
  id: string
  kind: 'deaths' | 'first-deaths' | 'checklist' | 'suggestion' | 'progression' | 'uptime'
  title: string
  detail: string
  pullId: number
  playerId?: number
  occurrences?: number
  evaluated?: number
}

export interface EncounterReview {
  key: string
  name: string
  pullCount: number
  deathCoverage: number
  deepCoverage: number
  eligiblePlayerPulls: number
  items: ReviewItem[]
}

const encounterKey = (pull: Pull) => `${pull.encounterID}:${pull.difficulty ?? 'unknown'}`
const duration = (pull: Pull) => `${Math.round((pull.endTime - pull.startTime) / 1000)}s`

/** Evidence-backed review prompts; recurring observations are not causal fault attribution. */
export function buildSessionReview(
  report: Report,
  pulls: Pull[],
  analyses: PullAnalysis[],
  deepAnalyses: XivanalysisPlayerAnalysis[],
  playerId?: number,
): EncounterReview[] {
  const pullsById = new Map(pulls.map((pull) => [pull.id, pull]))
  const loaded = new Map(
    analyses.filter((entry) => pullsById.has(entry.fightId)).map((entry) => [entry.fightId, entry]),
  )
  const deep = [
    ...new Map(
      deepAnalyses
        .filter((entry) => {
          const pull = pullsById.get(entry.fightId)
          return entry.reportCode === report.code && pull?.playerIds.includes(Number(entry.actorId))
        })
        .map((entry) => [`${entry.fightId}:${Number(entry.actorId)}`, entry]),
    ).values(),
  ]
  const groups = new Map<string, Pull[]>()
  for (const pull of pulls) {
    const key = encounterKey(pull)
    groups.set(key, [...(groups.get(key) ?? []), pull])
  }
  return [...groups.entries()].map(([key, encounterPulls]) => {
    const scopedPulls =
      playerId == null ? encounterPulls : encounterPulls.filter((pull) => pull.playerIds.includes(playerId))
    const ids = new Set(scopedPulls.map((pull) => pull.id))
    const observed = scopedPulls.flatMap((pull) => (loaded.has(pull.id) ? [loaded.get(pull.id)!] : []))
    const results = deep.filter(
      (entry) => ids.has(entry.fightId) && (playerId == null || Number(entry.actorId) === playerId),
    )
    const recurring: ReviewItem[] = []
    const causes = new Map<
      string,
      { name: string; pulls: Set<number>; example: { pullId: number; playerId: number } }
    >()
    const firstDeaths = new Map<number, Set<number>>()
    for (const analysis of observed) {
      const participants = new Set(pullsById.get(analysis.fightId)!.playerIds)
      for (const death of analysis.deaths) {
        if (
          death.fightId !== analysis.fightId ||
          !participants.has(death.playerId) ||
          (playerId != null && death.playerId !== playerId)
        )
          continue
        if (death.firstDeath) {
          const fights = firstDeaths.get(death.playerId) ?? new Set<number>()
          fights.add(analysis.fightId)
          firstDeaths.set(death.playerId, fights)
        }
        if (death.attribution === 'unknown' || death.abilityId == null) continue
        const cause = causes.get(String(death.abilityId)) ?? {
          name: death.ability,
          pulls: new Set<number>(),
          example: { pullId: analysis.fightId, playerId: death.playerId },
        }
        cause.pulls.add(analysis.fightId)
        causes.set(String(death.abilityId), cause)
      }
    }
    for (const [abilityId, cause] of causes) {
      if (cause.pulls.size < 2) continue
      recurring.push({
        id: `death:${abilityId}`,
        kind: 'deaths',
        title: `Review deaths recorded with ${cause.name}`,
        detail: `Recorded killing ability in ${cause.pulls.size} of ${observed.length} pulls with loaded death data. This identifies the final hit, not the underlying cause.`,
        ...cause.example,
        occurrences: cause.pulls.size,
        evaluated: observed.length,
      })
    }
    const playerName = (id: number) =>
      report.players.find((player) => player.id === id)?.name ?? `Player ${id}`
    for (const [id, fights] of firstDeaths) {
      if (fights.size < 2) continue
      const evaluated = observed.filter((analysis) =>
        pullsById.get(analysis.fightId)!.playerIds.includes(id),
      ).length
      recurring.push({
        id: `first:${id}`,
        kind: 'first-deaths',
        title: `Review ${playerName(id)}’s first-death sequences`,
        detail: `First recorded death in ${fights.size} of ${evaluated} participated pulls with loaded death data. Inspect preceding events before assigning a cause.`,
        pullId: [...fights][0],
        playerId: id,
        occurrences: fights.size,
        evaluated,
      })
    }
    for (const id of new Set(results.map((entry) => Number(entry.actorId)))) {
      const own = results.filter((entry) => Number(entry.actorId) === id)
      const checklist = own.filter(
        (entry) => getXivanalysisMetricStatus(entry, 'checklist').state === 'measured',
      )
      const labels = new Set(
        checklist.flatMap((entry) =>
          entry.checklist.flatMap((rule) => (rule.label?.trim() ? [rule.label] : [])),
        ),
      )
      for (const label of labels) {
        const evaluated = checklist.filter((entry) => entry.checklist.some((rule) => rule.label === label))
        const failed = evaluated.filter((entry) =>
          entry.checklist.some((rule) => rule.label === label && !rule.passed),
        )
        if (failed.length < 2) continue
        recurring.push({
          id: `checklist:${id}:${label}`,
          kind: 'checklist',
          title: `${playerName(id)}: ${label}`,
          detail: `Below the XIVAnalysis checklist target in ${failed.length} of ${evaluated.length} measured results containing this rule. Open an example to inspect the requirements.`,
          pullId: failed[0].fightId,
          playerId: id,
          occurrences: failed.length,
          evaluated: evaluated.length,
        })
      }
      const suggestions = own.filter(
        (entry) => getXivanalysisMetricStatus(entry, 'suggestions').state === 'measured',
      )
      const texts = new Set(
        suggestions.flatMap((entry) =>
          entry.suggestions.flatMap((finding) =>
            finding.severityName !== 'ignore' && finding.content?.trim() ? [finding.content] : [],
          ),
        ),
      )
      for (const content of texts) {
        const matching = suggestions.filter((entry) =>
          entry.suggestions.some(
            (finding) => finding.severityName !== 'ignore' && finding.content === content,
          ),
        )
        if (matching.length < 2) continue
        recurring.push({
          id: `suggestion:${id}:${content}`,
          kind: 'suggestion',
          title: `${playerName(id)}: repeated XIVAnalysis finding`,
          detail: `${content} Observed in ${matching.length} of ${suggestions.length} measured suggestion outputs. Absence of this finding is not proof of correct execution.`,
          pullId: matching[0].fightId,
          playerId: id,
          occurrences: matching.length,
          evaluated: suggestions.length,
        })
      }
    }
    recurring.sort((a, b) => (b.occurrences ?? 0) - (a.occurrences ?? 0) || a.id.localeCompare(b.id))
    const items = recurring.slice(0, 3)
    const progress = scopedPulls
      .filter(
        (pull) =>
          pull.kill ||
          (pull.fightRemaining != null &&
            Number.isFinite(pull.fightRemaining) &&
            pull.fightRemaining >= 0 &&
            pull.fightRemaining <= 100),
      )
      .sort(
        (a, b) =>
          Number(b.kill) - Number(a.kill) || (a.fightRemaining ?? 0) - (b.fightRemaining ?? 0) || a.id - b.id,
      )
    if (progress.length) {
      const best = progress[0]
      items.push({
        id: 'progression',
        kind: 'progression',
        title: 'Progression example',
        pullId: best.id,
        detail: best.kill
          ? `Pull ${best.id} cleared this encounter (${duration(best)}). Study its complete sequence.`
          : `Pull ${best.id} ended at ${best.fightRemaining!.toFixed(1)}% encounter remaining, the lowest of ${progress.length} eligible pulls with this value (${duration(best)}). This is end-of-pull progress, not mechanic completion.`,
      })
    }
    if (playerId != null) {
      const measured = results
        .filter((entry) => getXivanalysisMetricStatus(entry, 'gcdUptime').state === 'measured')
        .map((entry) => ({
          entry,
          percent: (100 * entry.uptime.gcdUptimeMs!) / entry.uptime.effectiveFightMs!,
        }))
        .sort((a, b) => b.percent - a.percent || a.entry.fightId - b.entry.fightId)
      if (measured.length) {
        const best = measured[0]
        items.push({
          id: `uptime:${playerId}`,
          kind: 'uptime',
          title: `${playerName(playerId)}: uptime example`,
          pullId: best.entry.fightId,
          playerId,
          detail: `${best.percent.toFixed(1)}% GCD uptime, highest among ${measured.length} measured eligible results for this player and encounter (${duration(pullsById.get(best.entry.fightId)!)} pull). Different pull lengths and phases can affect this comparison.`,
        })
      }
    }
    return {
      key,
      name: `${encounterPulls[0].name} · difficulty ${encounterPulls[0].difficulty ?? 'unknown'}`,
      pullCount: scopedPulls.length,
      deathCoverage: observed.length,
      deepCoverage: results.length,
      eligiblePlayerPulls: scopedPulls.reduce(
        (sum, pull) => sum + (playerId == null ? pull.playerIds.length : 1),
        0,
      ),
      items,
    }
  })
}
