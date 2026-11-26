import { translate } from '@/i18n/i18n'
import {
  WORKSPACE_VIEW_COMPANIONS,
  WORKSPACE_VIEW_CLEAR_COMPANIONS,
  internalWorkspaceCompanionRows,
  workspaceCompanionPortrait
} from '../../../../../shared/plugins/frames/plugin-workspace-view'
import type { PluginHostCallOutcome } from '../../../../../shared/plugins/frames/plugin-protocol'
import { callPanelActionViaPreload, type PanelActionCall } from './plugin-frame-host'
import {
  workspaceCompanionAllowed,
  workspaceCompanionGrants,
  type WorkspaceViewScope
} from './plugin-workspace-view-scope'

export function createWorkspaceCompanionView(
  onExpiry: () => void,
  stale: () => PluginHostCallOutcome
) {
  let companionSession: string | undefined
  let fatigueExpiry: ReturnType<typeof setTimeout> | undefined

  function callCompanions(sessionToken: string, params: unknown) {
    return callPanelActionViaPreload({ sessionToken, action: WORKSPACE_VIEW_COMPANIONS, params })
  }

  return {
    reset(handle: string) {
      clearTimeout(fatigueExpiry)
      if (companionSession) {
        void callPanelActionViaPreload({
          sessionToken: companionSession,
          action: WORKSPACE_VIEW_CLEAR_COMPANIONS,
          params: { workspace: handle }
        }).catch(() => {})
        companionSession = undefined
      }
    },
    async read({
      call,
      scope,
      revision,
      key,
      isCurrent
    }: {
      call: PanelActionCall
      scope: WorkspaceViewScope
      revision: string
      key: string
      isCurrent: () => boolean
    }): Promise<PluginHostCallOutcome> {
      const grants = workspaceCompanionGrants(key)
      const companions: { terminalId: string; target?: string; sessionLimitNear?: boolean }[] = []
      if (grants.fatigue || grants.portraits) {
        companionSession = call.sessionToken
        const current = scope
        const result = await callCompanions(call.sessionToken, {
          operation: 'read',
          workspace: revision,
          worktreeId: current.worktreeId,
          hostId: current.hostId,
          ...grants
        })
        if (!isCurrent()) {
          return stale()
        }
        if (!result.ok) {
          return result
        }
        const rows = internalWorkspaceCompanionRows.safeParse(result.value)
        if (!rows.success) {
          return stale()
        }
        clearTimeout(fatigueExpiry)
        let nextExpiry = Infinity
        const now = Date.now()
        for (const { terminalId, target, sessionLimitNear, expiresAt } of rows.data) {
          const liveLimit = grants.fatigue && expiresAt !== undefined && expiresAt > now
          if (liveLimit) {
            nextExpiry = Math.min(nextExpiry, expiresAt)
          }
          companions.push({
            terminalId,
            ...(grants.portraits && target ? { target } : {}),
            ...(liveLimit ? { sessionLimitNear } : {})
          })
        }
        if (Number.isFinite(nextExpiry)) {
          fatigueExpiry = setTimeout(() => {
            if (isCurrent()) {
              onExpiry()
            }
          }, nextExpiry - now)
        }
      }
      return { ok: true, value: { workspace: revision, grants, companions } }
    },
    setPortrait(call: PanelActionCall, revision: string, key: string) {
      const parsed = workspaceCompanionPortrait.safeParse(call.params)
      if (!parsed.success || parsed.data.workspace !== revision) {
        return stale()
      }
      if (!workspaceCompanionAllowed(key, 'portraits')) {
        return {
          ok: false as const,
          code: 'capability_denied' as const,
          error: translate(
            'plugins.workspaceView.accessDenied',
            'Allow access to this workspace first.'
          )
        }
      }
      return callCompanions(call.sessionToken, { operation: 'portrait', ...parsed.data })
    }
  }
}
