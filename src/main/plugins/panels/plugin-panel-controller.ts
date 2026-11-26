import {
  WORKSPACE_VIEW_AUTHORIZATION,
  WORKSPACE_VIEW_CLEAR_COMPANIONS,
  isInternalWorkspaceViewMethod,
  workspaceCompanionClearTarget
} from '../../../shared/plugins/frames/plugin-workspace-view'
import {
  panelActionCallSchema,
  type PluginFrameEntry
} from '../../../shared/plugins/frames/plugin-frame-bridge'
import type {
  PluginHostCallOutcome,
  PluginSurface
} from '../../../shared/plugins/frames/plugin-protocol'
import {
  admitPluginPanelCall,
  createPluginPanelCallAdmission,
  type PluginPanelCallAdmission
} from '../../../shared/plugins/frames/plugin-panel-call-admission'
import type { ValidDiscoveredPlugin } from '../discovery/plugin-discovery'
import type { PluginHostCaller } from '../runtime/plugin-service-host-call'
import { getPluginHostMethodSpec } from '../../../shared/plugins/workers/plugin-host-api'
import type { PluginContentVerifier } from '../artifacts/plugin-content-integrity'
import { findFrameContribution, loadPluginPanel } from './plugin-panel-load'
import {
  PluginPanelSessions,
  type PluginPanelSessionBinding,
  type ResolvedPluginPanelSession
} from './panel-lifetime/plugin-panel-sessions'
import type { PluginPanelCaller } from '../../../shared/plugins/workers/plugin-panel-bridge-protocol'
import {
  PluginWorkspaceCompanions,
  type WorkspaceCompanionsOptions
} from './plugin-workspace-companions'

type PluginPanelControllerOptions = {
  resolveApprovedPlugin: (pluginKey: string) => ValidDiscoveredPlugin | null
  contentVerifier: Pick<PluginContentVerifier, 'verify'>
  executeHostCall: (
    pluginKey: string,
    method: string,
    params: unknown,
    surface: PluginSurface,
    caller?: PluginHostCaller
  ) => Promise<PluginHostCallOutcome>
  log: (pluginKey: string) => (line: string) => void
  panelAdmission?: PluginPanelCallAdmission
  workspaceCompanions?: WorkspaceCompanionsOptions
  /** A session's public id once it can no longer be used (its panel's requests stop). */
  onSessionClosed?: (panelId: string) => void
}

type FrameOpenOptions = { shell?: boolean }

export class PluginPanelController {
  private readonly sessions: PluginPanelSessions
  private readonly boundOwnerSignals = new WeakSet<AbortSignal>()
  private readonly panelAdmission: PluginPanelCallAdmission
  private readonly companions?: PluginWorkspaceCompanions

  constructor(private readonly options: PluginPanelControllerOptions) {
    this.panelAdmission = options.panelAdmission ?? createPluginPanelCallAdmission()
    this.companions =
      options.workspaceCompanions && new PluginWorkspaceCompanions(options.workspaceCompanions)
    this.sessions = new PluginPanelSessions((panelId) => {
      this.companions?.close(panelId)
      options.onSessionClosed?.(panelId)
    })
  }

  /** The live, still-approved panel behind an owner's session: what its push channel serves. */
  sessionCaller(
    ownerKey: string,
    sessionToken: string
  ): { pluginKey: string; caller: PluginPanelCaller } | null {
    const binding = this.sessions.resolve(ownerKey, sessionToken)
    return binding && this.isCurrent(binding)
      ? { pluginKey: binding.pluginKey, caller: panelCaller(binding) }
      : null
  }

  async readEntry(pluginKey: string, panelId: string): Promise<{ html: string } | null> {
    return (await loadPluginPanel(this.options, pluginKey, 'panel', panelId))?.entry ?? null
  }

  /** `shell: false` (desktop guests): the guest loads its own document, so no srcdoc HTML is
   *  read, verified or sent; the protocol verifies the tree when the guest navigates. */
  open(
    ownerKey: string,
    pluginKey: string,
    panelId: string,
    isCurrent?: () => boolean,
    options: FrameOpenOptions = {}
  ): Promise<PluginFrameEntry | null> {
    return this.openFrame(ownerKey, pluginKey, 'panel', panelId, isCurrent, options)
  }

  openCustomEditor(
    ownerKey: string,
    pluginKey: string,
    editorId: string,
    isCurrent?: () => boolean,
    options: FrameOpenOptions = {}
  ): Promise<PluginFrameEntry | null> {
    return this.openFrame(ownerKey, pluginKey, 'editor', editorId, isCurrent, options)
  }

  /** The plugin behind this owner's live components-panel session, for its persisted state. */
  componentsPanelPlugin(ownerKey: string, sessionToken: string): string | null {
    return this.componentsPanelBinding(ownerKey, sessionToken)?.pluginKey ?? null
  }

  /** That plugin's root folder, for the image files its panel draws. */
  componentsPanelRoot(ownerKey: string, sessionToken: string): string | null {
    return this.componentsPanelBinding(ownerKey, sessionToken)?.rootDir ?? null
  }

  private componentsPanelBinding(
    ownerKey: string,
    sessionToken: string
  ): { pluginKey: string; rootDir: string } | null {
    const binding = this.sessions.resolve(ownerKey, sessionToken)
    if (!binding || binding.surface !== 'panel') {
      return null
    }
    const plugin = this.options.resolveApprovedPlugin(binding.pluginKey)
    const panel = plugin ? findFrameContribution(plugin, 'panel', binding.contributionId) : null
    return plugin && plugin.rootDir === binding.rootDir && panel?.ui === 'components'
      ? { pluginKey: binding.pluginKey, rootDir: plugin.rootDir }
      : null
  }

  revokeSession(ownerKey: string, sessionToken: string): void {
    this.sessions.revoke(ownerKey, sessionToken)
  }

  /**
   * `desktop`: the call came from this machine's own window over IPC, never from a paired client;
   * `callerWebContentsId` is that window, so its dialogs and budgets bind there.
   */
  async execute(
    ownerKey: string,
    call: unknown,
    origin: { desktop?: boolean; callerWebContentsId?: number } = {}
  ): Promise<PluginHostCallOutcome> {
    const sessionToken = this.extractSessionToken(call)
    const binding = sessionToken && this.sessions.resolve(ownerKey, sessionToken)
    if (!binding) {
      return { ok: false, code: 'invalid_request', error: 'invalid panel session' }
    }
    // Why: a dialog or browser tab on this machine must never answer a remote client's click.
    // Their own lane: a save carries a whole file, far past the 64 KiB message budget.
    const action = this.readAction(call)
    if (
      action === WORKSPACE_VIEW_CLEAR_COMPANIONS &&
      origin.desktop &&
      binding.surface === 'panel'
    ) {
      const parsed = panelActionCallSchema.safeParse(call)
      const target = workspaceCompanionClearTarget.safeParse(parsed.data?.params)
      if (target.success) {
        this.companions?.close(binding.publicId, target.data.workspace)
      }
      return { ok: true, value: null }
    }
    const userMethod = getPluginHostMethodSpec(action)?.userActivation === true
    if (userMethod && !origin.desktop) {
      return {
        ok: false,
        code: 'not_permitted',
        error: 'this method is only available in the Orca desktop app'
      }
    }
    const admissionRefusal = userMethod
      ? null
      : admitPluginPanelCall(this.panelAdmission, binding.pluginKey, call)
    if (admissionRefusal) {
      return admissionRefusal
    }
    const parsed = panelActionCallSchema.safeParse(call)
    if (!parsed.success) {
      return { ok: false, code: 'invalid_request', error: 'malformed panel action call' }
    }
    if (!this.isCurrent(binding)) {
      return { ok: false, code: 'unavailable', error: 'panel session is no longer available' }
    }
    if (isInternalWorkspaceViewMethod(parsed.data.action)) {
      if (!origin.desktop || binding.surface !== 'panel') {
        return { ok: false, code: 'not_permitted', error: 'Desktop panel session required.' }
      }
      if (parsed.data.action === WORKSPACE_VIEW_AUTHORIZATION) {
        return { ok: true, value: { pluginKey: binding.pluginKey } }
      }
      return (
        this.companions?.call(
          binding.publicId,
          parsed.data.params,
          () =>
            this.sessions.resolve(ownerKey, sessionToken)?.publicId === binding.publicId &&
            this.isCurrent(binding)
        ) ?? { ok: false, code: 'unavailable', error: 'Companion presentation is unavailable.' }
      )
    }
    return this.options.executeHostCall(
      binding.pluginKey,
      parsed.data.action,
      parsed.data.params,
      binding.surface,
      {
        ...(origin.desktop ? { webContentsId: origin.callerWebContentsId } : {}),
        panel: panelCaller(binding)
      }
    )
  }

  private isCurrent(binding: PluginPanelSessionBinding): boolean {
    const plugin = this.options.resolveApprovedPlugin(binding.pluginKey)
    return (
      plugin !== null &&
      plugin.rootDir === binding.rootDir &&
      JSON.stringify(plugin.manifest) === binding.manifestRevision &&
      findFrameContribution(plugin, binding.surface, binding.contributionId) !== null
    )
  }

  revokeOwner(ownerKey: string): void {
    this.sessions.revokeOwner(ownerKey)
  }

  bindOwnerSignal(ownerKey: string, signal: AbortSignal | undefined): void {
    if (!signal || this.boundOwnerSignals.has(signal)) {
      return
    }
    this.boundOwnerSignals.add(signal)
    if (signal.aborted) {
      this.revokeOwner(ownerKey)
      return
    }
    signal.addEventListener('abort', () => this.revokeOwner(ownerKey), { once: true })
  }

  revokeAll(): void {
    this.sessions.clear()
    this.panelAdmission.clear()
  }

  dispose(): void {
    this.revokeAll()
  }

  private readAction(call: unknown): string {
    try {
      const action =
        typeof call === 'object' && call !== null && 'action' in call ? call.action : null
      return typeof action === 'string' ? action : ''
    } catch {
      return ''
    }
  }

  private extractSessionToken(call: unknown): string | null {
    if (typeof call !== 'object' || call === null) {
      return null
    }
    try {
      const token = (call as { sessionToken?: unknown }).sessionToken
      return typeof token === 'string' && token.length >= 32 && token.length <= 128 ? token : null
    } catch {
      return null
    }
  }

  private async openFrame(
    ownerKey: string,
    pluginKey: string,
    surface: PluginPanelSessionBinding['surface'],
    contributionId: string,
    isCurrent: (() => boolean) | undefined,
    options: FrameOpenOptions
  ): Promise<PluginFrameEntry | null> {
    if (isCurrent?.() === false) {
      return null
    }
    const loaded = await loadPluginPanel(
      this.options,
      pluginKey,
      surface,
      contributionId,
      options.shell !== false
    )
    if (!loaded || isCurrent?.() === false) {
      return null
    }
    return { ...loaded.entry, sessionToken: this.sessions.issue(ownerKey, loaded.binding) }
  }
}

function panelCaller(binding: ResolvedPluginPanelSession): PluginPanelCaller {
  return { id: binding.publicId, surface: binding.surface, contributionId: binding.contributionId }
}
