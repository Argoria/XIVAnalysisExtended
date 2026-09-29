# Pullwise — XIV Analysis Extended

A local web app for reviewing an FFLogs report by **session**, **player**, **pull**, and **player × pull**. The initial implementation focuses on two questions: which recorded abilities kill the group most often, and which players die most frequently in the pulls they actually joined.

## Run

Requires Node.js 22.14+ within the Node 22 release line, npm, and Git. The pinned analysis engine uses Node 22.

```powershell
npm install
Copy-Item .env.example .env # Only if .env does not already exist
# Fill FFLOGS_CLIENT_ID and FFLOGS_CLIENT_SECRET in .env
npm run dev
```

Open <http://127.0.0.1:5173>. The clearly labeled **synthetic demo** works without credentials. Paste a report URL, for example `https://www.fflogs.com/reports/nvM2FT6QLkJ4Bb19`, or a 16-character code. URL `fight=4` and `fight=last` selections are supported.

The client ID and secret come from an FFLogs API v2 client. They remain in the server process and are exchanged at FFLogs' OAuth token endpoint. Never prefix them with `VITE_`. `.env` is ignored by Git. Restart the server after editing it. Client credentials support public reports; private reports need a future user OAuth flow. Do not overwrite an existing `.env` when updating the project.

Development uses Vite on port 5173 and the API on 3001. Both bind to loopback. If you change `PORT`, update the proxy target in `vite.config.ts` too. This is a local application; hosted multi-user authentication and quotas are outside this MVP.

```powershell
npm run check       # TypeScript, tests, production bundle
npm run format:check
npm run build
npm start           # Serves the built UI and API at http://127.0.0.1:3001
```

## Implemented

- Server-side FFLogs API v2 OAuth and GraphQL, token reuse, one renewal on HTTP 401, bounded event pagination, timeouts, rate-limit errors, runtime response validation, and bounded short-lived in-memory caching.
- Encounter and pull selection. A session is currently one report, limited to selected boss fights. Area downtime and encounter ID 0 segments are excluded.
- Rosters intersect each fight's `friendlyPlayers` with actual `Player` actors. Pets, NPCs, unrelated report actors, and Limit Break entities never become players in the analysis.
- Death counts, first deaths (including timestamp ties), deaths per participating pull, and death-free pulls. Substitutes use their own participation denominator.
- Player × pull DPS metrics come from FFLogs report rankings (`dps`, `rdps`, `ndps`, `cdps`) rather than local event summation. The player view shows duration-weighted average DPS, best pull DPS, and sortable pull history by boss HP, DPS, or deaths. FFLogs documents aDPS, but the current `ReportRankingMetricType` schema does not expose an `adps` enum, so it remains explicitly unavailable rather than being approximated.
- Killing-ability frequency with an explicit unknown bucket, per-pull death timelines, and up to ten incoming damage events from the five seconds before each death.
- Separate boss HP and encounter progression. API v2 percentages are already 0–100; they are not divided by 100 as in the legacy v1 adapter.
- Both Limit Break actor IDs are treated as the shared raid resource. Duplicate same-time, same-ability casts are grouped while preserving actor IDs. Player-attributed LB actions are not yet detected.
- Desktop/mobile layouts, keyboard-accessible details, loading/error/empty states, FFLogs evidence links, and per-player links to xivanalysis.

Deaths during wipe cleanup are included. The final hit and the first death are observations, **not causal blame or proof a death was avoidable**. A recent nonlethal hit is never silently promoted into a killing blow. Missing data stays unknown; a failed or unfinished event fetch never becomes a zero-death pull.

## Trainer comparison workflow

- Classify a pull in its detail drawer. Confirmed scrapped pulls are excluded by default; suspected resets remain included until reviewed. Manual decisions and reasons persist in this browser per report and fight.
- Choose a DPS metric, minimum duration, reached checkpoint, and required measured-uptime coverage before comparing pulls. Filters apply to all four views. The pull table retains excluded scrapped pulls for inspection.
- Sort the pull table and player history, or switch the matrix between deaths, DPS/rDPS/nDPS/cDPS, and uptime. Missing data stays unavailable; raid DPS requires the complete roster's metric.
- Check measured coverage separately from loaded analyses. Failed or incomplete metrics cannot enter averages; unaffected metrics remain usable.
- Use **What to review next** for recurring observations and specific evidence links, grouped by encounter/difficulty.

Vamp Fatale's numbered Sadistic Screech checkpoints are provisional anchors, not verified mechanic completion. Boss HP at a checkpoint appears only when its cast carries a valid boss resource snapshot. Mechanic failures and correct-opener counts remain unimplemented pending verified encounter/job extraction. See [delivery slices and remaining acceptance criteria](docs/trainer-slices.md).

## xivanalysis integration status

The upstream repository is pinned as the Git submodule `vendor/xivanalysis`. Deep analysis runs in an isolated Node process so xivanalysis' React 16/Babel dependency tree stays separate from this application's React 19 runtime.

Initialize the runner dependencies once after cloning or updating the submodule:

```powershell
npm run analysis:setup
```

For a selected player × pull, the server now fetches the complete FFLogs v2 event stream, converts it through the versioned compatibility adapter, and executes upstream xivanalysis `adaptEvents` and `Parser`. The structured result currently exposes GCD uptime, GCD lost-time windows, weaving and interrupted-cast delay, checklist rule percentages, module errors, and suggestion severity/value data. The UI loads this path lazily when a specific player/pull is inspected. In the player view, an explicit **Analyze selected pulls** action reuses those cached results across the selected pulls and reports weighted GCD uptime from summed uptime/eligible milliseconds, lost-time totals, checklist pass counts, and severe suggestion counts.

The application does **not** scrape xivanalysis' rendered React output. Opener correctness, DoT-specific uptime, mitigation opportunities, and boss-mechanic findings still need explicit module-specific extractors because upstream does not expose one uniform numeric contract for those concepts. Composite performance scoring remains intentionally absent until those metrics have support/coverage semantics.

The heavyweight runner smoke test is manual-only in GitHub Actions (`xivanalysis runner smoke`) so ordinary application commits do not reinstall xivanalysis' dependency tree. The normal `Check` workflow validates the application without initializing the submodule. Locally, `npm run analysis:smoke` exercises the isolated runner after `npm run analysis:setup`.

See [the product and integration design](docs/design.md) for the adapter contract, scoring constraints, and parity requirements. Upstream source remains unmodified in the pinned submodule and retains its MIT license.

## Layout

| Directory             | Purpose                                                                          |
| --------------------- | -------------------------------------------------------------------------------- |
| `server/fflogs/`      | OAuth/GraphQL transport, runtime schemas, actor normalization and death evidence |
| `server/service.ts`   | FFLogs pull orchestration plus bounded FFLogs/xivanalysis caches                 |
| `server/xivanalysis/` | FFLogs-v2 compatibility adapter and isolated-engine process bridge               |
| `analysis-runner/`    | Headless launcher around the pinned upstream xivanalysis parser                  |
| `shared/`             | Browser/server data contracts, input parsing, aggregation, synthetic demo        |
| `src/`                | React interface                                                                  |
| `tests/`              | Independent edge cases and mocked API/service tests                              |
| `vendor/xivanalysis/` | Pinned upstream source; not modified                                             |

## Validation and remaining live check

Type checking, the production build, and automated fixtures cover participation, LB aliases, resurrection/repeated deaths, first-death ties, cause attribution, v2 percentages, selection isolation, authentication, partial GraphQL errors, rate limits, pagination and failed-download caching. Browser checks cover the demo and missing-credential path.

**The example report has not been fetched with real credentials yet.** The official documentation URLs were blocked by a Cloudflare challenge during implementation. Request fields were cross-checked against existing v2 client source, but the authenticated API/schema and live event payloads still need confirmation. Do not interpret the synthetic demo as analysis of the example report.

Reference links:

- [FFLogs API documentation](https://www.archon.gg/ffxiv/articles/help/api-documentation)
- [FFLogs v2 Report schema](https://www.fflogs.com/v2-api-docs/ff/report.doc.html)
- [xivanalysis source](https://github.com/xivanalysis/xivanalysis)
