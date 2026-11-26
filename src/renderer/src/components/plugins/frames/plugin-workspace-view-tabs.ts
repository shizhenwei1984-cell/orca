import { translate } from '@/i18n/i18n'
import { createNonSecureContextUuid } from '../../../../../shared/identifiers/non-secure-context-uuid'
import { normalizeAgentSessionConversationName } from '../../../../../shared/agent-session/conversation-naming/agent-session-conversation-name'
import {
  WORKSPACE_VIEW_METHODS,
  workspaceViewRenameTarget,
  workspaceViewTabTarget
} from '../../../../../shared/plugins/frames/plugin-workspace-view'
import type { PluginHostCallOutcome } from '../../../../../shared/plugins/frames/plugin-protocol'
import type { PanelActionCall } from './plugin-frame-host'
import { useAppStore } from '@/store'
import { basename } from '@/lib/path'
import type { AppState } from '@/store/types'
import { selectActiveTabForWorktree } from '@/store/slices/tabs/active-tab-selection'
import {
  findAmbiguousWorktreeIds,
  findDuplicateIds,
  getPaletteOwnershipWorktreeIds,
  hasOpenFileExecutionHostEvidence,
  isOpenFileOwnedByWorktree,
  isUnifiedTabOwnedByWorktree
} from '@/lib/workspace/ownership/unified-tab-host-ownership'
import { activateWorkspaceTabPaletteResult } from '@/lib/workspace/search/tabs/workspace-tab-palette-activation'
import { readStructuredChatTabName } from '@/runtime/native-chat/naming/structured-chat-tab-name'
import {
  structuredAgentSessionOwnerForTab,
  structuredAgentSessionTargetForHost
} from '@/runtime/native-chat/session-ownership/structured-agent-session-owner'
import { getStructuredAgentSessionStatusFeed } from '@/runtime/native-chat/status/structured-agent-session-status-feed'
import type { Tab } from '../../../../../shared/workspace-layout/tab-groups/tab-types'
import type { WorkspaceViewScope } from './plugin-workspace-view-scope'
import { resolveTerminalTabTitle } from '../../../../../shared/workspace-layout/tab-groups/tab-title-resolution'

const TAB_LIMIT = 50

type WorkspaceViewTab = {
  tab: Tab & { contentType: 'terminal' | 'editor' | 'agent-session' }
  type: 'terminal' | 'editor' | 'chat'
  title: string
}

function eligibleWorkspaceViewTabs(state: AppState, scope: WorkspaceViewScope) {
  const { worktreeId, hostId } = scope
  const worktree = { id: worktreeId, hostId }
  const candidates = state.unifiedTabsByWorktree[worktreeId] ?? []
  const duplicates = findDuplicateIds(candidates)
  const ambiguous = findAmbiguousWorktreeIds(getPaletteOwnershipWorktreeIds(state))
  const groups = state.groupsByWorktree[worktreeId] ?? []
  const inStrip = new Set(groups.flatMap((group) => group.tabOrder))
  const items: WorkspaceViewTab[] = []
  for (const tab of candidates) {
    if (
      (tab.contentType !== 'terminal' &&
        tab.contentType !== 'agent-session' &&
        tab.contentType !== 'editor') ||
      !inStrip.has(tab.id) ||
      duplicates.has(tab.id) ||
      !isUnifiedTabOwnedByWorktree(tab, worktree, ambiguous)
    ) {
      continue
    }
    switch (tab.contentType) {
      case 'terminal': {
        const terminals = state.tabsByWorktree[worktreeId]?.filter(({ id }) => id === tab.entityId)
        if (terminals?.length === 1) {
          items.push({
            tab: { ...tab, contentType: 'terminal' },
            type: 'terminal',
            title: resolveTerminalTabTitle(
              terminals[0],
              state.settings?.tabAutoGenerateTitle === true,
              'Terminal'
            )
          })
        }
        break
      }
      case 'agent-session':
        if (structuredAgentSessionOwnerForTab(state, tab) === hostId) {
          items.push({
            tab: { ...tab, contentType: 'agent-session' },
            type: 'chat',
            title: readStructuredChatTabName(tab, state)
          })
        }
        break
      case 'editor': {
        const files = state.openFiles.filter((file) => file.id === tab.entityId)
        const file = files.length === 1 ? files[0] : null
        if (
          file?.worktreeId === worktreeId &&
          ((!hasOpenFileExecutionHostEvidence(file) && !ambiguous.has(worktreeId)) ||
            isOpenFileOwnedByWorktree(file, worktree))
        ) {
          items.push({
            tab: { ...tab, contentType: 'editor' },
            type: 'editor',
            title: basename(file.filePath)
          })
        }
        break
      }
    }
  }
  const selected = selectActiveTabForWorktree(state, worktreeId)?.id
  const limited = items.slice(0, TAB_LIMIT)
  const selectedItem = items.find((item) => item.tab.id === selected)
  if (selectedItem && !limited.includes(selectedItem)) {
    limited[TAB_LIMIT - 1] = selectedItem
  }
  return { items: limited, selected, truncated: items.length > TAB_LIMIT }
}

function workspaceViewTabKey({ tab }: WorkspaceViewTab): string {
  return JSON.stringify([tab.id, tab.contentType, tab.entityId, tab.createdAt, tab.executionHostId])
}

function selectWorkspaceViewTab(scope: WorkspaceViewScope, { tab }: WorkspaceViewTab): boolean {
  return (
    activateWorkspaceTabPaletteResult({
      tabId: tab.id,
      entityId: tab.entityId,
      groupId: tab.groupId,
      contentType: tab.contentType,
      worktreeId: scope.worktreeId,
      executionHostId: scope.hostId
    }).status === 'activated'
  )
}

function workspaceViewRenameId(state: AppState, item: WorkspaceViewTab): string | null {
  if (item.type === 'editor') {
    return null
  }
  const id = item.type === 'terminal' ? item.tab.entityId : item.tab.id
  const matching = Object.values(state.unifiedTabsByWorktree)
    .flat()
    .filter(
      (tab) =>
        (tab.contentType === 'terminal' && tab.entityId === id) ||
        (tab.contentType === 'agent-session' && tab.id === id)
    )
  const backingTerminals = Object.values(state.tabsByWorktree)
    .flat()
    .filter((tab) => tab.id === id)
  return matching.length === 1 && backingTerminals.length === Number(item.type === 'terminal')
    ? id
    : null
}

export function subscribeWorkspaceViewChatNames(scope: WorkspaceViewScope, change: () => void) {
  const target = structuredAgentSessionTargetForHost(scope.hostId)
  return target ? getStructuredAgentSessionStatusFeed(target).subscribe(change) : undefined
}

export function createWorkspaceViewTabActions() {
  let handles = new Map<string, string>()

  return {
    reset() {
      handles.clear()
    },
    prune(state: AppState, scope: WorkspaceViewScope) {
      if (handles.size) {
        const retained = new Set(
          eligibleWorkspaceViewTabs(state, scope).items.map(workspaceViewTabKey)
        )
        for (const key of handles.keys()) {
          if (!retained.has(key)) {
            handles.delete(key)
          }
        }
      }
    },
    project(state: AppState, scope: WorkspaceViewScope) {
      const { items, selected, truncated } = eligibleWorkspaceViewTabs(state, scope)
      const previous = handles
      handles = new Map()
      let selectedId: string | null = null
      const tabs = items.map((item) => {
        const key = workspaceViewTabKey(item)
        const id = previous.get(key) ?? createNonSecureContextUuid()
        handles.set(key, id)
        if (item.tab.id === selected) {
          selectedId = id
        }
        return { id, type: item.type, title: item.title.slice(0, 200) }
      })
      return { tabs, selected: selectedId, truncated }
    },
    apply({
      state,
      scope,
      handle,
      call,
      canRename
    }: {
      state: AppState
      scope: WorkspaceViewScope
      handle: string
      call: PanelActionCall
      canRename: () => boolean
    }): PluginHostCallOutcome {
      const rename = call.action === WORKSPACE_VIEW_METHODS.rename
      const parsed = (rename ? workspaceViewRenameTarget : workspaceViewTabTarget).safeParse(
        call.params
      )
      const stale = {
        ok: false,
        code: 'unavailable',
        error: translate('plugins.workspaceView.targetChanged', 'The tab or workspace has changed.')
      } as const
      if (!parsed.success || parsed.data.workspace !== handle) {
        return stale
      }
      const { tab } = parsed.data
      const item = eligibleWorkspaceViewTabs(state, scope).items.find(
        (candidate) => handles.get(workspaceViewTabKey(candidate)) === tab
      )
      if (!item) {
        return stale
      }
      if (rename) {
        const id = workspaceViewRenameId(state, item)
        const title =
          'title' in parsed.data && normalizeAgentSessionConversationName(parsed.data.title)
        if (!id || !canRename()) {
          return {
            ok: false,
            code: 'capability_denied',
            error: translate(
              'plugins.workspaceView.renameDenied',
              'Rename access is unavailable for this tab.'
            )
          }
        }
        if (!title) {
          return {
            ok: false,
            code: 'invalid_params',
            error: translate('plugins.workspaceView.emptyTitle', 'Enter a tab title.')
          }
        }
        const tabKey = workspaceViewTabKey(item)
        state.setTabCustomTitle(id, title, {
          recordInteraction: false,
          isCurrent: () => {
            const latest = useAppStore.getState()
            return (
              canRename() &&
              handles.get(tabKey) === tab &&
              eligibleWorkspaceViewTabs(latest, scope).items.some(
                (candidate) =>
                  workspaceViewTabKey(candidate) === tabKey &&
                  workspaceViewRenameId(latest, candidate) === id
              )
            )
          }
        })
      } else if (!selectWorkspaceViewTab(scope, item)) {
        return stale
      }
      return { ok: true, value: null }
    }
  }
}
