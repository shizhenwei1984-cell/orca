import type {
  SessionOutputRate,
  SessionTokenCounts
} from '../../shared/agent-usage/session-token-metrics'
import { readRecord } from '../codex/app-server/codex-item-field-readers'
import {
  resolveCodexUsageDelta,
  type CodexUsageRawUsage
} from '../codex-usage/codex-usage-token-delta'
import { parseClaudeUsageSourceRecord } from '../claude-usage/transcript-record-parser'

export function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

export function sessionOutputRate(
  output: number | null,
  duration: unknown,
  interval: SessionOutputRate['interval']
): SessionOutputRate | null {
  return output !== null &&
    typeof duration === 'number' &&
    Number.isFinite(duration) &&
    duration > 0
    ? { tokensPerSecond: (output * 1000) / duration, interval }
    : null
}

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

export type CodexSessionTokenState = {
  matches: boolean
  counts: SessionTokenCounts | null
  previous: CodexUsageRawUsage | null
  turn: { id: string; output: number | null; excluded: boolean } | null
  outputRate: SessionOutputRate | null
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
    return
  }
  if (!state.matches || row.type !== 'event_msg') {
    return
  }
  if (event.type === 'task_started') {
    state.turn =
      typeof event.turn_id === 'string' &&
      (event.root_turn_id === undefined || event.root_turn_id === event.turn_id)
        ? { id: event.turn_id, output: null, excluded: excludedTurns?.has(event.turn_id) ?? false }
        : null
  } else if (event.type === 'task_complete' || event.type === 'turn_aborted') {
    if (state.turn && state.turn.id === event.turn_id) {
      if (!state.turn.excluded) {
        state.outputRate = sessionOutputRate(state.turn.output, event.duration_ms, 'turn')
      }
      state.turn = null
    }
  } else if (event.type === 'token_count') {
    const info = readRecord(event.info)
    const total = codexUsage(info.total_token_usage)
    const last = codexUsage(info.last_token_usage)
    const usage = resolveCodexUsageDelta(total, last, state.previous)
    if (!usage) {
      return
    }
    state.previous = usage.nextTotals
    if (usage.kind !== 'event' || state.turn?.excluded || (excludedTurns && !state.turn)) {
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
    if (state.turn) {
      state.turn = { ...state.turn, output: (state.turn.output ?? 0) + output }
    }
  }
}

export function readClaudeSessionTokenRecord(
  line: string,
  providerSessionId: string,
  excludedEntries?: ReadonlySet<string>
) {
  const turn = parseClaudeUsageSourceRecord(line, null, {
    rootSessionId: providerSessionId,
    excludedEntries
  })
  if (!turn) {
    return null
  }
  return {
    key: turn.dedupeKey,
    counts: {
      input: turn.inputTokens,
      output: turn.outputTokens,
      cacheRead: turn.cacheReadTokens,
      cacheWrite: turn.cacheWriteTokens
    }
  }
}
