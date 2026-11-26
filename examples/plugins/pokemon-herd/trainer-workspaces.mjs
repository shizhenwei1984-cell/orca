function workspaceCatalog(answer) {
  const listed = new Map()
  const raw = new Map()
  for (const row of answer.workspaces) {
    listed.set(row.id, listed.has(row.id) ? null : row)
    if (row.projectId) {
      const id = `${row.projectId}::${row.path}`
      raw.set(id, [...(raw.get(id) ?? []), row])
    }
  }

  function resolve(id, reportedId) {
    if (!id && !reportedId) {
      return null
    }
    const candidates = raw.get(id)
    if (reportedId && reportedId !== id) {
      const reported = listed.get(reportedId)
      if (reported) {
        return !id || candidates?.includes(reported) ? reported.id : null
      }
      const folder = candidates?.length === 1 ? candidates[0] : null
      // Older hosts emit a worktree identity for folder projects they list by raw id.
      const host = encodeURIComponent(folder?.hostId ?? 'local')
      if (
        !answer.truncated &&
        folder?.kind === 'folder' &&
        folder.id === id &&
        listed.get(id) === folder &&
        reportedId.startsWith(`identity:wt2:${host}:`)
      ) {
        return folder.id
      }
      return null
    }
    if (listed.has(id)) {
      return listed.get(id) && !(candidates?.length > 1) ? id : null
    }
    const row = !answer.truncated && candidates?.length === 1 ? candidates[0] : null
    return row && listed.get(row.id) === row ? row.id : null
  }

  return { ...answer, resolve }
}

export function listTrainerWorkspaces(orca) {
  let cached
  let pending
  return async (fresh = false) => {
    if (!fresh && cached?.until > Date.now()) {
      return cached.catalog
    }
    pending ??= orca.host
      .call('workspace.list')
      .then(workspaceCatalog)
      .then((catalog) => {
        cached = { catalog, until: Date.now() + 10_000 }
        return catalog
      })
      .finally(() => {
        pending = undefined
      })
    return pending
  }
}

function moveRoomKeys(rooms, resolve, merge) {
  let next
  for (const [oldId, room] of Object.entries(rooms ?? {})) {
    const id = resolve(oldId)
    if (id && id !== oldId) {
      next ??= new Map(Object.entries(rooms))
      next.set(id, merge(next.get(id), room))
      next.delete(oldId)
    }
  }
  return next ? Object.fromEntries(next) : rooms
}

export function reconcileTrainerWorkspaces(save, catalog, legacy, workspaceId) {
  const aliases = new Map()
  for (const { workspaceId: oldId, hostWorkspaceId: raw } of Object.values(save.party)) {
    const id = raw && oldId && catalog.resolve(raw, oldId)
    if (id && id !== oldId) {
      aliases.set(oldId, !aliases.has(oldId) || aliases.get(oldId) === id ? id : null)
    }
  }
  if (legacy && workspaceId) {
    aliases.set(legacy, workspaceId)
  }
  const resolve = (id) => aliases.get(id) ?? catalog.resolve(id)
  let party = save.party
  for (const [slot, member] of Object.entries(save.party)) {
    const oldId = member.workspaceId ?? member.workspaceListId
    const id = resolve(oldId)
    if (id && id !== member.workspaceId) {
      if (party === save.party) {
        party = { ...save.party }
      }
      party[slot] = { ...member, workspaceId: id }
    }
  }
  const encounters = moveRoomKeys(save.encounters, resolve, (current, old) =>
    current ? { ...current, revision: Math.max(current.revision ?? 0, old.revision ?? 0) + 1 } : old
  )
  const encounterWork = moveRoomKeys(save.encounterWork, resolve, (current, old) =>
    !current || old.day > current.day || (old.day === current.day && old.ms > current.ms)
      ? old
      : current
  )
  return party === save.party &&
    encounters === save.encounters &&
    encounterWork === save.encounterWork
    ? save
    : { ...save, party, encounters, encounterWork }
}
