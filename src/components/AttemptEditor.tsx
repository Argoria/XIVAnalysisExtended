import { useState } from 'react'
import type { AttemptClassification, AttemptOverride } from '../../shared/attempts'

export function AttemptEditor({
  classification,
  override,
  onChange,
}: {
  classification: AttemptClassification
  override?: AttemptOverride
  onChange: (value?: AttemptOverride) => void
}) {
  const [reason, setReason] = useState(override?.reason ?? '')
  return (
    <section className="attempt-editor" aria-label="Attempt classification">
      <strong>
        {classification.status === 'scrapped'
          ? 'Scrapped pull'
          : classification.status === 'suspected-reset'
            ? 'Suspected reset'
            : 'Normal attempt'}
      </strong>
      <p>{classification.reason}</p>
      <label>
        Classification reason
        <input
          aria-label="Classification reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why should this pull be included or scrapped?"
          maxLength={500}
        />
      </label>
      <div className="attempt-actions">
        <button
          className="button"
          disabled={!reason.trim()}
          onClick={() => onChange({ status: 'scrapped', reason: reason.trim() })}
        >
          Mark scrapped
        </button>
        <button
          className="button"
          disabled={!reason.trim()}
          onClick={() => onChange({ status: 'normal', reason: reason.trim() })}
        >
          Keep as normal
        </button>
        {override && (
          <button
            className="text-button"
            onClick={() => {
              setReason('')
              onChange()
            }}
          >
            Use automatic classification
          </button>
        )}
      </div>
      <small>Only confirmed scrapped pulls are excluded by default. Suspected resets stay included.</small>
    </section>
  )
}
