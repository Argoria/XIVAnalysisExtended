import express from 'express'
import { resolve } from 'node:path'
import { z, ZodError } from 'zod'
import { parseReportInput } from '../shared/report-input'
import { FflogsError } from './fflogs/client'
import type { ReportService } from './service'
import { XivanalysisRunnerError } from './xivanalysis/runner'

export function createApp(service: ReportService) {
  const app = express()
  app.disable('x-powered-by')
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })
  app.get('/api/health', (_req, res) =>
    res.json({ configured: service.client.configured, analysisEngine: 'fflogs-deaths' }),
  )
  app.get('/api/reports/:code', async (req, res) => {
    const code = parseReportInput(req.params.code).code
    const controller = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) controller.abort()
    })
    const { report } = await service.report(code, req.query.refresh === '1', controller.signal)
    res.json(report)
  })
  app.get('/api/reports/:code/pulls/:id', async (req, res) => {
    const code = parseReportInput(req.params.code).code
    const parsedId = z.coerce.number().int().positive().safeParse(req.params.id)
    if (!parsedId.success) throw new FflogsError('Pull ID must be a positive integer.', 400)
    const id = parsedId.data
    const controller = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) controller.abort()
    })
    res.json(await service.pull(code, id, req.query.refresh === '1', controller.signal))
  })
  app.get('/api/reports/:code/pulls/:id/players/:actorId/xivanalysis', async (req, res) => {
    const code = parseReportInput(req.params.code).code
    const pullId = z.coerce.number().int().positive().safeParse(req.params.id)
    const actorId = z.coerce.number().int().positive().safeParse(req.params.actorId)
    if (!pullId.success || !actorId.success)
      throw new FflogsError('Pull ID and player actor ID must be positive integers.', 400)

    const controller = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) controller.abort()
    })
    res.json(
      await service.xivanalysis(
        code,
        pullId.data,
        actorId.data,
        req.query.refresh === '1',
        controller.signal,
      ),
    )
  })

  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }))
  app.use(express.static(resolve('dist')))
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')))
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.destroyed) return
    if (error instanceof FflogsError || error instanceof XivanalysisRunnerError) {
      res.status(error.status).json({ error: error.message })
      return
    }
    if (error instanceof ZodError) {
      res.status(502).json({ error: 'The request or FFLogs response has an unexpected format.' })
      return
    }
    const message = error instanceof Error ? error.message : ''
    if (/report URL|report code|Use an https/.test(message)) {
      res.status(400).json({ error: message })
      return
    }
    res.status(500).json({ error: 'Unable to analyze this report. Retry or check the server configuration.' })
  })
  return app
}
