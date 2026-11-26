function isId(value, limit) {
  return typeof value === 'string' && value.length > 0 && value.length <= limit
}

export function registerTerminalFocus(orca) {
  let latest = 0
  orca.panels.handle('terminal.focus', async (input, { panel, signal }) => {
    if (panel.surface !== 'panel' || panel.contributionId !== 'pokemon-herd') {
      throw new Error('Terminal focus is available from the Pokémon Herd panel.')
    }
    const { terminalId, workspaceId } = input ?? {}
    if (
      !isId(terminalId, 1024) ||
      (workspaceId !== undefined && !isId(workspaceId, 1024)) ||
      Object.keys(input).some((key) => key !== 'terminalId' && key !== 'workspaceId')
    ) {
      throw new Error('Expected a terminal ID and optional workspace ID.')
    }
    const request = ++latest
    const context = await orca.host.call('workspace.readContext', undefined, { signal })
    if (signal.aborted || request !== latest) {
      return { focused: false }
    }
    if (
      !context?.terminals.some(({ id }) => id === terminalId) ||
      (workspaceId !== undefined && workspaceId !== context.workspaceId)
    ) {
      throw new Error('This terminal is no longer in the current workspace.')
    }
    return orca.host.call('terminal.focus', { terminalId }, { signal })
  })
}
