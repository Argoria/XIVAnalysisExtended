import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(resolve('.artifacts/browser-tools/package.json'))
const { chromium } = require('playwright')
const output = resolve(process.env.VERIFY_OUTPUT_DIR || '.artifacts/live-verification')
await mkdir(output, { recursive: true })
const remote = process.env.VERIFY_BASE_URL
const base = (remote || 'http://127.0.0.1:3001').replace(/\/$/, '')
const user = remote ? process.env.APP_ACCESS_USER : 'verification'
const password = remote ? process.env.APP_ACCESS_PASSWORD : randomBytes(32).toString('hex')
const reportCode = process.env.FFLOGS_VERIFY_REPORT || 'nvM2FT6QLkJ4Bb19'
assert.match(reportCode, /^[a-zA-Z0-9]{16}$/)
const headers = user && password
  ? { Authorization: 'Basic ' + Buffer.from(user + ':' + password).toString('base64') }
  : {}
const summary = { target: remote ? 'deployed' : 'production build in Actions', reportCode, checks: [], actors: [], errors: [] }
let server
let browser
const clean = (error) => {
  let message = String(error?.message || error)
  for (const value of [process.env.FFLOGS_CLIENT_ID, process.env.FFLOGS_CLIENT_SECRET, password]) {
    if (value) message = message.split(value).join('[redacted]')
  }
  return message.slice(0, 1500)
}
async function get(path) {
  const response = await fetch(base + path, { headers, signal: AbortSignal.timeout(180000) })
  const body = await response.json().catch(() => ({}))
  assert.equal(response.status, 200,
    path + ' returned HTTP ' + response.status + (body.error ? ': ' + clean(body.error) : ''))
  return body
}
try {
  if (!remote) {
    assert.ok(process.env.FFLOGS_CLIENT_ID && process.env.FFLOGS_CLIENT_SECRET,
      'Set FFLOGS_CLIENT_ID and FFLOGS_CLIENT_SECRET in the dev environment.')
    server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      env: { ...process.env, NODE_ENV: 'production', HOST: '0.0.0.0', PORT: '3001',
        APP_ACCESS_USER: user, APP_ACCESS_PASSWORD: password },
      stdio: 'ignore',
    })
    server.on('error', () => {})
  }
  let ready = false
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch(base + '/healthz', { signal: AbortSignal.timeout(5000) })
      if (response.ok) { ready = true; break }
    } catch {}
    if (server?.exitCode != null) throw new Error('Production server exited before becoming ready.')
    await delay(1000)
  }
  assert.ok(ready, 'Server did not become ready.')
  if (user && password) {
    assert.equal((await fetch(base + '/api/health')).status, 401, 'API must require authentication')
  }
  assert.equal((await get('/api/health')).configured, true, 'FFLogs credentials are not configured')
  summary.checks.push('production server, health and access protection')
  if (!remote) {
    // Separate API-wide access problems from a report-specific permission denial.
    const { FflogsClient } = await import('../server/fflogs/client.ts')
    const client = new FflogsClient(() => ({
      id: process.env.FFLOGS_CLIENT_ID, secret: process.env.FFLOGS_CLIENT_SECRET,
    }))
    await client.query('query VerificationAccess { __typename }', {})
    summary.checks.push('FFLogs OAuth and public GraphQL access')
  }
  const root = '/api/reports/' + reportCode
  const report = await get(root)
  assert.equal(report.source, 'fflogs')
  assert.ok(report.pulls.length && report.players.length, 'Report has no encounters or players')
  const requestedFight = process.env.FFLOGS_VERIFY_FIGHT
  const pull = requestedFight
    ? report.pulls.find((candidate) => candidate.id === Number(requestedFight))
    : report.pulls.find((candidate) => candidate.endTime - candidate.startTime >= 60000 && candidate.playerIds.length)
      || report.pulls[0]
  assert.ok(pull, 'Verification fight is not in this report')
  summary.fightId = pull.id
  const analysis = await get(root + '/pulls/' + pull.id)
  assert.equal(analysis.fightId, pull.id)
  assert.ok(Array.isArray(analysis.performance) && analysis.performance.length)
  assert.ok(Array.isArray(analysis.deaths))
  const progression = await get(root + '/progression?fight=' + pull.id)
  assert.deepEqual(progression.failedPulls, [], 'Boss-cast progression request failed')
  assert.ok(Array.isArray(progression.pulls[pull.id]))
  summary.checks.push('real report, one pull, damage/deaths and boss casts')

  try {
  // Exercise the real page and API; only progression is scoped to the chosen pull.
  // Avoid a report-wide cast download just for this bounded verification.
  browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ...(user && password ? { httpCredentials: { username: user, password } } : {}),
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(clean(error)))
  await page.route('**/api/reports/*/progression', async (route) => {
    const url = new URL(route.request().url())
    url.searchParams.set('fight', String(pull.id))
    await route.continue({ url: url.toString() })
  })
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.getByRole('textbox', { name: 'FFLogs report URL or code' })
    .fill('https://www.fflogs.com/reports/' + reportCode + '?fight=' + pull.id)
  const loaded = page.waitForResponse((response) =>
    new URL(response.url()).pathname === root + '/pulls/' + pull.id && response.ok(),
    { timeout: 180000 })
  await page.getByRole('button', { name: 'Load report', exact: true }).click()
  await loaded
  await page.getByText(report.title, { exact: true }).first().waitFor()
  for (const [name, file] of [
    ['Session overview', 'session'], ['By player', 'players'],
    ['By pull', 'pulls'], ['Player × pull', 'matrix'],
  ]) {
    await page.getByRole('button', { name, exact: true }).click()
    await page.screenshot({ path: output + '/' + file + '.png', fullPage: true })
  }
  await page.getByLabel('Matrix metric', { exact: true }).selectOption('rdps')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: output + '/mobile.png', fullPage: true })
  assert.deepEqual(pageErrors, [], 'Browser runtime errors')
  summary.checks.push('real report browser load, four views, matrix metric and mobile screenshot')
  await browser.close()
  browser = undefined

  } catch (error) {
    summary.errors.push(clean(error))
    await browser?.close()
    browser = undefined
  }

  const players = report.players.filter((player) => pull.playerIds.includes(player.id))
  const preferred = ['GNB', 'AST'].flatMap((job) => players.filter((player) => player.job === job))
  const actors = [...new Map([...preferred, ...players].map((player) => [player.id, player])).values()].slice(0, 2)
  assert.ok(actors.length)
  for (const actor of actors) {
    try {
      const result = await get(root + '/pulls/' + pull.id + '/players/' + actor.id + '/xivanalysis')
      assert.equal(result.actorId, String(actor.id))
      assert.equal(result.fightId, pull.id)
      assert.ok(result.adaptedEventCount > 0 && result.moduleCount > 0, 'Engine produced no analysis')
      assert.ok(result.metricStatus, 'Engine omitted metric integrity')
      const failedModules = result.modules.filter((module) => module.error)
      summary.actors.push({ actorId: actor.id, job: result.job, events: result.adaptedEventCount,
        modules: result.moduleCount, metricStatus: result.metricStatus,
        failedModules: failedModules.map((module) => ({ handle: module.handle, error: clean(module.error) })) })
      assert.equal(failedModules.length, 0, 'Engine modules failed for actor ' + actor.id)
      assert.ok(Object.values(result.metricStatus).some((metric) => metric.state === 'measured'),
        'No measured engine metrics for actor ' + actor.id)
    } catch (error) { summary.errors.push(clean(error)) }
  }
  if (!summary.errors.length) summary.checks.push('real isolated xivanalysis engine for sampled players')
} catch (error) {
  summary.errors.push(clean(error))
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
  summary.ok = summary.errors.length === 0
  const json = JSON.stringify(summary, null, 2)
  await writeFile(output + '/summary.json', json + '\n')
  const markdown = '## Live verification: ' + (summary.ok ? 'passed' : 'failed') +
    '\n\nTarget: ' + summary.target + '\n\n' +
    summary.checks.map((check) => '- Passed: ' + check).join('\n') +
    '\n' + summary.errors.map((error) => '- Failed: ' + error).join('\n') + '\n'
  await writeFile(output + '/summary.md', markdown)
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown)
  console.log(json)
  if (!summary.ok) process.exitCode = 1
}
