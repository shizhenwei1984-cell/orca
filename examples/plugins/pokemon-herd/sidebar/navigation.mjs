// SPDX-License-Identifier: Apache-2.0
// Adapted for Orca from Pokémon Sidebar's agent list and workspace grouping. See NOTICE.
const PREFIX = /(?:^|\/)(?:([A-Z][A-Z0-9]*)-\S|([A-Za-z][A-Za-z0-9]*)-\d)/
const PRIORITY = { blocked: 4, done: 3, working: 2, waiting: 1 }
export const STATUS = {
  blocked: 'Blocked',
  done: 'Done',
  working: 'Working',
  waiting: 'Waiting for input'
}

function namePrefix(...names) {
  for (const name of names) {
    const match = PREFIX.exec(name ?? '')
    if (match) {
      return `${(match[1] ?? match[2]).toUpperCase()}-`
    }
  }
  return null
}

export function projectKey(id, hostId) {
  return JSON.stringify([hostId, id])
}

export function terminalKey(workspaceId, terminalId) {
  return JSON.stringify([workspaceId, terminalId])
}

export function groupsOf(rows, groupFor) {
  const groups = new Map()
  for (const row of rows) {
    const [key, label] = groupFor(row)
    if (!groups.has(key)) {
      groups.set(key, { key, label, rows: [] })
    }
    groups.get(key).rows.push(row)
  }
  return [...groups.values()]
}

export function workspaceRows(workspace, data) {
  if (!data) {
    return []
  }
  const agents = new Map(data.agents.filter((a) => a.terminalId).map((a) => [a.terminalId, a]))
  const companions = new Map((data.companions ?? []).map((c) => [c.terminalId, c]))
  const terminals = new Set(data.terminals.map((t) => t.id))

  const terminalRows = data.terminals.map(({ id, title }) => {
    const agent = agents.get(id)
    return {
      key: terminalKey(workspace.id, id),
      terminalId: id,
      name: title || agent?.title || agent?.agent || 'Terminal',
      workspace,
      agent,
      pokemon: companions.get(id)
    }
  })
  const otherAgents = data.agents
    .filter((a) => !terminals.has(a.terminalId))
    .map((agent) => ({
      key: agent.sessionId
        ? JSON.stringify([workspace.id, 'session', agent.agent, agent.sessionId])
        : null,
      terminalId: null,
      name: agent.title || agent.agent || 'Agent',
      workspace,
      agent
    }))
  return [...terminalRows, ...otherAgents]
}

export function agentGroups(rows, sort, pins) {
  const pinned = new Map(pins.map((key, index) => [key, index]))
  const selected = rows
    .filter((r) => pinned.has(r.key))
    .sort((a, b) => pinned.get(a.key) - pinned.get(b.key))
  const remaining = rows.filter((r) => !pinned.has(r.key))
  const byStatus = (a, b) =>
    PRIORITY[b.agent.state] - PRIORITY[a.agent.state] ||
    b.agent.stateStartedAt - a.agent.stateStartedAt
  const grouping = {
    priority: ({ agent }) => [agent.state, STATUS[agent.state]],
    workspace: ({ workspace }) => [workspace.id, workspace.name],
    project: ({ workspace }) =>
      workspace.projectId
        ? [projectKey(workspace.projectId, workspace.hostId), workspace.project]
        : [workspace.id, workspace.name],
    prefix: ({ workspace, name }) => {
      const prefix = namePrefix(workspace.name, name, workspace.branch)
      return [prefix, prefix ?? 'No prefix']
    }
  }
  const groups = groupsOf(
    sort === 'priority' ? remaining.sort(byStatus) : remaining,
    grouping[sort]
  )
  if (sort === 'prefix') {
    groups.sort((a, b) => (a.key === null) - (b.key === null) || a.label.localeCompare(b.label))
  }
  return selected.length ? [{ key: 'pinned', label: 'Pinned', rows: selected }, ...groups] : groups
}

export function elapsed(at) {
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60_000))
  if (minutes < 60) {
    return minutes ? `${minutes}m` : '<1m'
  }
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}
