export type SessionTokenCounts = {
  /** Includes cache reads and cache writes. */
  input: number
  output: number
  cacheRead: number | null
}

export type SessionOutputRate = {
  tokensPerSecond: number
  interval: 'session'
}

/** Returned by the runtime that owns this provider conversation. */
export type SessionTokenMetrics = {
  agent: 'claude' | 'codex'
  providerSessionId: string
  counts: SessionTokenCounts | null
  outputRate: SessionOutputRate | null
}
