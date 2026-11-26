import type {
  CodexPaneAccountRecord,
  CodexPaneAccountRegistryFile,
  CodexPaneHomeRoute
} from './codex-pane-account-registry-types'

function parseRegistryJson(rawRegistry: string): unknown {
  try {
    return JSON.parse(rawRegistry)
  } catch {
    return null
  }
}

function isAuthoritativeRegistry(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return false
  }
  const panes = (parsed as Partial<CodexPaneAccountRegistryFile>).panes
  const version = (parsed as Partial<CodexPaneAccountRegistryFile>).version
  const legacyWslAttributionUnknown = (parsed as Partial<CodexPaneAccountRegistryFile>)
    .legacyWslAttributionUnknown
  return (
    version === 2 &&
    Boolean(panes) &&
    typeof panes === 'object' &&
    !Array.isArray(panes) &&
    Object.values(panes).every(isPaneAccountRecord) &&
    (legacyWslAttributionUnknown === undefined || legacyWslAttributionUnknown === true)
  )
}

function parseRegistry(parsed: unknown): CodexPaneAccountRegistryFile {
  const empty: CodexPaneAccountRegistryFile = { version: 2, panes: {} }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return empty
  }
  const panes = (parsed as Partial<CodexPaneAccountRegistryFile>).panes
  if (!panes || typeof panes !== 'object' || Array.isArray(panes)) {
    return empty
  }
  if ((parsed as Partial<CodexPaneAccountRegistryFile>).legacyWslAttributionUnknown === true) {
    empty.legacyWslAttributionUnknown = true
  }
  for (const [ptyId, record] of Object.entries(panes)) {
    if (isPaneAccountRecord(record)) {
      const homeRoute = readPaneHomeRoute(record.homeRoute)
      empty.panes[ptyId] = {
        selectionKey: record.selectionKey,
        accountId: record.accountId,
        ...(homeRoute ? { homeRoute } : {})
      }
    }
  }
  return empty
}

function isPaneAccountRecord(value: unknown): value is CodexPaneAccountRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const record = value as Partial<CodexPaneAccountRecord>
  return (
    (record.selectionKey === 'host' ||
      (typeof record.selectionKey === 'string' && /^wsl:.+/.test(record.selectionKey))) &&
    (record.accountId === null || typeof record.accountId === 'string')
  )
}

// Older builds called shared-home panes with pane-local CODEX_HOME 'custom-home'.
function readPaneHomeRoute(value: unknown): CodexPaneHomeRoute | undefined {
  if (value === 'custom-home') {
    return 'shared-home'
  }
  return value === 'real-home' ||
    value === 'shared-home' ||
    value === 'account-home' ||
    value === 'wsl-home'
    ? value
    : undefined
}

export function decodePaneAccountRegistry(raw: string) {
  const parsed = parseRegistryJson(raw)
  const authoritative = isAuthoritativeRegistry(parsed)
  const registry = parseRegistry(parsed)
  if (!authoritative) {
    registry.legacyWslAttributionUnknown = true
  }
  return { authoritative, registry }
}
