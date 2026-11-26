import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import {
  workspaceChangedPayloadSchema,
  type PluginEventPayload
} from '../../../../../shared/plugins/events/plugin-events'
import type { PluginPanelPush } from '../../../../../shared/plugins/workers/plugin-panel-bridge-protocol'
import {
  activePluginTerminalPane,
  frameWorkspaceId,
  readActiveTerminalId
} from '../view/plugin-panel-activation'

function sameWorkspace(a: AppState, b: AppState): boolean {
  return (
    a.activeWorkspaceKey === b.activeWorkspaceKey &&
    a.activeWorktreeId === b.activeWorktreeId &&
    a.activeWorkspaceExecutionHostId === b.activeWorkspaceExecutionHostId
  )
}

export function forwardPluginFramePush(send: (push: PluginPanelPush) => void) {
  let current: PluginEventPayload<'workspace.changed'>['context']
  let revision = 0
  const publish = async (state: AppState): Promise<void> => {
    const request = ++revision
    const context = current
    if (!context) {
      return
    }
    const terminalId = await readActiveTerminalId(state)
    if (request === revision) {
      send({
        kind: 'event',
        event: 'workspace.changed',
        payload: {
          context: {
            ...context,
            focusedTerminalId: context.terminals.some(({ id }) => id === terminalId)
              ? terminalId
              : null
          }
        }
      })
    }
  }
  const unsubscribe = useAppStore.subscribe((state, previous) => {
    if (!sameWorkspace(state, previous)) {
      current = null
      revision++
    }
    if (!current) {
      return
    }
    const pane = activePluginTerminalPane(state)
    const before = activePluginTerminalPane(previous)
    if (
      pane?.tabId !== before?.tabId ||
      pane?.leafId !== before?.leafId ||
      pane?.ptyId !== before?.ptyId
    ) {
      void publish(state)
    }
  })
  return {
    receive(push: PluginPanelPush) {
      if (push.kind !== 'event' || push.event !== 'workspace.changed') {
        send(push)
        return
      }
      const result = workspaceChangedPayloadSchema.safeParse(push.payload)
      if (!result.success) {
        return
      }
      revision++
      current = result.data.context
      const state = useAppStore.getState()
      if (current && state.activeWorktreeId && current.workspaceId === frameWorkspaceId(state)) {
        void publish(state)
      } else {
        current = null
        send(push)
      }
    },
    dispose() {
      revision++
      unsubscribe()
    }
  }
}
