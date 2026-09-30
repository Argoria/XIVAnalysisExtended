import { createApp } from './app'
import { FflogsClient } from './fflogs/client'
import { hostingConfig } from './hosting'
import { ReportService } from './service'

const client = new FflogsClient(() => ({
  id: process.env.FFLOGS_CLIENT_ID,
  secret: process.env.FFLOGS_CLIENT_SECRET,
}))
const { host, port, access } = hostingConfig(process.env)
const server = createApp(new ReportService(client), access).listen(port, host, () => {
  console.log(`Pullwise listening on ${host}:${port} · FFLogs credentials ${client.configured ? 'configured' : 'missing (demo works)'}`)
})
server.on('error', (error: Error) => {
  console.error(`Could not start Pullwise: ${error.message}`)
  process.exitCode = 1
})
