import type { ProviderRateLimits } from '../../../shared/agent-usage/rate-limits/rate-limit-types'
import { normalizeRuntimePathForComparison } from '../../../shared/file-access/cross-platform-path'
import type { GlobalSettings } from '../../../shared/settings/global-settings-types'
import type { RuntimeTerminalSummary } from '../../../shared/terminal/runtime/runtime-terminal-contracts'
import type { CodexPaneAccountRecord } from '../../codex/configuration/homes/codex-pane-account-registry-types'
import { readCodexPaneAccountSnapshot } from '../../codex/configuration/homes/codex-pane-account-registry'
import type { RateLimitService } from '../../rate-limits/service/rate-limit-service'
import type { WorkspaceCompanionsOptions } from './plugin-workspace-companions'

export function desktopWorkspaceCompanions(
  runtime: WorkspaceCompanionsOptions['runtime'],
  core: { rateLimits?: RateLimitService | null },
  store: { getSettings(): Pick<GlobalSettings, 'codexManagedAccounts'> }
): WorkspaceCompanionsOptions {
  return {
    runtime,
    async loadFatigueReader() {
      const accounts = await readCodexPaneAccountSnapshot()
      const settings = store.getSettings()
      return (terminal) =>
        terminalSessionLimitNear(terminal, core.rateLimits, settings, Date.now(), accounts)
    }
  }
}

export function sessionWindowNear(reading: ProviderRateLimits | null, now: number) {
  const window = reading?.session
  if (
    reading?.status !== 'ok' ||
    !window ||
    window.windowMinutes !== 300 ||
    window.resetsAt === null ||
    !Number.isFinite(window.resetsAt) ||
    window.resetsAt <= now ||
    !Number.isFinite(reading.updatedAt) ||
    reading.updatedAt > now ||
    reading.updatedAt < window.resetsAt - window.windowMinutes * 60_000 ||
    !Number.isFinite(window.usedPercent)
  ) {
    return undefined
  }
  return { near: window.usedPercent >= 90, expiresAt: window.resetsAt }
}

export function terminalSessionLimitNear(
  terminal: RuntimeTerminalSummary,
  limits: Pick<RateLimitService, 'usageReading' | 'usageReadingAccount'> | null | undefined,
  settings: Pick<GlobalSettings, 'codexManagedAccounts'>,
  now: number,
  accounts: Readonly<Record<string, CodexPaneAccountRecord>>
) {
  if (
    !limits ||
    terminal.executionHostId !== 'local' ||
    terminal.agentIdentity !== 'codex' ||
    !terminal.ptyId
  ) {
    return undefined
  }
  const pane = accounts[terminal.ptyId]
  if (!pane?.accountId || pane.selectionKey !== 'host' || pane.homeRoute !== 'account-home') {
    return undefined
  }
  const account = settings.codexManagedAccounts?.find(({ id }) => id === pane.accountId)
  const source = limits.usageReadingAccount('codex')
  const reading = limits.usageReading('codex')
  const attribution = reading?.usageMetadata?.readingAccount
  if (
    !account ||
    (account.managedHomeRuntime ?? 'host') !== 'host' ||
    !source ||
    attribution?.accountId !== account.id ||
    attribution.runtime !== 'host' ||
    attribution.wslDistro !== null ||
    normalizeRuntimePathForComparison(source.home) !==
      normalizeRuntimePathForComparison(account.managedHomePath)
  ) {
    return undefined
  }
  return sessionWindowNear(reading, now)
}
