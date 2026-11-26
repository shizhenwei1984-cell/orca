import { antigravityFullTranscriptPath } from '../../../../../antigravity/antigravity-transcript-import'
import { join } from 'node:path'
import { SessionTokenMetricsParams } from '../../../../../../shared/rpc-contract/structured-agent-session/session-token-metrics-params'
import { agentSessionAccountHomePath } from '../../../../../../shared/agent-session/lifecycle/accounts/agent-session-account-home'
import { agentSessionJournalProviderHandle } from '../../../../../../shared/agent-session/lifecycle/provider-handles/agent-session-provider-handle-encoding'
import { isAgentSessionHandleProvider } from '../../../../../../shared/agent-session/lifecycle/provider-handles/agent-session-provider-handle'
import { nativeCopyCoverage } from '../../../../../native-chat/agent-session-journal/context-epochs/journal-history-origin'
import { readSessionTokenMetrics } from '../../../../../native-chat/session-token-metrics'
import { defineMethod } from '../../../core'
import { requireInstalledStructuredHost } from '../creation/structured-agent-session-gate'

export const SESSION_TOKEN_METRICS_METHOD = defineMethod({
  name: 'agentSession.tokenMetrics',
  permission: 'workspace',
  params: SessionTokenMetricsParams,
  handler: async (params, ctx) => {
    if (params.kind === 'terminal') {
      const row = ctx.runtime
        .getAgentStatusRowsForPane(params.paneKey)
        .filter((entry) => entry.providerSession)
        .reduce<ReturnType<typeof ctx.runtime.getAgentStatusRowsForPane>[number] | undefined>(
          (latest, entry) => (!latest || entry.receivedAt > latest.receivedAt ? entry : latest),
          undefined
        )
      const session = row?.providerSession
      if (
        !row ||
        !session ||
        row.connectionId ||
        row.executionHost === 'shared' ||
        session.id !== params.providerSessionId ||
        !isAgentSessionHandleProvider(row.agentType)
      ) {
        return null
      }
      return readSessionTokenMetrics({
        agent: row.agentType,
        providerSessionId: session.id,
        location: { cwd: session.cwd, transcriptPath: session.transcriptPath }
      })
    }

    const host = await requireInstalledStructuredHost(ctx, params.sessionId)
    const record = host.deps.store.getConversation(params.sessionId)
    const handle = record?.providerHandleChain.at(-1)?.handle
    if (
      !record ||
      !handle ||
      (!isAgentSessionHandleProvider(record.provider) && record.provider !== 'antigravity') ||
      handle.agent !== record.provider ||
      record.location.wslDistro
    ) {
      return null
    }
    const agent = record.provider
    const accountHome = agentSessionAccountHomePath(
      host.reads.childAccountHome(record.sessionId) ??
        record.launchedAccount?.accountHome ??
        record.accountHome
    )
    if (!accountHome) {
      return null
    }
    const forked =
      record.forkedFrom ||
      record.providerHandleChain.some(
        (link) => link.origin === 'forked' && link.handle.nativeId === handle.nativeId
      )
    if (agent === 'antigravity') {
      const transcriptPath = antigravityFullTranscriptPath(accountHome, handle.nativeId)
      if (!transcriptPath || forked) {
        return null
      }
      return readSessionTokenMetrics({
        agent,
        providerSessionId: handle.nativeId,
        location: { transcriptPath }
      })
    }
    const copiedEntries = forked
      ? nativeCopyCoverage(
          await host.reads.sessionHistoryOrigin(record.sessionId),
          agent,
          agent === 'codex' ? 'codex-turn' : 'claude-entry',
          agentSessionJournalProviderHandle({ agent, providerHandle: handle })
        )
      : undefined
    if (forked && !copiedEntries) {
      return null
    }
    return readSessionTokenMetrics({
      agent,
      providerSessionId: handle.nativeId,
      location: {
        cwd: record.launchDirectory,
        ...(agent === 'codex'
          ? { codexSessionsDirs: [join(accountHome, 'sessions')] }
          : { claudeProjectsDir: join(accountHome, 'projects') })
      },
      copiedEntries
    })
  }
})
