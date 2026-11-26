import type { ConfirmationDialogContextValue } from '@/components/dismiss/confirmation/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import type { WorkspaceCompanionPermission } from '../../../../../shared/plugins/frames/plugin-workspace-view'
import {
  workspaceCompanionGrantKey,
  workspaceViewGrant,
  type WorkspaceViewScope
} from './plugin-workspace-view-scope'

export function workspaceCompanionTitle(capability: WorkspaceCompanionPermission) {
  return capability === 'fatigue'
    ? translate('plugins.workspaceView.fatigue', 'Companion fatigue')
    : translate('plugins.workspaceView.portraits', 'Notification portraits')
}

export async function confirmWorkspaceViewAccess(
  confirm: ConfirmationDialogContextValue,
  options: {
    pluginName: string
    scope: WorkspaceViewScope
    key: string
    revoke: boolean
    capability?: WorkspaceCompanionPermission
    signal?: AbortSignal
    isCurrent: () => boolean | Promise<boolean>
  }
): Promise<boolean> {
  const { pluginName, scope, revoke, signal, isCurrent, capability } = options
  const key = capability ? workspaceCompanionGrantKey(options.key, capability) : options.key
  const companionDescription =
    capability === 'fatigue'
      ? translate(
          'plugins.workspaceView.fatigueDescription',
          'Share whether each verified companion is near its current session limit.'
        )
      : translate(
          'plugins.workspaceView.portraitsDescription',
          'Let Orca display companion portraits in notifications for matching terminals in this workspace.'
        )
  let rename = false
  const accepted = await confirm({
    title: revoke
      ? translate('plugins.workspaceView.revokeTitle', 'Remove workspace access?')
      : translate('plugins.workspaceView.allowTitle', 'Allow workspace access?'),
    subtitle: `${pluginName} · ${scope.name} · ${scope.hostId}`,
    description: capability
      ? companionDescription
      : revoke
        ? translate(
            'plugins.workspaceView.revokeDescription',
            'Remove permission to read and select tabs, see Git review status, and rename tabs in this workspace.'
          )
        : translate(
            'plugins.workspaceView.allowDescription',
            'Allow this plugin to read tab titles, select tabs, and see Git checkout and review status in this workspace. You can remove access in the plugin’s settings.'
          ),
    confirmLabel: revoke
      ? translate('plugins.workspaceView.remove', 'Remove access')
      : workspaceViewGrant(key)
        ? translate('plugins.workspaceView.save', 'Save access')
        : translate('plugins.workspaceView.allow', 'Allow access'),
    surface: 'security',
    ignoresOpeningGesture: true,
    dontAskAgain:
      revoke || capability
        ? undefined
        : {
            label: translate(
              'plugins.workspaceView.rename',
              'Also allow renaming chat and terminal tabs'
            ),
            onConfirmed: () => {
              rename = true
            }
          },
    signal
  })
  if (!accepted || !(await isCurrent())) {
    return false
  }
  if (revoke) {
    localStorage.removeItem(key)
  } else {
    localStorage.setItem(key, capability ? 'allow' : rename ? 'rename' : 'read')
  }
  return true
}
