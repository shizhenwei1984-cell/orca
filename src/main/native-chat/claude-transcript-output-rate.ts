import { readClaudeOutputEvidence } from '../claude/structured/turns/claude-session-output-rate'
import { readRecord } from '../codex/app-server/codex-item-field-readers'
import { isClaudeTranscriptRootPrompt } from '../claude/transcripts/claude-transcript-root-prompt'
import {
  outputMeasurement,
  recordTimestamp,
  tokenCount,
  type OutputMeasurement
} from './session-output-measurement'

type ClaudeTurn = {
  startedAt: number | null
  observedAt: number | null
  output: number | null
  durationMs: number | null
}

export type ClaudeTranscriptOutput = {
  active: string | null
  turns: Map<string, ClaudeTurn>
  owners: Map<string, string>
  requests: Map<string, number>
}

export function readClaudeTranscriptOutput(
  state: ClaudeTranscriptOutput,
  row: Record<string, unknown>,
  excludedEntries?: ReadonlySet<string>
): void {
  const id = typeof row.uuid === 'string' ? row.uuid : null
  if (!id || state.owners.has(id)) {
    return
  }
  const at = recordTimestamp(row.timestamp)
  const parent = typeof row.parentUuid === 'string' ? state.owners.get(row.parentUuid) : undefined
  const prompt = typeof row.promptId === 'string' ? `prompt:${row.promptId}` : null
  const promptOwner = prompt ? state.owners.get(prompt) : undefined
  if (excludedEntries?.has(id)) {
    state.active = null
    return
  }
  if (isClaudeTranscriptRootPrompt(row)) {
    const owner = promptOwner ?? openTurn(state, id, at)
    state.owners.set(id, owner)
    if (prompt) {
      state.owners.set(prompt, owner)
    }
  } else if (row.type === 'assistant') {
    const message = readRecord(row.message)
    const output = tokenCount(readRecord(message.usage).output_tokens)
    if (output === null) {
      return
    }
    const messageId = typeof message.id === 'string' ? `msg:${message.id}` : id
    const owner =
      state.owners.get(messageId) ??
      promptOwner ??
      parent ??
      state.active ??
      openTurn(state, id, null)
    state.owners.set(id, owner)
    state.owners.set(messageId, owner)
    const turn = state.turns.get(owner)!
    const old = state.requests.get(messageId)
    if (old === undefined || output > old) {
      state.requests.set(messageId, output)
      state.turns.set(owner, {
        ...turn,
        output: (turn.output ?? 0) + output - (old ?? 0),
        observedAt: at === null ? turn.observedAt : Math.max(at, turn.observedAt ?? at)
      })
    }
  } else if (row.type === 'system' && row.subtype === 'turn_duration') {
    const owner = parent ?? state.active
    if (owner) {
      const turn = state.turns.get(owner)!
      state.owners.set(id, owner)
      if (turn.durationMs === null) {
        state.turns.set(owner, { ...turn, durationMs: tokenCount(row.durationMs) })
      }
      if (owner === state.active) {
        state.active = null
      }
    }
  } else {
    const owner = promptOwner ?? parent ?? state.active
    if (owner) {
      state.owners.set(id, owner)
    }
  }
}

function openTurn(state: ClaudeTranscriptOutput, id: string, startedAt: number | null): string {
  state.active = id
  state.turns.set(id, {
    startedAt,
    observedAt: null,
    output: null,
    durationMs: null
  })
  return id
}

function claudeTranscriptMeasurement(turn: ClaudeTurn): OutputMeasurement | null {
  const elapsed =
    turn.startedAt !== null && turn.observedAt !== null ? turn.observedAt - turn.startedAt : null
  return outputMeasurement(turn.output, turn.durationMs) ?? outputMeasurement(turn.output, elapsed)
}

export function* measuredClaudeTurns(
  providerSessionId: string,
  transcript: ClaudeTranscriptOutput | undefined,
  copiedEntries: ReadonlySet<string> | undefined
): Iterable<OutputMeasurement> {
  const evidence = readClaudeOutputEvidence(providerSessionId)
  const claimed = new Set<string>()
  const samples = [
    ...(evidence?.results.values() ?? []),
    ...(evidence?.live ? [evidence.live] : [])
  ]
  for (const sample of samples) {
    if (sample.anchors.some((id) => copiedEntries?.has(id) || claimed.has(id))) {
      continue
    }
    const owners = sample.anchors.flatMap((id) => {
      const owner = transcript?.owners.get(id)
      return owner ? [owner] : []
    })
    if (
      owners.some((id) => claimed.has(id)) ||
      (sample === evidence?.live && owners.some((id) => transcript?.turns.get(id)?.durationMs))
    ) {
      continue
    }
    for (const id of [...sample.anchors, ...owners]) {
      claimed.add(id)
    }
    yield sample.measurement
  }
  for (const [id, turn] of transcript?.turns ?? []) {
    const measurement = claudeTranscriptMeasurement(turn)
    if (measurement && !claimed.has(id)) {
      yield measurement
    }
  }
}
