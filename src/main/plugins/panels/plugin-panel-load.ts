import {
  buildPluginPanelShellHtml,
  type PluginFrameSurface
} from '../../../shared/plugins/frames/plugin-panel-shell'
import type { ValidDiscoveredPlugin } from '../discovery/plugin-discovery'
import type { PluginContentVerifier } from '../artifacts/plugin-content-integrity'
import { PLUGIN_PANEL_ENTRY_MAX_BYTES } from '../../../shared/plugins/frames/plugin-frame-entry-limits'
import { readContainedPluginArtifactText } from '../artifacts/plugin-contained-artifact'
import type { PluginPanelSessionBinding } from './panel-lifetime/plugin-panel-sessions'

type PluginPanelLoadOptions = {
  resolveApprovedPlugin: (pluginKey: string) => ValidDiscoveredPlugin | null
  contentVerifier: Pick<PluginContentVerifier, 'verify'>
  log: (pluginKey: string) => (line: string) => void
}

type LoadedPluginPanel = {
  entry: { html: string; ui?: 'components' }
  binding: PluginPanelSessionBinding
}

export async function loadPluginPanel(
  options: PluginPanelLoadOptions,
  pluginKey: string,
  surface: PluginPanelSessionBinding['surface'],
  contributionId: string,
  withShell = true
): Promise<LoadedPluginPanel | null> {
  const plugin = options.resolveApprovedPlugin(pluginKey)
  const contribution = plugin ? findFrameContribution(plugin, surface, contributionId) : null
  if (!plugin || !contribution) {
    return null
  }
  const declarative = contribution.ui === 'components'
  // Why no entry text: a declarative entry is a module the desktop guest imports, and an
  // isolated-only editor never runs in the srcdoc fallback; both show they need the desktop app.
  const shellEntry = declarative || contribution.frame === 'isolated' ? null : contribution.entry
  const html = withShell ? await readShell(options, plugin, shellEntry, surface) : ''
  if (html === null) {
    return null
  }
  return {
    entry: declarative ? { html, ui: 'components' } : { html },
    binding: {
      pluginKey,
      surface,
      contributionId,
      rootDir: plugin.rootDir,
      manifestRevision: JSON.stringify(plugin.manifest)
    }
  }
}

async function readShell(
  options: PluginPanelLoadOptions,
  plugin: ValidDiscoveredPlugin,
  entryPath: string | null,
  surface: PluginFrameSurface
): Promise<string | null> {
  const { pluginKey } = plugin
  const log = options.log(pluginKey)
  try {
    await options.contentVerifier.verify(plugin)
    const html = buildPluginPanelShellHtml(
      entryPath === null
        ? ''
        : await readContainedPluginArtifactText(
            plugin.rootDir,
            entryPath,
            PLUGIN_PANEL_ENTRY_MAX_BYTES
          ),
      surface
    )
    const current = options.resolveApprovedPlugin(pluginKey)
    if (current !== plugin || current.rootDir !== plugin.rootDir) {
      return null
    }
    return html
  } catch (error) {
    log(
      `${surface} entry ${entryPath} rejected: ${error instanceof Error ? error.message : String(error)}`
    )
    return null
  }
}

export function findFrameContribution(
  plugin: ValidDiscoveredPlugin,
  surface: PluginPanelSessionBinding['surface'],
  id: string
): { entry: string; ui?: string; frame?: string } | null {
  const list =
    surface === 'panel'
      ? plugin.manifest.contributes.panels
      : plugin.manifest.contributes.customEditors
  return list.find((entry) => entry.id === id) ?? null
}
