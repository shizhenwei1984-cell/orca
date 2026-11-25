import type { SessionTokenCounts } from '../../shared/agent-usage/session-token-metrics'
import { readRecord } from '../codex/app-server/codex-item-field-readers'
import {
  buildCodexUsageEventKey,
  resolveCodexUsageDelta,
  type CodexUsageRawUsage
} from '../codex-usage/codex-usage-token-delta'
import {
  outputMeasurement,
  recordTimestamp,
  tokenCount,
  type OutputMeasurement
} from './session-output-measurement'

export function addSessionTokenCounts(
  left: SessionTokenCounts | null,
  right: SessionTokenCounts
): SessionTokenCounts {
  if (!left) {
    return right
  }
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead:
      left.cacheRead === null || right.cacheRead === null ? null : left.cacheRead + right.cacheRead
  }
}

function codexUsage(value: unknown): CodexUsageRawUsage | null {
  const raw = readRecord(value)
  const input = tokenCount(raw.input_tokens)
  const output = tokenCount(raw.output_tokens)
  const cache = tokenCount(raw.cached_input_tokens ?? raw.cache_read_input_tokens)
  return input === null || output === null
    ? null
    : {
        inputTokens: input,
        outputTokens: output,
        cachedInputTokens: cache ?? 0,
        reasoningOutputTokens: tokenCount(raw.reasoning_output_tokens) ?? 0,
        totalTokens: input + output
      }
}

type CodexTurn = {
  startedAt: number | null
  output: number | null
  closed: boolean
  measurement: OutputMeasurement | null
}

export type CodexSessionTokenState = {
  matches: boolean
  counts: SessionTokenCounts | null
  previous: CodexUsageRawUsage | null
  lastUsage: { at: number; key: string } | null
  turnId: string | null
  turns: Map<string, CodexTurn>
}

export function readCodexSessionTokenRecord(
  state: CodexSessionTokenState,
  line: string,
  providerSessionId: string,
  excludedTurns?: ReadonlySet<string>
): void {
  if (!/"(?:session_meta|task_started|task_complete|turn_aborted|token_count)"/.test(line)) {
    return
  }
  const row = readRecord(JSON.parse(line))
  const event = readRecord(row.payload)
  if (row.type === 'session_meta') {
    state.matches = event.id === providerSessionId
    state.turnId = null
    return
  }
  if (!state.matches || row.type !== 'event_msg') {
    return
  }

  const at = recordTimestamp(row.timestamp)
  const id = typeof event.turn_id === 'string' ? event.turn_id : null
  if (event.type === 'task_started' && id) {
    if (event.root_turn_id !== undefined && event.root_turn_id !== id) {
      return
    }
    if (!state.turns.has(id)) {
      state.turnId = id
      state.turns.set(id, {
        startedAt:
          at ?? (tokenCount(event.started_at) === null ? null : Number(event.started_at) * 1000),
        output: null,
        closed: false,
        measurement: null
      })
    }
  } else if ((event.type === 'task_complete' || event.type === 'turn_aborted') && id) {
    const turn = state.turns.get(id)
    if (turn && !turn.closed) {
      const elapsed = at !== null && turn.startedAt !== null ? at - turn.startedAt : null
      state.turns.set(id, {
        ...turn,
        closed: true,
        measurement:
          outputMeasurement(turn.output, event.duration_ms) ??
          outputMeasurement(turn.output, elapsed) ??
          turn.measurement
      })
      if (state.turnId === id) {
        state.turnId = null
      }
    }
  } else if (event.type === 'token_count') {
    readCodexTokenCount(state, event, at, id, excludedTurns)
  }
}

function readCodexTokenCount(
  state: CodexSessionTokenState,
  event: Record<string, unknown>,
  at: number | null,
  id: string | null,
  excludedTurns?: ReadonlySet<string>
): void {
  const info = readRecord(event.info)
  const total = codexUsage(info.total_token_usage)
  const last = codexUsage(info.last_token_usage)
  const usage = resolveCodexUsageDelta(total, last, state.previous)
  if (!usage) {
    return
  }
  if (at !== null) {
    const key = buildCodexUsageEventKey(String(at), total, last)
    if (state.lastUsage && (at < state.lastUsage.at || key === state.lastUsage.key)) {
      return
    }
    state.lastUsage = { at, key }
  }
  state.previous = usage.nextTotals
  const turnId = id ?? state.turnId
  if (usage.kind !== 'event' || (excludedTurns && (!turnId || excludedTurns.has(turnId)))) {
    return
  }
  const raw = readRecord(last ? info.last_token_usage : info.total_token_usage)
  const hasCache = tokenCount(raw.cached_input_tokens ?? raw.cache_read_input_tokens) !== null
  const { inputTokens: input, outputTokens: output, cachedInputTokens } = usage.delta
  state.counts = addSessionTokenCounts(state.counts, {
    input,
    output,
    cacheRead: hasCache && cachedInputTokens <= input ? cachedInputTokens : null
  })
  const turn = turnId ? state.turns.get(turnId) : undefined
  if (
    turnId &&
    turn &&
    !turn.closed &&
    (at === null || turn.startedAt === null || at >= turn.startedAt)
  ) {
    const turnOutput = (turn.output ?? 0) + output
    const measured =
      at !== null && turn.startedAt !== null
        ? outputMeasurement(turnOutput, at - turn.startedAt)
        : null
    state.turns.set(turnId, {
      ...turn,
      output: turnOutput,
      measurement: measured ?? turn.measurement
    })
  }
}
