import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { movePluginPanelParamsSchema } from '../../../../../shared/plugins/frames/plugin-frame-bridge'
import type { PluginHostCallOutcome } from '../../../../../shared/plugins/frames/plugin-protocol'
import { hasCurrentPluginPanelReceiver } from './plugin-panel-activation'
import { frameWorkspaceId } from './plugin-panel-workspace'
import { activePluginPanel, canPlacePluginPanel, movePluginPanel } from './plugin-panel-placement'
import { pluginPanelNotShownReason } from './plugin-view-shown'

export function moveOwnPluginPanel(tabKey: string, params: unknown): PluginHostCallOutcome {
  const state = useAppStore.getState()
  const panel = activePluginPanel(tabKey)
  const parsed = movePluginPanelParamsSchema.safeParse(params)
  if (
    !parsed.success ||
    parsed.data.workspaceId !== frameWorkspaceId(state) ||
    !hasCurrentPluginPanelReceiver(tabKey, state) ||
    !canPlacePluginPanel(state) ||
    !panel?.defaultPlacement ||
    pluginPanelNotShownReason(state, panel)
  ) {
    return {
      ok: false,
      code: 'not_permitted',
      error: translate(
        'auto.lib.pluginPanelActivation.cannotMove',
        'The panel cannot be moved in this workspace.'
      )
    }
  }
  movePluginPanel(panel, parsed.data.placement)
  return { ok: true, value: { moved: true } }
}
