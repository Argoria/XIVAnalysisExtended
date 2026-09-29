import { DeepCoverage } from './DeepCoverage'
import { getXivanalysisMetricStatus } from '../../shared/xivanalysis'
import { sanitizeXivanalysisResult, XIVANALYSIS_METRICS } from '../../shared/xivanalysis-integrity'
import {
  ArrowDownRight,
  ArrowLeft,
  Check,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  LoaderCircle,
  Shield,
  Sparkles,
} from 'lucide-react'
import { summarizeXivanalysis } from '../../shared/xivanalysis'
import type {
  Death,
  PlayerPullPerformance,
  Pull,
  PullAnalysis,
  Report,
  XivanalysisPlayerAnalysis,
  XivanalysisSuggestion,
} from '../../shared/types'
import { duration, fflogsLink, percent } from '../format'
import { Empty, JobBadge } from './ui'

const delay = (ms: number | null) => (ms == null ? '—' : `${(ms / 1000).toFixed(2)}s`)
const metricPercent = (value: number | null) => (value == null ? '—' : `${value.toFixed(1)}%`)
const metricNumber = (value: number | null) => (value == null ? '—' : Math.round(value).toLocaleString())
const readableLabel = (value: string | null, fallback: string) => {
  if (!value) return fallback
  return value
    .replace(
      /^(core|gnb|ast|sch|whm|sge|pld|war|drk|mnk|drg|nin|sam|rpr|vpr|brd|mch|dnc|blm|smn|rdm|pct|blu)[.]/,
      '',
    )
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

const severeSuggestionCount = (analysis?: XivanalysisPlayerAnalysis) =>
  analysis?.suggestions.filter(
    (suggestion) =>
      suggestion.severityName !== 'ignore' && (suggestion.severity === 0 || suggestion.severity === 1),
  ).length ?? 0

const failedChecklistCount = (analysis?: XivanalysisPlayerAnalysis) =>
  analysis?.checklist.filter((rule) => !rule.passed).length ?? 0

function PerformanceMetrics({ performance }: { performance?: PlayerPullPerformance }) {
  const metrics = performance?.metrics
  return (
    <div className="pull-player-metrics">
      <div>
        <span>DPS</span>
        <strong>{metricNumber(metrics?.dps ?? null)}</strong>
      </div>
      <div>
        <span>rDPS</span>
        <strong>{metricNumber(metrics?.rdps ?? null)}</strong>
      </div>
      <div>
        <span>nDPS</span>
        <strong>{metricNumber(metrics?.ndps ?? null)}</strong>
      </div>
      <div>
        <span>cDPS</span>
        <strong>{metricNumber(metrics?.cdps ?? null)}</strong>
      </div>
      <div>
        <span>Deaths</span>
        <strong>{performance?.deaths ?? '—'}</strong>
      </div>
    </div>
  )
}

export function PullDetail({
  report,
  pull,
  analysis,
  error,
  playerId,
  xivanalysis,
  xivanalysisByPlayer = {},
  xivanalysisLoading = false,
  xivanalysisError,
  xivanalysisBatchRunning = false,
  xivanalysisBatchProgress,
  xivanalysisBatchError,
  onSelectPlayer,
  onClearPlayer,
  onAnalyzePull,
}: {
  report: Report
  pull: Pull
  analysis?: PullAnalysis
  error?: string
  playerId?: number | null
  xivanalysis?: XivanalysisPlayerAnalysis
  xivanalysisByPlayer?: Record<number, XivanalysisPlayerAnalysis>
  xivanalysisLoading?: boolean
  xivanalysisError?: string
  xivanalysisBatchRunning?: boolean
  xivanalysisBatchProgress?: { done: number; total: number }
  xivanalysisBatchError?: string
  onSelectPlayer?: (playerId: number) => void
  onClearPlayer?: () => void
  onAnalyzePull?: () => void
}) {
  const player = playerId == null ? undefined : report.players.find((candidate) => candidate.id === playerId)
  const participatingPlayers = report.players.filter((candidate) => pull.playerIds.includes(candidate.id))
  const deepResults = participatingPlayers
    .map((candidate) => xivanalysisByPlayer[candidate.id])
    .filter((result): result is XivanalysisPlayerAnalysis => result != null)
  const deepSummary = summarizeXivanalysis(deepResults)
  const firstDeath = analysis?.deaths.find((death) => death.firstDeath)
  const firstDeathPlayer = firstDeath
    ? report.players.find((candidate) => candidate.id === firstDeath.playerId)
    : undefined
  const selectedPerformance = player
    ? analysis?.performance.find((entry) => entry.playerId === player.id)
    : undefined
  const selectedDeep = player ? (xivanalysis ?? xivanalysisByPlayer[player.id]) : undefined
  const xivaLink =
    report.source !== 'demo' && player
      ? `https://xivanalysis.com/fflogs/${report.code}/${pull.id}/${player.id}`
      : null

  return (
    <>
      <div className="eyebrow">PULL REVIEW</div>
      <h2>
        Pull {pull.id}{' '}
        <span className={`pill ${pull.kill ? 'success' : 'neutral'}`}>{pull.kill ? 'Clear' : 'Wipe'}</span>
      </h2>
      <p className="detail-subtitle">
        {pull.name} · {duration(pull.endTime - pull.startTime)} · {percent(pull.fightRemaining)} fight
        remaining · {percent(pull.bossRemaining)} boss HP
      </p>
      {report.source !== 'demo' && (
        <a className="external-link" href={fflogsLink(report.code, pull.id)} target="_blank" rel="noreferrer">
          Open this pull in FFLogs <ExternalLink size={14} />
        </a>
      )}

      {deepResults.length > 0 && <DeepCoverage summary={deepSummary} expected={pull.playerIds.length} />}
      {!analysis ? (
        <>
          <div className="detail-divider" />
          <Empty
            title={error ? 'Analysis unavailable' : 'Events are loading'}
            text={error || 'Select this pull in the sidebar to load its analysis.'}
          />
        </>
      ) : (
        <>
          <div className="pull-review-summary">
            <div>
              <span>Deaths</span>
              <strong>{analysis.deaths.length}</strong>
              <small>{analysis.deaths.length ? 'including wipe cleanup' : 'clean pull'}</small>
            </div>
            <div>
              <span>First death</span>
              <strong>{firstDeathPlayer?.name ?? 'None'}</strong>
              <small>{firstDeath ? duration(firstDeath.timestamp - pull.startTime) : '—'}</small>
            </div>
            <div>
              <span>Deep coverage</span>
              <strong>
                {deepResults.length}/{participatingPlayers.length}
              </strong>
              <small>players analyzed</small>
            </div>
            <div>
              <span>Weighted GCD uptime</span>
              <strong>{metricPercent(deepSummary.gcdUptimePercent)}</strong>
              <small>
                {deepSummary.gcdPlayerPullsMeasured
                  ? `${deepSummary.gcdPlayerPullsMeasured} measured`
                  : 'not measured'}
              </small>
            </div>
            <div>
              <span>Major findings</span>
              <strong>
                {deepSummary.metricCoverage.suggestions.measured ? deepSummary.severeSuggestions : '—'}
              </strong>
              <small>
                {deepSummary.metricCoverage.suggestions.measured
                  ? `${deepSummary.visibleSuggestions} visible total`
                  : 'no measured findings'}
              </small>
            </div>
          </div>

          <div className="detail-divider" />
          <div className="pull-section-heading">
            <div>
              <h3>{player ? 'Player review' : 'Player-by-player review'}</h3>
              <p className="muted small">
                FFLogs output and xivanalysis execution findings for this specific pull.
              </p>
            </div>
            {!player && report.source !== 'demo' && (
              <button
                className="button"
                onClick={onAnalyzePull}
                disabled={xivanalysisBatchRunning || deepResults.length >= participatingPlayers.length}
              >
                {xivanalysisBatchRunning ? (
                  <>
                    <LoaderCircle size={14} className="spin" />
                    {xivanalysisBatchProgress
                      ? `${xivanalysisBatchProgress.done}/${xivanalysisBatchProgress.total}`
                      : 'Analyzing…'}
                  </>
                ) : deepResults.length >= participatingPlayers.length ? (
                  'Deep results loaded'
                ) : (
                  'Analyze all players'
                )}
              </button>
            )}
          </div>

          {xivanalysisBatchError && <div className="notice error xiva-error">{xivanalysisBatchError}</div>}

          {!player ? (
            <div className="pull-player-review">
              <div className="pull-player-review-head">
                <span>Player</span>
                <span>DPS / rDPS</span>
                <span>Deaths</span>
                <span>GCD uptime</span>
                <span>Checklist</span>
                <span>Findings</span>
                <span />
              </div>
              {participatingPlayers.map((candidate) => {
                const performance = analysis.performance.find((entry) => entry.playerId === candidate.id)
                const rawDeep = xivanalysisByPlayer[candidate.id]
                const deep = rawDeep ? sanitizeXivanalysisResult(rawDeep) : undefined
                const failed = failedChecklistCount(deep)
                const severe = severeSuggestionCount(deep)
                const visible =
                  deep?.suggestions.filter((suggestion) => suggestion.severityName !== 'ignore').length ?? 0
                return (
                  <button
                    key={candidate.id}
                    className={`pull-player-review-row ${performance?.deaths || severe || failed ? 'has-findings' : ''}`}
                    onClick={() => onSelectPlayer?.(candidate.id)}
                  >
                    <span className="pull-player-name">
                      <JobBadge player={candidate} />
                      <span>
                        <strong>{candidate.name}</strong>
                        <small>{candidate.job}</small>
                      </span>
                    </span>
                    <span>
                      <strong>{metricNumber(performance?.metrics.dps ?? null)}</strong>
                      <small>{metricNumber(performance?.metrics.rdps ?? null)} rDPS</small>
                    </span>
                    <span>
                      <strong>{performance?.deaths ?? '—'}</strong>
                      <small>{performance?.firstDeath ? 'first death' : '—'}</small>
                    </span>
                    <span>
                      <strong>{metricPercent(deep?.uptime.gcdUptimePercent ?? null)}</strong>
                      <small>
                        {deep?.uptime.gcdDowntimeMs == null
                          ? deep
                            ? 'delay unavailable'
                            : 'not analyzed'
                          : `${delay(deep.uptime.gcdDowntimeMs)} delay`}
                      </small>
                    </span>
                    <span>
                      <strong>
                        {deep && getXivanalysisMetricStatus(deep, 'checklist').state === 'measured'
                          ? `${deep.checklist.length - failed}/${deep.checklist.length}`
                          : '—'}
                      </strong>
                      <small>
                        {deep
                          ? getXivanalysisMetricStatus(deep, 'checklist').state === 'measured'
                            ? `${failed} failed`
                            : 'incomplete / unavailable'
                          : 'not analyzed'}
                      </small>
                    </span>
                    <span>
                      <strong>
                        {deep && getXivanalysisMetricStatus(deep, 'suggestions').state === 'measured'
                          ? severe
                          : '—'}
                      </strong>
                      <small>{deep ? `${visible} visible` : 'not analyzed'}</small>
                    </span>
                    <span className="pull-player-review-action">
                      Review <ChevronRight size={14} />
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <>
              <button className="text-button pull-player-back" onClick={onClearPlayer}>
                <ArrowLeft size={14} /> All players
              </button>
              <div className="xiva-player-heading">
                <JobBadge player={player} />
                <div>
                  <strong>{player.name}</strong>
                  <span>{player.job} · player × pull analysis</span>
                </div>
                {xivaLink && (
                  <a href={xivaLink} target="_blank" rel="noreferrer" aria-label="Open in xivanalysis">
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>

              <PerformanceMetrics performance={selectedPerformance} />

              {report.source === 'demo' ? (
                <p className="muted small">Deep job analysis is not fabricated for synthetic demo data.</p>
              ) : xivanalysisLoading && !selectedDeep ? (
                <div className="xiva-state">
                  <LoaderCircle size={17} className="spin" />
                  Running xivanalysis for this player and pull…
                </div>
              ) : xivanalysisError && !selectedDeep ? (
                <div className="notice error xiva-error">{xivanalysisError}</div>
              ) : selectedDeep ? (
                <XivanalysisDetail analysis={selectedDeep} />
              ) : (
                <p className="muted small">xivanalysis data has not been loaded for this player.</p>
              )}
            </>
          )}

          <div className="detail-divider" />
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
        </>
      )}
    </>
  )
}

function XivanalysisDetail({ analysis: rawAnalysis }: { analysis: XivanalysisPlayerAnalysis }) {
  const analysis = sanitizeXivanalysisResult(rawAnalysis)
  const uptime = analysis.uptime
  const visibleSuggestions = analysis.suggestions.filter((suggestion) => suggestion.severityName !== 'ignore')
  const failedModules = analysis.modules.filter((module) => module.error)
  return (
    <div className="xiva-analysis">
      {failedModules.length > 0 && (
        <div className="notice error xiva-error">
          {failedModules.length} xivanalysis {failedModules.length === 1 ? 'module' : 'modules'} failed.
          Results below may be incomplete:
          <ul>
            {failedModules.map((module) => (
              <li key={module.handle}>
                {readableLabel(module.handle, module.handle)}: {module.error}
              </li>
            ))}
          </ul>
        </div>
      )}
      <dl className="metric-status-list">
        {XIVANALYSIS_METRICS.map((key) => {
          const status = getXivanalysisMetricStatus(analysis, key)
          return (
            <div key={key}>
              <dt>
                {
                  {
                    gcdUptime: 'GCD uptime',
                    gcdDowntime: 'GCD delay',
                    weaving: 'Weaving',
                    interrupts: 'Interrupted casts',
                    checklist: 'Checklist',
                    suggestions: 'Suggestions',
                  }[key]
                }
              </dt>
              <dd>
                {status.state}
                {status.reason ? ` — ${status.reason}` : ''}
              </dd>
            </div>
          )
        })}
      </dl>
      <div className="xiva-metrics">
        <div>
          <span>GCD uptime</span>
          <strong>{metricPercent(uptime.gcdUptimePercent)}</strong>
          <small>{uptime.gcdCount == null ? 'No GCD count' : `${uptime.gcdCount} GCDs observed`}</small>
        </div>
        <div>
          <span>GCD delay</span>
          <strong>{delay(uptime.gcdDowntimeMs)}</strong>
          <small>
            {uptime.gcdDowntimeCount == null ? 'Unavailable' : `${uptime.gcdDowntimeCount} issues`}
          </small>
        </div>
        <div>
          <span>Weaving delay</span>
          <strong>{delay(uptime.weavingDelayMs)}</strong>
          <small>
            {uptime.weavingIssueCount == null ? 'Unavailable' : `${uptime.weavingIssueCount} issues`}
          </small>
        </div>
        <div>
          <span>Interrupted casts</span>
          <strong>{delay(uptime.interruptedCastDelayMs)}</strong>
          <small>
            {uptime.interruptedCastCount == null ? 'Unavailable' : `${uptime.interruptedCastCount} issues`}
          </small>
        </div>
      </div>

      <div className="xiva-section">
        <div className="xiva-section-heading">
          <h4>Checklist</h4>
          <span>
            {analysis.checklist.filter((rule) => rule.passed).length}/{analysis.checklist.length} passing
          </span>
        </div>
        {analysis.checklist.length ? (
          <div className="xiva-rules">
            {analysis.checklist.map((rule, index) => (
              <div className="xiva-rule" key={`${rule.label ?? 'rule'}:${index}`}>
                <span className={`xiva-rule-status ${rule.passed ? 'pass' : 'fail'}`}>
                  {rule.passed ? <Check size={13} /> : '×'}
                </span>
                <div>
                  <strong>{readableLabel(rule.label, `Rule ${index + 1}`)}</strong>
                  <small>
                    {rule.percent.toFixed(1)}% · target {rule.target.toFixed(1)}%
                  </small>
                  {rule.requirements.length > 1 && (
                    <ul>
                      {rule.requirements.map((requirement, requirementIndex) => (
                        <li key={`${requirement.label ?? 'requirement'}:${requirementIndex}`}>
                          <span>
                            {readableLabel(requirement.label, `Requirement ${requirementIndex + 1}`)}
                          </span>
                          <strong>{requirement.percent.toFixed(1)}%</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted small">No checklist rules were emitted for this job and observed pull.</p>
        )}
      </div>

      <div className="xiva-section">
        <div className="xiva-section-heading">
          <h4>Suggestions</h4>
          <span>{visibleSuggestions.length}</span>
        </div>
        {visibleSuggestions.length ? (
          <div className="xiva-suggestions">
            {visibleSuggestions.map((suggestion, index) => (
              <SuggestionDetail key={index} suggestion={suggestion} />
            ))}
          </div>
        ) : (
          <p className="muted small">No visible xivanalysis suggestions were emitted.</p>
        )}
      </div>

      <p className="xiva-provenance">
        xivanalysis engine {analysis.engineRevision.slice(0, 8)} · adapter {analysis.adapterVersion} ·{' '}
        {analysis.adaptedEventCount.toLocaleString()} normalized events · {analysis.moduleCount} modules
      </p>
    </div>
  )
}

function SuggestionDetail({ suggestion }: { suggestion: XivanalysisSuggestion }) {
  return (
    <div className={`xiva-suggestion severity-${suggestion.severityName}`}>
      <div>
        <strong>{suggestion.content || suggestion.kind}</strong>
        <span className="pill neutral">{suggestion.severityName}</span>
      </div>
      {suggestion.why && suggestion.why !== suggestion.content && <p>{suggestion.why}</p>}
      {suggestion.value != null && <small>Observed value: {suggestion.value}</small>}
    </div>
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
          FFLogs deaths, killing abilities, first deaths, incoming-damage evidence, participation-adjusted
          death frequency, boss progression, Limit Break casts, and FFLogs DPS-family metrics.
        </p>
        <p>
          For an inspected player × pull, the pinned xivanalysis engine now provides GCD uptime, GCD delay,
          weaving/interruption issues, checklist percentages, and structured suggestions.
        </p>
      </div>
      <div className="coverage-block">
        <h3>
          <ArrowDownRight size={18} />
          Next extraction work
        </h3>
        <p>These are planned extractors. None is counted as a measured result yet:</p>
        <div className="extraction-list">
          <div>
            <strong>Opener</strong>
            <span>
              Job-specific action sequence and timing, from each job's xivanalysis modules. Report observed
              actions, expected actions, and coverage; no universal pass/fail shortcut.
            </span>
          </div>
          <div>
            <strong>Mitigation</strong>
            <span>
              Defensive casts aligned to incoming damage and encounter windows. Attribute usage only where the
              player had an eligible opportunity.
            </span>
          </div>
          <div>
            <strong>DoT uptime</strong>
            <span>
              Use job and target-specific DoT tracking plus targetable windows. Jobs without a DoT receive
              not-applicable, not zero.
            </span>
          </div>
          <div>
            <strong>Boss mechanics</strong>
            <span>
              Map encounter-specific enemy casts, repeated occurrences, player hits, and phase windows to
              named opportunities. The sidebar's last enemy cast is only a provisional progression marker.
            </span>
          </div>
        </div>
        <p>
          Each extractor must expose measured, unsupported, incomplete, or not-applicable status. Missing
          evidence must never become a measured zero.
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
          Confirmed scrapped pulls are excluded by default. Suspected resets remain included until reviewed.
          No composite performance score is published yet. Later scoring needs versioned job-specific metrics,
          encounter opportunity counts, support state, and enough observed mechanics to be meaningful.
        </p>
      </div>
    </>
  )
}
