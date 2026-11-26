import { isPluginPanelTabKey } from '../frames/plugin-tab-key'
import { isPluginJsonObject } from '../manifest/plugin-json-object'

export const PLUGIN_PANEL_PLACEMENTS = ['bottom', 'left', 'right'] as const
export type PluginPanelPlacement = (typeof PLUGIN_PANEL_PLACEMENTS)[number]
export type PluginPanelTabKey = `plugin:${string}`

export type PluginPanelDockState = {
  activeTab: PluginPanelTabKey | null
  placements: Partial<Record<PluginPanelTabKey, PluginPanelPlacement>>
}

export const EMPTY_PLUGIN_PANEL_DOCK: PluginPanelDockState = {
  activeTab: null,
  placements: {}
}

export function normalizePluginPanelDock(input: unknown): PluginPanelDockState {
  if (!isPluginJsonObject(input)) {
    return EMPTY_PLUGIN_PANEL_DOCK
  }
  const { activeTab, placements } = input
  const saved: PluginPanelDockState['placements'] = {}
  if (isPluginJsonObject(placements)) {
    for (const [key, value] of Object.entries(placements)) {
      const placement = PLUGIN_PANEL_PLACEMENTS.find((allowed) => allowed === value)
      if (placement && isPluginPanelTabKey(key)) {
        saved[key] = placement
      }
    }
  }
  return {
    activeTab: typeof activeTab === 'string' && isPluginPanelTabKey(activeTab) ? activeTab : null,
    placements: saved
  }
}
