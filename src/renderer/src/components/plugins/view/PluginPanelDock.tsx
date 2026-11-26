import { Suspense, useCallback, useState } from 'react'
import { lazyWithRetry } from '@/app-shell/startup/lazy-with-retry'
import { useAppStore } from '@/store'
import { cn } from '@/lib/class-names'
import { usePluginViewCaptureStore } from '@/store/plugins/capture/plugin-view-capture'
import {
  usePluginPanels,
  type ActivePluginPanel
} from '@/store/plugins/catalog/plugin-contribution-catalog'
import { pluginPanelPlacement } from './plugin-panel-placement'
import { PluginPanelPlacementControls } from './PluginPanelPlacementControls'

const PluginPanel = lazyWithRetry(() => import('../../right-sidebar/plugin-panels/PluginPanel'))

type DockPlacement = 'bottom' | 'left'

function DockedPanel({
  panel,
  placement
}: {
  panel: ActivePluginPanel
  placement: DockPlacement
}): React.JSX.Element {
  const [height, setHeight] = useState(180)
  const onPanelPreferredHeight = useCallback((value: number) => {
    setHeight(Math.max(96, Math.min(value, 480)))
  }, [])
  const bottomWidth = usePluginViewCaptureStore((s) =>
    placement === 'bottom' && s.panelPlacement === 'bottom' ? s.panelWidth : null
  )
  return (
    <section
      aria-label={panel.title}
      data-plugin-panel-placement={placement}
      className={cn(
        'flex max-w-full shrink-0 flex-col overflow-hidden border-t border-border bg-background',
        placement === 'left' ? 'max-h-[55%]' : 'max-h-1/2'
      )}
      style={bottomWidth ? { width: bottomWidth } : undefined}
    >
      <PluginPanelPlacementControls panel={panel} />
      <div
        data-plugin-panel-surface={panel.tabKey}
        className="flex min-h-0 flex-col overflow-hidden"
        style={{ height }}
      >
        <Suspense fallback={null}>
          <PluginPanel tabKey={panel.tabKey} onPanelPreferredHeight={onPanelPreferredHeight} />
        </Suspense>
      </div>
    </section>
  )
}

export function PluginPanelDock({
  placement
}: {
  placement: DockPlacement
}): React.JSX.Element | null {
  const panels = usePluginPanels()
  const panel = useAppStore((state) =>
    state.settings?.pluginSystemEnabled
      ? panels.find(
          (entry) =>
            entry.tabKey === state.pluginPanelDock.activeTab &&
            pluginPanelPlacement(state, entry) === placement
        )
      : undefined
  )
  return panel ? <DockedPanel key={panel.tabKey} panel={panel} placement={placement} /> : null
}
