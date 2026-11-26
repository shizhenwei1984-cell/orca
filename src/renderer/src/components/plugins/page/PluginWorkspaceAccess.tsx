import { useContext, useSyncExternalStore } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'
import { recomputeOn } from '@/lib/recompute-on'
import { ConfirmationDialogContext } from '@/components/dismiss/confirmation/confirmation-dialog-context'
import { Button } from '../../ui/button'
import { DetailRow, DetailSection } from './PluginDetailSections'
import {
  confirmWorkspaceViewAccess,
  workspaceCompanionTitle
} from '../frames/plugin-workspace-view-consent'
import {
  workspaceCompanionPermission,
  type WorkspaceCompanionPermission
} from '../../../../../shared/plugins/frames/plugin-workspace-view'
import {
  notifyWorkspaceViewGrant,
  resolveWorkspaceViewScope,
  subscribeWorkspaceViewGrant,
  workspaceCompanionGrants,
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

export function PluginWorkspaceAccess({
  pluginKey,
  name,
  canGrantCompanions
}: {
  pluginKey: string
  name: string
  canGrantCompanions: boolean
}) {
  const t = useTranslate()
  const confirm = useContext(ConfirmationDialogContext)
  const version = useSyncExternalStore(subscribe, () => {
    const workspace = settingsWorkspace()
    if (!workspace) {
      return null
    }
    const key = workspaceViewGrantKey(pluginKey, workspace)
    return JSON.stringify([
      key,
      workspace.name,
      workspaceViewGrant(key),
      workspaceCompanionGrants(key)
    ])
  })
  const { scope, key, grant, companions } = recomputeOn([version, pluginKey], () => {
    const scope = settingsWorkspace()
    const key = scope && workspaceViewGrantKey(pluginKey, scope)
    return {
      scope,
      key,
      grant: key && workspaceViewGrant(key),
      companions: key && workspaceCompanionGrants(key)
    }
  })
  if (!scope || !key || !companions || !confirm) {
    return null
  }
  const permissions = workspaceCompanionPermission.options.filter(
    (capability) => canGrantCompanions || companions[capability]
  )
  if (!grant && !permissions.length) {
    return null
  }
  const changeGrant = async (
    revoke: boolean,
    capability?: WorkspaceCompanionPermission
  ): Promise<void> => {
    const changed = await confirmWorkspaceViewAccess(confirm, {
      scope,
      key,
      pluginName: name,
      revoke,
      capability,
      isCurrent: () => settingsWorkspace()?.key === scope.key
    })
    if (changed) {
      notifyWorkspaceViewGrant(key)
    }
  }
  return (
    <DetailSection title={t('plugins.workspaceView.settingsTitle', 'Workspace access')}>
      {grant && (
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
            <Button size="sm" variant="outline" onClick={() => void changeGrant(true)}>
              {t('plugins.workspaceView.remove', 'Remove access')}
            </Button>
          }
        />
      )}
      {permissions.map((capability) => (
        <DetailRow
          key={capability}
          icon={<ShieldCheck />}
          title={workspaceCompanionTitle(capability)}
          detail={scope.name}
          trailing={
            <Button
              size="sm"
              variant="outline"
              onClick={() => void changeGrant(companions[capability], capability)}
            >
              {companions[capability]
                ? t('plugins.workspaceView.remove', 'Remove access')
                : t('plugins.workspaceView.allow', 'Allow access')}
            </Button>
          }
        />
      ))}
    </DetailSection>
  )
}
