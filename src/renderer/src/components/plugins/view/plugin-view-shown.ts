import { canShowRightSidebarForView } from '@/components/right-sidebar/visibility/right-sidebar-visibility'
import type { AppState } from '@/store/types'
import type { PluginHostPanel } from '../../../../../shared/plugins/plugin-list-entry'
import { pluginPanelPlacement } from './plugin-panel-placement'

export function pluginPanelNotShownReason(state: AppState, panel: PluginHostPanel): string | null {
  if (!canShowRightSidebarForView(state.activeView) || !state.activeWorktreeId) {
    return 'Orca is not showing a workspace'
  }
  const placement = pluginPanelPlacement(state, panel)
  if (placement !== 'right') {
    if (placement === 'left' && !state.sidebarOpen) {
      return 'the left sidebar is closed'
    }
    return state.pluginPanelDock.activeTab === panel.tabKey ? null : 'the panel is closed'
  }
  if (!state.rightSidebarOpen) {
    return 'the right sidebar is closed'
  }
  return (state.rightSidebarEffectiveTab ?? state.rightSidebarTab) === panel.tabKey
    ? null
    : 'the right sidebar shows another tab'
}
