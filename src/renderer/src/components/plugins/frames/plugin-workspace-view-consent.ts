import type { ConfirmationDialogContextValue } from '@/components/dismiss/confirmation/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import { workspaceViewGrant, type WorkspaceViewScope } from './plugin-workspace-view-scope'

export async function confirmWorkspaceViewAccess(
  confirm: ConfirmationDialogContextValue,
  options: {
    pluginName: string
    scope: WorkspaceViewScope
    key: string
    revoke: boolean
    signal?: AbortSignal
    isCurrent: () => boolean | Promise<boolean>
  }
): Promise<boolean> {
  const { pluginName, scope, key, revoke, signal, isCurrent } = options
  let rename = false
  const accepted = await confirm({
    title: revoke
      ? translate('plugins.workspaceView.revokeTitle', 'Remove workspace access?')
      : translate('plugins.workspaceView.allowTitle', 'Allow workspace access?'),
    subtitle: `${pluginName} · ${scope.name} · ${scope.hostId}`,
    description: revoke
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
    dontAskAgain: revoke
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
    localStorage.setItem(key, rename ? 'rename' : 'read')
  }
  return true
}
