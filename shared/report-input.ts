export function parseReportInput(input: string): { code: string; fightId?: number | 'last' } {
  const value = input.trim()
  if (/^[A-Za-z0-9]{16}$/.test(value)) return { code: value }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Paste an FFLogs report URL or its 16-character report code.')
  }
  if (
    url.protocol !== 'https:' ||
    !/^(?:www\.|[a-z]{2}\.)?fflogs\.com$/.test(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error('Use an https://www.fflogs.com/reports/… URL.')
  }
  const match = /^\/reports\/([A-Za-z0-9]{16})\/?$/.exec(url.pathname)
  if (!match) throw new Error('This URL does not contain a supported FFLogs report code.')
  const fight = url.searchParams.get('fight') ?? new URLSearchParams(url.hash.slice(1)).get('fight')
  return {
    code: match[1],
    fightId: fight === 'last' ? 'last' : fight && /^[1-9]\d*$/.test(fight) ? Number(fight) : undefined,
  }
}
