import { ArrowDownRight, Check, ChevronRight, CircleHelp, ExternalLink, Shield, Sparkles } from 'lucide-react'
import type { Death, Pull, PullAnalysis, Report } from '../../shared/types'
import { duration, fflogsLink, percent } from '../format'
import { Empty, JobBadge } from './ui'

export function PullDetail({
  report,
  pull,
  analysis,
  error,
}: {
  report: Report
  pull: Pull
  analysis?: PullAnalysis
  error?: string
}) {
  return (
    <>
      <div className="eyebrow">PULL REVIEW</div>
      <h2>
        Pull {pull.id}{' '}
        <span className={`pill ${pull.kill ? 'success' : 'neutral'}`}>{pull.kill ? 'Clear' : 'Wipe'}</span>
      </h2>
      <p className="detail-subtitle">
        {pull.name} · {duration(pull.endTime - pull.startTime)} · {percent(pull.fightRemaining)} fight
        remaining
      </p>
      {report.source !== 'demo' && (
        <a className="external-link" href={fflogsLink(report.code, pull.id)} target="_blank" rel="noreferrer">
          Open this pull in FFLogs <ExternalLink size={14} />
        </a>
      )}
      <div className="detail-divider" />
      {!analysis ? (
        <Empty
          title={error ? 'Analysis unavailable' : 'Events are loading'}
          text={error || 'Select this pull in the sidebar to load its analysis.'}
        />
      ) : (
        <>
          <h3>
            Death timeline <span className="muted">({analysis.deaths.length})</span>
          </h3>
          <p className="muted small">
            Includes deaths during wipe cleanup. First death is an observation, not a cause.
          </p>
          {analysis.deaths.length ? (
            <div className="death-timeline">
              {analysis.deaths.map((death) => (
                <DeathDetail key={death.id} report={report} pull={pull} death={death} />
              ))}
            </div>
          ) : (
            <div className="clean-state">
              <Check size={20} />
              No player deaths recorded in this pull.
            </div>
          )}
          <div className="detail-divider" />
          <h3>Limit Break</h3>
          <p className="muted small">
            Shared raid resource · {report.limitBreakActorIds.length} report entities grouped separately.
          </p>
          {analysis.limitBreak.length ? (
            analysis.limitBreak.map((use, i) => (
              <div className="lb-use" key={`${use.timestamp}:${i}`}>
                <Sparkles size={17} />
                <strong>{use.ability}</strong>
                <span>{duration(use.timestamp - pull.startTime)}</span>
              </div>
            ))
          ) : (
            <p className="small">
              No casts recorded under the report’s Limit Break entities. Player-attributed LB actions may
              require job analysis.
            </p>
          )}
          <div className="detail-divider" />
          <h3>Job performance</h3>
          <p className="muted small">
            Opener, mitigation use, uptime, and score: <strong>not analyzed</strong>.
          </p>
          {report.source !== 'demo' && (
            <div className="xiva-links">
              {report.players
                .filter((p) => pull.playerIds.includes(p.id))
                .map((p) => (
                  <a
                    key={p.id}
                    href={`https://xivanalysis.com/fflogs/${report.code}/${pull.id}/${p.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <JobBadge player={p} />
                    <span>{p.name}</span>
                    <ExternalLink size={13} />
                  </a>
                ))}
            </div>
          )}
        </>
      )}
    </>
  )
}

function DeathDetail({ report, pull, death }: { report: Report; pull: Pull; death: Death }) {
  const player = report.players.find((p) => p.id === death.playerId)
  return (
    <details className="death-entry">
      <summary>
        <span className="death-time">{duration(death.timestamp - pull.startTime)}</span>
        <div>
          <div className="death-name">
            {player?.name ?? `Player ${death.playerId}`}
            <span>{player?.job}</span>
            {death.firstDeath && <span className="first-tag">First death</span>}
          </div>
          <p>{death.ability}</p>
        </div>
        <ChevronRight size={16} />
      </summary>
      <div className="death-evidence">
        <div className="evidence-label">
          {death.attribution === 'recorded'
            ? 'Killing ability recorded by FFLogs'
            : death.attribution === 'lethal-hit'
              ? 'Matched to a lethal damage event within 1 second'
              : 'No recorded killing ability or matching lethal hit'}
        </div>
        <h4>Incoming damage in the preceding 5 seconds</h4>
        {death.recentDamage.length ? (
          <ul>
            {death.recentDamage.map((hit, i) => (
              <li key={i}>
                <span>{((hit.timestamp - death.timestamp) / 1000).toFixed(2)}s</span>
                <div>
                  {hit.ability}
                  <small>{hit.source}</small>
                </div>
                <strong>
                  {hit.amount?.toLocaleString() ?? '—'}
                  {hit.overkill != null && hit.overkill > 0 && (
                    <small>+{hit.overkill.toLocaleString()} overkill</small>
                  )}
                </strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">
            No incoming damage evidence available. Falls, scripted deaths, and missing events may not have a
            damage trail.
          </p>
        )}
        {report.source !== 'demo' && (
          <a
            className="external-link"
            href={fflogsLink(report.code, pull.id, death.playerId, death.timestamp)}
            target="_blank"
            rel="noreferrer"
          >
            Inspect the death in FFLogs <ExternalLink size={13} />
          </a>
        )}
      </div>
    </details>
  )
}

export function Coverage() {
  return (
    <>
      <div className="eyebrow">METHOD & COVERAGE</div>
      <h2>Evidence before a score.</h2>
      <p className="detail-subtitle">A useful raid review should make its limits as clear as its findings.</p>
      <div className="coverage-block">
        <h3>
          <Check size={18} />
          Available now
        </h3>
        <p>
          Player deaths, recorded killing abilities, first deaths, recent incoming damage,
          participation-adjusted death frequency, boss HP, fight progression, and Limit Break entity casts.
        </p>
        <p>
          A session currently means one FFLogs report, restricted to the selected boss pulls. Non-boss
          segments, pets, NPCs, and Limit Break entities do not enter the player roster.
        </p>
      </div>
      <div className="coverage-block">
        <h3>
          <ArrowDownRight size={18} />
          Next: xivanalysis modules
        </h3>
        <p>
          The upstream source is pinned in the repository. Its parser is not running in this MVP. Per-job and
          boss metrics need event normalization and structured result extraction.
        </p>
        <p>
          Unsupported, incomplete, and not-applicable metrics will remain separate states. A missing
          mitigation or uptime metric will never silently become a zero.
        </p>
      </div>
      <div className="coverage-block">
        <h3>
          <CircleHelp size={18} />
          Reading the numbers
        </h3>
        <p>
          The killing blow is not necessarily the mistake that caused a death. First deaths may be
          simultaneous, deliberate, or part of an already lost pull.
        </p>
        <p>
          Deaths per pull uses only the pulls that player joined. The table includes wipe cleanup and deaths
          after a resurrection. It is a frequency measure, not a ranking of player skill.
        </p>
        <p>
          Fight remaining uses FFLogs’ encounter progression. Boss HP remaining is shown separately because
          phase transitions and multiple bosses can make the two differ.
        </p>
      </div>
      <div className="coverage-block">
        <h3>
          <Shield size={18} />
          Scoring direction
        </h3>
        <p>
          Keep execution quality, observed fight coverage, and raid progression visible separately. A clean
          30-second opener gives evidence about that opener; it does not establish full-fight performance.
        </p>
        <p>
          No performance score is calculated in this MVP. Later scores need job-specific opportunity counts,
          encounter windows, patch versions, and enough observed mechanics to be meaningful.
        </p>
      </div>
    </>
  )
}
