import { SessionReview } from './components/SessionReview'
import { DeepCoverage } from './components/DeepCoverage'
import { AttemptEditor } from './components/AttemptEditor'
import { useAttemptOverrides } from './useAttemptOverrides'
import { classifyAttempt, includeAttempt } from '../shared/attempts'
import {
  comparePulls,
  sortValue,
  playerMetric,
  pullMetric,
  measuredUptimeCoverage,
  DPS_METRICS,
  metricLabel,
  type ReviewMetric,
  type PullSort,
} from '../shared/review'
import {
  checkpointOptions,
  checkpointKey,
  reachedCheckpoint,
  furthestCheckpoint,
} from '../shared/progression'
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
  Moon,
  Type,
  RefreshCw,
  Shield,
  Sun,
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
import type {
  Pull,
  PullAnalysis,
  PullProgression,
  Report,
  DpsMetricKey,
  XivanalysisPlayerAnalysis,
} from '../shared/types'
import { api } from './api'
import { duration, percent } from './format'

type View = 'session' | 'players' | 'pulls' | 'matrix'
type DeepTarget = { pullId: number; playerId: number }
type DeepBatchProgress = { scope: string; done: number; total: number }
type DeepBatchError = { scope: string; message: string }
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
  const [progression, setProgression] = useState<PullProgression>({})
  const [progressionFailures, setProgressionFailures] = useState<number[]>([])
  const [progressionStatus, setProgressionStatus] = useState<'loading' | 'ready' | 'unavailable'>('ready')
  const [view, setView] = useState<View>('session')
  const [input, setInput] = useState('')
  const [loadError, setLoadError] = useState('')
  const [loadingReport, setLoadingReport] = useState(false)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [failures, setFailures] = useState<Record<number, string>>({})
  const [revision, setRevision] = useState(0)
  const [focusedPull, setFocusedPull] = useState<number | null>(null)
  const [focusedPlayer, setFocusedPlayer] = useState<number | null>(null)
  const [playerPullSort, setPlayerPullSort] = useState<PullSort>('boss')
  const [pullSort, setPullSort] = useState<PullSort>('progression')
  const [dpsMetric, setDpsMetric] = useState<DpsMetricKey>('rdps')
  const [matrixMetric, setMatrixMetric] = useState<ReviewMetric>('deaths')
  const [minimumSeconds, setMinimumSeconds] = useState(0)
  const [minimumCoverage, setMinimumCoverage] = useState(0)
  const [checkpoint, setCheckpoint] = useState('')
  const [includeScrapped, setIncludeScrapped] = useState(false)
  const {
    overrides: attemptOverrides,
    update: updateAttempt,
    error: attemptSaveError,
  } = useAttemptOverrides(report.code)
  const [helpOpen, setHelpOpen] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark'
    const saved = window.localStorage.getItem('pullwise-theme')
    return saved === 'light' || saved === 'dark' ? saved : 'dark'
  })
  const [textSize, setTextSize] = useState<'comfortable' | 'large' | 'extra-large'>(() => {
    if (typeof window === 'undefined') return 'comfortable'
    const saved = window.localStorage.getItem('pullwise-text-size')
    return saved === 'large' || saved === 'extra-large' ? saved : 'comfortable'
  })
  const [xivanalysis, setXivanalysis] = useState<XivanalysisPlayerAnalysis | null>(null)
  const [xivanalysisError, setXivanalysisError] = useState('')
  const [xivanalysisLoading, setXivanalysisLoading] = useState(false)
  const [deepAnalyses, setDeepAnalyses] = useState<Record<string, XivanalysisPlayerAnalysis>>({})
  const [deepBatchProgress, setDeepBatchProgress] = useState<DeepBatchProgress | null>(null)
  const [deepBatchError, setDeepBatchError] = useState<DeepBatchError | null>(null)
  const loadController = useRef<AbortController | null>(null)
  const analysisController = useRef<AbortController | null>(null)
  const xivanalysisController = useRef<AbortController | null>(null)
  const deepBatchController = useRef<AbortController | null>(null)
  const detailRef = useRef<HTMLElement>(null)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('pullwise-theme', theme)
  }, [theme])
  useEffect(() => {
    document.documentElement.dataset.textSize = textSize
    window.localStorage.setItem('pullwise-text-size', textSize)
  }, [textSize])

  useEffect(() => {
    api
      .health()
      .then((h) => setConfigured(h.configured))
      .catch(() => setConfigured(null))
    return () => loadController.current?.abort()
  }, [])
  useEffect(() => {
    if (report.source === 'demo') {
      setProgression({})
      setProgressionFailures([])
      setProgressionStatus('ready')
      return
    }
    const controller = new AbortController()
    setProgression({})
    setProgressionFailures([])
    setProgressionStatus('loading')
    api
      .progression(report.code, controller.signal)
      .then((result) => {
        setProgression(result.pulls)
        setProgressionFailures(result.failedPulls)
        setProgressionStatus('ready')
      })
      .catch(() => {
        if (!controller.signal.aborted) setProgressionStatus('unavailable')
      })
    return () => controller.abort()
  }, [report.code, report.endTime, report.source, revision])
  const available = useMemo(
    () => report.pulls.filter((p) => encounter === 'all' || encounterKey(p) === encounter),
    [report, encounter],
  )
  const selectedPulls = useMemo(() => available.filter((p) => selected.includes(p.id)), [available, selected])
  const classifications = useMemo(
    () =>
      new Map(
        report.pulls.map((p) => [
          p.id,
          classifyAttempt(p, analyses[p.id], report.pulls, attemptOverrides[p.id]),
        ]),
      ),
    [report.pulls, analyses, attemptOverrides],
  )
  const checkpointChoices = useMemo(() => checkpointOptions(available, progression), [available, progression])
  const selectedCheckpoint = checkpointChoices.find(
    (option) => `${option.encounterID}:${option.difficulty}:${option.key}` === checkpoint,
  )
  const comparisonPulls = useMemo(
    () =>
      selectedPulls.filter(
        (p) =>
          p.endTime - p.startTime >= minimumSeconds * 1000 &&
          (!checkpoint ||
            (!!selectedCheckpoint &&
              p.encounterID === selectedCheckpoint.encounterID &&
              p.difficulty === selectedCheckpoint.difficulty &&
              reachedCheckpoint(progression[p.id] ?? [], selectedCheckpoint.key))) &&
          (!minimumCoverage ||
            measuredUptimeCoverage(
              p,
              Object.values(deepAnalyses),
              view === 'players' ? focusedPlayer : null,
            ) >= minimumCoverage),
      ),
    [
      selectedPulls,
      minimumSeconds,
      checkpoint,
      selectedCheckpoint,
      progression,
      minimumCoverage,
      deepAnalyses,
      view,
      focusedPlayer,
    ],
  )
  const pulls = useMemo(
    () => comparisonPulls.filter((p) => includeAttempt(classifications.get(p.id)!, includeScrapped)),
    [comparisonPulls, classifications, includeScrapped],
  )
  const deepForPull = (pull: Pull) =>
    pull.playerIds.flatMap((id) =>
      deepAnalyses[xivanalysisKey(pull.id, id)] ? [deepAnalyses[xivanalysisKey(pull.id, id)]] : [],
    )
  const sortPulls = (items: Pull[], sort: PullSort, playerId?: number | null) =>
    [...items].sort((a, b) =>
      comparePulls(a, b, sort, (p) =>
        sortValue(p, sort, dpsMetric, analyses[p.id], deepForPull(p), playerId),
      ),
    )
  const rankedPulls = sortPulls(comparisonPulls, pullSort).sort(
    (a, b) =>
      Number(!includeAttempt(classifications.get(a.id)!, includeScrapped)) -
      Number(!includeAttempt(classifications.get(b.id)!, includeScrapped)),
  )
  const excludedCount = selectedPulls.length - pulls.length
  const pullGroups = useMemo(() => {
    if (progressionStatus !== 'ready' || report.source === 'demo') {
      return [{ key: 'all', label: 'Pulls', pulls: available, rank: 0 }]
    }
    const encounters = [...new Set(available.map(encounterKey))]
    const references = new Map(
      encounters.map(
        (key) =>
          [
            key,
            [...available]
              .filter((pull) => encounterKey(pull) === key)
              .sort(
                (a, b) =>
                  Number(b.kill) - Number(a.kill) ||
                  (a.fightRemaining ?? 100) - (b.fightRemaining ?? 100) ||
                  b.endTime - b.startTime - (a.endTime - a.startTime),
              )[0],
          ] as const,
      ),
    )
    const groups = new Map<string, { key: string; label: string; pulls: Pull[]; rank: number }>()
    for (const pull of available) {
      const encounterId = encounterKey(pull)
      const reference = references.get(encounterId)
      const last = furthestCheckpoint(progression[pull.id] ?? [])
      const markerId = last ? `${last.name.toLocaleLowerCase()}:${last.occurrence}` : 'opening'
      const failed = progressionFailures.includes(pull.id)
      const key = `${encounterId}:${failed ? 'failed' : pull.kill ? 'clear' : markerId}`
      const label = `${encounter === 'all' ? `${pull.name} · ` : ''}${failed ? 'Cast data unavailable' : pull.kill ? 'Clear' : last ? `${last.name} #${last.occurrence}` : 'Opening / no boss cast recorded'}`
      const referenceMarker =
        last && reference
          ? progression[reference.id]?.find(
              (candidate) =>
                candidate.name.toLocaleLowerCase() === last.name.toLocaleLowerCase() &&
                candidate.occurrence === last.occurrence,
            )
          : undefined
      const elapsed =
        referenceMarker && reference
          ? referenceMarker.timestamp - reference.startTime
          : last
            ? last.timestamp - pull.startTime
            : -1
      const rank =
        encounters.indexOf(encounterId) * 1000000 + (failed ? 999999 : pull.kill ? 999998 : elapsed / 1000)
      const group = groups.get(key) ?? { key, label, pulls: [] as Pull[], rank }
      group.pulls.push(pull)
      groups.set(key, group)
    }
    return [...groups.values()].sort((a, b) => a.rank - b.rank)
  }, [available, encounter, progression, progressionFailures, progressionStatus, report.source])
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
    setDeepBatchError(null)
  }, [report.code, selectionKey])

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
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]',
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

  const inspectedDeepByPlayer = useMemo<Record<number, XivanalysisPlayerAnalysis>>(() => {
    if (!inspected) return {}
    const byPlayer: Record<number, XivanalysisPlayerAnalysis> = {}
    for (const playerId of inspected.playerIds) {
      const result = deepAnalyses[xivanalysisKey(inspected.id, playerId)]
      if (result) byPlayer[playerId] = result
    }
    return byPlayer
  }, [deepAnalyses, inspected])

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
      report.players.map((player) => [player.id, summarizeXivanalysis(grouped.get(player.id) ?? [])]),
    )
  }, [deepAnalyses, pulls, report.players])
  const focusedDeepSummary = focusedPlayer == null ? null : (deepSummaryByPlayer.get(focusedPlayer) ?? null)
  const focusedParticipatingPulls =
    focusedPlayer == null ? [] : pulls.filter((pull) => pull.playerIds.includes(focusedPlayer))
  const deepSummaryByPull = useMemo(() => {
    const grouped = new Map<number, XivanalysisPlayerAnalysis[]>()
    for (const result of Object.values(deepAnalyses)) {
      const entries = grouped.get(result.fightId) ?? []
      entries.push(result)
      grouped.set(result.fightId, entries)
    }
    return new Map(pulls.map((pull) => [pull.id, summarizeXivanalysis(grouped.get(pull.id) ?? [])]))
  }, [deepAnalyses, pulls])
  const selectedDeepResults = useMemo(() => {
    const selectedPullIds = new Set(pulls.map((pull) => pull.id))
    return Object.values(deepAnalyses).filter((result) => selectedPullIds.has(result.fightId))
  }, [deepAnalyses, pulls])
  const deepSessionSummary = useMemo(() => summarizeXivanalysis(selectedDeepResults), [selectedDeepResults])
  const deepSessionTargets = pulls.flatMap((pull) =>
    pull.playerIds.map((playerId) => ({ pullId: pull.id, playerId })),
  )
  const playerBatchScope = focusedPlayer == null ? null : `player:${focusedPlayer}`
  const sessionBatchScope = 'session'
  const isDeepBatchRunning = (scope: string) =>
    deepBatchProgress?.scope === scope && deepBatchProgress.done < deepBatchProgress.total

  function installReport(next: Report, fightId?: number | 'last') {
    setCheckpoint('')
    setMinimumCoverage(0)
    setMinimumSeconds(0)
    analysisController.current?.abort()
    xivanalysisController.current?.abort()
    deepBatchController.current?.abort()
    const initial = fightId === 'last' ? next.pulls.at(-1) : next.pulls.find((p) => p.id === fightId)
    setReport(next)
    setEncounter(initial ? encounterKey(initial) : next.pulls[0] ? encounterKey(next.pulls[0]) : 'all')
    setSelected(
      initial
        ? [initial.id]
        : next.pulls
            .filter((p) => !next.pulls[0] || encounterKey(p) === encounterKey(next.pulls[0]))
            .map((p) => p.id),
    )
    setAnalyses(next.source === 'demo' ? Object.fromEntries(demoAnalyses.map((a) => [a.fightId, a])) : {})
    setFailures({})
    setDeepAnalyses({})
    setDeepBatchProgress(null)
    setDeepBatchError(null)
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
    setCheckpoint('')
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
        setDeepBatchError(null)
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

  async function analyzeDeepTargets(targets: DeepTarget[], scope: string) {
    if (report.source === 'demo') return

    xivanalysisController.current?.abort()
    setXivanalysisLoading(false)
    deepBatchController.current?.abort()
    const controller = new AbortController()
    deepBatchController.current = controller

    const uniqueTargets = [
      ...new Map(targets.map((target) => [xivanalysisKey(target.pullId, target.playerId), target])).values(),
    ]
    const pending = uniqueTargets.filter(
      (target) => !deepAnalyses[xivanalysisKey(target.pullId, target.playerId)],
    )
    const alreadyDone = uniqueTargets.length - pending.length
    setDeepBatchProgress({ scope, done: alreadyDone, total: uniqueTargets.length })
    setDeepBatchError(null)
    if (!pending.length) return

    let cursor = 0
    let failed = 0
    async function worker() {
      while (cursor < pending.length && !controller.signal.aborted) {
        const target = pending[cursor++]
        const key = xivanalysisKey(target.pullId, target.playerId)
        try {
          const result = await api.xivanalysis(
            report.code,
            target.pullId,
            target.playerId,
            false,
            controller.signal,
          )
          if (!controller.signal.aborted) {
            setDeepAnalyses((previous) => ({ ...previous, [key]: result }))
            if (focusedPull === target.pullId && focusedPlayer === target.playerId) {
              setXivanalysis(result)
            }
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            failed++
            setDeepBatchError({
              scope,
              message: `${failed} deep ${failed === 1 ? 'analysis' : 'analyses'} failed: ${
                error instanceof Error ? error.message : 'xivanalysis failed.'
              }`,
            })
          }
        } finally {
          if (!controller.signal.aborted) {
            setDeepBatchProgress((previous) =>
              previous?.scope === scope ? { ...previous, done: previous.done + 1 } : previous,
            )
          }
        }
      }
    }

    await Promise.all([worker(), worker()])
  }

  async function analyzeFocusedPlayerPulls() {
    if (focusedPlayer == null || playerBatchScope == null) return
    await analyzeDeepTargets(
      focusedParticipatingPulls.map((pull) => ({
        pullId: pull.id,
        playerId: focusedPlayer,
      })),
      playerBatchScope,
    )
  }

  async function analyzePullPlayers(pull: Pull) {
    await analyzeDeepTargets(
      pull.playerIds.map((playerId) => ({ pullId: pull.id, playerId })),
      `pull:${pull.id}`,
    )
  }

  async function analyzeSelectedSession() {
    await analyzeDeepTargets(deepSessionTargets, sessionBatchScope)
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
            {pulls.length}/{available.length}
          </span>
        </div>
        <div className="selection-actions">
          <button onClick={() => setSelected(available.map((p) => p.id))}>Select all</button>
          <span>·</span>
          <button onClick={() => setSelected([])}>Clear</button>
        </div>
        <div className="pull-list">
          {progressionStatus === 'loading' && <p className="progression-note">Reading enemy casts…</p>}
          {progressionStatus === 'unavailable' && (
            <p className="progression-note">Cast grouping unavailable.</p>
          )}
          {progressionFailures.length > 0 && (
            <p className="progression-note">Cast data missing for {progressionFailures.length} pull(s).</p>
          )}
          {pullGroups.map((group) => (
            <div className="pull-group" key={group.key}>
              {group.key !== 'all' && (
                <div
                  className="pull-group-title"
                  title={`Furthest checkpoint or provisional cast: ${group.label}`}
                >
                  {group.label}
                </div>
              )}
              {group.pulls.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className={`pull-option ${selected.includes(p.id) ? 'selected' : ''}`}
                  aria-pressed={selected.includes(p.id)}
                  onClick={() =>
                    setSelected((current) =>
                      current.includes(p.id) ? current.filter((id) => id !== p.id) : [...current, p.id],
                    )
                  }
                >
                  <span className="pull-selection-indicator" aria-hidden="true" />
                  <span className="pull-option-name">
                    Pull {p.id}
                    <small>
                      {encounter === 'all' ? p.name : duration(p.endTime - p.startTime)}
                      {classifications.get(p.id)?.status === 'scrapped'
                        ? ' · scrapped'
                        : classifications.get(p.id)?.status === 'suspected-reset'
                          ? ' · suspected reset'
                          : ''}
                    </small>
                  </span>
                  <span className={p.kill ? 'kill-text' : 'remaining'}>
                    {p.kill ? <Check size={15} aria-label="Kill" /> : percent(p.fightRemaining)}
                  </span>
                </button>
              ))}
            </div>
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
          <div className="topbar-actions">
            <label className="text-size-control">
              <Type size={16} aria-hidden="true" />
              <span>Text size</span>
              <select
                aria-label="Text size"
                value={textSize}
                onChange={(event) => setTextSize(event.target.value as typeof textSize)}
              >
                <option value="comfortable">Comfortable</option>
                <option value="large">Large</option>
                <option value="extra-large">Extra large</option>
              </select>
            </label>
            <button
              className="theme-toggle"
              type="button"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>
            <span className="version">
              FFLogs MVP <span>v0.1</span>
            </span>
          </div>
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
              {pulls.length} eligible / {selectedPulls.length} selected
              <span className="separator-dot">·</span>
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
          <section className="comparison-controls" aria-label="Comparable pull filters">
            <label>
              DPS metric
              <select
                aria-label="DPS metric"
                value={dpsMetric}
                onChange={(e) => setDpsMetric(e.target.value as DpsMetricKey)}
              >
                {DPS_METRICS.map((metric) => (
                  <option key={metric} value={metric}>
                    {metricLabel(metric)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Minimum duration (seconds)
              <input
                aria-label="Minimum duration in seconds"
                type="number"
                min="0"
                max="7200"
                value={minimumSeconds}
                onChange={(e) => setMinimumSeconds(Math.max(0, Math.min(7200, Number(e.target.value) || 0)))}
              />
            </label>
            <label>
              Reached checkpoint
              <select
                aria-label="Reached checkpoint"
                value={checkpoint}
                onChange={(e) => setCheckpoint(e.target.value)}
              >
                <option value="">Any checkpoint</option>
                {checkpointChoices.map((option) => (
                  <option
                    key={`${option.encounterID}:${option.difficulty}:${option.key}`}
                    value={`${option.encounterID}:${option.difficulty}:${option.key}`}
                  >
                    {encounter === 'all'
                      ? `${available.find((p) => p.encounterID === option.encounterID && p.difficulty === option.difficulty)?.name} · `
                      : ''}
                    {option.label}
                    {option.confidence === 'provisional' ? ' (provisional)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Measured uptime coverage
              <select
                aria-label="Minimum measured uptime coverage"
                value={minimumCoverage}
                onChange={(e) => setMinimumCoverage(Number(e.target.value))}
              >
                <option value="0">Any coverage</option>
                <option value="50">At least 50%</option>
                <option value="100">100% of comparison roster</option>
              </select>
            </label>
            <button
              className={`button ${includeScrapped ? 'primary' : ''}`}
              aria-pressed={includeScrapped}
              onClick={() => setIncludeScrapped((v) => !v)}
            >
              {includeScrapped ? 'Scrapped included' : 'Scrapped excluded'}
            </button>
            <button
              className="text-button"
              onClick={() => {
                setMinimumSeconds(0)
                setMinimumCoverage(0)
                setCheckpoint('')
                setIncludeScrapped(false)
              }}
            >
              Reset filters
            </button>
            <p>
              {excludedCount} selected pull(s) excluded from summaries and rankings. Coverage means players
              with measured uptime, not percentage of the encounter completed.{' '}
              {encounter === 'all'
                ? 'Pull rankings are grouped by encounter and difficulty; choose one encounter for comparable player averages.'
                : 'Choose comparable duration and progression before judging best performance.'}
            </p>
            {minimumCoverage > 0 && (
              <button
                className="text-button"
                disabled={isDemo || isDeepBatchRunning(sessionBatchScope)}
                onClick={() =>
                  void analyzeDeepTargets(
                    selectedPulls.flatMap((p) => p.playerIds.map((playerId) => ({ pullId: p.id, playerId }))),
                    sessionBatchScope,
                  )
                }
              >
                Analyze selected pulls to measure coverage
              </button>
            )}
          </section>
          {selectedCheckpoint && (
            <div className="notice checkpoint-summary">
              {selectedCheckpoint.label}: reached in{' '}
              {
                comparisonPulls.filter((p) => includeAttempt(classifications.get(p.id)!, includeScrapped))
                  .length
              }{' '}
              eligible selected pulls. Completion is not inferred from reaching the cast.{' '}
              {selectedCheckpoint.confidence === 'provisional' ? 'This checkpoint is provisional.' : ''} Best
              observed boss HP at this checkpoint:{' '}
              {(() => {
                const samples = pulls.flatMap((p) =>
                  (progression[p.id] ?? [])
                    .filter((m) => checkpointKey(m) === selectedCheckpoint.key && m.bossHpPercent != null)
                    .map((m) => m.bossHpPercent!),
                )
                return samples.length
                  ? `${percent(Math.min(...samples))} (${samples.length} HP observations)`
                  : 'unavailable'
              })()}
            </div>
          )}
          {attemptSaveError && (
            <div role="alert" className="notice error">
              {attemptSaveError}
            </div>
          )}
          {!report.pulls.length ? (
            <Empty
              title="No boss encounters found"
              text="This report has no completed boss segments yet. Refresh after a pull is logged."
            />
          ) : !selectedPulls.length ? (
            <Empty
              title="Choose a pull to get started"
              text="Select pulls in the sidebar to build your analysis."
            />
          ) : (
            <>
              {!pulls.length && (
                <div className="notice">
                  No eligible pulls match these filters. Adjust filters or include scrapped pulls to review
                  them.
                </div>
              )}
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
                  <SessionReview
                    key={report.code}
                    report={report}
                    pulls={pulls}
                    analyses={Object.values(analyses)}
                    deepAnalyses={selectedDeepResults}
                    onInspect={(pullId, playerId) => {
                      setFocusedPull(pullId)
                      setFocusedPlayer(playerId ?? null)
                    }}
                  />
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
                  <section className="next-step deep-session">
                    <div className="next-icon">
                      <Shield size={23} />
                    </div>
                    <div className="deep-session-body">
                      <span className="eyebrow">DEEP EXECUTION COVERAGE</span>
                      <h3>
                        {deepSessionSummary.playerPullsAnalyzed} / {deepSessionTargets.length} player × pull
                        analyses loaded
                      </h3>
                      {deepSessionSummary.playerPullsAnalyzed ? (
                        <p>
                          Weighted GCD uptime{' '}
                          <strong>
                            {deepSessionSummary.gcdUptimePercent == null
                              ? '—'
                              : `${deepSessionSummary.gcdUptimePercent.toFixed(1)}%`}
                          </strong>{' '}
                          · checklist{' '}
                          {deepSessionSummary.metricCoverage.checklist.measured
                            ? `${deepSessionSummary.checklistPassed}/${deepSessionSummary.checklistRules}`
                            : 'unavailable'}{' '}
                          ·{' '}
                          {deepSessionSummary.metricCoverage.suggestions.measured
                            ? deepSessionSummary.severeSuggestions
                            : 'unavailable'}{' '}
                          major findings
                        </p>
                      ) : (
                        <p>
                          Deep analysis is opt-in. Run the pinned xivanalysis engine only when you want
                          execution metrics across the selected session.
                        </p>
                      )}
                      <DeepCoverage summary={deepSessionSummary} expected={deepSessionTargets.length} />
                      {deepBatchError?.scope === sessionBatchScope && (
                        <p className="deep-inline-error">{deepBatchError.message}</p>
                      )}
                    </div>
                    <div className="next-step-actions">
                      <button
                        className="button"
                        disabled={
                          isDemo ||
                          isDeepBatchRunning(sessionBatchScope) ||
                          deepSessionSummary.playerPullsAnalyzed >= deepSessionTargets.length
                        }
                        onClick={() => void analyzeSelectedSession()}
                      >
                        {isDeepBatchRunning(sessionBatchScope) ? (
                          <>
                            <LoaderCircle size={14} className="spin" />
                            {deepBatchProgress?.scope === sessionBatchScope ? deepBatchProgress.done : 0}/
                            {deepBatchProgress?.scope === sessionBatchScope ? deepBatchProgress.total : 0}
                          </>
                        ) : deepSessionSummary.playerPullsAnalyzed >= deepSessionTargets.length ? (
                          'Session results loaded'
                        ) : (
                          'Analyze selected session'
                        )}
                      </button>
                      <button className="text-button" onClick={() => setHelpOpen(true)}>
                        Coverage <ArrowRight size={14} />
                      </button>
                    </div>
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
                      {report.players
                        .filter((player) => selectedPulls.some((p) => p.playerIds.includes(player.id)))
                        .map((p) => (
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
                          <th>Avg {metricLabel(dpsMetric)}</th>
                          <th>Best {metricLabel(dpsMetric)}</th>
                          <th>GCD uptime</th>
                          <th>Measured / loaded / eligible</th>
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
                                {p.averageDps[dpsMetric] == null
                                  ? '—'
                                  : Math.round(p.averageDps[dpsMetric]).toLocaleString()}
                              </td>
                              <td>
                                {p.bestDps[dpsMetric] == null
                                  ? '—'
                                  : Math.round(p.bestDps[dpsMetric]).toLocaleString()}
                              </td>
                              <td>
                                {deepSummaryByPlayer.get(p.id)?.gcdUptimePercent == null
                                  ? '—'
                                  : `${deepSummaryByPlayer.get(p.id)!.gcdUptimePercent!.toFixed(1)}%`}
                              </td>
                              <td>
                                {deepSummaryByPlayer.get(p.id)?.gcdPlayerPullsMeasured ?? 0} /{' '}
                                {deepSummaryByPlayer.get(p.id)?.playerPullsAnalyzed ?? 0} / {p.pulls}
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
                              (playerBatchScope != null && isDeepBatchRunning(playerBatchScope)) ||
                              (focusedDeepSummary?.playerPullsAnalyzed ?? 0) >=
                                focusedParticipatingPulls.length
                            }
                            onClick={() => void analyzeFocusedPlayerPulls()}
                          >
                            {playerBatchScope != null && isDeepBatchRunning(playerBatchScope) ? (
                              <>
                                <LoaderCircle size={14} className="spin" />
                                {deepBatchProgress?.scope === playerBatchScope ? deepBatchProgress.done : 0}/
                                {deepBatchProgress?.scope === playerBatchScope ? deepBatchProgress.total : 0}
                              </>
                            ) : (focusedDeepSummary?.playerPullsAnalyzed ?? 0) >=
                              focusedParticipatingPulls.length ? (
                              'Deep results loaded'
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
                                {focusedDeepSummary?.gcdPlayerPullsMeasured ?? 0} measured /{' '}
                                {focusedParticipatingPulls.length} selected pulls
                              </small>
                            </div>
                            <div>
                              <span>GCD delay</span>
                              <strong>
                                {focusedDeepSummary?.gcdDowntimeMs == null
                                  ? '—'
                                  : duration(focusedDeepSummary.gcdDowntimeMs)}
                              </strong>
                              <small>
                                {focusedDeepSummary?.gcdDowntimeCount == null
                                  ? 'Not measured'
                                  : `${focusedDeepSummary.gcdDowntimeCount} issues`}
                              </small>
                            </div>
                            <div>
                              <span>Checklist rules</span>
                              <strong>
                                {!focusedDeepSummary?.metricCoverage.checklist.measured
                                  ? '—'
                                  : `${focusedDeepSummary!.checklistPassed} / ${focusedDeepSummary!.checklistRules}`}
                              </strong>
                              <small>passed / evaluated</small>
                            </div>
                            <div>
                              <span>Major findings</span>
                              <strong>
                                {!focusedDeepSummary?.metricCoverage.suggestions.measured
                                  ? '—'
                                  : focusedDeepSummary!.severeSuggestions}
                              </strong>
                              <small>
                                {(focusedDeepSummary?.playerPullsAnalyzed ?? 0) === 0
                                  ? 'Not analyzed'
                                  : `${focusedDeepSummary!.visibleSuggestions} visible suggestions`}
                              </small>
                            </div>
                          </div>
                        )}
                        {focusedDeepSummary && (
                          <DeepCoverage
                            summary={focusedDeepSummary}
                            expected={focusedParticipatingPulls.length}
                          />
                        )}
                        {deepBatchError?.scope === playerBatchScope && (
                          <div className="notice error deep-rollup-error" role="alert">
                            {deepBatchError.message}
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
                          <option value="dps">Highest {metricLabel(dpsMetric)}</option>
                          <option value="uptime">Highest GCD uptime</option>
                          <option value="fewest-deaths">Fewest deaths</option>
                          <option value="most-deaths">Most deaths</option>
                        </select>
                      </div>
                      {sortPulls(
                        pulls.filter((p) => p.playerIds.includes(focusedPlayer)),
                        playerPullSort,
                        focusedPlayer,
                      ).map((p) => {
                        const performance = performanceFor(p.id, focusedPlayer)
                        const deep = deepAnalyses[xivanalysisKey(p.id, focusedPlayer)]
                        return (
                          <button key={p.id} onClick={() => setFocusedPull(p.id)}>
                            <span>
                              Pull {p.id} · {p.name}
                            </span>
                            <span>
                              {performance
                                ? `${performance.metrics[dpsMetric] == null ? '—' : Math.round(performance.metrics[dpsMetric]!).toLocaleString()} ${metricLabel(dpsMetric)} · ${
                                    playerMetric('uptime', analyses[p.id], focusedPlayer, deep) == null
                                      ? 'uptime —'
                                      : `${playerMetric('uptime', analyses[p.id], focusedPlayer, deep)!.toFixed(1)}% uptime`
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
                      <p>
                        Excluded scrapped pulls stay visible for review. Open a pull to classify it and
                        inspect evidence.
                      </p>
                      <label>
                        Sort pulls{' '}
                        <select
                          aria-label="Sort pulls"
                          value={pullSort}
                          onChange={(e) => setPullSort(e.target.value as PullSort)}
                        >
                          <option value="progression">Deepest fight progression</option>
                          <option value="boss">Lowest boss HP</option>
                          <option value="dps">Highest raid {metricLabel(dpsMetric)}</option>
                          <option value="uptime">Highest measured GCD uptime</option>
                          <option value="fewest-deaths">Fewest deaths</option>
                          <option value="most-deaths">Most deaths</option>
                          <option value="duration">Longest duration</option>
                          <option value="chronological">Chronological</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Pull / encounter</th>
                          <th>Classification / checkpoint</th>
                          <th>Raid {metricLabel(dpsMetric)}</th>
                          <th>Duration</th>
                          <th>Fight left</th>
                          <th>Boss HP left</th>
                          <th>Deaths</th>
                          <th>First death</th>
                          <th>GCD uptime</th>
                          <th>Measured / loaded / roster</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {rankedPulls.map((p) => {
                          const analysis = analyses[p.id]
                          const first = analysis?.deaths.find((d) => d.firstDeath)
                          const deep = deepSummaryByPull.get(p.id)
                          const pullBatchScope = `pull:${p.id}`
                          return (
                            <tr key={p.id}>
                              <td>
                                <strong>Pull {p.id}</strong>
                                <small className="table-subtext">{p.name}</small>
                              </td>
                              <td>
                                <strong>{classifications.get(p.id)?.status}</strong>
                                {!includeAttempt(classifications.get(p.id)!, includeScrapped) && (
                                  <small className="table-subtext">Excluded from comparisons</small>
                                )}
                                <small className="table-subtext">
                                  {furthestCheckpoint(progression[p.id] ?? [])
                                    ? `${furthestCheckpoint(progression[p.id] ?? [])!.name} #${furthestCheckpoint(progression[p.id] ?? [])!.occurrence}`
                                    : 'Checkpoint unavailable'}
                                </small>
                              </td>
                              <td>
                                {pullMetric(dpsMetric, p, analysis) == null
                                  ? '—'
                                  : Math.round(pullMetric(dpsMetric, p, analysis)!).toLocaleString()}
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
                                {deep?.gcdUptimePercent == null
                                  ? '—'
                                  : `${deep.gcdUptimePercent.toFixed(1)}%`}
                              </td>
                              <td>
                                {deep?.gcdPlayerPullsMeasured ?? 0} / {deep?.playerPullsAnalyzed ?? 0} /{' '}
                                {p.playerIds.length}
                              </td>
                              <td>
                                <div className="table-actions">
                                  <button
                                    className="text-button"
                                    onClick={() => {
                                      setFocusedPlayer(null)
                                      setFocusedPull(p.id)
                                    }}
                                  >
                                    Inspect <ArrowRight size={14} />
                                  </button>
                                  <button
                                    className="text-button"
                                    disabled={
                                      isDemo ||
                                      isDeepBatchRunning(pullBatchScope) ||
                                      (deep?.playerPullsAnalyzed ?? 0) >= p.playerIds.length
                                    }
                                    onClick={() => void analyzePullPlayers(p)}
                                  >
                                    {isDeepBatchRunning(pullBatchScope)
                                      ? `${deepBatchProgress?.scope === pullBatchScope ? deepBatchProgress.done : 0}/${
                                          deepBatchProgress?.scope === pullBatchScope
                                            ? deepBatchProgress.total
                                            : 0
                                        }`
                                      : (deep?.playerPullsAnalyzed ?? 0) >= p.playerIds.length
                                        ? 'Results loaded'
                                        : 'Analyze'}
                                  </button>
                                </div>
                                {deepBatchError?.scope === pullBatchScope && (
                                  <small className="table-error">{deepBatchError.message}</small>
                                )}
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
                      <h2>{metricLabel(matrixMetric)} by player × pull</h2>
                      <p>A dash means the player did not participate. Select a cell to inspect the pull.</p>
                    </div>
                    <select
                      aria-label="Matrix metric"
                      value={matrixMetric}
                      onChange={(e) => setMatrixMetric(e.target.value as ReviewMetric)}
                    >
                      {(['deaths', ...DPS_METRICS, 'uptime'] as ReviewMetric[]).map((metric) => (
                        <option key={metric} value={metric}>
                          {metricLabel(metric)}
                        </option>
                      ))}
                    </select>
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
                                const count = playerMetric(
                                  matrixMetric,
                                  analysis,
                                  player.id,
                                  deepAnalyses[xivanalysisKey(p.id, player.id)],
                                )
                                return (
                                  <td key={p.id}>
                                    {participates ? (
                                      <button
                                        aria-label={`${player.name}, pull ${p.id}, ${count == null ? 'not analyzed' : `${count} ${metricLabel(matrixMetric)}`}`}
                                        className={`matrix-cell ${count == null ? 'unloaded' : matrixMetric === 'deaths' ? (count ? 'bad' : 'good') : 'neutral'}`}
                                        onClick={() => {
                                          setFocusedPlayer(player.id)
                                          setFocusedPull(p.id)
                                        }}
                                      >
                                        {count == null
                                          ? '—'
                                          : matrixMetric === 'uptime'
                                            ? `${count.toFixed(1)}%`
                                            : Math.round(count).toLocaleString()}
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
                <>
                  <AttemptEditor
                    key={`${report.code}:${inspected.id}`}
                    classification={classifications.get(inspected.id)!}
                    override={attemptOverrides[inspected.id]}
                    onChange={(value) => updateAttempt(inspected.id, value)}
                  />
                  <PullDetail
                    report={report}
                    pull={inspected}
                    analysis={analyses[inspected.id]}
                    error={failures[inspected.id]}
                    playerId={focusedPlayer}
                    xivanalysis={xivanalysis ?? undefined}
                    xivanalysisByPlayer={inspectedDeepByPlayer}
                    xivanalysisLoading={xivanalysisLoading}
                    xivanalysisError={xivanalysisError || undefined}
                    xivanalysisBatchRunning={isDeepBatchRunning(`pull:${inspected.id}`)}
                    xivanalysisBatchProgress={
                      deepBatchProgress?.scope === `pull:${inspected.id}`
                        ? { done: deepBatchProgress.done, total: deepBatchProgress.total }
                        : undefined
                    }
                    xivanalysisBatchError={
                      deepBatchError?.scope === `pull:${inspected.id}` ? deepBatchError.message : undefined
                    }
                    onSelectPlayer={setFocusedPlayer}
                    onClearPlayer={() => setFocusedPlayer(null)}
                    onAnalyzePull={() => void analyzePullPlayers(inspected)}
                  />
                </>
              )
            )}
          </section>
        </div>
      )}
    </div>
  )
}
