import type { SessionOutputRate } from '../../../../shared/agent-usage/session-token-metrics'
import { sessionOutputRate, tokenCount } from '../../../native-chat/session-token-records'
import { claudeRecord } from '../journal/claude-structured-item-translation'
import { isRootClaudeFrame } from './claude-turn-opening'

const latestRates = new Map<string, SessionOutputRate | null>()
const MAX_RECENT_SESSIONS = 128

export function readClaudeSessionOutputRate(sessionId: string): SessionOutputRate | null {
  return latestRates.get(sessionId) ?? null
}

function cumulativeModelOutput(value: unknown): number | null {
  const models = Object.values(claudeRecord(value) ?? {})
  let total = 0
  for (const model of models) {
    const count = tokenCount(claudeRecord(model)?.outputTokens)
    if (count === null) {
      return null
    }
    total += count
  }
  return models.length ? total : null
}

export function createClaudeSessionOutputObserver() {
  let apiBaseline: number | null = 0
  let outputBaseline: number | null = 0
  let lastResultId: unknown
  return (sessionId: string, message: Record<string, unknown>): void => {
    if (message.type !== 'result' || !isRootClaudeFrame(message)) {
      return
    }
    if (typeof message.uuid === 'string' && message.uuid === lastResultId) {
      return
    }
    lastResultId = message.uuid
    const output = tokenCount(claudeRecord(message.usage)?.output_tokens)
    const api = tokenCount(message.duration_api_ms)
    const cumulativeOutput = cumulativeModelOutput(message.modelUsage)
    // These two SDK counters accumulate across results on the connection.
    const apiInterval =
      api !== null &&
      apiBaseline !== null &&
      output !== null &&
      cumulativeOutput !== null &&
      outputBaseline !== null &&
      cumulativeOutput - outputBaseline === output
        ? api - apiBaseline
        : null
    apiBaseline = api
    outputBaseline = cumulativeOutput
    const rate =
      sessionOutputRate(output, apiInterval, 'api') ??
      sessionOutputRate(output, message.duration_ms, 'turn')
    latestRates.delete(sessionId)
    latestRates.set(sessionId, rate)
    if (latestRates.size > MAX_RECENT_SESSIONS) {
      const oldest = latestRates.keys().next().value
      if (oldest !== undefined) {
        latestRates.delete(oldest)
      }
    }
  }
}
