import { z } from 'zod'
import { eventPageSchema, reportSchema, type RawEvent, type RawReport } from './schema'
import type { Pull } from '../../shared/types'

const TOKEN_URL = 'https://www.fflogs.com/oauth/token'
const API_URL = 'https://www.fflogs.com/api/v2/client'

export class FflogsError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message)
  }
}

export const REPORT_QUERY = `query Report($code: String!) {
  reportData { report(code: $code) {
    code title startTime endTime
    fights { id encounterID name difficulty startTime endTime kill bossPercentage fightPercentage friendlyPlayers }
    masterData { actors { id name type subType petOwner } abilities { gameID name } }
  } }
}`
export const EVENTS_QUERY = `query Events($code: String!, $fightIDs: [Int]!, $start: Float!, $end: Float!, $dataType: EventDataType!, $filter: String) {
  reportData { report(code: $code) {
    events(fightIDs: $fightIDs, startTime: $start, endTime: $end, dataType: $dataType,
      hostilityType: Friendlies, filterExpression: $filter, includeResources: true, limit: 10000) {
      data nextPageTimestamp
    }
  } }
}`

export class FflogsClient {
  private token?: { value: string; expiresAt: number }
  private pendingToken?: Promise<string>
  constructor(
    private credentials: () => { id?: string; secret?: string },
    private fetcher: typeof fetch = fetch,
  ) {}

  get configured() {
    const { id, secret } = this.credentials()
    return Boolean(id?.trim() && secret?.trim())
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value
    if (this.pendingToken) return this.pendingToken
    this.pendingToken = this.authenticate()
    try {
      return await this.pendingToken
    } finally {
      this.pendingToken = undefined
    }
  }

  private async authenticate(): Promise<string> {
    const { id, secret } = this.credentials()
    if (!id?.trim() || !secret?.trim())
      throw new FflogsError(
        'Add FFLOGS_CLIENT_ID and FFLOGS_CLIENT_SECRET to .env, then restart the server.',
        503,
      )
    const response = await this.request(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${id.trim()}:${secret.trim()}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    })
    if (!response.ok)
      throw new FflogsError(
        'FFLogs rejected the client credentials. Check the client ID and secret in .env.',
        401,
      )
    const body = z
      .object({ access_token: z.string().min(1), expires_in: z.number().positive() })
      .parse(await response.json())
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + Math.max(0, body.expires_in - 60) * 1000,
    }
    return body.access_token
  }

  private async request(url: string, init: RequestInit, signal?: AbortSignal) {
    try {
      return await this.fetcher(url, {
        ...init,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
      })
    } catch (error) {
      if (signal?.aborted) throw error
      const cause = error instanceof Error ? error.cause : undefined
      const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : 'unknown'
      // Log only a transport code: never request headers, credentials, tokens or response bodies.
      console.warn(`[FFLogs] Transport failure: ${code}`)
      const timedOut = error instanceof Error && /TimeoutError|AbortError/.test(error.name)
      throw new FflogsError(
        timedOut
          ? 'FFLogs did not respond within 30 seconds. Retry shortly.'
          : 'Could not connect to FFLogs. Check your connection and retry.',
        timedOut ? 504 : 502,
      )
    }
  }

  async query(query: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.accessToken()
      const response = await this.request(
        API_URL,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables }),
        },
        signal,
      )
      if (response.status === 401 && attempt === 0) {
        this.token = undefined
        continue
      }
      if (response.status === 429) {
        const retry = response.headers.get('retry-after')
        throw new FflogsError(
          `FFLogs rate limit reached.${retry && /^\d+$/.test(retry) ? ` Retry in ${retry} seconds.` : ' Retry later.'}`,
          429,
        )
      }
      if (response.status === 401 || response.status === 403)
        throw new FflogsError(
          'FFLogs denied access. This MVP supports public reports through client credentials; private reports need user OAuth.',
          403,
        )
      if (!response.ok) throw new FflogsError(`FFLogs returned HTTP ${response.status}. Retry shortly.`)
      let body: { data?: unknown; errors?: { message?: string }[] }
      try {
        body = await response.json()
      } catch {
        throw new FflogsError('FFLogs returned an invalid response.')
      }
      if (body.errors?.length) {
        const messages = body.errors.map((e) => e.message ?? '').join('; ')
        if (/rate.?limit|exceeded|too many/i.test(messages))
          throw new FflogsError('FFLogs API quota reached. Retry after the quota resets.', 429)
        if (/private|permission|access|unauth/i.test(messages))
          throw new FflogsError(
            'This report is not accessible with client credentials. Use a public report.',
            403,
          )
        // Even partial GraphQL results are rejected; otherwise missing events look like clean pulls.
        throw new FflogsError(`FFLogs query failed: ${messages.slice(0, 400)}`)
      }
      if (!body.data) throw new FflogsError('FFLogs returned no report data.')
      return body.data
    }
    throw new FflogsError('FFLogs authentication failed.', 401)
  }

  async report(code: string, signal?: AbortSignal): Promise<RawReport> {
    const data = await this.query(REPORT_QUERY, { code }, signal)
    const envelope = z.object({ reportData: z.object({ report: reportSchema.nullable() }) }).parse(data)
    if (!envelope.reportData.report)
      throw new FflogsError('Report not found, private, or still processing.', 404)
    return envelope.reportData.report
  }

  async events(
    code: string,
    pull: Pull,
    dataType: 'Deaths' | 'DamageTaken' | 'DamageDone' | 'Casts',
    filter?: string,
    signal?: AbortSignal,
  ): Promise<RawEvent[]> {
    const events: RawEvent[] = []
    let start = pull.startTime
    for (let page = 0; page < 100; page++) {
      signal?.throwIfAborted()
      const data = await this.query(
        EVENTS_QUERY,
        { code, fightIDs: [pull.id], start, end: pull.endTime, dataType, filter: filter ?? null },
        signal,
      )
      const parsed = z
        .object({ reportData: z.object({ report: z.object({ events: eventPageSchema }).nullable() }) })
        .parse(data)
      if (!parsed.reportData.report)
        throw new FflogsError('Report became unavailable while loading events.', 404)
      const batch = parsed.reportData.report.events
      events.push(...batch.data)
      const next = batch.nextPageTimestamp
      if (next == null) return events
      if (next <= start || next > pull.endTime || !batch.data.length)
        throw new FflogsError('FFLogs returned inconsistent event pagination. No partial analysis was saved.')
      // FFLogs owns the continuation boundary. Adding 1 here would skip events sharing the timestamp.
      start = next
    }
    throw new FflogsError('This pull exceeded the event page limit. No partial analysis was saved.')
  }
}
