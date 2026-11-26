export async function reconcileLiveTerminals(orca, save, catalog, ids) {
  const unbound = Object.entries(save.party).filter(
    ([, member]) => member.pokemon && !member.terminalId && member.sessionId
  )
  if (!unbound.length || ids?.length === 0) {
    return save
  }
  try {
    const active = await orca.host.call('workspace.readContext')
    const workspaceId = catalog.resolve(active?.workspaceId)
    const room = catalog.workspaces?.find(({ id }) => id === workspaceId)
    const pending = unbound.filter(([, member]) => member.workspaceId === workspaceId)
    if (!room || !pending.length) {
      return save
    }
    const terminals = new Set(active.terminals.map(({ id }) => id))
    const wanted = ids && new Set(ids)
    const { agents } = await orca.host.call('agents.list', { workspaceId })
    const occupied = new Set(Object.values(save.party).map(({ terminalId }) => terminalId))
    let party = save.party
    for (const [slot, member] of pending) {
      const matches = agents.filter(
        ({ sessionId, liveIdentity }) =>
          sessionId === member.sessionId || liveIdentity?.paneKey === slot
      )
      if (matches.length !== 1) {
        continue
      }
      const [{ terminalId, sessionId, liveIdentity, title }] = matches
      if (
        !sessionId ||
        sessionId !== member.sessionId ||
        liveIdentity?.paneKey !== slot ||
        liveIdentity.hostId !== (room.hostId ?? 'local') ||
        liveIdentity.receivedAt !== member.lastAt ||
        !terminals.has(terminalId) ||
        (wanted && !wanted.has(terminalId)) ||
        occupied.has(terminalId) ||
        agents.some((agent) => agent !== matches[0] && agent.terminalId === terminalId)
      ) {
        continue
      }
      if (party === save.party) {
        party = { ...save.party }
      }
      party[slot] = { ...member, terminalId, title: title ?? member.title }
      occupied.add(terminalId)
    }
    return party === save.party ? save : { ...save, party }
  } catch {
    return save
  }
}
