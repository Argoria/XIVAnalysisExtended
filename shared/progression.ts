import type { ProgressionMarker, Pull, PullProgression } from './types'

export function checkpointKey(marker: ProgressionMarker): string {
  return `${marker.checkpointId}#${marker.occurrence}`
}

export function checkpointLabel(marker: ProgressionMarker): string {
  return `${marker.name} #${marker.occurrence}`
}

/** Selected encounter checkpoints take precedence over incidental later casts. */
export function furthestCheckpoint(markers: ProgressionMarker[]): ProgressionMarker | undefined {
  const checkpoints = markers.filter((marker) => marker.kind === 'checkpoint')
  return (checkpoints.length ? checkpoints : markers).reduce<ProgressionMarker | undefined>(
    (latest, marker) => (!latest || marker.timestamp > latest.timestamp ? marker : latest),
    undefined,
  )
}

/** Exact observed occurrence, not an assumption based on duration or another cast. */
export function reachedCheckpoint(markers: ProgressionMarker[], key: string): boolean {
  return markers.some((marker) => checkpointKey(marker) === key)
}

export interface CheckpointOption {
  key: string
  label: string
  encounterID: number
  difficulty: number | null
  confidence: ProgressionMarker['confidence']
  kind: ProgressionMarker['kind']
  /** Number of selected pulls with actual evidence of this occurrence. */
  reachedPulls: number
  bestBossHpPercent: number | null
  hpMeasuredPulls: number
}

/** Call with the selected encounter/difficulty pulls for a scoped comparison list. */
export function checkpointOptions(pulls: Pull[], progressions: PullProgression): CheckpointOption[] {
  const options = new Map<string, CheckpointOption & { firstElapsed: number }>()
  for (const pull of pulls) {
    const seen = new Set<string>()
    for (const marker of progressions[pull.id] ?? []) {
      const key = checkpointKey(marker)
      const scopedKey = `${pull.encounterID}:${pull.difficulty}:${key}`
      if (seen.has(scopedKey)) continue
      seen.add(scopedKey)
      let option = options.get(scopedKey)
      if (!option) {
        option = {
          key,
          label: checkpointLabel(marker),
          encounterID: pull.encounterID,
          difficulty: pull.difficulty,
          confidence: marker.confidence,
          kind: marker.kind,
          reachedPulls: 0,
          bestBossHpPercent: null,
          hpMeasuredPulls: 0,
          firstElapsed: marker.timestamp - pull.startTime,
        }
        options.set(scopedKey, option)
      }
      option.reachedPulls++
      option.firstElapsed = Math.min(option.firstElapsed, marker.timestamp - pull.startTime)
      if (marker.confidence === 'provisional') option.confidence = 'provisional'
      if (marker.bossHpPercent != null) {
        option.hpMeasuredPulls++
        option.bestBossHpPercent = Math.min(option.bestBossHpPercent ?? Infinity, marker.bossHpPercent)
      }
    }
  }
  return [...options.values()]
    .sort(
      (a, b) =>
        a.encounterID - b.encounterID ||
        (a.difficulty ?? -1) - (b.difficulty ?? -1) ||
        a.firstElapsed - b.firstElapsed,
    )
    .map(({ firstElapsed: _, ...option }) => option)
}
