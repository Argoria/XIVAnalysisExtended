# Dev deployment and verification

Pullwise requires a Node 22 server, including the pinned xivanalysis submodule and its pnpm dependencies. The analyzer runs in a child process. Serve the built Vite frontend and API together; static-only hosting cannot run the analysis API.

## Render

The repository includes a free-plan Render Blueprint. The equivalent native Node service uses:

- Build: `npm ci --include=dev && npm run analysis:setup && npm run build`
- Start: `node --import tsx server/index.ts`
- Health check: `/healthz`
- Environment: `NODE_VERSION=22`, `NODE_ENV=production`, `HOST=0.0.0.0`
- Secrets: `FFLOGS_CLIENT_ID`, `FFLOGS_CLIENT_SECRET`, `APP_ACCESS_USER`, `APP_ACCESS_PASSWORD`

Public binding refuses to start without access credentials. The page and all API routes require HTTP Basic authentication over the host's HTTPS URL. Only the liveness endpoint is public. Local development still defaults to loopback without authentication. Do not put secrets in build arguments, repository files, URLs or artifacts.

GitHub Actions secrets are available to workflow jobs; they do not automatically become Render runtime variables. Set the FFLogs credentials in Render's environment settings too. The Blueprint generates an access password; keep the same access credentials in the GitHub `dev` environment if enabling remote verification.

Free hosting is an initial trial. Measure startup time and memory during real analysis before choosing whether a paid plan is necessary.

## Automated verification

`Verify dev` runs on master pushes and manual dispatch, using the GitHub `dev` environment. It installs the production build, pinned analysis dependencies and Chromium, then starts an authenticated server and uses the real FFLogs API.

Required environment secrets: `FFLOGS_CLIENT_ID` and `FFLOGS_CLIENT_SECRET`.

Optional environment variables:

- `FFLOGS_VERIFY_REPORT`: report code (defaults to `nvM2FT6QLkJ4Bb19`).
- `FFLOGS_VERIFY_FIGHT`: one encounter ID. By default select the first pull lasting at least 60 seconds.
- `DEV_BASE_URL`: deployed HTTPS URL. Enables a second verification against that service, using `APP_ACCESS_USER` and `APP_ACCESS_PASSWORD` secrets.

Each verification covers one pull and up to two participating players, preferring GNB and AST. It checks live report/death/damage/cast APIs, loads the report in Chromium, switches all four views, captures desktop/mobile screenshots and runs the actual xivanalysis engine. Browser progression is scoped to the selected pull to avoid a report-wide download. Module errors fail verification; HTTP 200 alone is not a successful analysis.

Artifacts contain a redacted summary and screenshots, retained seven days. No credentials or raw event stream are saved. A passing workflow validates the production build in Actions; the summary explicitly distinguishes this from a deployed-service check. It does not establish full metric parity with upstream xivanalysis.

Deployment is not complete until the host is created, runtime credentials are set and the deployed-service check passes.
