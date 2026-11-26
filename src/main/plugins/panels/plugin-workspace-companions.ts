import { randomUUID } from 'node:crypto'
import type { NativeImage } from 'electron'
import { parseExecutionHostId } from '../../../shared/execution-host/execution-host'
import { internalWorkspaceCompanions } from '../../../shared/plugins/frames/plugin-workspace-view'
import type { PluginHostCallOutcome } from '../../../shared/plugins/frames/plugin-protocol'
import { PLUGIN_WORKSPACE_TERMINAL_LIMIT } from '../../../shared/plugins/workers/plugin-host-api-workspace-context'
import type { RuntimeTerminalSummary } from '../../../shared/terminal/runtime/runtime-terminal-contracts'
import { makePaneKey } from '../../../shared/workspace-layout/stable-pane-id'
import {
  companionPortraitFromPixels,
  setCompanionPortraitSource
} from '../../notifications/companion-notification-portraits'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'

type Terminal = RuntimeTerminalSummary & { ptyId: string; incarnationId: string }
type Target = {
  token: string
  terminal: Terminal
  portrait?: NativeImage
}
type ScopedPanel = {
  workspace: string
  worktreeId: string
  hostId: string
  targets: Map<string, Target>
  readRevision: number
}

export type WorkspaceCompanionsOptions = {
  runtime: Pick<OrcaRuntimeService, 'listTerminals' | 'resolveTerminalPane'>
  loadFatigueReader(): Promise<
    (terminal: RuntimeTerminalSummary) => { near: boolean; expiresAt: number } | undefined
  >
}

export class PluginWorkspaceCompanions {
  private readonly panels = new Map<string, ScopedPanel>()

  constructor(private readonly options: WorkspaceCompanionsOptions) {}

  close(panelId: string, workspace?: string): void {
    if (workspace && this.panels.get(panelId)?.workspace !== workspace) {
      return
    }
    this.panels.delete(panelId)
    setCompanionPortraitSource(panelId)
  }

  private currentTerminal(terminal: Terminal): boolean {
    try {
      const current = this.options.runtime.resolveTerminalPane(
        makePaneKey(terminal.tabId, terminal.leafId),
        terminal.worktreeId
      )
      return (
        current.connected === true &&
        current.handle === terminal.handle &&
        current.executionHostId === terminal.executionHostId &&
        current.ptyId === terminal.ptyId &&
        current.incarnationId === terminal.incarnationId
      )
    } catch {
      return false
    }
  }

  async call(
    panelId: string,
    params: unknown,
    isCurrent: () => boolean
  ): Promise<PluginHostCallOutcome> {
    const parsed = internalWorkspaceCompanions.safeParse(params)
    if (!parsed.success) {
      return { ok: false, code: 'invalid_params', error: 'Invalid companion request.' }
    }
    const input = parsed.data
    const previous = this.panels.get(panelId)
    if (input.operation === 'portrait') {
      const target = previous?.targets.get(input.target)
      if (
        previous?.workspace !== input.workspace ||
        !target ||
        !this.currentTerminal(target.terminal)
      ) {
        return { ok: false, code: 'unavailable', error: 'The companion target has changed.' }
      }
      target.portrait = input.rgba === null ? undefined : companionPortraitFromPixels(input.rgba)
      return { ok: true, value: null }
    }
    if (!parseExecutionHostId(input.hostId) || (!input.fatigue && !input.portraits)) {
      return { ok: true, value: [] }
    }

    const panel =
      previous?.workspace === input.workspace &&
      previous.worktreeId === input.worktreeId &&
      previous.hostId === input.hostId
        ? previous
        : {
            workspace: input.workspace,
            worktreeId: input.worktreeId,
            hostId: input.hostId,
            targets: new Map(),
            readRevision: 0
          }
    this.panels.set(panelId, panel)
    const revision = ++panel.readRevision
    const [result, readFatigue] = await Promise.all([
      this.options.runtime
        .listTerminals(`id:${input.worktreeId}`, PLUGIN_WORKSPACE_TERMINAL_LIMIT, {
          includeVisualLayouts: false
        })
        .catch(() => null),
      input.fatigue && input.hostId === 'local' ? this.options.loadFatigueReader() : undefined
    ])
    if (!isCurrent() || this.panels.get(panelId) !== panel || revision !== panel.readRevision) {
      return { ok: false, code: 'unavailable', error: 'The workspace view has changed.' }
    }
    const targets = new Map<string, Target>()
    const tokensByHandle = new Map(
      [...panel.targets.values()].map((target) => [target.terminal.handle, target])
    )
    const companions = (result?.terminals ?? []).flatMap((terminal) => {
      if (
        terminal.worktreeId !== input.worktreeId ||
        terminal.executionHostId !== input.hostId ||
        !terminal.connected ||
        terminal.orphaned ||
        !terminal.ptyId ||
        !terminal.incarnationId
      ) {
        return []
      }
      const live = { ...terminal, ptyId: terminal.ptyId, incarnationId: terminal.incarnationId }
      if (!this.currentTerminal(live)) {
        return []
      }
      const limit = readFatigue?.(live)
      if (!input.portraits && !limit) {
        return []
      }
      const old = tokensByHandle.get(live.handle)
      const target =
        old?.terminal.incarnationId === live.incarnationId &&
        old.terminal.ptyId === live.ptyId &&
        old.terminal.tabId === live.tabId &&
        old.terminal.leafId === live.leafId
          ? old
          : { token: randomUUID(), terminal: live }
      if (input.portraits) {
        targets.set(target.token, target)
      }
      return [
        {
          terminalId: live.handle,
          ...(input.portraits ? { target: target.token } : {}),
          ...(limit ? { sessionLimitNear: limit.near, expiresAt: limit.expiresAt } : {})
        }
      ]
    })
    panel.targets = targets
    setCompanionPortraitSource(
      panelId,
      input.portraits
        ? (request) => {
            if (
              !isCurrent() ||
              this.panels.get(panelId) !== panel ||
              request.worktreeId !== panel.worktreeId ||
              request.workspaceExecutionHostId !== panel.hostId
            ) {
              return undefined
            }
            for (const { terminal, portrait } of panel.targets.values()) {
              if (
                portrait &&
                request.terminalPtyId === terminal.ptyId &&
                request.terminalIncarnationId === terminal.incarnationId &&
                request.paneKey === makePaneKey(terminal.tabId, terminal.leafId) &&
                this.currentTerminal(terminal)
              ) {
                return portrait
              }
            }
            return undefined
          }
        : undefined
    )
    return { ok: true, value: companions }
  }
}
