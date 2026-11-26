import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import {
  isLivePlugin,
  usePluginPanelsStore
} from '@/store/plugins/catalog/plugin-contribution-catalog'
import { selectActiveTabForWorktree } from '@/store/slices/tabs/active-tab-selection'
import { resolveTerminalHandleForPane } from '../../terminal-pane/clipboard/terminal-handle-copy'
import { openPluginPanel } from './plugin-panel-placement'
import { pluginPanelNotShownReason } from './plugin-view-shown'
import { openPluginPanelParamsSchema } from '../../../../../shared/plugins/frames/plugin-frame-bridge'
import type { PluginHostCallOutcome } from '../../../../../shared/plugins/frames/plugin-protocol'
import { getActiveSidebarWorkspaceId } from '../../../../../shared/workspace/identity/workspace-scope'
import type { PluginHostPanel } from '../../../../../shared/plugins/plugin-list-entry'
import { pluginPanelTabKey } from '../../../../../shared/plugins/frames/plugin-tab-key'
import { PLUGIN_TERMINAL_ID_MAX_LENGTH } from '../../../../../shared/plugins/workers/plugin-host-api-workspace-context'
import { canShowRightSidebarForView } from '../../right-sidebar/visibility/right-sidebar-visibility'
import type { AppState } from '@/store/types'
import { frameWorkspaceId } from './plugin-panel-workspace'

type PanelActivation = {
  action: string
  terminalId?: string
  input?: string[]
  workspaceId?: string
}
type Receiver = (activation: PanelActivation) => void
type PendingActivation = {
  panel: PluginHostPanel
  activation?: PanelActivation
  dispose: () => void
}

type ScopedReceiver = {
  worktreeId: string | null
  hostId: AppState['activeWorkspaceExecutionHostId']
  receive: Receiver
}

const receivers = new Map<string, ScopedReceiver>()
let pending: PendingActivation | undefined

function isScopedReceiverCurrent(
  receiver: ScopedReceiver | undefined,
  state: AppState
): receiver is ScopedReceiver {
  return (
    receiver?.worktreeId === state.activeWorktreeId &&
    receiver.hostId === state.activeWorkspaceExecutionHostId
  )
}

export function hasCurrentPluginPanelReceiver(tabKey: string, state: AppState): boolean {
  return isScopedReceiverCurrent(receivers.get(tabKey), state)
}

function deliver(): void {
  const current = pending
  const receiver = current && receivers.get(current.panel.tabKey)
  const state = useAppStore.getState()
  if (
    current?.activation &&
    isScopedReceiverCurrent(receiver, state) &&
    !pluginPanelNotShownReason(state, current.panel)
  ) {
    current.dispose()
    receiver.receive(current.activation)
  }
}

export function registerPluginPanelActivationReceiver(
  tabKey: string,
  guestWorkspaceId: unknown,
  receive: Receiver
): () => void {
  const state = useAppStore.getState()
  const workspaceId = frameWorkspaceId(state)
  if (workspaceId && typeof guestWorkspaceId === 'string' && guestWorkspaceId !== workspaceId) {
    return () => {}
  }
  const receiver = {
    worktreeId: state.activeWorktreeId,
    hostId: state.activeWorkspaceExecutionHostId,
    receive
  }
  receivers.set(tabKey, receiver)
  deliver()
  return () => {
    if (receivers.get(tabKey) === receiver) {
      receivers.delete(tabKey)
    }
  }
}

export function activePluginTerminalPane(state: AppState) {
  const worktreeId = getActiveSidebarWorkspaceId(state.activeWorkspaceKey, state.activeWorktreeId)
  const tab =
    state.activeView === 'terminal' && worktreeId
      ? selectActiveTabForWorktree(state, worktreeId)
      : null
  if (tab?.contentType !== 'terminal') {
    return undefined
  }
  const layout = state.terminalLayoutsByTabId[tab.entityId]
  const leafId = layout?.activeLeafId
  if (!leafId) {
    return undefined
  }
  return {
    tabId: tab.entityId,
    leafId,
    ptyId: layout.ptyIdsByLeafId?.[leafId],
    worktreeId
  }
}

export async function readActiveTerminalId(state: AppState): Promise<string | undefined> {
  const pane = activePluginTerminalPane(state)
  if (!pane) {
    return undefined
  }
  const id = await resolveTerminalHandleForPane({
    ...pane,
    callRuntime: ({ method, params }) =>
      window.api.runtime.call({ method, params: { ...params, worktreeId: pane.worktreeId } })
  }).catch(() => undefined)
  return id && id.length <= PLUGIN_TERMINAL_ID_MAX_LENGTH ? id : undefined
}

export function activatePluginCommandPanel(pluginKey: string, commandId: string): void {
  const plugin = usePluginPanelsStore
    .getState()
    .plugins.find((entry) => entry.pluginKey === pluginKey)
  const handler = plugin?.commands.find(({ id }) => id === commandId)?.handler
  if (!plugin || !isLivePlugin(plugin) || handler?.type !== 'panel') {
    throw new Error('The plugin panel command is unavailable')
  }
  const tabKey = pluginPanelTabKey(pluginKey, handler.panel)
  const panel = plugin.panels.find((entry) => entry.tabKey === tabKey)
  const origin = useAppStore.getState()
  const view =
    origin.activeView === 'settings' ? origin.previousViewBeforeSettings : origin.activeView
  if (
    !panel?.actions?.includes(handler.action) ||
    !origin.activeWorktreeId ||
    !canShowRightSidebarForView(view)
  ) {
    throw new Error('The plugin panel needs an open workspace')
  }

  const workspaceId = plugin.capabilities.some(({ kind }) => kind === 'workspace:read')
    ? frameWorkspaceId(origin)
    : undefined
  if (
    !openPanelActivation(
      panel,
      { action: handler.action, workspaceId },
      handler.activeTerminal === true
    )
  ) {
    throw new Error('The plugin panel is unavailable')
  }
}

export function openSiblingPluginPanel(
  from: string,
  params: unknown,
  permitsWorkspaceHandle?: (value: string) => boolean
): PluginHostCallOutcome {
  const parsed = openPluginPanelParamsSchema.safeParse(params)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid_params',
      error: translate(
        'auto.lib.pluginPanelActivation.invalidTarget',
        'Invalid plugin panel target.'
      )
    }
  }
  const { panel, action, workspaceId, input } = parsed.data
  const plugin = usePluginPanelsStore
    .getState()
    .plugins.find(
      (entry) =>
        isLivePlugin(entry) &&
        entry.capabilities.some(({ kind }) => kind === 'workspace:read') &&
        entry.panels.some(
          (panel) =>
            panel.tabKey === from && !pluginPanelNotShownReason(useAppStore.getState(), panel)
        )
    )
  const tabKey = plugin && pluginPanelTabKey(plugin.pluginKey, panel)
  const target = plugin?.panels.find((entry) => entry.tabKey === tabKey)
  const state = useAppStore.getState()
  const publicId = frameWorkspaceId(state)
  if (
    !target?.actions?.includes(action) ||
    (workspaceId !== publicId && !permitsWorkspaceHandle?.(workspaceId)) ||
    !canShowRightSidebarForView(state.activeView) ||
    !openPanelActivation(target, { action, input, workspaceId: publicId })
  ) {
    return {
      ok: false,
      code: 'not_permitted',
      error: translate(
        'auto.lib.pluginPanelActivation.unavailable',
        'The panel action is unavailable in this workspace.'
      )
    }
  }
  return { ok: true, value: { opened: true } }
}

function openPanelActivation(
  panel: PluginHostPanel,
  activation: PanelActivation,
  readTerminal = false
): boolean {
  const origin = useAppStore.getState()
  pending?.dispose()
  if (origin.activeView === 'settings') {
    origin.closeSettingsPage()
  }
  if (!openPluginPanel(panel.tabKey)) {
    return false
  }
  const stopWatching = useAppStore.subscribe((state) => {
    if (
      state.activeWorkspaceKey !== origin.activeWorkspaceKey ||
      state.activeWorktreeId !== origin.activeWorktreeId ||
      state.activeWorkspaceExecutionHostId !== origin.activeWorkspaceExecutionHostId
    ) {
      current.dispose()
    }
  })
  const timer = setTimeout(() => current.dispose(), 10_000)
  const current: PendingActivation = {
    panel,
    dispose() {
      clearTimeout(timer)
      stopWatching()
      if (pending === current) {
        pending = undefined
      }
    }
  }
  pending = current

  const complete = (terminalId?: string): void => {
    if (pending !== current) {
      return
    }
    current.activation = { ...activation, terminalId }
    deliver()
  }
  if (readTerminal) {
    void readActiveTerminalId(
      origin.activeView === 'settings'
        ? { ...origin, activeView: origin.previousViewBeforeSettings }
        : origin
    ).then(complete)
  } else {
    complete()
  }
  return true
}
