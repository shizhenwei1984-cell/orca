import { isDeepStrictEqual } from 'node:util'
import { entryOf, megaForms } from '../catalog/dex.mjs'
import { pokemonId, trainerAction } from '../trainer-actions.mjs'
import { showPokemon } from '../trainer-view.mjs'
import {
  changeItems,
  creditResearch,
  MINUTE,
  registerCaught,
  registerSeen,
  resolvePartyMember,
  savedPokemon,
  settleBadges,
  trainerPerks,
  trainerPick
} from '../trainer-game.mjs'
import { createEncounterState, hpOf } from './encounter-state.js'
import { renderEncounterSnapshot } from './encounter-view.js'
import { movesFor, transitionEncounter } from './encounters.js'
import { abilityName, megaAbility } from './rules/abilities.js'
import { isWalkable } from './rules/dex.js'
import { addMoney, holdOrder, ITEMS } from './rules/items.js'
import { HELD_IDS } from './rules/picks.js'
import { BAIT, AUTO_BAIT, dayOf, fighterKey } from './rules/trainer.js'
import { TOWER_HEAL_IDS } from './rules/trainers.js'
import { weatherNow } from './rules/weather.js'
import { readHerdSettings } from '../world-settings.mjs'

const playerActions = new Set([
  'attack',
  'call',
  'gift',
  'heal',
  'nearby',
  'raid-hit',
  'spar',
  'throw',
  'tower-start',
  'tower-quit',
  'withdraw'
])
const stateFor = (save, workspaceId) =>
  Object.hasOwn(save.encounters ?? {}, workspaceId) ? save.encounters[workspaceId] : null

function roomScope(save, scope) {
  const slots = scope.slots.filter((slot) => {
    const member = save.party[slot]
    return scope.workspaceId && member?.workspaceId === scope.workspaceId && member.pokemon
  })
  return { ...scope, slots }
}

function rulesFor(save, { slots, at, rnd, settings, rain }) {
  const party = Object.fromEntries(
    slots.map((slot) => [slot, trainerPick(save.party[slot].pokemon)])
  )
  const ownedPicks = [
    ...Object.values(save.party).flatMap(({ pokemon }) => (pokemon ? [trainerPick(pokemon)] : [])),
    ...Object.values(save.box).map(trainerPick)
  ]
  const top = new Map()
  for (const { pokemon } of Object.values(save.party)) {
    if (pokemon) {
      top.set(pokemon.dex, (top.get(pokemon.dex) ?? 0) + pokemon.jobs)
    }
  }
  const topDex = [...top].sort((a, b) => b[1] - a[1])[0]?.[0]
  return {
    now: at,
    random: rnd,
    party,
    ownedPicks,
    items: save.bag.items,
    dex: save.dex,
    daily: save.daily,
    jobs: save.work.jobs,
    topDex,
    perks: trainerPerks(save, slots),
    workingSlots: slots.filter((slot) => save.party[slot].run?.state === 'working'),
    weather:
      settings?.weather !== false && (rain === 'rain' || rain === 'storm')
        ? weatherNow(rain)
        : undefined,
    ball: settings?.ball,
    bait: settings?.bait,
    settings,
    xAttack: save.boosts?.['x-attack'] > at
  }
}

function applyEncounter(save, action, context) {
  const { workspaceId, slots, at, key } = context
  const prior = stateFor(save, workspaceId)
  const current =
    prior && save.towerPaid && prior.tower.run
      ? { ...prior, tower: { ...prior.tower, paid: save.towerPaid } }
      : prior
  const { state, deltas, error } = transitionEncounter(current, action, rulesFor(save, context))
  if (error) {
    throw new Error(error)
  }
  if (isDeepStrictEqual(prior, state)) {
    return save
  }

  const stateWithRevision = { ...state, revision: (prior?.revision ?? 0) + 1 }
  const paid = state.tower.paid
  const towerPaid =
    paid &&
    (!save.towerPaid ||
      paid.day > save.towerPaid.day ||
      (paid.day === save.towerPaid.day && paid.floor > save.towerPaid.floor))
      ? paid
      : save.towerPaid
  let next = {
    ...save,
    encounters: { ...save.encounters, [workspaceId]: stateWithRevision },
    towerBest: Math.max(save.towerBest ?? 0, state.tower.best),
    ...(towerPaid && { towerPaid })
  }
  if (Object.keys(deltas.items).length) {
    next = changeItems(next, deltas.items)
    if (!next) {
      throw new Error('The Bag changed. Try again.')
    }
  }
  if (deltas.money || deltas.marks.trainers || deltas.marks.fullHearts) {
    const { marks } = next.bag
    next = {
      ...next,
      bag: {
        ...addMoney(next.bag, deltas.money),
        marks: {
          ...marks,
          ...(deltas.marks.trainers && { trainers: (marks.trainers ?? 0) + deltas.marks.trainers }),
          ...(deltas.marks.fullHearts && { fullHearts: true })
        }
      }
    }
  }
  if (Object.keys(deltas.party).length) {
    const party = { ...next.party }
    for (const [slot, pick] of Object.entries(deltas.party)) {
      party[slot] = { ...party[slot], pokemon: savedPokemon(pick, party[slot].pokemon) }
    }
    next = { ...next, party }
  }
  if (action.type === 'heal') {
    const { slot, item } = action
    const kind = ['berry', 'sitrus-berry'].includes(item) ? 'feed' : 'heal'
    next = {
      ...next,
      party: { ...next.party, [slot]: { ...next.party[slot], careNote: { kind, at, item } } }
    }
  }
  if (deltas.seen.length) {
    next = registerSeen(next, deltas.seen)
    if (!next.visitors) {
      next = { ...next, visitors: true }
    }
  }
  for (const [id, pick] of Object.entries(deltas.box)) {
    next = registerCaught(next, pick, `catch:${key ?? workspaceId}:${id}`, at, slots, {
      research: false
    })
  }
  for (const { event, count } of deltas.research) {
    next = creditResearch(next, at, slots, event, count)
  }
  return settleBadges(next, slots)
}

export function settleEncounterWork(before, after, context) {
  const { at } = context
  const scope = roomScope(after, context)
  const { workspaceId } = scope
  const day = dayOf(at)
  if (!workspaceId || after.daily?.day !== day) {
    return after
  }
  const previous = before.daily?.day === day ? (before.daily.count.work ?? 0) : 0
  const added = (after.daily.count.work ?? 0) - previous
  if (!(added > 0)) {
    return after
  }
  const cursor = Object.hasOwn(after.encounterWork ?? {}, workspaceId)
    ? after.encounterWork[workspaceId]
    : null
  if (cursor?.day > day) {
    return after
  }
  const start = cursor?.day === day ? cursor.ms : 0
  const ms = start + Math.round(added * MINUTE)
  const next = applyEncounter(
    after,
    {
      type: 'work',
      before: start / MINUTE,
      after: ms / MINUTE
    },
    { rnd: Math.random, ...context, ...scope }
  )
  return { ...next, encounterWork: { ...next.encounterWork, [workspaceId]: { day, ms } } }
}

export function encounterTrainerAction(save, action, context) {
  const scope = roomScope(save, context)
  const prior = stateFor(save, scope.workspaceId)
  const slot = action.target?.slot
  if (action.type === 'use' && TOWER_HEAL_IDS.includes(action.item) && scope.slots.includes(slot)) {
    if (pokemonId(save.party[slot].pokemon, slot) !== action.target.id) {
      throw new Error('That Pokémon is no longer available.')
    }
    return applyEncounter(save, { type: 'heal', slot, item: action.item }, scope)
  }
  return trainerAction(save, action, {
    ...context,
    battles: {
      hpOf: (slot) =>
        prior && scope.slots.includes(slot) ? hpOf(prior, slot, context.at) : undefined,
      swap: (next, slot) =>
        scope.slots.includes(slot)
          ? applyEncounter(next, { type: 'party-switch', slot }, scope)
          : next,
      exchange: (next, first, second) => exchangeCompanions(next, scope.workspaceId, first, second)
    }
  })
}

export function companionMenu(save, context, slot, source, targets) {
  const { workspaceId, at } = context
  const state = stateFor(save, workspaceId)
  const member = save.party[slot]
  const { pokemon } = member
  const health = (slot) => (state ? hpOf(state, slot, at) : 1)
  const card = showPokemon(pokemon, slot, save, at, member, health)
  const entry = entryOf(card.appearance)
  const megas = entry ? megaForms(entry) : []
  const form = megas.find(({ kind }) => kind === pokemon.megaKind) ?? megas[0]
  const active =
    pokemon.mega === 'on' ||
    ((pokemon.mega ?? 'auto') === 'auto' && member.run?.state === 'working')
  const mega = active ? form : null
  const key = mega ? fighterKey(pokemon.dex, { mega: mega.kind }) : null
  const pick = { ...trainerPick(pokemon), mega: mega ? 'on' : 'off' }
  const moves = movesFor({}, { [slot]: pick }, slot).map(({ name }) => name)
  const stock = (id) => ({
    id,
    name: ITEMS[id].name,
    icon: ITEMS[id].icon,
    count: save.bag.items[id] ?? 0
  })
  const held = card.held ? stock(card.held) : null
  const rules = rulesFor(save, context)
  return {
    card: {
      ...card,
      name: mega ? `Mega ${card.name}${mega.kind ? ` ${mega.kind}` : ''}` : card.name,
      appearance: { ...card.appearance, mega: pick.mega },
      types: mega?.types ?? entry?.types ?? [],
      ability: (key && abilityName(megaAbility(key))) || card.ability,
      moves,
      activeMoveForm: key === null ? null : String(key),
      hp: health(slot),
      hasMega: !!form
    },
    held,
    uses: card.items
      .filter(
        (id) =>
          !HELD_IDS.includes(id) &&
          (!TOWER_HEAL_IDS.includes(id) ||
            !transitionEncounter(state, { type: 'heal', slot, item: id }, rules).error)
      )
      .map(stock),
    holds: holdOrder(
      pick,
      card.items.filter((id) => HELD_IDS.includes(id))
    ).map(stock),
    source,
    mates: source
      ? targets
          .filter(
            (target) =>
              target.slot !== slot &&
              target.id !== source.id &&
              !exchangeBlocked(state, [slot, target.slot])
          )
          .map((target) => {
            const mate = save.party[target.slot]
            const { appearance, name, title } = showPokemon(
              mate.pokemon,
              target.slot,
              save,
              at,
              mate
            )
            return { target, appearance, name, title }
          })
      : []
  }
}

function exchangeBlocked(state, slots) {
  return (
    !!state &&
    slots.some(
      (slot) =>
        state.clash?.kind === 'spar' ||
        state.clash?.slot === slot ||
        state.visitor?.battle?.slot === slot ||
        state.visitor?.trainer?.fighter === slot ||
        Object.hasOwn(state.counters, slot)
    )
  )
}

function exchangeCompanions(save, workspaceId, first, second) {
  const state = stateFor(save, workspaceId)
  if (!state) {
    return save
  }
  if (exchangeBlocked(state, [first, second])) {
    throw new Error('Wait for these Pokémon to finish battling.')
  }
  const moved = (slot) => (slot === first ? second : slot === second ? first : slot)
  const moveEntries = (map) =>
    Object.fromEntries(Object.entries(map).map(([slot, value]) => [moved(slot), value]))
  const { tower, spar, visitor } = state
  const run = tower.run
  const next = {
    ...state,
    revision: (state.revision ?? 0) + 1,
    health: moveEntries(state.health),
    spar: { ...spar, last: moveEntries(spar.last) },
    ...(visitor?.statuses && { visitor: { ...visitor, statuses: moveEntries(visitor.statuses) } }),
    ...(run && {
      tower: { ...tower, run: { ...run, out: run.out.map(moved), fighter: moved(run.fighter) } }
    })
  }
  return { ...save, encounters: { ...save.encounters, [workspaceId]: next } }
}

function requestScope(input) {
  const { workspaceId, terminalIds, rain } = input ?? {}
  if (
    (workspaceId != null && (typeof workspaceId !== 'string' || workspaceId.length > 1024)) ||
    !Array.isArray(terminalIds) ||
    terminalIds.length > 50 ||
    terminalIds.some((id) => typeof id !== 'string' || id.length > 1024)
  ) {
    throw new Error('Invalid encounter workspace.')
  }
  return { workspaceId, terminalIds, rain }
}

function snapshotFor(save, context) {
  const state = stateFor(save, context.workspaceId) ?? createEncounterState(context.at)
  const snapshot = renderEncounterSnapshot(state, rulesFor(save, context))
  const view = {
    ...snapshot,
    workspaceId: context.workspaceId,
    revision: state.revision ?? 0,
    party: snapshot.party.map((pick) => {
      const { pokemon, terminalId } = save.party[pick.slot]
      return { ...pick, pokemonId: pokemonId(pokemon, pick.slot), terminalId }
    })
  }
  // The IPC accepts JSON; battle timelines and optional Pokémon traits can contain undefined.
  return JSON.parse(JSON.stringify(view))
}

function verifyAction(save, state, context, action) {
  for (const [field, idField] of [
    ['slot', 'pokemonId'],
    ['opponent', 'opponentId']
  ]) {
    if (action[field] === undefined) {
      continue
    }
    const slot = action[field]
    const member =
      typeof slot === 'string' && context.slots.includes(slot) ? save.party[slot] : null
    if (
      !member?.pokemon ||
      pokemonId(member.pokemon, slot) !== action[idField] ||
      resolvePartyMember(save, member.terminalId)?.slot !== slot
    ) {
      throw new Error('That Pokémon is no longer available.')
    }
  }
  if (
    action.type === 'throw' &&
    typeof action.bait === 'string' &&
    action.bait !== AUTO_BAIT &&
    (!Object.hasOwn(BAIT, action.bait) || !(save.bag.items[action.bait] > 0))
  ) {
    throw new Error('That Berry is unavailable.')
  }
  if (action.type === 'nearby' && !state?.visitor?.act) {
    throw new Error('That visitor has already moved on.')
  }
}

export function registerEncounterHandlers(
  orca,
  {
    store,
    getScope,
    preferences = () => readHerdSettings(orca.storage),
    clock = Date.now,
    rnd = Math.random
  }
) {
  const cries = new Map()
  orca.panels.handle('encounter.cry', async ({ dex } = {}) => {
    if (!Number.isInteger(dex) || !isWalkable(dex)) {
      return null
    }
    if (cries.has(dex)) {
      return cries.get(dex)
    }
    if (cries.size >= 32) {
      cries.delete(cries.keys().next().value)
    }
    const source = `https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/${dex}.ogg`
    const load = (async () => {
      const response = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(6500) })
      if (!response.ok || !response.body) {
        return null
      }
      const chunks = []
      let length = 0
      for await (const chunk of response.body) {
        length += chunk.length
        if (length > 128 * 1024) {
          return null
        }
        chunks.push(chunk)
      }
      const bytes = Buffer.concat(chunks)
      const magic = bytes.toString('ascii', 0, 4)
      if (magic === 'OggS') {
        return `data:audio/ogg;base64,${bytes.toString('base64')}`
      }
      if (magic.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
        return `data:audio/mpeg;base64,${bytes.toString('base64')}`
      }
      return null
    })().catch(() => {
      if (cries.get(dex) === load) {
        cries.delete(dex)
      }
      return null
    })
    cries.set(dex, load)
    return load
  })

  async function contextFor(save, input, catalog, at, fresh) {
    return {
      ...input,
      settings: await preferences(save.settings),
      ...roomScope(
        save,
        await getScope(save, input.terminalIds, catalog, {
          fresh,
          requested: input.workspaceId
        })
      ),
      at,
      rnd
    }
  }

  orca.panels.handle('encounter.read', (raw) => {
    const input = requestScope(raw)
    return store.transact(
      async (save, catalog) => {
        const context = await contextFor(save, input, catalog, clock(), false)
        if (!context.workspaceId || !context.slots.length) {
          return { save, result: null }
        }
        const next = applyEncounter(save, { type: 'tick' }, context)
        return { save: next, result: snapshotFor(next, context) }
      },
      (before, after) =>
        before.bag !== after.bag ||
        before.box !== after.box ||
        before.party !== after.party ||
        before.dex !== after.dex ||
        before.daily !== after.daily
    )
  })

  orca.panels.handle('encounter.command', (raw) => {
    const input = requestScope(raw)
    const { client, sequence, revision, action } = raw
    if (
      typeof client !== 'string' ||
      !/^[a-f0-9]{36}$/.test(client) ||
      !Number.isSafeInteger(sequence) ||
      sequence < 1 ||
      !Number.isSafeInteger(revision) ||
      !playerActions.has(action?.type)
    ) {
      throw new Error('Invalid encounter command.')
    }
    const at = clock()
    const receiptKey = `encounter:${client}`
    return store.transact(async (save, catalog) => {
      const receipt = save.receipts[receiptKey]
      if (receipt && sequence <= receipt.sequence) {
        return {
          save,
          result: sequence === receipt.sequence ? receipt.result : { ok: true, replayed: true }
        }
      }
      const context = await contextFor(save, input, catalog, at, true)
      try {
        if (!context.workspaceId || !context.slots.length) {
          throw new Error('Open a workspace with an active Pokémon.')
        }
        const state = stateFor(save, context.workspaceId)
        if (revision !== (state?.revision ?? 0)) {
          throw new Error('The encounter changed. Try again.')
        }
        verifyAction(save, state, context, action)
        const next = applyEncounter(save, action, { ...context, key: `${client}:${sequence}` })
        const result = { ok: true }
        return {
          save: { ...next, receipts: { ...next.receipts, [receiptKey]: { sequence, result } } },
          result
        }
      } catch (error) {
        return { save, result: { ok: false, error: error.message } }
      }
    })
  })
}
