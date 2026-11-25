import type {
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
import { readClaudeSessionOutputRate } from '../claude/structured/turns/claude-session-output-rate'
import { resolveSessionFilePath, type ResolveSessionFileOptions } from './session-file-resolver'
import { parseSshTranscriptPath } from './transcript-filesystem/ssh-transcript-path'
import {
  addSessionTokenCounts,
  readClaudeSessionTokenRecord,
  readCodexSessionTokenRecord,
  type CodexSessionTokenState
} from './session-token-records'

type Source = Pick<SessionTokenMetrics, 'agent' | 'providerSessionId'> & {
  location: ResolveSessionFileOptions
  copiedEntries?: ReadonlySet<string>
}
type ClaudeRecord = NonNullable<ReturnType<typeof readClaudeSessionTokenRecord>>
type ClaudeCounts = ClaudeRecord['counts']
type TokenState = {
  codex: CodexSessionTokenState
  claude: { counts: SessionTokenCounts | null; requests: Map<string, ClaudeCounts> }
}
type CachedSource = {
  path: string
  stats: JsonlFileSnapshot
  checkpoint: JsonlFileCheckpoint | null
  state: TokenState
}

const cache = new Map<string, CachedSource>()
const pending = new InFlightPromiseDedupe<CachedSource | null>()

function freshState(): TokenState {
  return {
    codex: { matches: false, previous: null, counts: null, turn: null, outputRate: null },
    claude: { counts: null, requests: new Map() }
  }
}

function addClaudeRecord(
  state: TokenState['claude'],
  seen: Map<string, ClaudeCounts>,
  { key, counts }: ClaudeRecord
): void {
  const old = key ? (seen.get(key) ?? state.requests.get(key)) : undefined
  const maxima = old
    ? {
        input: Math.max(old.input, counts.input),
        output: Math.max(old.output, counts.output),
        cacheRead: Math.max(old.cacheRead, counts.cacheRead),
        cacheWrite: Math.max(old.cacheWrite, counts.cacheWrite)
      }
    : counts
  if (key) {
    seen.set(key, maxima)
  }
  state.counts = addSessionTokenCounts(state.counts, {
    input:
      maxima.input +
      maxima.cacheRead +
      maxima.cacheWrite -
      (old ? old.input + old.cacheRead + old.cacheWrite : 0),
    output: maxima.output - (old?.output ?? 0),
    cacheRead: maxima.cacheRead - (old?.cacheRead ?? 0)
  })
}

async function readSource(
  source: Source,
  retained: CachedSource | undefined
): Promise<CachedSource | null> {
  const { agent, providerSessionId, location } = source
  const path = retained?.path ?? (await resolveSessionFilePath(agent, providerSessionId, location))
  if (!path || isWslUncPath(path) || parseSshTranscriptPath(path)) {
    return null
  }
  const reader = await openJsonlFileReader(path)
  try {
    if (retained && sameJsonlFileSnapshot(retained.stats, reader.stats)) {
      return retained
    }
    const checkpoint = await resolveJsonlFileCheckpoint(path, retained?.checkpoint, reader)
    const original = checkpoint && retained ? retained.state : freshState()
    const state = { codex: { ...original.codex }, claude: { ...original.claude } }
    const claudeSeen = new Map<string, ClaudeCounts>()
    let endOffset = checkpoint?.parsedBytes ?? 0
    for await (const row of readJsonlLinesFromOffset(path, endOffset, reader)) {
      if (!row.terminated) {
        break
      }
      endOffset = row.endOffset
      if (agent === 'codex') {
        try {
          readCodexSessionTokenRecord(
            state.codex,
            row.line,
            providerSessionId,
            source.copiedEntries
          )
        } catch (error) {
          if (!(error instanceof SyntaxError)) {
            throw error
          }
        }
      } else {
        const turn = readClaudeSessionTokenRecord(row.line, providerSessionId, source.copiedEntries)
        if (turn) {
          addClaudeRecord(state.claude, claudeSeen, turn)
        }
      }
    }
    const nextCheckpoint = await buildJsonlFileCheckpoint(
      path,
      endOffset,
      checkpoint?.headDigest,
      reader
    )
    if (!(await validateJsonlFileReader(reader, checkpoint))) {
      return null
    }
    for (const [id, usage] of claudeSeen) {
      state.claude.requests.set(id, usage)
    }
    return { path, stats: reader.stats, checkpoint: nextCheckpoint, state }
  } finally {
    await reader.handle.close()
  }
}

export async function readSessionTokenMetrics(source: Source): Promise<SessionTokenMetrics> {
  const { agent, providerSessionId } = source
  const key = stableInFlightKey([
    agent,
    providerSessionId,
    source.location,
    source.copiedEntries?.size
  ])
  const result = await pending.run(key, async () => {
    const value = await readSource(source, cache.get(key)).catch(() => null)
    cache.delete(key)
    if (value) {
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
    outputRate:
      agent === 'claude'
        ? readClaudeSessionOutputRate(providerSessionId)
        : (result?.state.codex.outputRate ?? null)
  }
}
