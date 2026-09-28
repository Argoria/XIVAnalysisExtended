import { afterEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { createApp } from '../server/app'
import { FflogsClient } from '../server/fflogs/client'
import { ReportService } from '../server/service'

const servers: Server[] = []
async function start() {
  const app = createApp(new ReportService(new FflogsClient(() => ({}))))
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  servers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  return `http://127.0.0.1:${address.port}`
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections()
          server.close((error) => (error ? reject(error) : resolve()))
        }),
    ),
  )
})

describe('HTTP API boundary', () => {
  it('exposes configuration status without exposing credentials', async () => {
    const response = await fetch(`${await start()}/api/health`)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ configured: false, analysisEngine: 'fflogs-deaths' })
  })
  it('returns an actionable setup error for missing credentials', async () => {
    const response = await fetch(`${await start()}/api/reports/nvM2FT6QLkJ4Bb19`)
    expect(response.status).toBe(503)
    expect((await response.json()).error).toContain('restart the server')
  })
  it('rejects malformed report codes before requesting FFLogs', async () => {
    const response = await fetch(`${await start()}/api/reports/not-a-code`)
    expect(response.status).toBe(400)
  })
  it('rejects invalid pull IDs as client errors', async () => {
    const response = await fetch(`${await start()}/api/reports/nvM2FT6QLkJ4Bb19/pulls/-2`)
    expect(response.status).toBe(400)
  })
  it('returns JSON for unknown API routes instead of the SPA', async () => {
    const response = await fetch(`${await start()}/api/unknown`)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'API route not found.' })
  })
})
