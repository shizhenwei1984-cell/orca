import { resolveQualifiedWorktreeExecutionOwner } from '@/lib/workspace/ownership/qualified-worktree-execution-owner'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'
import type { AppState } from '@/store/types'
import { parseWorkspaceKey } from '../../../../../shared/workspace/identity/workspace-scope'
import {
  pluginWorkspaceId,
  PLUGIN_HOST_ID_MAX_LENGTH
} from '../../../../../shared/plugins/workers/plugin-host-api-workspace-methods'

export function frameWorkspaceId(state: AppState): string | undefined {
  const id = state.activeWorktreeId
  if (!id) {
    return undefined
  }
  const owner =
    parseWorkspaceKey(id)?.type === 'folder'
      ? null
      : resolveQualifiedWorktreeExecutionOwner(
          selectWorktreesByRepo(state),
          state.repos,
          id,
          state.activeWorkspaceExecutionHostId
        )
  const projected = pluginWorkspaceId({ id, identityKey: owner?.worktree.identity?.key })
  return projected.length <= PLUGIN_HOST_ID_MAX_LENGTH &&
    (projected.startsWith('identity:') || parseWorkspaceKey(projected)?.type === 'folder')
    ? projected
    : undefined
}
