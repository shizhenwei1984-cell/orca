import { z } from 'zod'

export const WORKSPACE_VIEW_METHODS = {
  read: 'workspace.view',
  companions: 'workspace.companions',
  portrait: 'workspace.companionPortrait',
  access: 'workspace.viewAccess',
  select: 'workspace.selectTab',
  rename: 'workspace.renameTab',
  refresh: 'workspace.refreshReview'
} as const
export const WORKSPACE_VIEW_CHANGED = 'workspace.viewChanged'
export const WORKSPACE_VIEW_AUTHORIZATION = 'internal.workspaceViewAuthorization'
export const WORKSPACE_VIEW_COMPANIONS = 'internal.workspaceViewCompanions'
export const WORKSPACE_VIEW_CLEAR_COMPANIONS = 'internal.workspaceViewClearCompanions'

export const workspaceCompanionPermission = z.enum(['fatigue', 'portraits'])
export type WorkspaceCompanionPermission = z.infer<typeof workspaceCompanionPermission>
export const COMPANION_PORTRAIT_SIZE = 40
const portraitLength = Math.ceil((COMPANION_PORTRAIT_SIZE ** 2 * 4) / 3) * 4

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
  capability: workspaceCompanionPermission.optional(),
  revoke: z.boolean().optional()
})
export const workspaceCompanionPortrait = z.strictObject({
  workspace: workspaceViewHandle,
  target: workspaceViewHandle,
  rgba: z
    .string()
    .length(portraitLength)
    .regex(/^[A-Za-z0-9+/]+={1,2}$/)
    .nullable()
})
export const internalWorkspaceCompanions = z.discriminatedUnion('operation', [
  z.strictObject({
    operation: z.literal('read'),
    workspace: workspaceViewHandle,
    worktreeId: z.string().min(1).max(8192),
    hostId: z.string().min(1).max(1024),
    fatigue: z.boolean(),
    portraits: z.boolean()
  }),
  workspaceCompanionPortrait.extend({ operation: z.literal('portrait') })
])
export const workspaceCompanionClearTarget = z.strictObject({ workspace: workspaceViewHandle })
export const internalWorkspaceCompanionRows = z.array(
  z.object({
    terminalId: z.string(),
    target: workspaceViewHandle.optional(),
    sessionLimitNear: z.boolean().optional(),
    expiresAt: z.number().optional()
  })
)

export function isInternalWorkspaceViewMethod(method: string): boolean {
  return (
    method === WORKSPACE_VIEW_AUTHORIZATION ||
    method === WORKSPACE_VIEW_COMPANIONS ||
    method === WORKSPACE_VIEW_CLEAR_COMPANIONS
  )
}
export const workspaceViewRefreshTarget = z.strictObject({ workspace: workspaceViewHandle })

export function isWorkspaceViewMethod(method: string): boolean {
  return Object.values<string>(WORKSPACE_VIEW_METHODS).includes(method)
}

export function workspaceViewFrameMethods(surface: string, isolatedGuest: boolean): string[] {
  return surface === 'panel' && isolatedGuest ? Object.values(WORKSPACE_VIEW_METHODS) : []
}
