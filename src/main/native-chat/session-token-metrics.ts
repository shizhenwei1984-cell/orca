import {
  antigravityMeasuredOutput,
  recordAntigravityStep
} from '../antigravity/antigravity-token-metrics'
import type {
  SessionOutputRate,
  SessionTokenCounts,
  SessionTokenMetrics
} from '../../shared/agent-usage/session-token-metrics'
import { isWslUncPath } from '../../shared/file-access/wsl-paths'
import {
  InFlightPromiseDedupe,
  stableInFlightKey
} from '../../shared/concurrency/in-flight-promise-dedupe'
import {
  buildJsonlFileCheckpoint,
  openJsonlFileReader,
  resolveJsonlFileCheckpoint,
  validateJsonlFileReader,
  type JsonlFileCheckpoint
} from '../usage/source-input/jsonl/jsonl-file-checkpoint'
import { readJsonlLinesFromOffset } from '../usage/source-input/jsonl/jsonl-line-offsets'
import {
  sameJsonlFileSnapshot,
  type JsonlFileSnapshot
} from '../usage/source-input/jsonl/jsonl-file-snapshot'
import { parseClaudeUsageSourceRecord } from '../claude-usage/transcript-record-parser'
import { readRecord } from '../codex/app-server/codex-item-field-readers'
import {
  measuredClaudeTurns,
  readClaudeTranscriptOutput,
  type ClaudeTranscriptOutput
} from './claude-transcript-output-rate'
import type { OutputMeasurement } from './session-output-measurement'
import { resolveSessionFilePath, type ResolveSessionFileOptions } from './session-file-resolver'
import { parseSshTranscriptPath } from './transcript-filesystem/ssh-transcript-path'
import {
  addSessionTokenCounts,
  addClaudeRecord,
  type ClaudeCounts,
  readCodexSessionTokenRecord,
  type CodexSessionTokenState
} from './session-token-records'

type Source = Pick<SessionTokenMetrics, 'agent' | 'providerSessionId'> & {
  location: ResolveSessionFileOptions
  copiedEntries?: ReadonlySet<string>
}
type TokenState = {
  antigravity: { counts: SessionTokenCounts | null; steps: Map<number, SessionTokenCounts | null> }
  codex: CodexSessionTokenState
  claude: {
    counts: SessionTokenCounts | null
    requests: Map<string, ClaudeCounts>
    output: ClaudeTranscriptOutput
  }
}
type CachedSource = {
  path: string
  stats: JsonlFileSnapshot
  checkpoint: JsonlFileCheckpoint | null
  state: TokenState
}

const cache = new Map<string, CachedSource>()
const pending = new InFlightPromiseDedupe<CachedSource | null>()
const lastRates = new Map<string, { rate: SessionOutputRate; hadTranscript: boolean }>()

function freshState(): TokenState {
  return {
    antigravity: { counts: null, steps: new Map() },
    codex: {
      matches: false,
      previous: null,
      counts: null,
      lastUsage: null,
      turnId: null,
      turns: new Map()
    },
    claude: {
      counts: null,
      requests: new Map(),
      output: { active: null, turns: new Map(), owners: new Map(), requests: new Map() }
    }
  }
}

async function readSource(
  source: Source,
  retained: CachedSource | undefined
): Promise<CachedSource | null> {
  const { agent, providerSessionId, location } = source
  const resolvePath = () =>
    agent === 'antigravity'
      ? location.transcriptPath
      : resolveSessionFilePath(agent, providerSessionId, location)
  const path = retained?.path ?? (await resolvePath())
  if (!path || isWslUncPath(path) || parseSshTranscriptPath(path)) {
    return null
  }
  const reader = await openJsonlFileReader(path).catch(async (error: unknown) => {
    if (!retained) {
      throw error
    }
    const nextPath = await resolvePath()
    if (
      !nextPath ||
      nextPath === path ||
      isWslUncPath(nextPath) ||
      parseSshTranscriptPath(nextPath)
    ) {
      throw error
    }
    return openJsonlFileReader(nextPath)
  })
  try {
    if (retained?.path === reader.path && sameJsonlFileSnapshot(retained.stats, reader.stats)) {
      return retained
    }
    const checkpoint =
      retained?.path === reader.path && reader.stats.size > retained.stats.size
        ? await resolveJsonlFileCheckpoint(reader.path, retained.checkpoint, reader)
        : null
    const original = checkpoint && retained ? retained.state : freshState()
    const output = original.claude.output
    const state: TokenState = {
      antigravity: { ...original.antigravity, steps: new Map(original.antigravity.steps) },
      codex: { ...original.codex, turns: new Map(original.codex.turns) },
      claude: {
        ...original.claude,
        output: {
          ...output,
          turns: new Map(output.turns),
          owners: new Map(output.owners),
          requests: new Map(output.requests)
        }
      }
    }
    const claudeSeen = new Map<string, ClaudeCounts>()
    let endOffset = checkpoint?.parsedBytes ?? 0
    for await (const row of readJsonlLinesFromOffset(reader.path, endOffset, reader)) {
      if (!row.terminated) {
        break
      }
      endOffset = row.endOffset
      try {
        if (agent === 'codex') {
          readCodexSessionTokenRecord(
            state.codex,
            row.line,
            providerSessionId,
            source.copiedEntries
          )
        } else if (agent === 'antigravity') {
          recordAntigravityStep(state.antigravity.steps, readRecord(JSON.parse(row.line)))
        } else {
          const usage = parseClaudeUsageSourceRecord(row.line, null, {
            rootSessionId: providerSessionId,
            excludedEntries: source.copiedEntries
          })
          if (usage) {
            addClaudeRecord(state.claude, claudeSeen, usage)
          }
          if (/"(?:assistant|user|system|attachment)"/.test(row.line)) {
            const entry = readRecord(JSON.parse(row.line))
            if (
              entry.sessionId === providerSessionId &&
              entry.isSidechain !== true &&
              entry.agentId == null &&
              entry.parent_tool_use_id == null
            ) {
              readClaudeTranscriptOutput(state.claude.output, entry, source.copiedEntries)
            }
          }
        }
      } catch (error) {
        if (!(error instanceof SyntaxError)) {
          throw error
        }
      }
    }
    const nextCheckpoint = await buildJsonlFileCheckpoint(
      reader.path,
      endOffset,
      checkpoint?.headDigest,
      reader
    )
    if (!(await validateJsonlFileReader(reader, checkpoint))) {
      return null
    }
    if (agent === 'antigravity') {
      state.antigravity.counts = null
      for (const counts of state.antigravity.steps.values()) {
        if (!counts) {
          state.antigravity.counts = null
          break
        }
        state.antigravity.counts = addSessionTokenCounts(state.antigravity.counts, counts)
      }
    }
    for (const [id, usage] of claudeSeen) {
      state.claude.requests.set(id, usage)
    }
    return { path: reader.path, stats: reader.stats, checkpoint: nextCheckpoint, state }
  } finally {
    await reader.handle.close()
  }
}

function* measuredTurns(
  source: Source,
  state: TokenState | undefined
): Iterable<OutputMeasurement> {
  const { agent, providerSessionId, copiedEntries } = source
  if (agent === 'codex') {
    for (const [id, turn] of state?.codex.turns ?? []) {
      if (turn.measurement && !copiedEntries?.has(id)) {
        yield turn.measurement
      }
    }
    return
  }

  if (agent === 'antigravity') {
    const measurement = antigravityMeasuredOutput(providerSessionId)
    if (measurement) {
      yield measurement
    }
    return
  }
  yield* measuredClaudeTurns(providerSessionId, state?.claude.output, copiedEntries)
}

function latestRate(
  key: string,
  source: Source,
  state: TokenState | undefined
): SessionOutputRate | null {
  const previous = lastRates.get(key)
  if (!state && previous?.hadTranscript) {
    return previous.rate
  }
  let output = 0
  let durationMs = 0
  for (const turn of measuredTurns(source, state)) {
    output += turn.output
    durationMs += turn.durationMs
  }
  if (!durationMs) {
    return previous?.rate ?? null
  }
  const rate: SessionOutputRate = {
    tokensPerSecond: (output * 1000) / durationMs,
    interval: 'session'
  }
  lastRates.delete(key)
  lastRates.set(key, { rate, hadTranscript: state !== undefined })
  if (lastRates.size > 128) {
    const oldest = lastRates.keys().next().value
    if (oldest !== undefined) {
      lastRates.delete(oldest)
    }
  }
  return rate
}

export async function readSessionTokenMetrics(source: Source): Promise<SessionTokenMetrics> {
  const { agent, providerSessionId } = source
  const key = stableInFlightKey([
    agent,
    providerSessionId,
    source.location,
    source.copiedEntries && Array.from(source.copiedEntries).sort()
  ])
  const result = await pending.run(key, async () => {
    const retained = cache.get(key)
    const value = await readSource(source, retained).catch(() => null)
    if (value) {
      cache.delete(key)
      cache.set(key, value)
    }
    if (cache.size > 4) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) {
        cache.delete(oldest)
      }
    }
    return value
  })
  return {
    agent,
    providerSessionId,
    counts: result?.state[agent].counts ?? null,
    outputRate: latestRate(key, source, (result ?? cache.get(key))?.state)
  }
}
