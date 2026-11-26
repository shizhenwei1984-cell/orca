import {
  encounterTrainerAction,
  registerEncounterHandlers,
  settleEncounterWork
} from './encounters/trainer-encounters.mjs'
import { recordStatus, trainerView, workingMinutes } from './trainer.mjs'
import { trainerAction } from './trainer-actions.mjs'
import { MINUTE, settleBadges } from './trainer-game.mjs'
import { readTrainer, writeTrainer } from './trainer-save.mjs'
import { gameView } from './trainer-view.mjs'
import { registerSidebar } from './sidebar/worker.mjs'
import { registerTerminalFocus } from './terminal-focus.mjs'
import { registerCatalogSprites } from './catalog/sprite-worker.mjs'
import { initialCatalogPick, registerCatalogPreferences } from './catalog/trainer-catalog.mjs'
import { listTrainerWorkspaces, reconcileTrainerWorkspaces } from './trainer-workspaces.mjs'

function terminalIds(input) {
  const ids = input?.terminalIds
  if (
    !Array.isArray(ids) ||
    ids.length > 50 ||
    ids.some((id) => typeof id !== 'string' || id.length > 1024)
  ) {
    throw new Error('Expected up to 50 terminal IDs')
  }
  return ids
}

export function createTrainerStore(orca, workspaces = listTrainerWorkspaces(orca)) {
  let current
  let tail = Promise.resolve()
  let writeError

  function queue(run) {
    const result = tail.then(async () => {
      current ??= await readTrainer(orca.storage)
      return run()
    })
    tail = result.catch(() => {})
    return result
  }

  function transact(apply, visible = () => true) {
    return queue(async () => {
      for (let attempt = 0; ; attempt++) {
        const before = current.save
        const catalog = await workspaces().catch(() => ({ resolve: () => null }))
        const { save, result } = await apply(reconcileTrainerWorkspaces(before, catalog), catalog)
        try {
          if (save !== before) {
            current = await writeTrainer(orca.storage, current, save)
          }
        } catch (error) {
          current = undefined
          writeError = error
          if (attempt) {
            orca.panels.post('trainer.changed', null)
            throw error
          }
          // The index may already be committed if its acknowledgement was lost.
          current = await readTrainer(orca.storage)
          continue
        }
        if (writeError || (save !== before && visible(before, save))) {
          orca.panels.post('trainer.changed', null)
        }
        writeError = undefined
        return result
      }
    })
  }

  return {
    transact,
    read: (view) =>
      queue(() => {
        if (writeError) {
          throw writeError
        }
        return view(current.save)
      })
  }
}

function getTerminalLists(orca) {
  const cache = new Map()
  return async (workspaceId, fresh = false) => {
    if (!workspaceId) {
      return null
    }
    const known = cache.get(workspaceId)
    if (!fresh && known?.until > Date.now()) {
      return known.list
    }
    try {
      const result = await orca.host.call('terminal.list', { workspaceId })
      const list = {
        ids: new Set(result.terminals.map(({ id }) => id)),
        truncated: result.truncated
      }
      cache.set(workspaceId, { list, until: Date.now() + 10_000 })
      return list
    } catch {
      cache.delete(workspaceId)
      return null
    }
  }
}

function queryOf(query) {
  const { page = 0, search = '', sort = 'new', filter = '' } = query ?? {}
  if (
    !Number.isSafeInteger(page) ||
    page < 0 ||
    typeof search !== 'string' ||
    search.length > 80 ||
    !['new', 'dex', 'name', 'hearts'].includes(sort) ||
    !['', 'caught', 'shiny', 'alpha', 'shadow', 'locked', 'held', 'hatched'].includes(filter)
  ) {
    throw new Error('Invalid Box search')
  }
  return { page, search, sort, filter }
}

function actionOf(input) {
  const { client, sequence, action } = input ?? {}
  if (
    typeof client !== 'string' ||
    !/^[a-f0-9]{36}$/.test(client) ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    typeof action?.type !== 'string' ||
    action.type.length > 32 ||
    (action.targets !== undefined && (!Array.isArray(action.targets) || action.targets.length > 18))
  ) {
    throw new Error('Invalid trainer command')
  }
  return { client, sequence, action }
}

function partySlots(save, ids, workspaceId) {
  const wanted = new Set(ids)
  const slots = new Map()
  for (const [slot, member] of Object.entries(save.party)) {
    if (
      !member.pokemon ||
      !wanted.has(member.terminalId) ||
      (workspaceId && member.workspaceId !== workspaceId)
    ) {
      continue
    }
    if (!(slots.get(member.terminalId)?.lastAt >= member.lastAt)) {
      slots.set(member.terminalId, { slot, lastAt: member.lastAt })
    }
  }
  return [...slots.values()].map(({ slot }) => slot)
}

let timer
export function deactivate() {
  clearInterval(timer)
}

export default function activate(orca) {
  activateTrainer(orca, { registerEncounterHandlers, encounterTrainerAction, settleEncounterWork })
}

export function activateTrainer(
  orca,
  { registerEncounterHandlers, encounterTrainerAction, settleEncounterWork } = {}
) {
  registerTerminalFocus(orca)
  registerCatalogSprites(orca)
  const catalogPreferences = registerCatalogPreferences(orca)
  const workspaces = listTrainerWorkspaces(orca)
  const store = createTrainerStore(orca, workspaces)
  registerSidebar(orca, store, workspaces)
  const list = getTerminalLists(orca)

  async function getScope(save, ids, catalog, { fresh = false, requested } = {}) {
    const room = catalog.resolve(requested)
    const candidates = requested && !room ? [] : partySlots(save, ids, room)
    const members = Object.entries(save.party).filter(([, member]) => member.pokemon)
    const workspaceIds = [
      ...new Set(members.map(([, member]) => catalog.resolve(member.workspaceId)).filter(Boolean))
    ]
    const lists = new Map()
    for (let start = 0; start < workspaceIds.length; start += 4) {
      const batch = workspaceIds.slice(start, start + 4)
      const results = await Promise.all(batch.map((workspace) => list(workspace, fresh)))
      for (const [index, workspace] of batch.entries()) {
        lists.set(workspace, results[index])
      }
    }
    const slots = candidates.filter((slot) => {
      const { terminalId, workspaceId } = save.party[slot]
      return !lists.get(workspaceId) || lists.get(workspaceId).ids.has(terminalId)
    })
    const closed = new Set()
    for (const [slot, member] of members) {
      const known = lists.get(member.workspaceId)
      if (member.terminalId && known && !known.truncated && !known.ids.has(member.terminalId)) {
        closed.add(slot)
      }
    }
    const candidateWorkspaces = new Set(
      slots.map((slot) => catalog.resolve(save.party[slot].workspaceId)).filter(Boolean)
    )
    const workspaceId =
      room ?? (candidateWorkspaces.size === 1 ? candidateWorkspaces.values().next().value : null)
    return { slots, closed, workspaceId }
  }

  function settleWork(before, after, at, slots, workspaceId) {
    if (!settleEncounterWork || after.daily === before.daily) {
      return after
    }
    const start = before.daily?.day === after.daily?.day ? (before.daily?.count.work ?? 0) : 0
    if ((after.daily?.count.work ?? 0) <= start) {
      return after
    }
    return settleEncounterWork(before, after, { at, slots, workspaceId, rnd: Math.random })
  }

  orca.events.on('agent.status.changed', (event) =>
    store.transact(
      async (save, catalog) => {
        let workspaceId = catalog.resolve(event.workspaceId, event.workspaceListId)
        if (!workspaceId && (event.workspaceId || event.workspaceListId)) {
          catalog = await workspaces(true).catch(() => catalog)
          workspaceId = catalog.resolve(event.workspaceId, event.workspaceListId)
        }
        save = reconcileTrainerWorkspaces(save, catalog, event.workspaceListId, workspaceId)
        const prior = Object.hasOwn(save.party, event.paneKey)
          ? save.party[event.paneKey]
          : undefined
        if (prior && event.receivedAt <= prior.lastAt) {
          return { save }
        }
        const roomId =
          workspaceId ??
          (!event.workspaceId && !event.workspaceListId
            ? catalog.resolve(prior?.workspaceId)
            : null)
        const room = await list(roomId)
        const slots = [...new Set([...partySlots(save, room?.ids ?? [], roomId), event.paneKey])]
        const initialPick = prior?.pokemon
          ? undefined
          : await catalogPreferences().then(
              (preferences) => initialCatalogPick(save, preferences, Math.random),
              (error) => orca.log(error.message)
            )
        const after = recordStatus(save, event, { slots, initialPick, workspaceId: roomId })
        return { save: await settleWork(save, after, event.receivedAt, slots, roomId) }
      },
      (before, after) =>
        Object.keys(after.party).length !== Object.keys(before.party).length ||
        after.work !== before.work ||
        after.bag !== before.bag ||
        after.daily !== before.daily ||
        Object.entries(after.party).some(([slot, current]) => {
          const previous = before.party[slot]
          return (
            current.pokemon !== previous?.pokemon ||
            current.terminalId !== previous?.terminalId ||
            current.workspaceId !== previous?.workspaceId
          )
        })
    )
  )

  async function countActiveWork(save, catalog) {
    const at = Date.now()
    const rooms = new Map()
    for (const [slot, member] of Object.entries(save.party)) {
      if (
        member.run?.state !== 'working' ||
        at - member.run.phaseSince - (member.run.credited ?? 0) < MINUTE ||
        !catalog.resolve(member.workspaceId) ||
        !member.terminalId
      ) {
        continue
      }
      if (!rooms.has(member.workspaceId)) {
        rooms.set(member.workspaceId, [])
      }
      rooms.get(member.workspaceId).push(slot)
    }
    let next = save
    for (const [workspaceId, candidates] of rooms) {
      let agents
      try {
        ;({ agents } = await orca.host.call('agents.list', { workspaceId }))
      } catch {
        continue
      }
      const byTerminal = new Map(agents.map((agent) => [agent.terminalId, agent]))
      const confirmed = candidates.filter((slot) => {
        const { terminalId, sessionId, run } = save.party[slot]
        const agent = byTerminal.get(terminalId)
        return (
          agent?.state === 'working' &&
          (!sessionId || agent.sessionId === sessionId) &&
          agent.stateStartedAt <= run.phaseSince
        )
      })
      const slots = partySlots(save, byTerminal.keys(), workspaceId)
      const after = workingMinutes(next, at, confirmed, { slots })
      next = await settleWork(next, after, at, slots, workspaceId)
    }
    return { save: next }
  }

  timer = setInterval(() => {
    void store.transact(countActiveWork).catch((error) => orca.log(error.message))
  }, MINUTE)
  timer.unref()

  orca.panels.handle('trainer.read', (input) => {
    const ids = terminalIds(input)
    return store.read((save) => trainerView(save, ids))
  })
  orca.panels.handle('trainer.game', (input) => {
    const ids = terminalIds(input)
    const query = queryOf(input.query)
    return store.transact(async (save, catalog) => {
      const scope = await getScope(save, ids, catalog)
      const next = settleBadges(save, scope.slots)
      return { save: next, result: gameView(next, { ...scope, at: Date.now(), query }) }
    })
  })
  orca.panels.handle('trainer.command', (input) => {
    const ids = terminalIds(input)
    const { client, sequence, action } = actionOf(input)
    const at = Date.now()
    return store.transact(
      async (save, catalog) => {
        const receipt = save.receipts[client]
        if (receipt && sequence <= receipt.sequence) {
          return {
            save,
            result: sequence === receipt.sequence ? receipt.result : { ok: true, replayed: true }
          }
        }

        const inventoryOnly = ['buy', 'sell', 'boost', 'undo-release'].includes(action.type)
        const scope = inventoryOnly
          ? { slots: [], closed: new Set(), workspaceId: null }
          : await getScope(save, ids, catalog, { fresh: true })
        const context = { ...scope, at, key: `${client}:${sequence}`, rnd: Math.random }
        let next = save
        let result
        try {
          next =
            (await encounterTrainerAction?.(save, action, context)) ??
            trainerAction(save, action, context)
          result = { ok: true }
        } catch (error) {
          result = { ok: false, message: error.message }
        }
        return {
          save: { ...next, receipts: { ...next.receipts, [client]: { sequence, result } } },
          result
        }
      },
      (before, after) =>
        before.bag !== after.bag ||
        before.party !== after.party ||
        before.box !== after.box ||
        before.care !== after.care ||
        before.boosts !== after.boosts
    )
  })
  registerEncounterHandlers?.(orca, { store, getScope })
}
