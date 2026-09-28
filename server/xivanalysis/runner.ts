import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import type { XivanalysisPlayerAnalysis } from '../../shared/types'
import type { XivanalysisCompatInput } from './v2-adapter'

export const XIVA_ENGINE_REVISION = 'f532855e635bdfb4211cec8128d582dadfdc6a75'

export type XivanalysisEngineResult = XivanalysisPlayerAnalysis

export interface XivanalysisEngineRunner {
  analyze(
    input: XivanalysisCompatInput,
    actorId: string,
    signal?: AbortSignal,
  ): Promise<XivanalysisEngineResult>
}

export class XivanalysisRunnerError extends Error {
  constructor(
    message: string,
    public status = 503,
  ) {
    super(message)
  }
}

export class IsolatedXivanalysisRunner implements XivanalysisEngineRunner {
  private readonly runnerPath = resolve('analysis-runner/runner.cjs')
  private readonly vendorParser = resolve('vendor/xivanalysis/src/parser/core/Parser.tsx')
  private readonly vendorBabel = resolve('vendor/xivanalysis/node_modules/@babel/register')

  get available() {
    return existsSync(this.runnerPath) && existsSync(this.vendorParser) && existsSync(this.vendorBabel)
  }

  async analyze(
    input: XivanalysisCompatInput,
    actorId: string,
    signal?: AbortSignal,
  ): Promise<XivanalysisEngineResult> {
    if (!this.available) {
      throw new XivanalysisRunnerError(
        'xivanalysis runner is not installed. Run npm run analysis:setup before requesting deep analysis.',
      )
    }

    return await new Promise<XivanalysisEngineResult>((resolveResult, reject) => {
      const child = spawn(process.execPath, [this.runnerPath], {
        cwd: process.cwd(),
        env: { ...process.env, XIVA_ENGINE_REVISION },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      let settled = false

      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        fn()
      }
      const onAbort = () => {
        child.kill('SIGTERM')
        finish(() => reject(signal?.reason ?? new Error('xivanalysis analysis aborted')))
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
        if (stdout.length > 2_000_000) {
          child.kill('SIGTERM')
          finish(() =>
            reject(new XivanalysisRunnerError('xivanalysis runner returned too much output.', 502)),
          )
        }
      })
      child.stderr.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-20_000)
      })
      child.on('error', (error) => finish(() => reject(error)))
      child.on('close', (code) => {
        if (settled) return
        if (code !== 0) {
          let detail = stderr.trim()
          try {
            const parsed = JSON.parse(detail.split('\n').at(-1) ?? '{}')
            detail = parsed.error || detail
          } catch {
            // Keep the bounded stderr text.
          }
          finish(() =>
            reject(
              new XivanalysisRunnerError(
                detail
                  ? `xivanalysis runner failed: ${detail}`
                  : `xivanalysis runner exited with code ${code}.`,
                502,
              ),
            ),
          )
          return
        }
        try {
          const parsed = JSON.parse(stdout) as XivanalysisEngineResult
          finish(() => resolveResult(parsed))
        } catch {
          finish(() => reject(new XivanalysisRunnerError('xivanalysis runner returned invalid JSON.', 502)))
        }
      })

      child.stdin.end(JSON.stringify({ input, actorId }))
    })
  }
}
