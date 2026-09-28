import type { PullAnalysis, PullProgression, Report, XivanalysisPlayerAnalysis } from '../shared/types'

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal })
  const body = await response
    .json()
    .catch(() => ({ error: 'The API is unavailable. Start both servers with npm run dev.' }))
  if (!response.ok || body.error) throw new Error(body.error || `Request failed (${response.status})`)
  return body as T
}
export const api = {
  health: () => get<{ configured: boolean }>('/api/health'),
  report: (code: string, signal?: AbortSignal) => get<Report>(`/api/reports/${code}?refresh=1`, signal),
  progression: (code: string, signal?: AbortSignal) =>
    get<PullProgression>(`/api/reports/${code}/progression`, signal),
  pull: (code: string, id: number, refresh: boolean, signal?: AbortSignal) =>
    get<PullAnalysis>(`/api/reports/${code}/pulls/${id}${refresh ? '?refresh=1' : ''}`, signal),
  xivanalysis: (code: string, pullId: number, actorId: number, refresh = false, signal?: AbortSignal) =>
    get<XivanalysisPlayerAnalysis>(
      `/api/reports/${code}/pulls/${pullId}/players/${actorId}/xivanalysis${refresh ? '?refresh=1' : ''}`,
      signal,
    ),
}
