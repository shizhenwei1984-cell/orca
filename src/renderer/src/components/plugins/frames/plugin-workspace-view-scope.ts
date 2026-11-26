import type { AppState } from '@/store/types'
import { resolveQualifiedIndexedFolderWorkspace } from '@/store/folder-workspaces/folder-workspace-record-index'
import { resolveQualifiedWorktreeExecutionOwner } from '@/lib/workspace/ownership/qualified-worktree-execution-owner'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'
import {
  getActiveSidebarWorkspaceId,
  parseWorkspaceKey
} from '../../../../../shared/workspace/identity/workspace-scope'
import { isFolderRepo } from '../../../../../shared/repository/repo-kind'
import type { Repo } from '../../../../../shared/repository/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import {
  getRepoExecutionHostId,
  type ExecutionHostId
} from '../../../../../shared/execution-host/execution-host'
import { frameWorkspaceId } from '../view/plugin-panel-activation'

export type WorkspaceViewScope = {
  key: string
  worktreeId: string
  hostId: ExecutionHostId
  publicId: string | undefined
  name: string
  git: { repo: Repo; worktree: Worktree } | null
}

export function resolveWorkspaceViewScope(state: AppState): WorkspaceViewScope | null {
  const worktreeId = getActiveSidebarWorkspaceId(state.activeWorkspaceKey, state.activeWorktreeId)
  if (!worktreeId || state.activeView !== 'terminal') {
    return null
  }
  const selectedHost = state.activeWorkspaceExecutionHostId ?? undefined
  const publicId = frameWorkspaceId(state)
  const folder = parseWorkspaceKey(worktreeId)
  if (folder?.type === 'folder') {
    const result = resolveQualifiedIndexedFolderWorkspace(
      state,
      folder.folderWorkspaceId,
      selectedHost
    )
    if (result.kind !== 'selected' || result.value.workspace.isArchived) {
      return null
    }
    const { hostId, workspace } = result.value
    return {
      key: JSON.stringify([hostId, worktreeId, workspace.createdAt]),
      worktreeId,
      hostId,
      publicId,
      name: workspace.name,
      git: null
    }
  }

  const owner = resolveQualifiedWorktreeExecutionOwner(
    selectWorktreesByRepo(state),
    state.repos,
    worktreeId,
    selectedHost
  )
  if (!owner) {
    return null
  }
  const { hostId, worktree } = owner
  const repo = state.repos.find(
    (candidate) => candidate.id === worktree.repoId && getRepoExecutionHostId(candidate) === hostId
  )
  if (!repo || worktree.isArchived || worktree.isBare) {
    return null
  }
  return {
    key: JSON.stringify([hostId, worktree.identity?.key ?? worktreeId]),
    worktreeId,
    hostId,
    publicId,
    name: worktree.displayName,
    git: isFolderRepo(repo) ? null : { repo, worktree }
  }
}

export type WorkspaceViewGrant = 'read' | 'rename'

const PREFIX = 'orca.plugin-workspace-views.'
const WORKSPACE_VIEW_GRANT_CHANGED = 'orca:plugin-workspace-grant'

export function notifyWorkspaceViewGrant(key: string): void {
  window.dispatchEvent(new CustomEvent(WORKSPACE_VIEW_GRANT_CHANGED, { detail: key }))
}

export function workspaceViewGrantKey(pluginKey: string, scope: WorkspaceViewScope): string {
  return PREFIX + JSON.stringify([pluginKey, scope.key])
}

export function workspaceViewGrant(key: string): WorkspaceViewGrant | null {
  try {
    const value = localStorage.getItem(key)
    return value === 'read' || value === 'rename' ? value : null
  } catch {
    return null
  }
}

export function subscribeWorkspaceViewGrant(onChange: (key: string | null) => void): () => void {
  const storage = (event: StorageEvent) => onChange(event.key)
  const local = (event: Event) => {
    if ('detail' in event && typeof event.detail === 'string') {
      onChange(event.detail)
    }
  }
  window.addEventListener('storage', storage)
  window.addEventListener(WORKSPACE_VIEW_GRANT_CHANGED, local)
  return () => {
    window.removeEventListener('storage', storage)
    window.removeEventListener(WORKSPACE_VIEW_GRANT_CHANGED, local)
  }
}
