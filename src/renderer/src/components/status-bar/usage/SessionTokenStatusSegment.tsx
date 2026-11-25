import { useEffect, useMemo, useState } from 'react'
import type { z } from 'zod'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useIntlLocale, useTranslate } from '@/i18n/use-translate'
import { selectFocusedTab } from '@/lib/focused-chat-workers'
import { useAppStore } from '@/store'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { RuntimeRpcCallError } from '@/runtime/rpc/calls/runtime-rpc-result'
import { useAgentStatus } from '@/runtime/agent-status/use-agent-status'
import {
  structuredAgentSessionOwnerForTab,
  structuredAgentSessionTargetForHost
} from '@/runtime/native-chat/session-ownership/structured-agent-session-owner'
import { getFocusedAgentPaneKeyForWorktree } from '@/components/sidebar/workspace-card/activity/focused-agent-row-highlight'
import { useStructuredAgentSessionTokenActivity } from '@/components/native-chat/session/status/structured-agent-session-status-hooks'
import { isAgentSessionHandleProvider } from '../../../../../shared/agent-session/lifecycle/provider-handles/agent-session-provider-handle'
import type { SessionTokenMetrics } from '../../../../../shared/agent-usage/session-token-metrics'
import type { SessionTokenMetricsParams } from '../../../../../shared/rpc-contract/structured-agent-session/session-token-metrics-params'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'

type Request = z.infer<typeof SessionTokenMetricsParams>

export function SessionTokenStatusSegment(): React.JSX.Element | null {
  const tab = useAppStore((s) =>
    s.activeView === 'terminal' ? selectFocusedTab(s, s.activeWorktreeId) : null
  )
  const owner = useAppStore((s) => (tab ? structuredAgentSessionOwnerForTab(s, tab) : null))
  const target = useMemo(() => structuredAgentSessionTargetForHost(owner), [owner])
  const paneKey = useAppStore((s) =>
    tab?.contentType === 'terminal' && s.activeWorktreeId
      ? getFocusedAgentPaneKeyForWorktree(s, s.activeWorktreeId)
      : null
  )
  const terminalStatus = useAgentStatus(paneKey)
  if (!tab || !target) {
    return null
  }
  if (tab.contentType === 'agent-session' && isAgentSessionHandleProvider(tab.agentSessionAgent)) {
    return (
      <ChatTokens
        key={JSON.stringify([owner, tab.entityId])}
        target={target}
        sessionId={tab.entityId}
      />
    )
  }
  const providerSessionId = terminalStatus?.providerSession?.id
  if (
    !paneKey ||
    !terminalStatus ||
    !providerSessionId ||
    !isAgentSessionHandleProvider(terminalStatus.agentType) ||
    terminalStatus.connectionId ||
    terminalStatus.executionHost === 'shared'
  ) {
    return null
  }
  return (
    <FocusedTokens
      key={JSON.stringify([owner, paneKey, providerSessionId])}
      target={target}
      request={{ kind: 'terminal', paneKey, providerSessionId }}
      providerSessionId={providerSessionId}
      working={terminalStatus.state === 'working' && terminalStatus.workingMode !== 'monitoring'}
    />
  )
}

function ChatTokens({ target, sessionId }: { target: RuntimeClientTarget; sessionId: string }) {
  const { providerSessionId, working } = useStructuredAgentSessionTokenActivity(sessionId, target)
  return (
    <FocusedTokens
      key={providerSessionId}
      target={target}
      request={{ kind: 'chat', sessionId }}
      providerSessionId={providerSessionId}
      working={working}
    />
  )
}

function FocusedTokens({
  target,
  request,
  providerSessionId,
  working
}: {
  target: RuntimeClientTarget
  request: Request
  providerSessionId: string | undefined
  working: boolean
}): React.JSX.Element | null {
  const [metrics, setMetrics] = useState<SessionTokenMetrics | null>(null)
  const [supported, setSupported] = useState(true)
  const chatId = request.kind === 'chat' ? request.sessionId : null
  const paneKey = request.kind === 'terminal' ? request.paneKey : null

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let reads = 0
    let reading = false
    async function read(): Promise<void> {
      if (reading || document.hidden || controller.signal.aborted) {
        return
      }
      reading = true
      reads++
      try {
        const params = chatId
          ? { kind: 'chat', sessionId: chatId }
          : { kind: 'terminal', paneKey, providerSessionId }
        const result = await callRuntimeRpc<SessionTokenMetrics | null>(
          target,
          'agentSession.tokenMetrics',
          params,
          { signal: controller.signal, background: true }
        )
        if (!controller.signal.aborted) {
          setMetrics(
            result && (!providerSessionId || result.providerSessionId === providerSessionId)
              ? result
              : null
          )
        }
      } catch (error) {
        if (
          !controller.signal.aborted &&
          error instanceof RuntimeRpcCallError &&
          error.code === 'method_not_found'
        ) {
          setSupported(false)
          return
        }
      } finally {
        reading = false
      }
      // Give the final transcript flush time to land, then stop reading an idle session.
      if (!controller.signal.aborted && !document.hidden && (working || reads < 3)) {
        timer = setTimeout(() => void read(), 2_000)
      }
    }
    const visibilityChanged = (): void => {
      clearTimeout(timer)
      if (!document.hidden) {
        reads = 0
        void read()
      }
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    void read()
    return () => {
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }, [target, chatId, paneKey, providerSessionId, working])

  return supported ? <SessionTokenReadout metrics={metrics} /> : null
}

function SessionTokenReadout({ metrics }: { metrics: SessionTokenMetrics | null }) {
  const t = useTranslate()
  const locale = useIntlLocale()
  const [compact, decimal, percent] = useMemo(
    () => [
      new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }),
      new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
      new Intl.NumberFormat(locale, { style: 'percent' })
    ],
    [locale]
  )
  const counts = metrics?.counts
  const rate = metrics?.outputRate
  const tokens = counts ? compact.format(counts.input + counts.output) : '—'
  const hit =
    counts && counts.input > 0 && counts.cacheRead !== null
      ? percent.format(counts.cacheRead / counts.input)
      : '—'
  const speed = rate ? decimal.format(rate.tokensPerSecond) : '—'
  const title = t(
    'auto.components.status.bar.SessionTokenStatusSegment.title',
    'Session token usage'
  )
  const rateLabel = t(
    'auto.components.status.bar.SessionTokenStatusSegment.rate',
    '{{speed}} tok/s',
    {
      speed
    }
  )
  const countLabel = t(
    'auto.components.status.bar.SessionTokenStatusSegment.tokens',
    '{{tokens}} tokens',
    {
      tokens
    }
  )
  const cacheLabel = t(
    'auto.components.status.bar.SessionTokenStatusSegment.cache',
    '{{hit}} cache hit',
    {
      hit
    }
  )
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${title}. ${rateLabel}, ${countLabel}, ${cacheLabel}`}
          data-session-token-usage=""
          className="inline-flex shrink-0 items-center gap-2 rounded px-1 py-0.5 text-muted-foreground tabular-nums hover:bg-accent hover:text-accent-foreground"
        >
          <span>{rateLabel}</span>
          <span>{countLabel}</span>
          <span>{cacheLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-72">
        <div className="space-y-1.5 p-3 text-xs">
          <p className="font-medium">{title}</p>
          <p>
            {rate?.interval === 'api'
              ? t(
                  'auto.components.status.bar.SessionTokenStatusSegment.apiRateDetail',
                  'Output tokens per second of API time in the most recent turn.'
                )
              : t(
                  'auto.components.status.bar.SessionTokenStatusSegment.turnRateDetail',
                  'Output tokens per second averaged over the most recent turn.'
                )}
          </p>
          <p>
            {t(
              'auto.components.status.bar.SessionTokenStatusSegment.countDetail',
              'Total input and output tokens for this session. Cached reads are counted once.'
            )}
          </p>
          <p>
            {t(
              'auto.components.status.bar.SessionTokenStatusSegment.cacheDetail',
              'Cache hit is the share of all session input tokens read from cache.'
            )}
          </p>
          <p className="text-muted-foreground">
            {t(
              'auto.components.status.bar.SessionTokenStatusSegment.unavailable',
              'A dash means usage or timing is unavailable.'
            )}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
