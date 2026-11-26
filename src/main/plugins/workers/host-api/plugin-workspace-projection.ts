import type { z } from 'zod'
import { createHash } from 'node:crypto'
import {
  shortPluginBranchName,
  workspaceChangedPayloadSchema
} from '../../../../shared/plugins/events/plugin-events'
import type { PluginEventName } from '../../../../shared/plugins/manifest/plugin-manifest'
import {
  PLUGIN_TERMINAL_ID_MAX_LENGTH,
  PLUGIN_WORKSPACE_LABEL_MAX_LENGTH,
  PLUGIN_WORKSPACE_TERMINAL_LIMIT,
  type pluginWorkspaceContextSchema
} from '../../../../shared/plugins/workers/plugin-host-api'
import {
  PLUGIN_AGENT_LIST_LIMIT,
  PLUGIN_AGENT_TASK_TITLE_MAX,
  pluginAgentSessionIdSchema
} from '../../../../shared/plugins/workers/plugin-host-api-panel-methods'
import {
  PLUGIN_HOST_ID_MAX_LENGTH,
  pluginWorkspaceId
} from '../../../../shared/plugins/workers/plugin-host-api-workspace-methods'
import { parseWorkspaceKey } from '../../../../shared/workspace/identity/workspace-scope'
import type { AgentStatusIpcPayload } from '../../../../shared/agent-status/contracts/agent-status-ipc-payload'
import {
  getConnectionExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host/execution-host'
import { mainAgentState } from '../../../../shared/agent-status/lifecycle/main-agent-status'

/** One terminal of a workspace, as main's runtime lists it. */
export type PluginWorkspaceTerminal = {
  /** The terminal handle plugins call `terminalId`. */
  id: string
  title?: string
  /** `tabId:leafId`, which agent statuses carry. */
  paneKey?: string
  executionHostId?: ExecutionHostId
  connected?: boolean
  folderKey?: string
}

/** One agent row from the hook server's status store (the fields plugins may see). */
export type PluginAgentStatusRow = Pick<
  AgentStatusIpcPayload,
  | 'paneKey'
  | 'worktreeId'
  | 'terminalHandle'
  | 'state'
  | 'agentType'
  | 'stateStartedAt'
  | 'providerSessionOnly'
  | 'providerSession'
  | 'restoredUnconfirmed'
  | 'subagents'
  | 'mainAgent'
> & { connectionId?: string | null; receivedAt?: number }

export type PluginWorkspaceContext = z.output<typeof pluginWorkspaceContextSchema>

type Context = { worktreeId: string; identityKey?: string; branch: string; displayName: string }

/** The session id a plugin may see: what `agent.resume` accepts, else none. */
export function pluginAgentSessionId(
  session: { id: string } | null | undefined
): string | undefined {
  const id = session?.id
  return id && pluginAgentSessionIdSchema.safeParse(id).success ? id : undefined
}

/** A pane's own name wins over the title its program sets. */
export function pluginTerminalTitle(terminal: {
  title: string | null
  paneTitle?: string
}): string | undefined {
  const title = (terminal.paneTitle ?? terminal.title ?? '').trim()
  return title ? title.slice(0, PLUGIN_WORKSPACE_LABEL_MAX_LENGTH) : undefined
}

/** The id `workspace.list` gives, or undefined when it exceeds the public bound. */
export function pluginListedWorkspaceId(row: {
  id: string
  identityKey?: string | null
}): string | undefined {
  const id = pluginWorkspaceId(row)
  return id.length <= PLUGIN_HOST_ID_MAX_LENGTH ? id : undefined
}

/**
 * What a frame (panel, editor) may see of a context: no raw workspace id, which embeds the
 * workspace's path. Only the path-free forms (`identity:`, `folder:`) reach frames.
 */
export function pluginFrameWorkspaceContext(
  context: PluginWorkspaceContext
): PluginWorkspaceContext {
  const id = context?.workspaceId
  if (!context || !id || id.startsWith('identity:') || parseWorkspaceKey(id)?.type === 'folder') {
    return context
  }
  const { workspaceId: _rawId, ...pathFree } = context
  return pathFree
}

/** An event payload as frames get it: `workspace.changed` without a raw workspace id. */
export function pluginFrameEventPayload(event: PluginEventName, payload: unknown): unknown {
  const changed = event === 'workspace.changed' && workspaceChangedPayloadSchema.safeParse(payload)
  return changed && changed.success
    ? { context: pluginFrameWorkspaceContext(changed.data.context) }
    : payload
}

/** Only these public fields reach plugins; the id is the one `workspace.list` gives. */
export function projectPluginWorkspaceContext(
  context: Context | null,
  terminals: readonly PluginWorkspaceTerminal[]
): PluginWorkspaceContext {
  if (!context) {
    return null
  }
  const workspaceId = pluginListedWorkspaceId({
    id: context.worktreeId,
    identityKey: context.identityKey
  })
  return {
    ...(workspaceId ? { workspaceId } : {}),
    branch: shortPluginBranchName(context.branch).slice(0, PLUGIN_WORKSPACE_LABEL_MAX_LENGTH),
    displayName: context.displayName.slice(0, PLUGIN_WORKSPACE_LABEL_MAX_LENGTH),
    terminals: terminals
      .filter(({ id }) => id.length > 0 && id.length <= PLUGIN_TERMINAL_ID_MAX_LENGTH)
      .slice(0, PLUGIN_WORKSPACE_TERMINAL_LIMIT)
      .map(({ id, title }) => (title ? { id, title } : { id }))
  }
}

/** The terminal an agent's pane is: by the handle its status names, else by pane key. */
export function terminalForPane(
  terminals: readonly PluginWorkspaceTerminal[],
  row: Pick<PluginAgentStatusRow, 'paneKey' | 'terminalHandle'>
): PluginWorkspaceTerminal | undefined {
  return (
    terminals.find((terminal) => terminal.id === row.terminalHandle) ??
    terminals.find((terminal) => terminal.paneKey === row.paneKey)
  )
}

/** `agents.list`: the focused workspace's agents, newest state first. */
export function projectPluginWorkspaceAgents(
  worktreeId: string,
  terminals: readonly PluginWorkspaceTerminal[],
  rows: readonly PluginAgentStatusRow[],
  readTaskTitles: () => ReadonlyMap<string, string> = () => new Map(),
  includeLiveIdentity = false
) {
  const workspaceRows = rows.filter(
    (row) => row.worktreeId === worktreeId && row.providerSessionOnly !== true
  )
  const listed = workspaceRows
    .toSorted((a, b) => b.stateStartedAt - a.stateStartedAt)
    .slice(0, PLUGIN_AGENT_LIST_LIMIT)
  const taskTitles = listed.length > 0 ? readTaskTitles() : new Map<string, string>()
  const folderAgents = new Map<string, Set<string>>()
  const matched = listed.map((row) => {
    const host = getConnectionExecutionHostId(row.connectionId)
    const sessionId = pluginAgentSessionId(row.providerSession) ?? null
    const terminal = terminalForPane(
      terminals.filter(
        ({ executionHostId }) => executionHostId === undefined || executionHostId === host
      ),
      row
    )
    const liveTerminal =
      terminal?.connected === true &&
      terminal.paneKey === row.paneKey &&
      terminal.executionHostId === host &&
      !row.restoredUnconfirmed
        ? terminal
        : undefined
    const folder = mainAgentState(row) === 'working' ? liveTerminal?.folderKey : undefined
    if (folder && terminal) {
      const peers = folderAgents.get(folder) ?? new Set<string>()
      peers.add(terminal.id)
      folderAgents.set(folder, peers)
    }
    const liveIdentity =
      includeLiveIdentity &&
      liveTerminal &&
      sessionId &&
      (!row.terminalHandle || row.terminalHandle === liveTerminal.id) &&
      typeof row.receivedAt === 'number' &&
      row.receivedAt > 0 &&
      Number.isFinite(row.receivedAt) &&
      row.paneKey.length > 0 &&
      row.paneKey.length <= 2048 &&
      terminals.filter((item) => item.paneKey === row.paneKey && item.executionHostId === host)
        .length === 1 &&
      !workspaceRows.some(
        (item) =>
          item !== row &&
          (item.providerSession?.id === sessionId ||
            (item.paneKey === row.paneKey &&
              getConnectionExecutionHostId(item.connectionId) === host))
      )
        ? { paneKey: row.paneKey, hostId: host, receivedAt: row.receivedAt }
        : undefined
    return { row, terminal, folder, liveTerminalId: liveTerminal?.id, liveIdentity, sessionId }
  })
  return matched.map(({ row, terminal, folder, liveTerminalId, liveIdentity, sessionId }) => {
    const taskTitle = taskTitles.get(row.paneKey)
    const children = liveTerminalId
      ? row.subagents?.slice(0, 16).flatMap(({ id, state, startedAt }) =>
          state === 'unverifiable'
            ? []
            : [
                {
                  id: `child:${createHash('sha256')
                    .update(
                      JSON.stringify([liveTerminalId, row.providerSession?.id, id, startedAt])
                    )
                    .digest('hex')}`,
                  state,
                  startedAt
                }
              ]
        )
      : undefined
    return {
      terminalId: terminal?.id ?? null,
      title: terminal?.title ?? null,
      agent: row.agentType?.slice(0, 128) ?? null,
      state: row.state,
      stateStartedAt: row.stateStartedAt,
      ...(folder && (folderAgents.get(folder)?.size ?? 0) > 1
        ? { sameFolderRival: true as const }
        : {}),
      ...(children?.length ? { children, leadWorking: row.mainAgent?.state === 'working' } : {}),
      sessionId,
      ...(liveIdentity ? { liveIdentity } : {}),
      // Only that it is a dispatched task, and its title: never the dispatch's own records.
      task:
        taskTitle === undefined ? null : { title: taskTitle.slice(0, PLUGIN_AGENT_TASK_TITLE_MAX) }
    }
  })
}
