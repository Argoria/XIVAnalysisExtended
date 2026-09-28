export const duration = (ms: number) =>
  `${Math.floor(Math.max(0, ms) / 60000)}:${String(Math.floor(Math.max(0, ms) / 1000) % 60).padStart(2, '0')}`
export const percent = (n: number | null) => (n == null ? 'Unknown' : `${n.toFixed(1)}%`)
export const fflogsLink = (code: string, fight: number, player?: number, timestamp?: number) => {
  const query = new URLSearchParams({ fight: String(fight), type: 'deaths' })
  if (player != null) query.set('source', String(player))
  if (timestamp != null) {
    query.set('start', String(Math.max(0, timestamp - 5000)))
    query.set('end', String(timestamp + 1000))
  }
  return `https://www.fflogs.com/reports/${code}?${query}`
}
