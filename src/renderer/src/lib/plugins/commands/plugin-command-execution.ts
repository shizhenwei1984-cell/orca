import {
  collectActivePluginCommands,
  usePluginPanelsStore,
  type ActivePluginCommand
} from '@/store/plugins/catalog/plugin-contribution-catalog'
import { useAppStore } from '@/store'
import { shortcutPlatform } from '@/app-shell/chrome/app-window-chrome'
import { findPluginCommandForKeybinding } from './plugin-command-keybindings'
import { readCustomEditorKeyChord } from '../../../../../shared/plugins/frames/plugin-custom-editor-bridge'
import { activatePluginCommandPanel } from '@/components/plugins/view/plugin-panel-activation'
import { dispatchAppCommand, type AppCommandSource } from '../../app-commands/app-command-dispatch'

/** Resolves with whatever a worker handler returned; built-in actions return nothing. */
export async function executePluginCommand(
  command: ActivePluginCommand,
  source: AppCommandSource
): Promise<unknown> {
  if (command.handler.type === 'built-in') {
    if (!dispatchAppCommand(command.handler.action, source)) {
      throw new Error('built-in action is unavailable in the current context')
    }
    return undefined
  }
  if (command.handler.type === 'panel') {
    activatePluginCommandPanel(command.pluginKey, command.id)
    return undefined
  }
  return window.api.plugins.invokeCommand({
    pluginKey: command.pluginKey,
    commandId: command.id
  })
}

export function runPluginPanelCommandFromGuestChord(raw: unknown): void {
  const input = readCustomEditorKeyChord(raw)
  if (!input) {
    return
  }
  const { activeWorktreeId, keybindings } = useAppStore.getState()
  const commands = collectActivePluginCommands(usePluginPanelsStore.getState().plugins)
  const command = findPluginCommandForKeybinding(
    commands,
    input,
    shortcutPlatform,
    keybindings,
    Boolean(activeWorktreeId)
  )
  if (command?.handler.type === 'panel') {
    void executePluginCommand(command, 'plugin-keybinding').catch(reportError)
  }
}
