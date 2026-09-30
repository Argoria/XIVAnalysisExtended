import { createHash, timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'

export interface AccessCredentials {
  user: string
  password: string
}

export function hostingConfig(env: NodeJS.ProcessEnv) {
  const host = env.HOST || '127.0.0.1'
  const port = Number(env.PORT || 3001)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.')
  const user = env.APP_ACCESS_USER || ''
  const password = env.APP_ACCESS_PASSWORD || ''
  if (!!user !== !!password || user.includes(':')) {
    throw new Error('Set both APP_ACCESS_USER and APP_ACCESS_PASSWORD; the user must not contain a colon.')
  }
  if (!['127.0.0.1', '::1', 'localhost'].includes(host) && !password) {
    throw new Error('Public hosting requires APP_ACCESS_USER and APP_ACCESS_PASSWORD.')
  }
  return { host, port, access: password ? { user, password } : undefined }
}

export function accessGate(access?: AccessCredentials): RequestHandler {
  const digest = (value: string) => createHash('sha256').update(value).digest()
  const expected = access ? digest(access.user + ':' + access.password) : null
  return (req, res, next) => {
    if (!expected) return next()
    res.setHeader('Cache-Control', 'no-store')
    const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(req.headers.authorization || '')
    const supplied = match ? Buffer.from(match[1], 'base64').toString('utf8') : ''
    if (match && timingSafeEqual(expected, digest(supplied))) return next()
    res.setHeader('WWW-Authenticate', 'Basic realm="Pullwise dev", charset="UTF-8"')
    res.status(401).json({ error: 'Authentication required.' })
  }
}
