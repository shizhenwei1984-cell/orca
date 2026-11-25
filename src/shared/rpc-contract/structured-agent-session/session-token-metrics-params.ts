import { z } from 'zod'
import { SessionId } from './structured-agent-session-identifiers'

export const SessionTokenMetricsParams = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('chat'), sessionId: SessionId }),
  z.object({
    kind: z.literal('terminal'),
    paneKey: z.string().min(1).max(512),
    providerSessionId: z.string().min(1).max(512)
  })
])
