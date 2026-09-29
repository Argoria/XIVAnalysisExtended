import type { XivanalysisAggregate } from '../../shared/xivanalysis'

export function DeepCoverage({ summary, expected }: { summary: XivanalysisAggregate; expected: number }) {
  const c = summary.metricCoverage.gcdUptime
  return (
    <p className="metric-coverage" role="status">
      Uptime measured:{' '}
      <strong>
        {c.measured}/{expected}
      </strong>{' '}
      player × pulls
      {c.error > 0 && <> · {c.error} failed</>}
      {c.incomplete > 0 && <> · {c.incomplete} incomplete</>}
      {c.unsupported > 0 && <> · {c.unsupported} unsupported</>}
      {c['not-applicable'] > 0 && <> · {c['not-applicable']} not applicable</>}
      {expected > summary.playerPullsAnalyzed && <> · {expected - summary.playerPullsAnalyzed} not loaded</>}.
      Only measured metrics contribute to averages.
    </p>
  )
}
