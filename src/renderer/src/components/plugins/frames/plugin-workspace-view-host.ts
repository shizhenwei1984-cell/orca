import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'
import type { ConfirmationDialogContextValue } from '@/components/dismiss/confirmation/confirmation-dialog-context'
import type {
  PluginHostCallOutcome,
  PluginErrorCode
} from '../../../../../shared/plugins/frames/plugin-protocol'
import {
  WORKSPACE_VIEW_METHODS,
  workspaceViewAccessTarget,
  workspaceViewRefreshTarget
} from '../../../../../shared/plugins/frames/plugin-workspace-view'
import { createNonSecureContextUuid } from '../../../../../shared/identifiers/non-secure-context-uuid'
import type { PanelActionCall } from './plugin-frame-host'
import {
  authorizeWorkspaceViewFrame,
  visibleWorkspaceViewPlugin
} from './plugin-workspace-view-admission'
import { confirmWorkspaceViewAccess } from './plugin-workspace-view-consent'
import { createWorkspaceViewReview } from './plugin-workspace-view-review'
import {
  notifyWorkspaceViewGrant,
  resolveWorkspaceViewScope,
  subscribeWorkspaceViewGrant,
  workspaceViewGrant,
  workspaceViewGrantKey
} from './plugin-workspace-view-scope'
import {
  createWorkspaceViewTabActions,
  subscribeWorkspaceViewChatNames
} from './plugin-workspace-view-tabs'

function refusal(code: PluginErrorCode, error: string): PluginHostCallOutcome {
  return { ok: false, code, error }
}

function stale(): PluginHostCallOutcome {
  return refusal(
    'unavailable',
    translate('plugins.workspaceView.scopeChanged', 'The workspace view has changed.')
  )
}

export function createPluginWorkspaceViewHost(options: {
  tabKey: string
  sessionToken: () => string | null
  confirm: ConfirmationDialogContextValue | null
  onChange: (reset: boolean) => void
}) {
  let disposed = false
  let observed = false
  let scope = resolveWorkspaceViewScope(useAppStore.getState())
  let handle = createNonSecureContextUuid()
  const tabs = createWorkspaceViewTabActions()
  let timer: ReturnType<typeof setTimeout> | undefined
  let appearance: AbortController | undefined
  const review = createWorkspaceViewReview(notify)
  let stopChat: (() => void) | undefined
  let grantKey: string | undefined

  function notify() {
    if (!observed || disposed || timer) {
      return
    }
    timer = setTimeout(() => {
      timer = undefined
      options.onChange(false)
    }, 160)
  }

  function reset() {
    appearance?.abort()
    stopChat?.()
    stopChat = undefined
    handle = createNonSecureContextUuid()
    grantKey = undefined
    review.reset()
    tabs.reset()
    if (observed && !disposed) {
      options.onChange(true)
    }
  }

  function syncScope() {
    const next = resolveWorkspaceViewScope(useAppStore.getState())
    const changed = scope?.key !== next?.key
    scope = next
    if (changed) {
      reset()
    }
  }

  const stopState = useAppStore.subscribe((state, previous) => {
    syncScope()
    if (
      grantKey &&
      scope &&
      (state.groupsByWorktree[scope.worktreeId] !== previous.groupsByWorktree[scope.worktreeId] ||
        state.activeGroupIdByWorktree[scope.worktreeId] !==
          previous.activeGroupIdByWorktree[scope.worktreeId] ||
        state.unifiedTabsByWorktree[scope.worktreeId] !==
          previous.unifiedTabsByWorktree[scope.worktreeId] ||
        state.tabsByWorktree[scope.worktreeId] !== previous.tabsByWorktree[scope.worktreeId] ||
        state.openFiles !== previous.openFiles ||
        state.hostedReviewCache !== previous.hostedReviewCache ||
        state.prCache !== previous.prCache ||
        selectWorktreesByRepo(state) !== selectWorktreesByRepo(previous))
    ) {
      if (
        state.unifiedTabsByWorktree[scope.worktreeId] !==
          previous.unifiedTabsByWorktree[scope.worktreeId] ||
        state.openFiles !== previous.openFiles
      ) {
        tabs.prune(state, scope)
      }
      notify()
    }
  })
  const stopAuthority = window.api?.plugins?.onChanged?.(reset)
  const stopGrant = subscribeWorkspaceViewGrant((key) => {
    if (key === null || key === grantKey) {
      reset()
    }
  })

  return {
    async call(call: PanelActionCall): Promise<PluginHostCallOutcome> {
      if (disposed || call.sessionToken !== options.sessionToken()) {
        return stale()
      }
      syncScope()
      const revision = handle
      const authorized = await authorizeWorkspaceViewFrame(call.sessionToken)
      if (!authorized.ok) {
        return authorized
      }
      const { pluginKey } = authorized
      const plugin = visibleWorkspaceViewPlugin(pluginKey, options.tabKey)
      const isCurrent = () => {
        syncScope()
        return (
          !disposed &&
          revision === handle &&
          options.sessionToken() === call.sessionToken &&
          Boolean(visibleWorkspaceViewPlugin(pluginKey, options.tabKey))
        )
      }
      if (!plugin || !isCurrent()) {
        return stale()
      }
      if (call.action === WORKSPACE_VIEW_METHODS.read) {
        if (call.params !== undefined) {
          return refusal(
            'invalid_params',
            translate(
              'plugins.workspaceView.activeOnly',
              'The workspace view uses the active workspace.'
            )
          )
        }
        observed = true
      }
      if (!scope) {
        return call.action === WORKSPACE_VIEW_METHODS.read ? { ok: true, value: null } : stale()
      }
      const key = workspaceViewGrantKey(pluginKey, scope)
      grantKey = key
      const grant = workspaceViewGrant(key)
      if (call.action === WORKSPACE_VIEW_METHODS.access) {
        const parsed = workspaceViewAccessTarget.safeParse(call.params)
        if (!parsed.success || parsed.data.workspace !== handle || !options.confirm || appearance) {
          return stale()
        }
        const controller = new AbortController()
        appearance = controller
        try {
          const changed = await confirmWorkspaceViewAccess(options.confirm, {
            pluginName: plugin.name,
            scope,
            key,
            revoke: parsed.data.revoke === true,
            signal: controller.signal,
            isCurrent: async () => {
              if (!isCurrent()) {
                return false
              }
              const admitted = await authorizeWorkspaceViewFrame(call.sessionToken)
              return admitted.ok && admitted.pluginKey === pluginKey && isCurrent()
            }
          })
          if (changed) {
            notifyWorkspaceViewGrant(key)
          }
          return { ok: true, value: { changed } }
        } finally {
          appearance = undefined
        }
      }
      const state = useAppStore.getState()
      if (call.action === WORKSPACE_VIEW_METHODS.read) {
        const base = {
          workspace: handle,
          workspaceId: scope.publicId ?? null,
          hostId: scope.hostId,
          grant
        }
        if (!grant) {
          return {
            ok: true,
            value: { ...base, tabs: [], selected: null, git: null, truncated: false }
          }
        }
        stopChat ??= subscribeWorkspaceViewChatNames(scope, notify)
        return {
          ok: true,
          value: {
            ...base,
            ...tabs.project(state, scope),
            git: review.project(state, scope)
          }
        }
      }
      if (!grant) {
        return refusal(
          'capability_denied',
          translate('plugins.workspaceView.accessDenied', 'Allow access to this workspace first.')
        )
      }
      if (call.action === WORKSPACE_VIEW_METHODS.refresh) {
        const parsed = workspaceViewRefreshTarget.safeParse(call.params)
        if (!parsed.success || parsed.data.workspace !== handle || !scope.git) {
          return stale()
        }
        review.refresh(state, scope, true)
        return { ok: true, value: null }
      }
      return tabs.apply({
        state,
        scope,
        handle,
        call,
        canRename: () => isCurrent() && workspaceViewGrant(key) === 'rename'
      })
    },
    permitsHandle(value: string): boolean {
      syncScope()
      return (
        !disposed &&
        value === handle &&
        grantKey !== undefined &&
        workspaceViewGrant(grantKey) !== null
      )
    },
    dispose() {
      disposed = true
      reset()
      clearTimeout(timer)
      stopState()
      stopAuthority?.()
      stopGrant()
    }
  }
}
