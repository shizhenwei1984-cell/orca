// SPDX-License-Identifier: Apache-2.0
// Adapted for the Orca plugin host from Pokémon Sidebar. See NOTICE.
import { ITEMS } from '../encounters/rules/items.js'
import { cardOf, heartsText, nameFor, needsText } from '../encounters/rules/picks.js'
import { pokemonId } from '../trainer-actions.mjs'
import { trainerPick } from '../trainer-game.mjs'

function companions(save, workspaceId, agents) {
  const targets = new Map(agents.filter((agent) => agent.terminalId).map((a) => [a.terminalId, a]))
  const matches = new Map()
  for (const [slot, member] of Object.entries(save.party)) {
    const agent = targets.get(member.terminalId)
    if (
      !agent ||
      !member.pokemon ||
      member.workspaceId !== workspaceId ||
      (agent.sessionId && member.sessionId && agent.sessionId !== member.sessionId) ||
      matches.get(member.terminalId)?.member.lastAt >= member.lastAt
    ) {
      continue
    }
    matches.set(member.terminalId, { slot, member })
  }
  return Array.from(matches, ([terminalId, { slot, member }]) => {
    const pick = trainerPick(member.pokemon)
    return {
      terminalId,
      ref: { slot, id: pokemonId(member.pokemon, slot) },
      pick: {
        dex: pick.dex,
        ...(pick.form ? { form: pick.form } : {}),
        ...(pick.gender ? { gender: pick.gender } : {}),
        shiny: !!pick.shiny,
        mega: pick.mega ?? 'auto',
        megaKind: pick.megaKind ?? ''
      },
      name: nameFor(pick),
      held: ITEMS[pick.held]?.name ?? null,
      hearts: heartsText(pick.friend),
      friendship: pick.friend,
      evolution: cardOf(pick),
      needs: needsText(pick)
    }
  })
}

export function registerSidebar(orca, store) {
  const call = orca.host.call
  orca.panels.handle('sidebar.workspaces', async () => {
    const [list, projects, context] = await Promise.all([
      call('workspace.list'),
      call('project.list'),
      call('workspace.readContext')
    ])
    return {
      workspaces: list.workspaces.map(({ id, name, kind, branch, projectId, project, hostId }) => ({
        id,
        name,
        kind,
        branch,
        projectId: projectId ?? null,
        project: project ?? null,
        hostId: hostId ?? 'local'
      })),
      projects: projects.projects.map(({ id, kind, hostId, hidden }) => ({
        id,
        kind,
        hostId: hostId ?? 'local',
        hidden: hidden === true
      })),
      activeWorkspace: context?.workspaceId ?? null,
      truncated: list.truncated || projects.truncated
    }
  })

  orca.panels.handle('sidebar.workspace', async ({ workspaceId }) => {
    const [list, { agents }] = await Promise.all([
      call('terminal.list', { workspaceId }),
      call('agents.list', { workspaceId })
    ])
    // Keep navigation usable if the trainer save cannot be read.
    const progress = await store
      .read((save) => companions(save, workspaceId, agents))
      .catch(() => null)
    return { ...list, agents, companions: progress }
  })

  orca.panels.handle('sidebar.openWorkspace', ({ workspaceId }) =>
    call('workspace.open', { workspaceId })
  )
  orca.panels.handle('sidebar.renameWorkspace', ({ workspaceId, name }) =>
    call('workspace.rename', { workspaceId, name })
  )
  orca.panels.handle('sidebar.newWorkspace', ({ projectId, hostId, name }) =>
    call('workspace.create', { projectId, hostId, name })
  )
  orca.panels.handle('sidebar.setProjectHidden', ({ projectId, hostId, hidden }) =>
    call('project.setHidden', { projectId, hostId, hidden })
  )
  orca.panels.handle('sidebar.focusTerminal', ({ terminalId }) =>
    call('terminal.focus', { terminalId })
  )
  orca.panels.handle('sidebar.newTerminal', ({ workspaceId }) =>
    call('terminal.create', { workspaceId })
  )
  orca.panels.handle('sidebar.closeTerminal', ({ terminalId }) =>
    call('terminal.close', { terminalId })
  )
  orca.panels.handle('sidebar.toggleRightSidebar', () =>
    call('commands.run', { action: 'sidebar.right.toggle' })
  )
}
