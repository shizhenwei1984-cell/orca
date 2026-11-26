import { useContext, useSyncExternalStore } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'
import { ConfirmationDialogContext } from '@/components/dismiss/confirmation/confirmation-dialog-context'
import { Button } from '../../ui/button'
import { DetailRow, DetailSection } from './PluginDetailSections'
import { confirmWorkspaceViewAccess } from '../frames/plugin-workspace-view-consent'
import {
  notifyWorkspaceViewGrant,
  resolveWorkspaceViewScope,
  subscribeWorkspaceViewGrant,
  workspaceViewGrant,
  workspaceViewGrantKey
} from '../frames/plugin-workspace-view-scope'

function settingsWorkspace() {
  const state = useAppStore.getState()
  return resolveWorkspaceViewScope({
    ...state,
    activeView:
      state.activeView === 'settings' ? state.previousViewBeforeSettings : state.activeView
  })
}

function subscribe(change: () => void): () => void {
  const stop = useAppStore.subscribe(change)
  const unwatchGrant = subscribeWorkspaceViewGrant(change)
  return () => {
    stop()
    unwatchGrant()
  }
}

export function PluginWorkspaceAccess({ pluginKey, name }: { pluginKey: string; name: string }) {
  const t = useTranslate()
  const confirm = useContext(ConfirmationDialogContext)
  useSyncExternalStore(subscribe, () => {
    const workspace = settingsWorkspace()
    if (!workspace) {
      return null
    }
    const key = workspaceViewGrantKey(pluginKey, workspace)
    return JSON.stringify([key, workspace.name, workspaceViewGrant(key)])
  })
  const scope = settingsWorkspace()
  const key = scope && workspaceViewGrantKey(pluginKey, scope)
  const grant = key && workspaceViewGrant(key)
  if (!scope || !key || !grant || !confirm) {
    return null
  }
  const revoke = async (): Promise<void> => {
    const changed = await confirmWorkspaceViewAccess(confirm, {
      scope,
      key,
      pluginName: name,
      revoke: true,
      isCurrent: () => settingsWorkspace()?.key === scope.key
    })
    if (changed) {
      notifyWorkspaceViewGrant(key)
    }
  }
  return (
    <DetailSection title={t('plugins.workspaceView.settingsTitle', 'Workspace access')}>
      <DetailRow
        icon={<ShieldCheck />}
        title={scope.name}
        detail={
          grant === 'rename'
            ? t(
                'plugins.workspaceView.settingsRename',
                'Read tabs and reviews, select and rename tabs'
              )
            : t('plugins.workspaceView.settingsRead', 'Read tabs and reviews, select tabs')
        }
        trailing={
          <Button size="sm" variant="outline" onClick={() => void revoke()}>
            {t('plugins.workspaceView.remove', 'Remove access')}
          </Button>
        }
      />
    </DetailSection>
  )
}
