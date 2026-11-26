import { Ellipsis, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { PLUGIN_PANEL_PLACEMENTS } from '../../../../../shared/plugins/contributions/plugin-panel-placement'
import type { PluginHostPanel } from '../../../../../shared/plugins/plugin-list-entry'
import {
  canPlacePluginPanel,
  closePluginPanel,
  movePluginPanel,
  pluginPanelPlacement
} from './plugin-panel-placement'

export function PluginPanelPlacementControls({
  panel
}: {
  panel: PluginHostPanel
}): React.JSX.Element | null {
  const t = useTranslate()
  const canPlace = useAppStore(canPlacePluginPanel)
  const placement = useAppStore((state) => pluginPanelPlacement(state, panel))
  if (!canPlace || !panel.defaultPlacement) {
    return null
  }
  const labels = {
    bottom: t('auto.components.plugins.PluginPanelPlacement.bottom', 'Bottom'),
    left: t('auto.components.plugins.PluginPanelPlacement.left', 'Left sidebar'),
    right: t('auto.components.plugins.PluginPanelPlacement.right', 'Right sidebar')
  }
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border bg-background px-2 text-foreground">
      <span className="min-w-0 flex-1 truncate text-xs">{panel.title}</span>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('auto.components.plugins.PluginPanelPlacement.move', 'Move panel')}
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup value={placement}>
            {PLUGIN_PANEL_PLACEMENTS.map((value) => (
              <DropdownMenuRadioItem
                key={value}
                value={value}
                onSelect={() => movePluginPanel(panel, value)}
              >
                {labels[value]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t('auto.components.plugins.PluginPanelPlacement.close', 'Close panel')}
        onClick={() => closePluginPanel(panel)}
      >
        <X />
      </Button>
    </div>
  )
}
