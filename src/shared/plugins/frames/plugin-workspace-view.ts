import { z } from 'zod'

export const WORKSPACE_VIEW_METHODS = {
  read: 'workspace.view',
  access: 'workspace.viewAccess',
  select: 'workspace.selectTab',
  rename: 'workspace.renameTab',
  refresh: 'workspace.refreshReview'
} as const
export const WORKSPACE_VIEW_CHANGED = 'workspace.viewChanged'
export const WORKSPACE_VIEW_AUTHORIZATION = 'internal.workspaceViewAuthorization'

export const workspaceViewHandle = z.string().uuid()
export const workspaceViewTabTarget = z.strictObject({
  workspace: workspaceViewHandle,
  tab: workspaceViewHandle
})
export const workspaceViewRenameTarget = workspaceViewTabTarget.extend({
  title: z.string().trim().min(1).max(200)
})
export const workspaceViewAccessTarget = z.strictObject({
  workspace: workspaceViewHandle,
  revoke: z.boolean().optional()
})
export const workspaceViewRefreshTarget = z.strictObject({ workspace: workspaceViewHandle })

export function isWorkspaceViewMethod(method: string): boolean {
  return Object.values<string>(WORKSPACE_VIEW_METHODS).includes(method)
}

export function workspaceViewFrameMethods(surface: string, isolatedGuest: boolean): string[] {
  return surface === 'panel' && isolatedGuest ? Object.values(WORKSPACE_VIEW_METHODS) : []
}
