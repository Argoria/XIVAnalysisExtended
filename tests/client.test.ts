import { describe, expect, it, vi } from 'vitest'
import { FflogsClient } from '../server/fflogs/client'
import { normalizeReport } from '../server/fflogs/normalize'
import { ReportService } from '../server/service'
import type { XivanalysisEngineRunner } from '../server/xivanalysis/runner'
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
  it('reads FFLogs report ranking DPS metrics by actor id', async () => {
    const { fetcher, client } = setup()
    const ranking = (amount: number) => ({
      data: [
        {
          roles: {
            tanks: { characters: [{ id: 1, amount }] },
            healers: { characters: [] },
            dps: { characters: [] },
          },
        },
      ],
    })
    fetcher.mockResolvedValueOnce(token()).mockResolvedValueOnce(
      data({
        dps: ranking(15000),
        rdps: ranking(14750),
        ndps: ranking(14500),
        cdps: ranking(15200),
      }),
    )
    await expect(client.dpsMetrics(fixture.code, pull)).resolves.toEqual(
      new Map([[1, { dps: 15000, rdps: 14750, ndps: 14500, cdps: 15200, adps: null }]]),
    )
  })

  it('fetches the complete xivanalysis event stream without a data-type filter', async () => {
    const { fetcher, client } = setup()
    const cast = {
      timestamp: 70000,
      type: 'cast',
      fight: 1,
      sourceID: 1,
      targetID: 20,
      ability: { guid: 101, name: 'Attack', type: 128, abilityIcon: 'attack.png' },
    }
    fetcher
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(data({ events: { data: [cast], nextPageTimestamp: 90000 } }))
      .mockResolvedValueOnce(
        data({
          events: {
            data: [{ ...cast, timestamp: 90000, sourceInstance: 2 }],
            nextPageTimestamp: null,
          },
        }),
      )

    const result = await client.analysisEvents(fixture.code, pull)
    expect(result).toHaveLength(2)
    expect(result[0].ability?.guid).toBe(101)

    const requests = fetcher.mock.calls.slice(1).map((call) => JSON.parse(String(call[1]?.body)))
    expect(requests[0].query).toContain('useAbilityIDs: false')
    expect(requests[0].query).not.toContain('dataType:')
    expect(requests.map((request) => request.variables.start)).toEqual([60000, 90000])
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
    const metricSpy = vi.spyOn(client, 'dpsMetrics').mockResolvedValue(new Map())
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
    expect(eventSpy).toHaveBeenCalledTimes(3)
    expect(metricSpy).toHaveBeenCalledTimes(1)
    expect(eventSpy.mock.calls.every((c) => c[1].id === 1)).toBe(true)
    expect(eventSpy.mock.calls.find((c) => c[2] === 'Casts')?.[3]).toBe('source.id = 10 OR source.id = 11')
  })
  it('does not cache an analysis with failed damage evidence', async () => {
    const { client } = setup()
    vi.spyOn(client, 'report').mockResolvedValue(fixture)
    vi.spyOn(client, 'dpsMetrics').mockResolvedValue(new Map())
    const events = vi.spyOn(client, 'events').mockImplementation(async (_code, _pull, type) => {
      if (type === 'Deaths') return [event('death', 80000, { targetID: 1 })]
      if (type === 'DamageTaken') throw new Error('download failed')
      return []
    })
    const service = new ReportService(client)
    await expect(service.pull(fixture.code, 1)).rejects.toThrow('download failed')
    events.mockResolvedValue([])
    await expect(service.pull(fixture.code, 1)).resolves.toMatchObject({
      deaths: [],
      performance: expect.any(Array),
    })
    expect(events).toHaveBeenCalledTimes(5)
  })
  it('loads and caches complete xivanalysis adapter input only after a successful event fetch', async () => {
    const { client } = setup()
    vi.spyOn(client, 'report').mockResolvedValue(fixture)
    const analysisEvents = vi.spyOn(client, 'analysisEvents').mockResolvedValue([
      {
        timestamp: 80000,
        type: 'cast',
        fight: 1,
        sourceID: 1,
        targetID: 20,
        ability: { guid: 101, name: 'Attack' },
      },
    ])
    const service = new ReportService(client)

    const first = await service.xivanalysisInput(fixture.code, 1)
    const second = await service.xivanalysisInput(fixture.code, 1)

    expect(second).toEqual(first)
    expect(first.events).toHaveLength(1)
    expect(first.adapterVersion).toMatch(/^fflogs-v2-legacy-compat\//)
    expect(analysisEvents).toHaveBeenCalledTimes(1)
  })

  it('does not cache failed xivanalysis event downloads', async () => {
    const { client } = setup()
    vi.spyOn(client, 'report').mockResolvedValue(fixture)
    const analysisEvents = vi
      .spyOn(client, 'analysisEvents')
      .mockRejectedValueOnce(new Error('full stream failed'))
      .mockResolvedValueOnce([])
    const service = new ReportService(client)

    await expect(service.xivanalysisInput(fixture.code, 1)).rejects.toThrow('full stream failed')
    await expect(service.xivanalysisInput(fixture.code, 1)).resolves.toMatchObject({
      reportCode: fixture.code,
      events: [],
    })
    expect(analysisEvents).toHaveBeenCalledTimes(2)
  })

  it('runs and caches upstream xivanalysis per participating player', async () => {
    const { client } = setup()
    vi.spyOn(client, 'report').mockResolvedValue(fixture)
    vi.spyOn(client, 'analysisEvents').mockResolvedValue([])
    const analyze = vi.fn(async (input, actorId) => ({
      engineRevision: 'f532855e635bdfb4211cec8128d582dadfdc6a75',
      adapterVersion: input.adapterVersion,
      reportCode: input.reportCode,
      fightId: input.pull.fightId,
      actorId,
      job: 'GUNBREAKER',
      encounterKey: null,
      adaptedEventCount: 0,
      eventTypes: {},
      moduleCount: 1,
      modules: [{ handle: 'test', type: 'Test', error: null }],
      uptime: {
        fightDurationMs: input.pull.duration,
        unavailableMs: 0,
        effectiveFightMs: input.pull.duration,
        gcdUptimeMs: 85000,
        gcdUptimePercent: 94.44,
        gcdCount: 36,
        gcdDowntimeMs: 5000,
        gcdDowntimeCount: 2,
        weavingDelayMs: 1200,
        weavingIssueCount: 1,
        interruptedCastDelayMs: 0,
        interruptedCastCount: 0,
      },
      checklist: [
        {
          label: 'core.always-cast.title',
          percent: 94.44,
          target: 98,
          passed: false,
          requirements: [
            {
              label: 'core.always-cast.gcd-uptime',
              percent: 94.44,
              value: null,
              target: 100,
              weight: 1,
            },
          ],
        },
      ],
      suggestions: [],
    }))
    const runner: XivanalysisEngineRunner = { analyze }
    const service = new ReportService(client, runner)

    const first = await service.xivanalysis(fixture.code, 1, 1)
    const second = await service.xivanalysis(fixture.code, 1, 1)

    expect(second).toEqual(first)
    expect(first.job).toBe('GUNBREAKER')
    expect(first.uptime.gcdUptimePercent).toBe(94.44)
    expect(first.checklist[0].passed).toBe(false)
    expect(analyze).toHaveBeenCalledTimes(1)
  })

  it('rejects xivanalysis for an actor that did not participate in the pull', async () => {
    const { client } = setup()
    vi.spyOn(client, 'report').mockResolvedValue(fixture)
    vi.spyOn(client, 'analysisEvents').mockResolvedValue([])
    const runner: XivanalysisEngineRunner = {
      analyze: vi.fn(),
    }
    const service = new ReportService(client, runner)

    await expect(service.xivanalysis(fixture.code, 1, 3)).rejects.toThrow('did not participate')
    expect(runner.analyze).not.toHaveBeenCalled()
  })

  it('rejects trash segments before requesting any events', async () => {
    const { client } = setup()
    vi.spyOn(client, 'report').mockResolvedValue(fixture)
    const events = vi.spyOn(client, 'events')
    await expect(new ReportService(client).pull(fixture.code, 99)).rejects.toThrow('not found')
    expect(events).not.toHaveBeenCalled()
  })
})
