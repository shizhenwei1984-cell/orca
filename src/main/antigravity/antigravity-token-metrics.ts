import { BoundedMap } from '../../shared/collections/bounded-map'
import type { SessionTokenCounts } from '../../shared/agent-usage/session-token-metrics'
import {
  outputMeasurement,
  tokenCount,
  type OutputMeasurement
} from '../native-chat/session-output-measurement'

const measuredPrompts = new BoundedMap<string, OutputMeasurement>({ maxEntries: 128 })

export function recordAntigravityPromptOutput(
  sessionId: string,
  output: number,
  durationMs: number
): void {
  const sample = outputMeasurement(output, durationMs)
  if (sample) {
    const previous = measuredPrompts.get(sessionId)
    measuredPrompts.set(sessionId, {
      output: (previous?.output ?? 0) + sample.output,
      durationMs: (previous?.durationMs ?? 0) + sample.durationMs
    })
  }
}

export function antigravityMeasuredOutput(sessionId: string): OutputMeasurement | undefined {
  return measuredPrompts.get(sessionId)
}

export function recordAntigravityStep(
  steps: Map<number, SessionTokenCounts | null>,
  row: Record<string, unknown>
): void {
  const step = tokenCount(row.step_index)
  if (
    step === null ||
    !(
      (row.source === 'MODEL' && row.type === 'PLANNER_RESPONSE') ||
      (row.source === 'SYSTEM' && row.type === 'CHECKPOINT')
    )
  ) {
    return
  }
  const input = tokenCount(row.input_tokens)
  const output = tokenCount(row.output_tokens)
  const cacheRead = tokenCount(row.cache_read_tokens)
  // agy's input_tokens excludes cache reads; without both counts the total is unknown.
  steps.set(
    step,
    input !== null && output !== null && cacheRead !== null
      ? { input: input + cacheRead, output, cacheRead }
      : null
  )
}
