import { useMemo, useState } from 'react'
import { buildSessionReview } from '../../shared/coaching'
import type { Pull, PullAnalysis, Report, XivanalysisPlayerAnalysis } from '../../shared/types'

export function SessionReview({
  report,
  pulls,
  analyses,
  deepAnalyses,
  onInspect,
}: {
  report: Report
  pulls: Pull[]
  analyses: PullAnalysis[]
  deepAnalyses: XivanalysisPlayerAnalysis[]
  onInspect: (pullId: number, playerId?: number) => void
}) {
  const [encounter, setEncounter] = useState('')
  const [player, setPlayer] = useState('')
  const reviews = useMemo(
    () => buildSessionReview(report, pulls, analyses, deepAnalyses, player ? Number(player) : undefined),
    [report, pulls, analyses, deepAnalyses, player],
  )
  const review = reviews.find((entry) => entry.key === encounter) ?? reviews[0]
  const players = report.players.filter((entry) => pulls.some((pull) => pull.playerIds.includes(entry.id)))
  return (
    <section className="card session-review" aria-label="Session review priorities">
      <div className="card-heading">
        <div>
          <h2>What to review next</h2>
          <p>Recurring observations and concrete examples from the eligible pulls.</p>
        </div>
      </div>
      <div className="review-filters">
        <label>
          Encounter{' '}
          <select
            aria-label="Review encounter"
            value={review?.key ?? ''}
            onChange={(event) => setEncounter(event.target.value)}
          >
            {reviews.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Player{' '}
          <select
            aria-label="Review player"
            value={player}
            onChange={(event) => setPlayer(event.target.value)}
          >
            <option value="">All players</option>
            {players.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {review ? (
        <>
          <p className="muted">
            Death data: {review.deathCoverage}/{review.pullCount} pulls. Deep results loaded:{' '}
            {review.deepCoverage}/{review.eligiblePlayerPulls} player-pulls; each finding uses only its
            measured metric. Comparisons stay within this encounter and difficulty.
          </p>
          {review.items.length ? (
            <ul className="review-items">
              {review.items.map((item) => (
                <li key={item.id}>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                  <button className="text-button" onClick={() => onInspect(item.pullId, item.playerId)}>
                    Inspect pull {item.pullId}
                    {item.playerId != null ? ' · player evidence' : ''}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              No recurring measured findings or progression examples in these eligible pulls yet. Load more
              evidence or select another encounter.
            </p>
          )}
        </>
      ) : (
        <p>Select eligible pulls to build a session review.</p>
      )}
    </section>
  )
}
