# Product and integration design

## Product intent

Turn a raid log into an actionable review with evidence: “this ability repeatedly killed us,” “these are the pulls where I died,” and, once job analysis is integrated, “this cooldown or damage window was missed.” The same underlying result must aggregate by player × pull, player, pull, and session without requiring users to interpret raw event tables.

The FFLogs MVP is implemented. The remaining stages below are planned, not present functionality.

## Units and identities

- **Report**: an FFLogs recording; not an assumption that everything recorded belongs to one raid group.
- **Session**: initially, one report restricted to the explicitly selected boss pulls. Multi-report sessions and automatic session splitting are future work.
- **Encounter**: `encounterID` plus difficulty. A boss in another difficulty must not share an opportunity model by accident.
- **Pull**: report code plus FFLogs fight ID; display preserves that ID for evidence links. Selection does not renumber it.
- **Player**: report-local actor ID, never name as an identity key. Names can collide; cross-report identities require region/server/character IDs and an explicit policy.
- **Participation**: membership in that pull's `friendlyPlayers`, intersected with master-data `Player` actors. Limit Break is filtered even when represented as a player. Missing participation is an error, not permission to use the report-wide roster.
- **Limit Break**: shared raid resource with a set of report actor IDs. Same-time, same-ability casts from aliases collapse into one observed use, retaining provenance. Optimizing charge generation and use is separate from recording casts.

The metadata schema records both `bossPercentage` and `fightPercentage`. Multi-phase and multi-target fights can make these differ. Null does not mean zero. Kills are explicitly normalized to zero remaining.

## FFLogs pipeline

1. Parse a report code from a constrained FFLogs URL; do not fetch arbitrary user-provided hosts.
2. Authenticate server-side using the client-credentials grant. Reuse the token until expiry, and renew once on HTTP 401.
3. Fetch fights, actor master data, and ability master data. Exclude non-boss and zero-duration segments.
4. For each selected pull, fetch all friendly death pages. When deaths exist, fetch damage-taken pages for evidence. Fetch casts filtered to the report's Limit Break actor IDs. Fetch FFLogs report rankings for `dps`, `rdps`, `ndps`, and `cdps` and attach them by report actor ID.
5. Follow `nextPageTimestamp` exactly, with a monotonic-cursor check and a page limit. Reject partial GraphQL errors and incomplete event pages.
6. Filter events by the selected pull window, optional event fight ID, and participating player IDs. Deduplicate death events by pull + player + timestamp. Preserve deaths after resurrection.
7. Prefer `killingAbilityGameID`. Otherwise accept an incoming hit within one second with positive overkill or positive damage and zero recorded target HP. Other cases are unknown. The UI distinguishes these evidence sources.
8. Preserve FFLogs' own DPS-family metrics rather than reconstructing them from damage events. FFLogs documents aDPS, but `ReportRankingMetricType` currently exposes `dps`, `rdps`, `ndps`, and `cdps` without an `adps` enum; do not substitute another metric for it.
9. Cache only successful complete analysis in a bounded process-local cache. UI concurrency is two pulls; selection changes abort obsolete downloads. The UI explicitly labels incomplete aggregate coverage.

First deaths include ties at the exact timestamp. They are not labeled wipe causes. Wipe cleanup, intentional deaths, wall deaths, game-specific fake deaths, and lethal events without damage need stronger context for deeper diagnosis. Those distinctions must use verified boss rules or explicit user annotations; avoid introducing arbitrary “last N seconds of pull” blame filters.

## xivanalysis integration

### Provisional encounter progression

The sidebar loads enemy cast events for each pull independently of deep xivanalysis. It numbers repeated casts
within a pull (`Sadistic Screech #1`, `#2`, etc.) and groups pulls by their last observed cast. Clears have their
own group. This is an observed event marker, not a verified phase or a claim about mechanic success. Encounter
rules will later map selected cast IDs and occurrences to meaningful progression checkpoints, handle simultaneous
adds and cast cancellations, and record the boss HP at each checkpoint. Missing or failed cast extraction does
not alter FFLogs' fight and boss remaining percentages.

### Planned extraction contracts

Opener needs job-specific expected and observed action windows; mitigation needs defensive events matched to
eligible incoming damage; DoT uptime needs targetable windows and job-specific effects; boss mechanics need
versioned encounter cast IDs, occurrence order, and player hit evidence. Each metric must carry a measured,
unsupported, incomplete, or not-applicable state, plus its observed window and opportunity count. A measured
zero is a real result, never a substitute for missing data.

Pinned upstream revision: `f532855e635bdfb4211cec8128d582dadfdc6a75` (`dawntrail` at initial checkout). Review and test upgrades explicitly.

Current adapter status:

- `server/fflogs/client.ts` can fetch the complete selected-pull v2 event stream with resources, nested ability payloads (`useAbilityIDs: false`), report actor IDs, exact continuation timestamps, and no hostility/data-type filter.
- `server/xivanalysis/v2-adapter.ts` converts FFLogs v2 metadata into a versioned compatibility bundle. It preserves report-relative event timestamps, derives legacy friendliness flags from fight membership, carries actor game IDs/ownership/instance counts, maps `combatTime` to xivanalysis' parser window, preserves report language for edition selection, and converts v2 `fightPercentage` from its native 0–100 scale.
- `ReportService.xivanalysisInput()` loads this expensive full stream lazily and caches only successful complete adapter inputs. The normal FFLogs-only pull path does not pay this cost.
- `analysis-runner/runner.cjs` constructs upstream-compatible `Report`/`Pull`/`Actor` objects and executes the pinned xivanalysis `adaptEvents` and `Parser` in an isolated Node process. The application does not copy or reimplement job analyzers.
- Structured extraction currently reads upstream `AlwaysBeCasting`, `Downtime`, `Weaving`, `Interrupts`, `Checklist`, and `Suggestions` module state before React rendering. This yields GCD uptime, lost-time issue counts/durations, checklist percentages, and suggestion metadata for a player × pull.
- The player view can explicitly analyze the selected player's selected pulls with bounded client concurrency. Rollups aggregate GCD uptime from summed measured uptime and eligible milliseconds rather than averaging pull percentages. Missing delay metrics remain unavailable rather than becoming zero; checklist results remain `passed / evaluated` counts rather than a synthetic score.
- Deep analysis is opt-in at the player/pull level; loading ordinary FFLogs summaries never spawns the xivanalysis runner.

Observed upstream integration points:

- `src/report.ts`: engine `Report`, `Pull`, and `Actor`; timestamps are epoch milliseconds, actor IDs are strings, and encounters/editions are explicit.
- `src/reportSources/legacyFflogs/reportAdapter.ts`: legacy report conversion, per-fight actor construction, NPC/Limit Break exclusion, encounter mapping, progression conversion.
- `src/reportSources/legacyFflogs/eventAdapter/adapter.ts`: explicitly accepts **API v1** events and runs ordered normalization steps. These steps include prepull state, actor-instance handling, ordering corrections, and game-specific event fixes. Do not pass v2 events directly to it or reimplement only a convenient subset.
- `src/parser/AVAILABLE_MODULES.ts`, `core/Meta.tsx`, and `core/Parser.tsx`: job/boss/core registration, patch-aware module composition, dependency ordering, event dispatch, and output generation. `generateResults()` emits React markup, not a stable JSON API. Browser/localStorage paths and React dependencies exist.

Recommended sequence:

1. **Compatibility proof:** select one supported GNB pull and one AST pull from a real log. Capture the necessary full event streams, including combatant state, casts, damage, heals, buffs/debuffs, resources, targetability, instances, and prepull events. The death-only MVP stream is insufficient.
2. **Versioned adapter:** implemented for the FFLogs-v2 compatibility boundary. It preserves report-relative event timestamps for upstream translation, nested game ability IDs, actor IDs/instances/ownership, report language, combat timing, fight progression, and duty metadata. The isolated runner still needs to resolve upstream edition/job/encounter keys and construct actual xivanalysis engine objects. Keep the submodule untouched; put runner/build glue outside it and maintain any necessary upstream patch explicitly.
3. **Isolated runner:** implemented. The pinned engine executes outside the application's React 19 tree using its own dependency tree and upstream Babel transforms. Browser-only globals needed while importing analyzer modules are narrowly shimmed; core/job module arrays still come from upstream source.
4. **Structured extraction:** partially implemented. GCD uptime/lost-time, weaving/interruption delay, checklist rules, module errors, and suggestions are exported before UI rendering. Preserve unstructured upstream output as “available in full analysis” when a numeric extractor is not supported; do not scrape rendered JSX into invented metrics.
5. **Parity:** compare fixtures with upstream xivanalysis for the same report, pull, actor, patch, and pinned engine revision. Include a short wipe, a full kill, a death/resurrection, a downtime-heavy boss, a job with no applicable DoT, and incomplete logs. Failures must be local to the affected metric/analysis, not silent green checks.
6. **Raid aggregation:** run one job analysis per participating actor/pull, reuse immutable normalized pull events, and cache by report/fight/actor, event snapshot, patch, engine revision, and adapter version. Merge into the existing four views.

## Proposed structured result contract

Use a discriminated result state instead of sentinel numbers:

```ts
type MetricState<T> =
  | { status: 'measured'; value: T; observedMs: number; eligibleMs?: number }
  | { status: 'not-applicable'; reason: string }
  | { status: 'unsupported' | 'incomplete' | 'error'; reason: string }

interface PlayerPullPerformance {
  reportCode: string
  fightId: number
  actorId: number
  job: string
  patch: string
  engineRevision: string
  adapterVersion: string
  metrics: Record<string, MetricState<unknown>>
  findings: {
    module: string
    severity: 'info' | 'suggestion' | 'major'
    message: string
    startMs?: number
    endMs?: number
    actionIds?: number[]
    evidenceEventIds?: string[]
  }[]
}
```

For DoT uptime, carry numerator and eligible targetable-time denominator, and distinguish multi-target windows. For mitigation, show actual uses and evaluated opportunities independently: `7 uses / 5 opportunities` is possible; it is not inherently 140% correctness. Mitigation timing, overlap, party coverage, damage type, invulnerability, and encounter strategy determine usefulness. An opener cut off by a wipe is incomplete, not automatically passed or failed.

“A mitigation would have prevented this death” requires cooldown availability, valid target/range assumptions, mitigation stacking, damage type, active shields/HP, and a trustworthy damage model. Until those inputs exist, show the observed missed use/timing evidence rather than a counterfactual guarantee.

## Scoring

The requested eventual index may combine module results with boss progression, with configurable, versioned weights. Do not publish default weights without validated metrics.

Keep these inputs separately visible:

1. **Execution quality:** weighted applicable metrics evaluated in observed opportunity windows. Aggregate numerators/denominators; do not average percentages across unequal pulls.
2. **Coverage:** observed/eligible fight and mechanic windows, number of evaluated opportunities, and incomplete/unsupported modules. This determines whether a score is sufficiently supported.
3. **Raid progression:** FFLogs fight progression, with separate boss HP and explicit boss/phase handling. This describes the group result, not one player's independent skill.

A short pull can have perfect observed opener execution and still have insufficient coverage for a full-performance score. A progression-adjusted index can be useful for tracking one group's repeated attempts, but should not rank player skill across bosses or parties. Its formula and component contributions must be inspectable.

## Remaining acceptance criteria

- Authenticate and compare real report pull/participant/death totals against FFLogs, including the supplied example if accessible.
- Confirm event shapes, friendly `Deaths`/`DamageTaken` behavior, killing IDs, continuation boundaries, and Limit Break casts against the authenticated schema.
- Distinguish upstream fake-death/boss behavior before advertising boss-specific death correction.
- Reach parity with upstream GNB/AST output using real pulls and the structured extractors, then broaden supported job/boss/patch combinations rather than claiming all combinations from a successful import.
- Render all available extracted metrics with source, time window, support state, and evidence links; unsupported metrics stay explicit.
- Validate scoring against short wipes and long pulls, and raid recommendations against observed mechanics.
- Add user OAuth, persistent storage, report histories, or deployment authentication only when those capabilities are in scope.
