# Pullwise — XIV Analysis Extended

A local web app for reviewing an FFLogs report by **session**, **player**, **pull**, and **player × pull**. The initial implementation focuses on two questions: which recorded abilities kill the group most often, and which players die most frequently in the pulls they actually joined.

## Run

Requires Node.js 22.14+ (Node 24 recommended), npm, and Git.

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
- Player × pull raw damage and pull-duration DPS from `DamageDone`, with pet damage rolled into the participating owner through FFLogs `petOwner`. The player view shows weighted average DPS, best pull DPS, and sortable pull history by boss HP, DPS, or deaths.
- Killing-ability frequency with an explicit unknown bucket, per-pull death timelines, and up to ten incoming damage events from the five seconds before each death.
- Separate boss HP and encounter progression. API v2 percentages are already 0–100; they are not divided by 100 as in the legacy v1 adapter.
- Both Limit Break actor IDs are treated as the shared raid resource. Duplicate same-time, same-ability casts are grouped while preserving actor IDs. Player-attributed LB actions are not yet detected.
- Desktop/mobile layouts, keyboard-accessible details, loading/error/empty states, FFLogs evidence links, and per-player links to xivanalysis.

Deaths during wipe cleanup are included. The final hit and the first death are observations, **not causal blame or proof a death was avoidable**. A recent nonlethal hit is never silently promoted into a killing blow. Missing data stays unknown; a failed or unfinished event fetch never becomes a zero-death pull.

## xivanalysis and scoring status

The upstream repository is added as the pinned Git submodule `vendor/xivanalysis`. Initialize it after cloning:

```powershell
git submodule update --init --recursive
```

The submodule is **not yet an executing analysis engine** in this app. Its current implementation is a React 16/Webpack application with a legacy FFLogs v1 adapter, browser dependencies, module-specific result state, and React output. Opener checks, DoT uptime, mitigation opportunities, boss-specific recommendations, and composite performance scores are deliberately shown as **not analyzed** in the MVP. Raw pull-duration DPS is an FFLogs fact, not an xivanalysis score or an FFLogs rDPS/aDPS/nDPS ranking metric.

See [the product and integration design](docs/design.md) for the implementation path, metric contract, scoring constraints, and acceptance criteria. No upstream dependencies or code are copied into the production bundle. The original MIT license remains in the submodule.

## Layout

| Directory             | Purpose                                                                          |
| --------------------- | -------------------------------------------------------------------------------- |
| `server/fflogs/`      | OAuth/GraphQL transport, runtime schemas, actor normalization and death evidence |
| `server/service.ts`   | Pull orchestration and bounded caches                                            |
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
