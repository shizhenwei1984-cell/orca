import {
  outputMeasurement,
  tokenCount,
  type OutputMeasurement
} from '../../../native-chat/session-output-measurement'
import { claudeRecord } from '../journal/claude-structured-item-translation'
import { isRootClaudeFrame } from './claude-turn-opening'

type ClaudeOutputSample = {
  anchors: readonly string[]
  measurement: OutputMeasurement
}
type ClaudeOutputEvidence = {
  results: Map<string, ClaudeOutputSample>
  live: ClaudeOutputSample | null
}
type LiveTurn = {
  startedAt: number | null
  prompt: string | null
  messageId: string | null
  messages: Map<string, number>
  output: number | null
}

const evidence = new Map<string, ClaudeOutputEvidence>()
const MAX_RECENT_SESSIONS = 128

export function readClaudeOutputEvidence(sessionId: string): ClaudeOutputEvidence | undefined {
  return evidence.get(sessionId)
}

export function createClaudeSessionOutputObserver() {
  let active: LiveTurn | null = null
  const streamFrames = new Set<string>()

  return (input: {
    sessionId: string
    message: Record<string, unknown>
    leafUuid: string | null
    startsTurn: boolean
    observedAt: number
  }): void => {
    const { sessionId, message, leafUuid, startsTurn, observedAt } = input
    if (!isRootClaudeFrame(message)) {
      return
    }
    const uuid = typeof message.uuid === 'string' ? message.uuid : null
    if (startsTurn && message.type === 'user' && uuid && uuid !== active?.prompt) {
      active = openTurn(uuid, observedAt)
    } else if (message.type === 'result') {
      if (!uuid || evidence.get(sessionId)?.results.has(uuid)) {
        return
      }
      const prompts = resultPrompts(message)
      const matchedTurn =
        active &&
        (prompts.length === 0 || active.prompt === null || prompts.includes(active.prompt))
          ? active
          : null
      const anchors = [
        ...prompts,
        ...(matchedTurn ? turnAnchors(matchedTurn) : []),
        ...(leafUuid && matchedTurn ? [leafUuid] : [])
      ]
      const measurement = outputMeasurement(
        tokenCount(claudeRecord(message.usage)?.output_tokens),
        message.duration_ms
      )
      if (measurement && anchors.length > 0 && (matchedTurn || prompts.length > 0)) {
        retainEvidence(sessionId).results.set(uuid, { anchors, measurement })
      }
      if (matchedTurn) {
        const retained = evidence.get(sessionId)
        if (retained && measurement) {
          retained.live = null
        }
        active = null
      }
    } else if (message.type === 'stream_event') {
      const event = claudeRecord(message.event)
      if (!event || (uuid && streamFrames.has(uuid))) {
        return
      }
      if (event.type === 'message_start') {
        active ??= openTurn(null, null)
        const start = claudeRecord(event.message)
        const id = typeof start?.id === 'string' ? start.id : null
        if (!id || active.messages.has(id)) {
          return
        }
        active.messageId = id
        const output = tokenCount(claudeRecord(start?.usage)?.output_tokens)
        updateLiveOutput(sessionId, active, output, observedAt)
      } else if (event.type === 'message_delta' && active?.messageId) {
        const output = tokenCount(claudeRecord(event.usage)?.output_tokens)
        updateLiveOutput(sessionId, active, output, observedAt)
      } else if (event.type === 'message_stop' && active) {
        active.messageId = null
      } else {
        return
      }
      if (uuid) {
        streamFrames.add(uuid)
      }
    }
  }
}

function resultPrompts(message: Record<string, unknown>): string[] {
  const uuids = Array.isArray(message.user_message_uuids) ? message.user_message_uuids : []
  return [message.user_message_uuid, ...uuids].filter(
    (id): id is string => typeof id === 'string' && id.length > 0
  )
}

function openTurn(prompt: string | null, startedAt: number | null): LiveTurn {
  return { prompt, startedAt, messageId: null, messages: new Map(), output: null }
}

function turnAnchors(turn: LiveTurn): string[] {
  return [
    ...(turn.prompt ? [turn.prompt] : []),
    ...Array.from(turn.messages.keys(), (id) => `msg:${id}`)
  ]
}

function updateLiveOutput(
  sessionId: string,
  turn: LiveTurn,
  output: number | null,
  observedAt: number
): void {
  const id = turn.messageId
  if (!id || output === null) {
    return
  }
  const old = turn.messages.get(id)
  if (old !== undefined && output <= old) {
    return
  }
  turn.messages.set(id, output)
  turn.output = (turn.output ?? 0) + output - (old ?? 0)
  const measurement = outputMeasurement(
    turn.output,
    turn.startedAt === null ? null : observedAt - turn.startedAt
  )
  if (measurement) {
    retainEvidence(sessionId).live = { anchors: turnAnchors(turn), measurement }
  }
}

function retainEvidence(sessionId: string): ClaudeOutputEvidence {
  const retained = evidence.get(sessionId) ?? { results: new Map(), live: null }
  evidence.delete(sessionId)
  evidence.set(sessionId, retained)
  if (evidence.size > MAX_RECENT_SESSIONS) {
    const oldest = evidence.keys().next().value
    if (oldest !== undefined) {
      evidence.delete(oldest)
    }
  }
  return retained
}
