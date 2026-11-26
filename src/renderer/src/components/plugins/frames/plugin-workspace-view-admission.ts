import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  isLivePlugin,
  usePluginPanelsStore
} from '@/store/plugins/catalog/plugin-contribution-catalog'
import { WORKSPACE_VIEW_AUTHORIZATION } from '../../../../../shared/plugins/frames/plugin-workspace-view'
import type { PluginHostCallOutcome } from '../../../../../shared/plugins/frames/plugin-protocol'
import { pluginPanelNotShownReason } from '../view/plugin-view-shown'
import { callPanelActionViaPreload } from './plugin-frame-host'

type WorkspaceViewAdmission =
  | { ok: true; pluginKey: string }
  | Extract<PluginHostCallOutcome, { ok: false }>

export async function authorizeWorkspaceViewFrame(
  sessionToken: string
): Promise<WorkspaceViewAdmission> {
  const outcome = await callPanelActionViaPreload({
    sessionToken,
    action: WORKSPACE_VIEW_AUTHORIZATION
  })
  if (!outcome.ok) {
    return outcome
  }
  const { value } = outcome
  return value &&
    typeof value === 'object' &&
    'pluginKey' in value &&
    typeof value.pluginKey === 'string'
    ? { ok: true, pluginKey: value.pluginKey }
    : {
        ok: false,
        code: 'unavailable',
        error: translate('plugins.workspaceView.scopeChanged', 'The workspace view has changed.')
      }
}

export function visibleWorkspaceViewPlugin(key: string, tabKey: string) {
  const state = useAppStore.getState()
  const plugin = usePluginPanelsStore.getState().plugins.find((entry) => entry.pluginKey === key)
  const panel = plugin?.panels.find((entry) => entry.tabKey === tabKey)
  return plugin && panel && isLivePlugin(plugin) && !pluginPanelNotShownReason(state, panel)
    ? plugin
    : null
}
