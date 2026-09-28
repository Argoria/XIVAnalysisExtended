import { createApp } from './app'
import { FflogsClient } from './fflogs/client'
import { ReportService } from './service'

const client = new FflogsClient(() => ({
  id: process.env.FFLOGS_CLIENT_ID,
  secret: process.env.FFLOGS_CLIENT_SECRET,
}))
const port = Number(process.env.PORT || 3001)
createApp(new ReportService(client)).listen(port, '127.0.0.1', (error?: Error) => {
  if (error) {
    console.error(`Could not start the local server on port ${port}: ${error.message}`)
    process.exitCode = 1
    return
  }
  console.log(
    `Pullwise API: http://127.0.0.1:${port} · FFLogs credentials ${client.configured ? 'configured' : 'missing (demo works)'}`,
  )
})
