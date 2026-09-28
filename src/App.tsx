import { Stat, JobBadge, Empty } from './components/ui'
import { PullDetail, Coverage } from './components/PullDetail'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Crosshair,
  Flag,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  RefreshCw,
  Shield,
  Skull,
  Sparkles,
  Swords,
  Users,
  X,
} from 'lucide-react'
import { summarize } from '../shared/analysis'
import { summarizeXivanalysis } from '../shared/xivanalysis'
import { demoAnalyses, demoReport } from '../shared/demo'
import { parseReportInput } from '../shared/report-input'
import type { Pull, PullAnalysis, Report, XivanalysisPlayerAnalysis } from '../shared/types'
import { api } from './api'
import { duration, percent } from './format'

type View = 'session' | 'players' | 'pulls' | 'matrix'
const views: { id: View; label: string; icon: typeof Activity }[] = [
  { id: 'session', label: 'Session overview', icon: LayoutDashboard },
  { id: 'players', label: 'By player', icon: Users },
  { id: 'pulls', label: 'By pull', icon: Swords },
  { id: 'matrix', label: 'Player × pull', icon: Layers3 },
]
const encounterKey = (pull: Pull) => `${pull.encounterID}:${pull.difficulty ?? 'unknown'}`
const xivanalysisKey = (pullId: number, playerId: number) => `${pullId}:${playerId}`

export function App() {
  const [report, setReport] = useState<Report>(demoReport)
  const [analyses, setAnalyses] = useState<Record<number, PullAnalysis>>(
    Object.fromEntries(demoAnalyses.map((a) => [a.fightId, a])),
  )
  const [encounter, setEncounter] = useState(encounterKey(demoReport.pulls[0]))
  const [selected, setSelected] = useState<number[]>(demoReport.pulls.slice(0, 8).map((p) => p.id))
  const [view, setView] = useState<View>('session')
  const [input, setInput] = useState('')
  const [loadError, setLoadError] = useState('')
  const [loadingReport, setLoadingReport] = useState(false)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [failures, setFailures] = useState<Record<number, string>>({})
  const [revision, setRevision] = useState(0)
  const [focusedPull, setFocusedPull] = useState<number | null>(null)
  const [focusedPlayer, setFocusedPlayer] = useState<number | null>(null)
  const [playerPullSort, setPlayerPullSort] = useState<
    'boss' | 'dps' | 'uptime' | 'fewest-deaths' | 'most-deaths'
  >('boss')
  const [helpOpen, setHelpOpen] = useState(false)
  const [xivanalysis, setXivanalysis] = useState<XivanalysisPlayerAnalysis | null>(null)
  const [xivanalysisError, setXivanalysisError] = useState('')
  const [xivanalysisLoading, setXivanalysisLoading] = useState(false)
  const [deepAnalyses, setDeepAnalyses] = useState<Record<string, XivanalysisPlayerAnalysis>>({})
  const [deepBatchProgress, setDeepBatchProgress] = useState<{ done: number; total: number } | null>(null)
  const [deepBatchError, setDeepBatchError] = useState('')
  const loadController = useRef<AbortController | null>(null)
  const analysisController = useRef<AbortController | null>(null)
  const xivanalysisController = useRef<AbortController | null>(null)
  const deepBatchController = useRef<AbortController | null>(null)
  const detailRef = useRef<HTMLElement>(null)
  useEffect(() => {
    api
      .health()
      .then((h) => setConfigured(h.configured))
      .catch(() => setConfigured(null))
    return () => loadController.current?.abort()
  }, [])
  const available = useMemo(
    () => report.pulls.filter((p) => encounter === 'all' || encounterKey(p) === encounter),
    [report, encounter],
  )
  const pulls = useMemo(() => available.filter((p) => selected.includes(p.id)), [available, selected])
  const selectionKey = selected.join(',')

  useEffect(() => {
    if (report.source === 'demo') return
    const controller = new AbortController()
    analysisController.current = controller
    const pending = report.pulls.filter((p) => selected.includes(p.id) && !analyses[p.id])
    let cursor = 0
    async function worker() {
      while (cursor < pending.length && !controller.signal.aborted) {
        const pull = pending[cursor++]
        try {
          const result = await api.pull(report.code, pull.id, revision > 0, controller.signal)
          if (!controller.signal.aborted) setAnalyses((previous) => ({ ...previous, [pull.id]: result }))
        } catch (error) {
          if (!controller.signal.aborted)
            setFailures((previous) => ({
              ...previous,
              [pull.id]: error instanceof Error ? error.message : 'Analysis failed.',
            }))
        }
      }
    }
    void Promise.all([worker(), worker()])
    return () => controller.abort()
    // Cache updates must not restart in-flight workers. Selection and revision own the lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, selectionKey, revision])

  useEffect(() => {
    xivanalysisController.current?.abort()
    setXivanalysis(null)
    setXivanalysisError('')
    setXivanalysisLoading(false)

    if (report.source === 'demo' || focusedPull == null || focusedPlayer == null) return
    const pull = report.pulls.find((candidate) => candidate.id === focusedPull)
    if (!pull?.playerIds.includes(focusedPlayer)) return

    const key = xivanalysisKey(focusedPull, focusedPlayer)
    const cached = deepAnalyses[key]
    if (cached) {
      setXivanalysis(cached)
      return
    }

    const controller = new AbortController()
    xivanalysisController.current = controller
    setXivanalysisLoading(true)
    api
      .xivanalysis(report.code, focusedPull, focusedPlayer, false, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setXivanalysis(result)
          setDeepAnalyses((previous) => ({ ...previous, [key]: result }))
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setXivanalysisError(error instanceof Error ? error.message : 'xivanalysis failed.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setXivanalysisLoading(false)
      })
    return () => controller.abort()
  }, [report, focusedPull, focusedPlayer, deepAnalyses])

  useEffect(() => {
    deepBatchController.current?.abort()
    setDeepBatchProgress(null)
    setDeepBatchError('')
  }, [focusedPlayer, selectionKey])

  useEffect(() => {
    if (focusedPull != null || helpOpen) {
      const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
      detailRef.current?.focus()
      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          setFocusedPull(null)
          setHelpOpen(false)
        }
        if (event.key === 'Tab') {
          const elements = [
            ...(detailRef.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), a[href], summary, [tabindex="0"]',
            ) ?? []),
          ].filter((el) => el.getClientRects().length)
          const first = elements[0],
            last = elements.at(-1)
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === detailRef.current)
          ) {
            event.preventDefault()
            last?.focus()
          } else if (
            !event.shiftKey &&
            (document.activeElement === last || document.activeElement === detailRef.current)
          ) {
            event.preventDefault()
            first?.focus()
          }
        }
      }
      window.addEventListener('keydown', onKey)
      return () => {
        window.removeEventListener('keydown', onKey)
        previousFocus?.focus()
      }
    }
  }, [focusedPull, helpOpen])

  const completed = pulls.filter((p) => analyses[p.id])
  const summary = useMemo(() => summarize(report, pulls, Object.values(analyses)), [report, pulls, analyses])
  const failedPulls = pulls.filter((p) => failures[p.id] && !analyses[p.id])
  const pendingCount = pulls.length - completed.length - failedPulls.length
  const encounters = [...new Map(report.pulls.map((p) => [encounterKey(p), p])).values()]
  const inspected = report.pulls.find((p) => p.id === focusedPull)
  const isDemo = report.source === 'demo'
  const bestPull = [...pulls]
    .filter((p) => p.fightRemaining != null)
    .sort((a, b) => a.fightRemaining! - b.fightRemaining!)[0]
  const performanceFor = (fightId: number, playerId: number) =>
    analyses[fightId]?.performance.find((entry) => entry.playerId === playerId)

  const deepSummaryByPlayer = useMemo(() => {
    const selectedPullIds = new Set(pulls.map((pull) => pull.id))
    const grouped = new Map<number, XivanalysisPlayerAnalysis[]>()
    for (const result of Object.values(deepAnalyses)) {
      if (!selectedPullIds.has(result.fightId)) continue
      const actorId = Number(result.actorId)
      if (!Number.isFinite(actorId)) continue
      const entries = grouped.get(actorId) ?? []
      entries.push(result)
      grouped.set(actorId, entries)
    }
    return new Map(
      report.players.map((player) => [
        player.id,
        summarizeXivanalysis(grouped.get(player.id) ?? []),
      ]),
    )
  }, [deepAnalyses, pulls, report.players])
  const focusedDeepSummary =
    focusedPlayer == null ? null : (deepSummaryByPlayer.get(focusedPlayer) ?? null)
  const focusedParticipatingPulls =
    focusedPlayer == null ? [] : pulls.filter((pull) => pull.playerIds.includes(focusedPlayer))
  const deepBatchRunning =
    deepBatchProgress != null && deepBatchProgress.done < deepBatchProgress.total

  function installReport(next: Report, fightId?: number | 'last') {
    analysisController.current?.abort()
    xivanalysisController.current?.abort()
    deepBatchController.current?.abort()
    const initial = fightId === 'last' ? next.pulls.at(-1) : next.pulls.find((p) => p.id === fightId)
    setReport(next)
    setEncounter(initial ? encounterKey(initial) : 'all')
    setSelected(initial ? [initial.id] : next.pulls.map((p) => p.id))
    setAnalyses(next.source === 'demo' ? Object.fromEntries(demoAnalyses.map((a) => [a.fightId, a])) : {})
    setFailures({})
    setDeepAnalyses({})
    setDeepBatchProgress(null)
    setDeepBatchError('')
    setXivanalysis(null)
    setXivanalysisError('')
    setXivanalysisLoading(false)
    setRevision(0)
    setFocusedPlayer(null)
    setFocusedPull(null)
    setView('session')
  }

  async function loadReport(event: React.FormEvent) {
    event.preventDefault()
    setLoadError('')
    let parsed: ReturnType<typeof parseReportInput>
    try {
      parsed = parseReportInput(input)
    } catch (error) {
      setLoadError((error as Error).message)
      return
    }
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller
    setLoadingReport(true)
    try {
      const next = await api.report(parsed.code, controller.signal)
      if (!controller.signal.aborted) {
        installReport(next, parsed.fightId)
        setConfigured(true)
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setLoadError(error instanceof Error ? error.message : 'Could not load report.')
    } finally {
      if (!controller.signal.aborted) setLoadingReport(false)
    }
  }

  function changeEncounter(value: string) {
    setEncounter(value)
    setSelected(report.pulls.filter((p) => value === 'all' || encounterKey(p) === value).map((p) => p.id))
    setFocusedPlayer(null)
  }

  async function refresh() {
    if (isDemo) {
      installReport(demoReport)
      return
    }
    setLoadingReport(true)
    setLoadError('')
    analysisController.current?.abort()
    xivanalysisController.current?.abort()
    deepBatchController.current?.abort()
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller
    try {
      const next = await api.report(report.code, controller.signal)
      if (!controller.signal.aborted) {
        setReport(next)
        setAnalyses({})
        setFailures({})
        setDeepAnalyses({})
        setDeepBatchProgress(null)
        setDeepBatchError('')
        setXivanalysis(null)
        setXivanalysisError('')
        setXivanalysisLoading(false)
        setRevision((v) => v + 1)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setLoadError((error as Error).message)
        setRevision((v) => v + 1)
      }
    } finally {
      if (!controller.signal.aborted) setLoadingReport(false)
    }
  }

  async function analyzeFocusedPlayerPulls() {
    if (report.source === 'demo' || focusedPlayer == null) return

    xivanalysisController.current?.abort()
    setXivanalysisLoading(false)
    deepBatchController.current?.abort()
    const controller = new AbortController()
    deepBatchController.current = controller

    const targets = pulls.filter((pull) => pull.playerIds.includes(focusedPlayer))
    const pending = targets.filter(
      (pull) => !deepAnalyses[xivanalysisKey(pull.id, focusedPlayer)],
    )
    const alreadyDone = targets.length - pending.length
    setDeepBatchProgress({ done: alreadyDone, total: targets.length })
    setDeepBatchError('')
    if (!pending.length) return

    let cursor = 0
    let failed = 0
    async function worker() {
      while (cursor < pending.length && !controller.signal.aborted) {
        const pull = pending[cursor++]
        const key = xivanalysisKey(pull.id, focusedPlayer!)
        try {
          const result = await api.xivanalysis(
            report.code,
            pull.id,
            focusedPlayer!,
            false,
            controller.signal,
          )
          if (!controller.signal.aborted) {
            setDeepAnalyses((previous) => ({ ...previous, [key]: result }))
            if (focusedPull === pull.id) setXivanalysis(result)
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            failed++
            setDeepBatchError(
              `${failed} deep ${failed === 1 ? 'analysis' : 'analyses'} failed: ${
                error instanceof Error ? error.message : 'xivanalysis failed.'
              }`,
            )
          }
        } finally {
          if (!controller.signal.aborted) {
            setDeepBatchProgress((previous) =>
              previous ? { ...previous, done: previous.done + 1 } : previous,
            )
          }
        }
      }
    }

    await Promise.all([worker(), worker()])
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Pullwise home">
          <span className="brand-mark">
            <Activity size={24} />
          </span>
          <span>
            pullwise<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="sidebar-caption">FINAL FANTASY XIV · RAID ANALYSIS</div>
        <nav aria-label="Analysis views">
          {views.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              onClick={() => setView(item.id)}
              aria-current={view === item.id ? 'page' : undefined}
            >
              <item.icon size={18} />
              {item.label}
              {view === item.id && <ChevronRight size={15} className="nav-arrow" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-separator" />
        <div className="sidebar-section">
          <span className="eyebrow">PULL SELECTION</span>
          <span>
            {selected.length}/{available.length}
          </span>
        </div>
        <div className="selection-actions">
          <button onClick={() => setSelected(available.map((p) => p.id))}>Select all</button>
          <span>·</span>
          <button onClick={() => setSelected([])}>Clear</button>
        </div>
        <div className="pull-list">
          {available.map((p) => (
            <label key={p.id} className={`pull-option ${selected.includes(p.id) ? 'selected' : ''}`}>
              <input
                type="checkbox"
                name={`pull-${p.id}`}
                checked={selected.includes(p.id)}
                onChange={(e) =>
                  setSelected((current) =>
                    e.target.checked ? [...current, p.id] : current.filter((id) => id !== p.id),
                  )
                }
              />
              <span>
                Pull {p.id}
                <small>{encounter === 'all' ? p.name : duration(p.endTime - p.startTime)}</small>
              </span>
              <span className={p.kill ? 'kill-text' : 'remaining'}>
                {p.kill ? <Check size={15} aria-label="Kill" /> : percent(p.fightRemaining)}
              </span>
            </label>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="source-status">
            <span className={`status-dot ${configured ? 'connected' : ''}`} />
            {configured
              ? 'FFLogs credentials configured'
              : configured === false
                ? 'FFLogs credentials needed'
                : 'API connection unverified'}
          </div>
          <button className="help-button" onClick={() => setHelpOpen(true)}>
            <CircleHelp size={16} />
            How to read this analysis
            <ArrowRight size={14} />
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumbs">
            Workspace <ChevronRight size={13} />
            <span>Raid review</span>
          </div>
          <span className="version">
            FFLogs MVP <span>v0.1</span>
          </span>
        </header>
        <div className="main-content">
          <section className="report-loader" aria-label="Load a report">
            <div className="loader-label">
              <Activity size={18} />
              <strong>Start with a log</strong>
            </div>
            <form onSubmit={loadReport}>
              <input
                name="report"
                aria-label="FFLogs report URL or code"
                placeholder="Paste an FFLogs report URL or code…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <button className="button primary" disabled={loadingReport || !input.trim()}>
                {loadingReport ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />}Load
                report
              </button>
            </form>
            <button
              className="text-button"
              onClick={() => {
                loadController.current?.abort()
                setLoadingReport(false)
                setLoadError('')
                installReport(demoReport)
              }}
            >
              Try demo
            </button>
          </section>
          {loadError && (
            <div className="notice error" role="alert">
              {loadError}
            </div>
          )}
          {isDemo && (
            <div className="demo-banner">
              <Sparkles size={15} />
              <span>
                <strong>You’re exploring demo data.</strong> All names, deaths, and pull results here are
                illustrative, not findings from your example report.
              </span>
              <span className="demo-tag">SYNTHETIC DATA</span>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">{report.title}</div>
              <h1>{views.find((v) => v.id === view)?.label}</h1>
              <p>Find the patterns. Make the next pull count.</p>
            </div>
            <div className="report-meta">
              <span className={`pill ${isDemo ? 'neutral' : 'success'}`}>
                <span className="tiny-dot" />
                {isDemo ? 'Demo report' : 'FFLogs report'}
              </span>
              <span>
                {new Date(report.startTime).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            </div>
          </div>
          <section className="filter-bar" aria-label="Analysis filters">
            <div>
              <label htmlFor="encounter">Encounter</label>
              <select id="encounter" value={encounter} onChange={(e) => changeEncounter(e.target.value)}>
                <option value="all">All encounters</option>
                {encounters.map((p) => (
                  <option key={encounterKey(p)} value={encounterKey(p)}>
                    {p.name}
                    {encounters.filter((e) => e.encounterID === p.encounterID).length > 1
                      ? ` · difficulty ${p.difficulty}`
                      : ''}
                  </option>
                ))}
              </select>
            </div>
            <span className="filter-count">
              <Swords size={15} />
              {pulls.length} pulls selected<span className="separator-dot">·</span>
              {summary.players.length} players analyzed
            </span>
            <button
              className="icon-button refresh"
              onClick={refresh}
              disabled={loadingReport}
              title={isDemo ? 'Reset demo' : 'Refresh report and events'}
              aria-label={isDemo ? 'Reset demo' : 'Refresh report and events'}
            >
              <RefreshCw size={16} />
            </button>
          </section>
          {!report.pulls.length ? (
            <Empty
              title="No boss encounters found"
              text="This report has no completed boss segments yet. Refresh after a pull is logged."
            />
          ) : !pulls.length ? (
            <Empty
              title="Choose a pull to get started"
              text="Select pulls in the sidebar to build your analysis."
            />
          ) : (
            <>
              {(pendingCount > 0 || failedPulls.length > 0) && (
                <div className={`notice ${failedPulls.length ? 'error' : ''}`} role="status">
                  {pendingCount > 0 && <LoaderCircle size={17} className="spin" />}
                  <div>
                    <strong>
                      {completed.length} of {pulls.length} pulls analyzed.
                    </strong>{' '}
                    {pendingCount > 0 ? `Loading ${pendingCount} more. ` : ''}Summaries below cover completed
                    pulls only.
                    {failedPulls.length > 0 && (
                      <p>
                        {failedPulls.length} failed: {failures[failedPulls[0].id]}
                      </p>
                    )}
                  </div>
                  {failedPulls.length > 0 && (
                    <button
                      className="button"
                      onClick={() => {
                        setFailures({})
                        setRevision((v) => v + 1)
                      }}
                    >
                      Retry
                    </button>
                  )}
                </div>
              )}
              <section className="stat-grid" aria-label="Session statistics">
                <Stat
                  label="Pulls analyzed"
                  value={String(completed.length)}
                  detail={`${summary.kills} ${summary.kills === 1 ? 'clear' : 'clears'} in selection`}
                  icon={<Swords />}
                />
                <Stat
                  label="Player deaths"
                  value={String(summary.deaths.length)}
                  detail={`${summary.cleanPulls} death-free ${summary.cleanPulls === 1 ? 'pull' : 'pulls'}`}
                  icon={<Skull />}
                  accent="coral"
                />
                <Stat
                  label="Best fight remaining"
                  value={bestPull ? percent(bestPull.fightRemaining) : '—'}
                  detail={
                    bestPull
                      ? `Pull ${bestPull.id}${bestPull.kill ? ' · Cleared' : ' · FFLogs progression'}`
                      : 'Progression unavailable'
                  }
                  icon={<Flag />}
                  accent="teal"
                />
                <Stat
                  label="Time in combat"
                  value={duration(summary.totalDuration)}
                  detail="Analyzed pulls · excludes downtime"
                  icon={<Clock3 />}
                />
              </section>
              {view === 'session' && (
                <>
                  <section className="card progression">
                    <div className="card-heading">
                      <div>
                        <span className="eyebrow">THE SESSION AT A GLANCE</span>
                        <h2>Every pull is progress</h2>
                      </div>
                      <span className="chart-legend">
                        <i />
                        Fight completed <span>100% = clear</span>
                      </span>
                    </div>
                    <div className="progress-chart">
                      {pulls.map((p) => (
                        <button
                          key={p.id}
                          className={`chart-column ${p.kill ? 'cleared' : ''}`}
                          onClick={() => {
                            setFocusedPlayer(null)
                            setFocusedPull(p.id)
                          }}
                          aria-label={`Inspect pull ${p.id}, ${percent(p.fightRemaining)} fight remaining`}
                        >
                          <span className="chart-value">
                            {p.kill ? (
                              <Check size={14} />
                            ) : p.fightRemaining == null ? (
                              '—'
                            ) : (
                              `${Math.round(100 - p.fightRemaining)}%`
                            )}
                          </span>
                          <span className="bar-track">
                            <span
                              className="bar-fill"
                              style={{
                                height: `${Math.max(p.fightRemaining == null ? 0 : 100 - p.fightRemaining, 2)}%`,
                              }}
                            />
                          </span>
                          <span className="chart-label">{String(p.id).padStart(2, '0')}</span>
                          <span className="chart-duration">{duration(p.endTime - p.startTime)}</span>
                        </button>
                      ))}
                    </div>
                    <div className="chart-footnote">
                      Pull number{' '}
                      <span>
                        Click a pull to inspect its deaths and Limit Break use <ArrowRight size={13} />
                      </span>
                    </div>
                  </section>
                  <div className="insights-grid">
                    <section className="card">
                      <div className="card-heading">
                        <div>
                          <span className="eyebrow">WHAT IS KILLING US?</span>
                          <h2>Most frequent killing blows</h2>
                        </div>
                        <span className="icon-badge coral">
                          <Crosshair size={19} />
                        </span>
                      </div>
                      {summary.causes.length ? (
                        <div className="causes">
                          {summary.causes.slice(0, 5).map((cause, index) => (
                            <div className="cause" key={cause.key}>
                              <span className="rank">{String(index + 1).padStart(2, '0')}</span>
                              <div className="cause-body">
                                <div>
                                  <strong>{cause.ability}</strong>
                                  <span>
                                    {cause.deaths}
                                    <small> deaths</small>
                                  </span>
                                </div>
                                <div className="cause-track">
                                  <div
                                    style={{ width: `${(cause.deaths / summary.deaths.length) * 100}%` }}
                                  />
                                </div>
                                <small>
                                  {cause.affectedPulls} pulls affected · {cause.firstDeaths} first deaths
                                </small>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <Empty
                          title={completed.length ? 'No player deaths recorded' : 'Waiting for analysis'}
                          text={
                            completed.length
                              ? 'No deaths in the analyzed selection.'
                              : 'Killing blows appear once events finish loading.'
                          }
                        />
                      )}
                      <div className="card-footer">
                        <CircleHelp size={14} />
                        Killing blows describe the final hit, not responsibility.
                      </div>
                    </section>
                    <section className="card">
                      <div className="card-heading">
                        <div>
                          <span className="eyebrow">WHO IS DYING MOST OFTEN?</span>
                          <h2>Player death frequency</h2>
                        </div>
                        <span className="icon-badge">
                          <Users size={19} />
                        </span>
                      </div>
                      <div className="player-ranking">
                        {summary.players.slice(0, 5).map((player) => (
                          <button
                            className="ranked-player"
                            key={player.id}
                            onClick={() => {
                              setFocusedPlayer(player.id)
                              setView('players')
                            }}
                          >
                            <JobBadge player={player} />
                            <div>
                              <strong>{player.name}</strong>
                              <small>
                                {player.deaths} deaths in {player.pulls} pulls
                              </small>
                            </div>
                            <div className="frequency">
                              <strong>{player.deathsPerPull.toFixed(2)}</strong>
                              <small>per pull</small>
                            </div>
                            <ChevronRight size={15} />
                          </button>
                        ))}
                      </div>
                      <button className="card-footer footer-button" onClick={() => setView('players')}>
                        Review all players <ArrowRight size={15} />
                      </button>
                    </section>
                  </div>
                  <section className="next-step">
                    <div className="next-icon">
                      <Shield size={23} />
                    </div>
                    <div>
                      <span className="eyebrow">DEEPER JOB ANALYSIS</span>
                      <h3>Deaths tell you where to look. Job metrics explain more.</h3>
                      <p>
                        Player × pull GCD uptime, lost-time issues, checklist results, and xivanalysis
                        suggestions are now available on demand.
                      </p>
                    </div>
                    <button className="button" onClick={() => setHelpOpen(true)}>
                      Analysis coverage <ArrowRight size={15} />
                    </button>
                  </section>
                </>
              )}
              {view === 'players' && (
                <section className="card">
                  <div className="card-heading">
                    <div>
                      <h2>Players in these encounters</h2>
                      <p>Sorted by deaths per participating pull. Substitutes keep their own denominator.</p>
                    </div>
                    <select
                      aria-label="Filter player"
                      value={focusedPlayer ?? ''}
                      onChange={(e) => setFocusedPlayer(e.target.value ? Number(e.target.value) : null)}
                    >
                      <option value="">All players</option>
                      {summary.players.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name} · {p.job}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Player</th>
                          <th>Pulls</th>
                          <th>Deaths</th>
                          <th>Deaths / pull</th>
                          <th>Avg DPS</th>
                          <th>Best DPS</th>
                          <th>GCD uptime</th>
                          <th>Deep pulls</th>
                          <th>First deaths</th>
                          <th>Death-free pulls</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.players
                          .filter((p) => focusedPlayer == null || p.id === focusedPlayer)
                          .map((p) => (
                            <tr key={p.id}>
                              <td>
                                <div className="player-cell">
                                  <JobBadge player={p} />
                                  <strong>{p.name}</strong>
                                </div>
                              </td>
                              <td>{p.pulls}</td>
                              <td>
                                <span className={`count-chip ${p.deaths ? 'bad' : 'good'}`}>{p.deaths}</span>
                              </td>
                              <td>{p.deathsPerPull.toFixed(2)}</td>
                              <td>
                                {p.averageDps.dps == null
                                  ? '—'
                                  : Math.round(p.averageDps.dps).toLocaleString()}
                              </td>
                              <td>
                                {p.bestDps.dps == null ? '—' : Math.round(p.bestDps.dps).toLocaleString()}
                              </td>
                              <td>
                                {deepSummaryByPlayer.get(p.id)?.gcdUptimePercent == null
                                  ? '—'
                                  : `${deepSummaryByPlayer.get(p.id)!.gcdUptimePercent!.toFixed(1)}%`}
                              </td>
                              <td>
                                {deepSummaryByPlayer.get(p.id)?.pullsAnalyzed ?? 0} / {p.pulls}
                              </td>
                              <td>{p.firstDeaths}</td>
                              <td>
                                {p.deathFreePulls} / {p.pulls}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="card-footer">
                    First deaths include ties at the same timestamp. They do not assign blame.
                  </div>
                  {focusedPlayer != null && (
                    <div className="player-history">
                      <div className="deep-rollup">
                        <div className="deep-rollup-heading">
                          <div>
                            <span className="eyebrow">XIVANALYSIS COVERAGE</span>
                            <h3>Execution across selected pulls</h3>
                          </div>
                          <button
                            className="button"
                            disabled={
                              isDemo ||
                              deepBatchRunning ||
                              (focusedDeepSummary?.pullsAnalyzed ?? 0) >= focusedParticipatingPulls.length
                            }
                            onClick={() => void analyzeFocusedPlayerPulls()}
                          >
                            {deepBatchRunning ? (
                              <>
                                <LoaderCircle size={14} className="spin" />
                                {deepBatchProgress?.done ?? 0}/{deepBatchProgress?.total ?? 0}
                              </>
                            ) : (focusedDeepSummary?.pullsAnalyzed ?? 0) >=
                              focusedParticipatingPulls.length ? (
                              'Deep analysis complete'
                            ) : (
                              'Analyze selected pulls'
                            )}
                          </button>
                        </div>
                        {isDemo ? (
                          <p className="muted small">Deep analysis is disabled for synthetic demo data.</p>
                        ) : (
                          <div className="deep-rollup-metrics">
                            <div>
                              <span>Weighted GCD uptime</span>
                              <strong>
                                {focusedDeepSummary?.gcdUptimePercent == null
                                  ? '—'
                                  : `${focusedDeepSummary.gcdUptimePercent.toFixed(1)}%`}
                              </strong>
                              <small>
                                {focusedDeepSummary?.gcdPullsMeasured ?? 0} measured /{' '}
                                {focusedParticipatingPulls.length} selected pulls
                              </small>
                            </div>
                            <div>
                              <span>GCD delay</span>
                              <strong>{duration(focusedDeepSummary?.gcdDowntimeMs ?? 0)}</strong>
                              <small>{focusedDeepSummary?.gcdDowntimeCount ?? 0} issues</small>
                            </div>
                            <div>
                              <span>Checklist rules</span>
                              <strong>
                                {focusedDeepSummary?.checklistPassed ?? 0} /{' '}
                                {focusedDeepSummary?.checklistRules ?? 0}
                              </strong>
                              <small>passed / evaluated</small>
                            </div>
                            <div>
                              <span>Major findings</span>
                              <strong>{focusedDeepSummary?.severeSuggestions ?? 0}</strong>
                              <small>{focusedDeepSummary?.visibleSuggestions ?? 0} visible suggestions</small>
                            </div>
                          </div>
                        )}
                        {deepBatchError && (
                          <div className="notice error deep-rollup-error" role="alert">
                            {deepBatchError}
                          </div>
                        )}
                      </div>
                      <div className="player-history-heading">
                        <h3>Pull-by-pull history</h3>
                        <select
                          aria-label="Sort player pulls"
                          value={playerPullSort}
                          onChange={(e) => setPlayerPullSort(e.target.value as typeof playerPullSort)}
                        >
                          <option value="boss">Best boss HP</option>
                          <option value="dps">Highest DPS</option>
                          <option value="uptime">Highest GCD uptime</option>
                          <option value="fewest-deaths">Fewest deaths</option>
                          <option value="most-deaths">Most deaths</option>
                        </select>
                      </div>
                      {[...pulls]
                        .filter((p) => p.playerIds.includes(focusedPlayer))
                        .sort((a, b) => {
                          const ap = performanceFor(a.id, focusedPlayer)
                          const bp = performanceFor(b.id, focusedPlayer)
                          if (!ap && !bp) return a.id - b.id
                          if (!ap) return 1
                          if (!bp) return -1
                          if (playerPullSort === 'dps')
                            return (
                              (bp.metrics.dps ?? -Infinity) - (ap.metrics.dps ?? -Infinity) || a.id - b.id
                            )
                          if (playerPullSort === 'uptime') {
                            const aUptime =
                              deepAnalyses[xivanalysisKey(a.id, focusedPlayer)]?.uptime.gcdUptimePercent
                            const bUptime =
                              deepAnalyses[xivanalysisKey(b.id, focusedPlayer)]?.uptime.gcdUptimePercent
                            if (aUptime == null && bUptime == null) return a.id - b.id
                            if (aUptime == null) return 1
                            if (bUptime == null) return -1
                            return bUptime - aUptime || a.id - b.id
                          }
                          if (playerPullSort === 'fewest-deaths')
                            return (
                              ap.deaths - bp.deaths ||
                              (bp.metrics.dps ?? 0) - (ap.metrics.dps ?? 0) ||
                              a.id - b.id
                            )
                          if (playerPullSort === 'most-deaths')
                            return (
                              bp.deaths - ap.deaths ||
                              (ap.metrics.dps ?? 0) - (bp.metrics.dps ?? 0) ||
                              a.id - b.id
                            )
                          return (
                            (ap.bossRemaining ?? Number.POSITIVE_INFINITY) -
                              (bp.bossRemaining ?? Number.POSITIVE_INFINITY) ||
                            (bp.metrics.dps ?? 0) - (ap.metrics.dps ?? 0) ||
                            a.id - b.id
                          )
                        })
                        .map((p) => {
                          const performance = performanceFor(p.id, focusedPlayer)
                          const deep = deepAnalyses[xivanalysisKey(p.id, focusedPlayer)]
                          return (
                            <button key={p.id} onClick={() => setFocusedPull(p.id)}>
                              <span>
                                Pull {p.id} · {p.name}
                              </span>
                              <span>
                                {performance
                                  ? `${performance.metrics.dps == null ? '—' : Math.round(performance.metrics.dps).toLocaleString()} DPS · ${
                                      deep?.uptime.gcdUptimePercent == null
                                        ? 'uptime —'
                                        : `${deep.uptime.gcdUptimePercent.toFixed(1)}% uptime`
                                    } · ${performance.deaths} ${performance.deaths === 1 ? 'death' : 'deaths'} · ${percent(
                                      performance.bossRemaining,
                                    )} boss HP`
                                  : 'Not analyzed'}{' '}
                                <ChevronRight size={15} />
                              </span>
                            </button>
                          )
                        })}
                    </div>
                  )}
                </section>
              )}
              {view === 'pulls' && (
                <section className="card">
                  <div className="card-heading">
                    <div>
                      <h2>Pull breakdown</h2>
                      <p>Open a pull for the death timeline and the evidence behind each killing blow.</p>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Pull / encounter</th>
                          <th>Duration</th>
                          <th>Fight left</th>
                          <th>Boss HP left</th>
                          <th>Deaths</th>
                          <th>First death</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {pulls.map((p) => {
                          const analysis = analyses[p.id]
                          const first = analysis?.deaths.find((d) => d.firstDeath)
                          return (
                            <tr key={p.id}>
                              <td>
                                <strong>Pull {p.id}</strong>
                                <small className="table-subtext">{p.name}</small>
                              </td>
                              <td>{duration(p.endTime - p.startTime)}</td>
                              <td>
                                {p.kill ? (
                                  <span className="pill success">Cleared</span>
                                ) : (
                                  percent(p.fightRemaining)
                                )}
                              </td>
                              <td>{percent(p.bossRemaining)}</td>
                              <td>
                                {analysis ? analysis.deaths.length : failures[p.id] ? 'Failed' : 'Loading…'}
                              </td>
                              <td>
                                {first
                                  ? report.players.find((player) => player.id === first.playerId)?.name
                                  : analysis
                                    ? 'None'
                                    : '—'}
                              </td>
                              <td>
                                <button
                                  className="text-button"
                                  onClick={() => {
                                    setFocusedPlayer(null)
                                    setFocusedPull(p.id)
                                  }}
                                >
                                  Inspect <ArrowRight size={14} />
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {view === 'matrix' && (
                <section className="card">
                  <div className="card-heading">
                    <div>
                      <h2>Deaths by player × pull</h2>
                      <p>A dash means the player did not participate. Select a cell to inspect the pull.</p>
                    </div>
                    <span className="pill neutral">Death counts</span>
                  </div>
                  <div className="table-scroll">
                    <table className="matrix">
                      <thead>
                        <tr>
                          <th>Player</th>
                          {pulls.map((p) => (
                            <th key={p.id}>Pull {p.id}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {report.players
                          .filter((p) => pulls.some((f) => f.playerIds.includes(p.id)))
                          .map((player) => (
                            <tr key={player.id}>
                              <td>
                                <div className="player-cell">
                                  <JobBadge player={player} />
                                  <strong>{player.name}</strong>
                                </div>
                              </td>
                              {pulls.map((p) => {
                                const participates = p.playerIds.includes(player.id)
                                const analysis = analyses[p.id]
                                const count = analysis?.deaths.filter((d) => d.playerId === player.id).length
                                return (
                                  <td key={p.id}>
                                    {participates ? (
                                      <button
                                        aria-label={`${player.name}, pull ${p.id}, ${count == null ? 'not analyzed' : `${count} deaths`}`}
                                        className={`matrix-cell ${count == null ? 'unloaded' : count ? 'bad' : 'good'}`}
                                        onClick={() => {
                                          setFocusedPlayer(player.id)
                                          setFocusedPull(p.id)
                                        }}
                                      >
                                        {count ?? '…'}
                                      </button>
                                    ) : (
                                      <span className="absent">—</span>
                                    )}
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="card-footer">
                    FFLogs DPS-family metrics are retained per player and pull. Select a matrix cell to run
                    xivanalysis for that player and inspect GCD uptime, lost-time issues, checklist rules, and
                    suggestions.
                  </div>
                </section>
              )}
              <footer className="page-footer">
                <span>
                  <Check size={13} />
                  Only encounter participants included · Limit Break tracked separately
                </span>
                <span>{report.ignoredSegments} non-boss segments excluded</span>
              </footer>
            </>
          )}
        </div>
      </main>
      {(inspected || helpOpen) && (
        <div
          className="drawer-backdrop"
          onClick={() => {
            setFocusedPull(null)
            setHelpOpen(false)
          }}
        >
          <section
            className="detail-drawer"
            ref={detailRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={helpOpen ? 'Analysis coverage' : `Pull ${inspected?.id} detail`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="drawer-close icon-button"
              aria-label="Close details"
              onClick={() => {
                setFocusedPull(null)
                setHelpOpen(false)
              }}
            >
              <X size={20} />
            </button>
            {helpOpen ? (
              <Coverage />
            ) : (
              inspected && (
                <PullDetail
                  report={report}
                  pull={inspected}
                  analysis={analyses[inspected.id]}
                  error={failures[inspected.id]}
                  playerId={focusedPlayer}
                  xivanalysis={xivanalysis ?? undefined}
                  xivanalysisLoading={xivanalysisLoading}
                  xivanalysisError={xivanalysisError || undefined}
                  onSelectPlayer={setFocusedPlayer}
                />
              )
            )}
          </section>
        </div>
      )}
    </div>
  )
}
