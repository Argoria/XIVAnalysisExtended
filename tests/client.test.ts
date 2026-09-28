import { describe, expect, it, vi } from 'vitest'
import { FflogsClient } from '../server/fflogs/client'
import { normalizeReport } from '../server/fflogs/normalize'
import { ReportService } from '../server/service'
import { fixture, event } from './fixtures'

const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers })
const token = () => json({ access_token: 'test-token-only', expires_in: 3600 })
const data = (report: unknown) => json({ data: { reportData: { report } } })
function setup() {
  const fetcher = vi.fn<typeof fetch>()
  const client = new FflogsClient(() => ({ id: 'test-id', secret: 'test-secret' }), fetcher)
  return { fetcher, client }
}
const pull = normalizeReport(fixture).pulls[0]

describe('FFLogs client', () => {
  it('uses server-side OAuth and reuses the token', async () => {
    const { fetcher, client } = setup()
    fetcher
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(data(fixture))
      .mockResolvedValueOnce(data(fixture))
    await client.report(fixture.code)
    await client.report(fixture.code)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher.mock.calls[0][0]).toBe('https://www.fflogs.com/oauth/token')
    expect(fetcher.mock.calls[0][1]?.body).toBe('grant_type=client_credentials')
    expect(fetcher.mock.calls[1][0]).toBe('https://www.fflogs.com/api/v2/client')
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer test-token-only' })
    expect(JSON.stringify(fetcher.mock.calls[1][1]?.body)).not.toContain('test-secret')
  })
  it('deduplicates concurrent token requests', async () => {
    const { fetcher, client } = setup()
    fetcher.mockResolvedValueOnce(token()).mockImplementation(async () => data(fixture))
    await Promise.all([client.report(fixture.code), client.report(fixture.code)])
    expect(fetcher.mock.calls.filter((c) => String(c[0]).endsWith('/oauth/token'))).toHaveLength(1)
  })
  it('refuses missing credentials without sending a request', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const client = new FflogsClient(() => ({}), fetcher)
    await expect(client.report(fixture.code)).rejects.toThrow('FFLOGS_CLIENT_ID')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('renews an expired/rejected token once', async () => {
    const { fetcher, client } = setup()
    fetcher
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(data(fixture))
    await expect(client.report(fixture.code)).resolves.toEqual(fixture)
    expect(fetcher).toHaveBeenCalledTimes(4)
  })
  it('does not loop on repeated authentication failure', async () => {
    const { fetcher, client } = setup()
    fetcher
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(json({}, 401))
    await expect(client.report(fixture.code)).rejects.toThrow('denied access')
    expect(fetcher).toHaveBeenCalledTimes(4)
  })
  it('reports rate limiting and retry-after without fabricating data', async () => {
    const { fetcher, client } = setup()
    fetcher.mockResolvedValueOnce(token()).mockResolvedValueOnce(json({}, 429, { 'Retry-After': '60' }))
    await expect(client.report(fixture.code)).rejects.toThrow('Retry in 60 seconds')
  })
  it('rejects partial GraphQL responses', async () => {
    const { fetcher, client } = setup()
    fetcher
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(
        json({ data: { reportData: { report: fixture } }, errors: [{ message: 'A field failed' }] }),
      )
    await expect(client.report(fixture.code)).rejects.toThrow('A field failed')
  })
  it('returns a clear error for missing or inaccessible reports', async () => {
    const { fetcher, client } = setup()
    fetcher.mockResolvedValueOnce(token()).mockResolvedValueOnce(data(null))
    await expect(client.report(fixture.code)).rejects.toThrow('Report not found')
  })
  it('follows continuation timestamps exactly, without skipping events at the boundary', async () => {
    const { fetcher, client } = setup()
    fetcher
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(
        data({ events: { data: [event('death', 80000, { targetID: 1 })], nextPageTimestamp: 90000 } }),
      )
      .mockResolvedValueOnce(
        data({ events: { data: [event('death', 90000, { targetID: 2 })], nextPageTimestamp: null } }),
      )
    const result = await client.events(fixture.code, pull, 'Deaths')
    expect(result.map((e) => e.timestamp)).toEqual([80000, 90000])
    const variables = fetcher.mock.calls.slice(1).map((c) => JSON.parse(String(c[1]?.body)).variables)
    expect(variables).toMatchObject([
      { start: 60000, fightIDs: [1], end: 160000 },
      { start: 90000, fightIDs: [1], end: 160000 },
    ])
  })
  it.each([
    { next: 60000, events: [event('death', 60000)] },
    { next: 90000, events: [] },
    { next: 170000, events: [event('death', 90000)] },
  ])('rejects inconsistent pagination %#', async ({ next, events }) => {
    const { fetcher, client } = setup()
    fetcher
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(data({ events: { data: events, nextPageTimestamp: next } }))
    await expect(client.events(fixture.code, pull, 'Deaths')).rejects.toThrow('inconsistent event pagination')
  })
  it('fails a bounded download instead of returning a truncated event list', async () => {
    const { fetcher, client } = setup()
    fetcher.mockResolvedValueOnce(token()).mockImplementation(async (_url, options) => {
      const start = JSON.parse(String(options?.body)).variables.start
      return data({ events: { data: [event('death', start)], nextPageTimestamp: start + 1 } })
    })
    await expect(client.events(fixture.code, pull, 'Deaths')).rejects.toThrow('page limit')
    expect(fetcher).toHaveBeenCalledTimes(101)
  })
})

describe('report service', () => {
  it('loads only the chosen pull and caches successful analysis', async () => {
    const { client } = setup()
    const reportSpy = vi.spyOn(client, 'report').mockResolvedValue(fixture)
    const eventSpy = vi
      .spyOn(client, 'events')
      .mockImplementation(async (_code, _pull, type) =>
        type === 'Deaths' ? [event('death', 80000, { targetID: 1, killingAbilityGameID: 100 })] : [],
      )
    const service = new ReportService(client)
    const result = await service.pull(fixture.code, 1)
    expect(result.deaths).toHaveLength(1)
    expect(await service.pull(fixture.code, 1)).toEqual(result)
    expect(reportSpy).toHaveBeenCalledTimes(1)
    expect(eventSpy).toHaveBeenCalledTimes(4)
    expect(eventSpy.mock.calls.every((c) => c[1].id === 1)).toBe(true)
    expect(eventSpy.mock.calls.some((c) => c[2] === 'DamageDone')).toBe(true)
    expect(eventSpy.mock.calls.find((c) => c[2] === 'Casts')?.[3]).toBe('source.id = 10 OR source.id = 11')
  })
  it('does not cache an analysis with failed damage evidence', async () => {
    const { client } = setup()
    vi.spyOn(client, 'report').mockResolvedValue(fixture)
    const events = vi.spyOn(client, 'events').mockImplementation(async (_code, _pull, type) => {
      if (type === 'Deaths') return [event('death', 80000, { targetID: 1 })]
      if (type === 'DamageTaken') throw new Error('download failed')
      return []
    })
    const service = new ReportService(client)
    await expect(service.pull(fixture.code, 1)).rejects.toThrow('download failed')
    events.mockResolvedValue([])
    await expect(service.pull(fixture.code, 1)).resolves.toMatchObject({ deaths: [], performance: expect.any(Array) })
    expect(events).toHaveBeenCalledTimes(8)
  })
  it('rejects trash segments before requesting any events', async () => {
    const { client } = setup()
    vi.spyOn(client, 'report').mockResolvedValue(fixture)
    const events = vi.spyOn(client, 'events')
    await expect(new ReportService(client).pull(fixture.code, 99)).rejects.toThrow('not found')
    expect(events).not.toHaveBeenCalled()
  })
})
