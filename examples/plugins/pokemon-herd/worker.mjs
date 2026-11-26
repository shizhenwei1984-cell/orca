import {
  companionMenu,
  encounterTrainerAction,
  registerEncounterHandlers,
  settleEncounterWork
} from './encounters/trainer-encounters.mjs'
import { dueCare, recordStatus, sampleCare, trainerView, workingMinutes } from './trainer.mjs'
import { pokemonId, readMoveEditor, trainerAction } from './trainer-actions.mjs'
import { MAX_MOVES } from './encounters/rules/moves.js'
import { MINUTE, settleBadges } from './trainer-game.mjs'
import { readTrainer, writeTrainer } from './trainer-save.mjs'
import { gameView } from './trainer-view.mjs'
import { registerSidebar } from './sidebar/worker.mjs'
import { registerTerminalFocus } from './terminal-focus.mjs'
import { registerCatalogSprites } from './catalog/sprite-worker.mjs'
import { initialCatalogPick, registerCatalogPreferences } from './catalog/trainer-catalog.mjs'
import { listTrainerWorkspaces, reconcileTrainerWorkspaces } from './trainer-workspaces.mjs'
import { defaultHerdSettings, readHerdSettings } from './world-settings.mjs'

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

const exchangeFields = ['slot', 'id', 'terminalId', 'sessionId', 'assignment']
const exchangeRef = (ref) => exchangeFields.map((field) => ref?.[field])

function moveRef(target) {
  const { slot, id, location, version } = target ?? {}
  if (
    typeof slot !== 'string' ||
    slot.length > 2048 ||
    typeof id !== 'string' ||
    id.length > 4096 ||
    !['party', 'box'].includes(location) ||
    typeof version !== 'string' ||
    version.length > 4096
  ) {
    throw new Error('Invalid move editor target.')
  }
  return [slot, id, location, version]
}

function moveCommandToken({ target, form, moves }) {
  if (
    typeof form !== 'string' ||
    form.length > 12 ||
    (moves !== null &&
      (!Array.isArray(moves) ||
        moves.length > MAX_MOVES ||
        moves.some((name) => typeof name !== 'string' || name.length > 30)))
  ) {
    throw new Error('Invalid move selection.')
  }
  return JSON.stringify([moveRef(target), form, moves])
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
  const workspaces = listTrainerWorkspaces(orca)
  const store = createTrainerStore(orca, workspaces)
  const catalogPreferences = registerCatalogPreferences(orca, async () => {
    const { trainer, legendsOpen } = await preferences(await store.read((save) => save.settings))
    return { trainer, legendsOpen }
  })
  registerSidebar(orca, store, workspaces)
  const list = getTerminalLists(orca)
  let settings = defaultHerdSettings
  async function preferences(legacy) {
    try {
      settings = await readHerdSettings(orca.storage, legacy)
    } catch (error) {
      orca.log(error.message)
    }
    return settings
  }

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
    return { slots, closed, workspaceId, listed: lists.get(workspaceId)?.ids }
  }

  async function getMoveScope(save, ids, catalog, target) {
    if (target.location === 'box') {
      return getScope(save, ids, catalog, { fresh: true })
    }
    const active = await orca.host.call('workspace.readContext')
    const current = new Set(active?.terminals.map(({ id }) => id))
    return getScope(
      save,
      ids.filter((id) => current.has(id)),
      catalog,
      {
        fresh: true,
        requested: active?.workspaceId
      }
    )
  }

  async function exchangeTargets(save, scope, active) {
    const { slots, workspaceId, listed } = scope
    const terminals = new Set(active?.terminals.map(({ id }) => id))
    const members = slots.filter((slot) => {
      const member = save.party[slot]
      return (
        member.workspaceId === workspaceId &&
        listed?.has(member.terminalId) &&
        terminals.has(member.terminalId)
      )
    })
    if (members.length < 2) {
      return []
    }
    const { agents } = await orca.host.call('agents.list', { workspaceId })
    return members.flatMap((slot) => {
      const { pokemon, terminalId, sessionId, assignment } = save.party[slot]
      const live = agents.filter((agent) => agent.terminalId === terminalId)
      return sessionId &&
        live.length === 1 &&
        live[0].sessionId === sessionId &&
        live[0].stateStartedAt <= save.party[slot].lastAt
        ? [
            {
              slot,
              id: pokemonId(pokemon, slot),
              terminalId,
              sessionId,
              assignment: assignment ?? ''
            }
          ]
        : []
    })
  }

  function settleWork(before, after, at, slots, workspaceId, settings) {
    if (!settleEncounterWork || after.daily === before.daily) {
      return after
    }
    const start = before.daily?.day === after.daily?.day ? (before.daily?.count.work ?? 0) : 0
    if ((after.daily?.count.work ?? 0) <= start) {
      return after
    }
    return settleEncounterWork(before, after, {
      at,
      slots,
      workspaceId,
      settings,
      rnd: Math.random
    })
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
        const settings = await preferences(save.settings)
        const initialPick = prior?.pokemon
          ? undefined
          : await catalogPreferences().then(
              (pickPreferences) => initialCatalogPick(save, pickPreferences, Math.random, settings),
              (error) => orca.log(error.message)
            )
        const after = recordStatus(save, event, {
          slots,
          initialPick,
          workspaceId: roomId,
          evolve: settings.evolve
        })
        return { save: settleWork(save, after, event.receivedAt, slots, roomId, settings) }
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

  async function sampleLiveAgents(save, catalog) {
    const at = Date.now()
    const settings = await preferences(save.settings)
    const rooms = new Map()
    for (const [slot, member] of Object.entries(save.party)) {
      if (!member.run || !catalog.resolve(member.workspaceId) || !member.terminalId) {
        continue
      }
      const { run } = member
      const workDue = run.state === 'working' && at - run.phaseSince - (run.credited ?? 0) >= MINUTE
      if (!workDue && !dueCare(member, at, settings)) {
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
          agent?.state === run.state &&
          (!sessionId || agent.sessionId === sessionId) &&
          agent.stateStartedAt <= run.phaseSince
        )
      })
      const slots = partySlots(save, byTerminal.keys(), workspaceId)
      const after = workingMinutes(next, at, confirmed, { slots })
      next = sampleCare(
        settleWork(next, after, at, slots, workspaceId, settings),
        at,
        confirmed.filter((slot) => slots.includes(slot)),
        settings
      )
    }
    return { save: next }
  }

  timer = setInterval(() => {
    void store.transact(sampleLiveAgents).catch((error) => orca.log(error.message))
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
      const settings = await preferences(save.settings)
      return { save: next, result: gameView(next, { ...scope, at: Date.now(), query, settings }) }
    })
  })
  orca.panels.handle('trainer.moves', (input) => {
    const ids = terminalIds(input)
    moveRef(input.target)
    return store.transact(async (save, catalog) => {
      const scope = await getMoveScope(save, ids, catalog, input.target)
      return { save, result: readMoveEditor(save, input.target, scope) }
    })
  })
  orca.panels.handle('trainer.companion-menu', (input) => {
    const ids = terminalIds(input)
    return store.transact(async (save, catalog) => {
      const active = await orca.host.call('workspace.readContext')
      const scope = await getScope(save, ids, catalog, {
        fresh: true,
        requested: catalog.resolve(active?.workspaceId)
      })
      const slot = input.target?.slot
      const member = scope.slots.includes(slot) ? save.party[slot] : null
      if (
        !member ||
        pokemonId(member.pokemon, slot) !== input.target.id ||
        !active?.terminals.some(({ id }) => id === member.terminalId)
      ) {
        return { save, result: null }
      }
      const targets = await exchangeTargets(save, scope, active).catch(() => [])
      const source = targets.find((target) => target.slot === slot) ?? null
      const settings = await preferences(save.settings)
      return {
        save,
        result: companionMenu(
          save,
          { ...scope, settings, at: Date.now(), rnd: Math.random },
          slot,
          source,
          targets
        )
      }
    })
  })
  orca.panels.handle('trainer.command', (input) => {
    const ids = terminalIds(input)
    const { client, sequence, action } = actionOf(input)
    const exchange = action.type === 'swap-companions'
    const teaching = action.type === 'teach-moves'
    const swapToken = exchange
      ? JSON.stringify([exchangeRef(action.target), exchangeRef(action.destination)])
      : undefined
    const moveToken = teaching ? moveCommandToken(action) : undefined
    const at = Date.now()
    return store.transact(
      async (save, catalog) => {
        const receipt = save.receipts[client]
        if (receipt && sequence <= receipt.sequence) {
          if (
            receipt.swapToken !== swapToken ||
            receipt.moveToken !== moveToken ||
            ((exchange || teaching) && sequence !== receipt.sequence)
          ) {
            return { save, result: { ok: false, message: 'That trainer command has expired.' } }
          }
          return {
            save,
            result: sequence === receipt.sequence ? receipt.result : { ok: true, replayed: true }
          }
        }

        const inventoryOnly = ['buy', 'sell', 'boost', 'undo-release'].includes(action.type)
        const active =
          exchange || action.worldTerminalId !== undefined
            ? await orca.host.call('workspace.readContext')
            : null
        const scope = inventoryOnly
          ? { slots: [], closed: new Set(), workspaceId: null }
          : teaching
            ? await getMoveScope(save, ids, catalog, action.target)
            : await getScope(save, ids, catalog, {
                fresh: true,
                requested: exchange ? catalog.resolve(active?.workspaceId) : undefined
              })
        const context = {
          ...scope,
          settings: inventoryOnly ? undefined : await preferences(save.settings),
          at,
          key: `${client}:${sequence}`,
          rnd: Math.random
        }
        let next = save
        let result
        try {
          if (exchange) {
            const targets = await exchangeTargets(save, scope, active)
            const valid = (ref) =>
              targets.some((target) => exchangeFields.every((key) => ref?.[key] === target[key]))
            if (!valid(action.target) || !valid(action.destination)) {
              throw new Error('These companions are no longer available to swap.')
            }
          } else if (action.worldTerminalId !== undefined) {
            const slot = action.target?.slot
            const terminalId = action.worldTerminalId
            if (
              !['use', 'pet', 'take-held'].includes(action.type) ||
              !scope.slots.includes(slot) ||
              save.party[slot].terminalId !== terminalId ||
              !active?.terminals.some(({ id }) => id === terminalId)
            ) {
              return {
                save,
                result: { ok: false, message: 'That Pokémon is no longer available.' }
              }
            }
          }
          next =
            (await encounterTrainerAction?.(save, action, context)) ??
            trainerAction(save, action, context)
          result = { ok: true }
        } catch (error) {
          result = { ok: false, message: error.message }
        }
        return {
          save: {
            ...next,
            receipts: {
              ...next.receipts,
              [client]: {
                sequence,
                result,
                ...(exchange && { swapToken }),
                ...(teaching && { moveToken })
              }
            }
          },
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
  registerEncounterHandlers?.(orca, { store, getScope, preferences })
}
