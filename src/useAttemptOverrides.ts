import { useEffect, useState } from 'react'
import {
  attemptStorageKey,
  parseAttemptOverrides,
  serializeAttemptOverrides,
  type AttemptOverride,
  type AttemptOverrides,
} from '../shared/attempts'

export function useAttemptOverrides(reportCode: string) {
  const [saved, setSaved] = useState<{ code: string; overrides: AttemptOverrides }>({
    code: '',
    overrides: {},
  })
  const [error, setError] = useState('')
  useEffect(() => {
    try {
      setSaved({
        code: reportCode,
        overrides: parseAttemptOverrides(
          window.localStorage.getItem(attemptStorageKey(reportCode)),
          reportCode,
        ),
      })
      setError('')
    } catch {
      setSaved({ code: reportCode, overrides: {} })
      setError('Saved classifications could not be loaded in this browser.')
    }
  }, [reportCode])
  const overrides = saved.code === reportCode ? saved.overrides : {}
  function update(pullId: number, value?: AttemptOverride) {
    const next = { ...overrides }
    if (value) next[pullId] = value
    else delete next[pullId]
    setSaved({ code: reportCode, overrides: next })
    try {
      window.localStorage.setItem(attemptStorageKey(reportCode), serializeAttemptOverrides(reportCode, next))
      setError('')
    } catch {
      setError('Classification applied for this visit, but could not be saved in this browser.')
    }
  }
  return { overrides, update, error }
}
