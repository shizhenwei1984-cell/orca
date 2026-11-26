import { isWebClientLocation } from '@/app-shell/platform/web-client-location'
import { selectWorktreeCreationSurfaceShown } from '@/lib/workspace/creation/worktree-creation-surface'
import { useAppStore } from '@/store'
import {
  collectActivePluginPanels,
  usePluginPanelsStore
} from '@/store/plugins/catalog/plugin-contribution-catalog'
import type { AppState } from '@/store/types'
import type { PluginHostPanel } from '../../../../../shared/plugins/plugin-list-entry'
import type { PluginPanelPlacement } from '../../../../../shared/plugins/contributions/plugin-panel-placement'
import { canShowRightSidebarForView } from '../../right-sidebar/visibility/right-sidebar-visibility'

export function canPlacePluginPanel(state: AppState): boolean {
  return (
    !isWebClientLocation() &&
    state.activeView === 'terminal' &&
    state.activeWorktreeId !== null &&
    !selectWorktreeCreationSurfaceShown(state)
  )
}

export function pluginPanelPlacement(
  state: AppState,
  panel: Pick<PluginHostPanel, 'defaultPlacement' | 'tabKey'>
): PluginPanelPlacement {
  return panel.defaultPlacement && canPlacePluginPanel(state)
    ? (state.pluginPanelDock.placements[panel.tabKey] ?? panel.defaultPlacement)
    : 'right'
}

export function activePluginPanel(tabKey: string): PluginHostPanel | undefined {
  return collectActivePluginPanels(usePluginPanelsStore.getState().plugins).find(
    (panel) => panel.tabKey === tabKey
  )
}

export function openPluginPanel(tabKey: string): boolean {
  const panel = activePluginPanel(tabKey)
  const state = useAppStore.getState()
  if (!panel || !state.activeWorktreeId || !canShowRightSidebarForView(state.activeView)) {
    return false
  }
  const placement = pluginPanelPlacement(state, panel)
  if (placement === 'right') {
    if (canPlacePluginPanel(state) && state.pluginPanelDock.activeTab === panel.tabKey) {
      useAppStore.setState({ pluginPanelDock: { ...state.pluginPanelDock, activeTab: null } })
    }
    state.setRightSidebarTab(panel.tabKey)
    state.setRightSidebarOpen(true)
  } else {
    useAppStore.setState({ pluginPanelDock: { ...state.pluginPanelDock, activeTab: panel.tabKey } })
    if (state.rightSidebarTab === panel.tabKey) {
      state.setRightSidebarTab('explorer')
    }
    if (placement === 'left') {
      state.setSidebarOpen(true)
    }
  }
  return true
}

export function movePluginPanel(panel: PluginHostPanel, placement: PluginPanelPlacement): void {
  const state = useAppStore.getState()
  if (!panel.defaultPlacement || !canPlacePluginPanel(state)) {
    return
  }
  const dock = state.pluginPanelDock
  useAppStore.setState({
    pluginPanelDock: { ...dock, placements: { ...dock.placements, [panel.tabKey]: placement } }
  })
  openPluginPanel(panel.tabKey)
}

export function closePluginPanel(panel: PluginHostPanel): void {
  const state = useAppStore.getState()
  if (pluginPanelPlacement(state, panel) === 'right') {
    state.setRightSidebarOpen(false)
  } else if (state.pluginPanelDock.activeTab === panel.tabKey) {
    useAppStore.setState({ pluginPanelDock: { ...state.pluginPanelDock, activeTab: null } })
  }
}
