import {
  boxOnSwitch,
  canPurify,
  cleanNick,
  FRIEND,
  hash,
  itemUse,
  purified,
  PURIFY_PAY,
  raised,
  switchedPick,
  takeHeld,
  useItem as applyItem,
  withFriend
} from './encounters/rules/picks.js'
import {
  addItem,
  addMoney,
  buy,
  ITEMS,
  MAX_ITEM,
  sell,
  withBoost
} from './encounters/rules/items.js'
import { duplicates, releasePay } from './trainer-rules/box.mjs'
import { allowance, dayOf, TIP } from './encounters/rules/trainer.js'
import { validateChoice } from './catalog/trainer-catalog.mjs'
import { genderFrom } from './encounters/rules/gender.js'
import { KEPT_ITEMS } from './encounters/rules/form-items.js'
import {
  MINUTE,
  creditResearch,
  isNight,
  registerEvolution,
  registerSeen,
  savedPokemon,
  settleBadges,
  trainerPick,
  trainerShinyOdds
} from './trainer-game.mjs'

export const pokemonId = (pokemon, slot) => pokemon.id ?? `legacy:${slot}`

export function boxedPokemon(save, closed) {
  return Object.fromEntries([
    ...[...closed].flatMap((slot) => {
      const { pokemon, lastAt } = save.party[slot]
      return pokemon && (pokemon.locked || raised(trainerPick(pokemon)))
        ? [[slot, { ...pokemon, boxedAt: pokemon.boxedAt ?? lastAt }]]
        : []
    }),
    ...Object.entries(save.box)
  ])
}

function putPokemon(save, slot, pokemon) {
  if (Object.hasOwn(save.party, slot)) {
    return { ...save, party: { ...save.party, [slot]: { ...save.party[slot], pokemon } } }
  }
  return { ...save, box: { ...save.box, [slot]: pokemon } }
}

function removeBox(save, slot) {
  if (Object.hasOwn(save.box, slot)) {
    const { [slot]: _pokemon, ...box } = save.box
    return { ...save, box }
  }
  return putPokemon(save, slot, null)
}

function cancelCare(save, slot) {
  if (!save.care.pair.includes(slot)) {
    return save
  }
  return {
    ...save,
    care: { ...save.care, pair: save.care.pair.filter((id) => id !== slot), left: 0 }
  }
}

export function itemOptions(pokemon, slot, bag, at) {
  const pick = trainerPick(pokemon)
  const how = { day: dayOf(at), night: isNight(at) }
  return Object.keys(bag.items).filter((id) => itemUse(pick, slot, id, how))
}

function applyToPokemon(save, { slot, pokemon }, item, { at, slots, battles }) {
  if (!(save.bag.items[item] > 0)) {
    throw new Error('That item is no longer in the Bag.')
  }
  const how = { day: dayOf(at), night: isNight(at), hpOf: battles?.hpOf }
  const result = applyItem(trainerPick(pokemon), slot, item, how, at)
  if (!result || ((result.heal || result.revive) && !battles?.applyItem)) {
    throw new Error('That item has no effect right now.')
  }
  const updated = savedPokemon(result.pick, pokemon)
  let bag = KEPT_ITEMS.has(item) ? save.bag : addItem(save.bag, item, -1)
  if (result.back) {
    bag = addItem(bag, result.back)
  }
  let next = putPokemon({ ...save, bag }, slot, updated)
  if (result.heal || result.revive) {
    next = battles.applyItem(next, slot, item, result)
  }
  if (result.evolved) {
    next = registerEvolution(next, updated)
  }
  if (item === 'berry' || item === 'sitrus-berry') {
    next = creditResearch(next, at, slots, 'berry', 1)
  }
  return settleBadges(next, slots, updated)
}

function replaceParty(save, slot, pokemon, incoming, at, key, { same, all } = {}) {
  const away = boxOnSwitch(trainerPick(pokemon), incoming, at, { same, all: all || pokemon.locked })
  const awaySlot = `boxed:${key}`
  const box = away
    ? {
        ...save.box,
        [awaySlot]: {
          ...savedPokemon(away.pick, pokemon, pokemonId(pokemon, slot)),
          boxedAt: at
        }
      }
    : save.box
  return { ...putPokemon(save, slot, incoming), box }
}

function bringOut(save, { slot, pokemon }, target, { at, key, battles }) {
  const { slot: pane, pokemon: current } = target
  let next = cancelCare(removeBox(save, slot), slot)
  if (pokemon.held && current.held) {
    next = { ...next, bag: addItem(next.bag, current.held) }
  }
  const incoming = {
    ...pokemon,
    id: pokemonId(pokemon, slot),
    ...(current.held && !pokemon.held ? { held: current.held } : {}),
    ...(current.stay ? { stay: true } : {})
  }
  next = replaceParty(next, pane, current, incoming, at, key, { same: true })
  return battles?.swap ? battles.swap(next, pane) : next
}

function choose(save, { slot, pokemon }, action, { at, slots, key, rnd, battles }) {
  const { dex, form } = action
  const { same, gender, mega, megaKind, shiny } = validateChoice(save, pokemon, action)
  if (same) {
    return putPokemon(save, slot, {
      ...pokemon,
      ...(gender ? { gender } : {}),
      ...(mega ? { mega } : {}),
      ...(megaKind !== undefined ? { megaKind } : {}),
      ...(shiny !== undefined ? { shiny } : {})
    })
  }
  const mode = mega ?? pokemon.mega ?? 'auto'
  const rolledShiny = shiny === true || rnd() * trainerShinyOdds(save, slots) < 1
  const pick = switchedPick(trainerPick(pokemon), { dex, form }, mode, megaKind, rolledShiny)
  const incoming = savedPokemon(
    {
      ...pick,
      gender: gender ?? genderFrom(dex, hash(`${slot}:gender`)),
      ...(megaKind !== undefined ? { megaKind } : {})
    },
    null,
    `chosen:${key}`
  )
  const next = registerSeen(
    replaceParty(save, slot, pokemon, incoming, at, key, { same: action.fresh, all: action.fresh }),
    [dex]
  )
  return battles?.swap ? battles.swap(next, slot) : next
}

function release(save, selected, at) {
  if (!selected.length || selected.some(({ pokemon }) => pokemon.locked)) {
    throw new Error('Only unlocked Pokémon in the Box can be released.')
  }
  let { bag } = save
  const returned = {}
  const picks = {}
  let next = save
  for (const { slot, pokemon } of selected) {
    const key = Object.hasOwn(save.box, slot) ? slot : `released:${pokemonId(pokemon, slot)}`
    picks[key] = { ...pokemon, id: pokemonId(pokemon, slot) }
    if (pokemon.held && (bag.items[pokemon.held] ?? 0) < MAX_ITEM) {
      bag = addItem(bag, pokemon.held)
      returned[pokemon.held] = (returned[pokemon.held] ?? 0) + 1
    }
    bag = addMoney(bag, releasePay(trainerPick(pokemon)))
    next = cancelCare(removeBox(next, slot), slot)
  }
  return { ...next, bag, undo: { picks, at, returned, money: bag.money - save.bag.money } }
}

function undoRelease(save, at) {
  const undo = save.undo
  if (!undo || at - undo.at >= 10_000) {
    throw new Error('The release undo period has ended.')
  }
  let { bag } = save
  if (
    bag.money < undo.money ||
    Object.entries(undo.returned).some(([id, count]) => (bag.items[id] ?? 0) < count)
  ) {
    throw new Error('The release proceeds have already been used.')
  }
  for (const [item, count] of Object.entries(undo.returned)) {
    bag = addItem(bag, item, -count)
  }
  const { undo: _undo, ...next } = save
  return { ...next, box: { ...save.box, ...undo.picks }, bag: addMoney(bag, -undo.money) }
}

function updateCare(save, { slot, pokemon }) {
  const care = save.care
  if (care.pair.includes(slot)) {
    return cancelCare(save, slot)
  }
  const stored = Object.hasOwn(save.box, slot)
  const key = stored ? slot : `stored:${pokemonId(pokemon, slot)}`
  const next = stored
    ? save
    : {
        ...removeBox(save, slot),
        box: { ...save.box, [key]: { ...pokemon, id: pokemonId(pokemon, slot) } }
      }
  return { ...next, care: { ...care, pair: [...care.pair, key].slice(-2), left: 0 } }
}

function pet(save, { slot, pokemon }, { at, slots }) {
  const member = save.party[slot]
  const last = Math.max(member.petAt ?? 0, member.quickAt ?? 0)
  if (pokemon.friendship >= 100) {
    throw new Error('Friendship is already full.')
  }
  if (at - last <= 30 * MINUTE) {
    throw new Error('This Pokémon was petted recently.')
  }
  const updated = savedPokemon(withFriend(trainerPick(pokemon), FRIEND.pat), pokemon)
  let next = {
    ...save,
    party: { ...save.party, [slot]: { ...member, pokemon: updated, petAt: at } }
  }
  next = creditResearch(next, at, slots, 'pet', 1)
  const tip = allowance(next.daily, 'tip', TIP.pat)
  if (tip) {
    next = creditResearch({ ...next, bag: addMoney(next.bag, tip) }, at, slots, 'tip', tip)
  }
  return settleBadges(next, slots, updated)
}

export function trainerAction(save, action, context) {
  const { at, slots, closed } = context
  const { type, item } = action
  if (
    ['buy', 'sell', 'boost', 'use'].includes(type) &&
    (typeof item !== 'string' || !Object.hasOwn(ITEMS, item))
  ) {
    throw new Error('Unknown item.')
  }
  if (type === 'buy' || type === 'sell') {
    if (!Number.isInteger(action.count) || action.count < 1 || action.count > MAX_ITEM) {
      throw new Error('Enter a quantity between 1 and 999.')
    }
    const bag = (type === 'buy' ? buy : sell)(save.bag, item, action.count)
    if (!bag) {
      throw new Error(
        type === 'buy'
          ? 'The Bag is full or you need more Pokédollars.'
          : 'There is nothing to sell or the wallet is full.'
      )
    }
    return { ...save, bag }
  }
  if (type === 'boost') {
    if (ITEMS[item].kind !== 'boost' || !(save.bag.items[item] > 0)) {
      throw new Error('That boost is unavailable.')
    }
    return {
      ...save,
      boosts: withBoost(save.boosts ?? {}, item, at),
      bag: addItem(save.bag, item, -1)
    }
  }
  if (type === 'undo-release') {
    return undoRelease(save, at)
  }

  const boxed = boxedPokemon(save, closed)
  const party = Object.fromEntries(slots.map((slot) => [slot, save.party[slot]?.pokemon]))
  function find(ref, choices) {
    const slot = ref?.slot
    const pokemon = typeof slot === 'string' && Object.hasOwn(choices, slot) ? choices[slot] : null
    if (!pokemon || pokemonId(pokemon, slot) !== ref.id) {
      throw new Error('That Pokémon is no longer available.')
    }
    return { slot, pokemon }
  }
  if (type === 'release-duplicates') {
    const entries = [
      ...Object.entries(party)
        .filter(([, pokemon]) => pokemon)
        .map(([slot, pokemon]) => ({ slot, pick: trainerPick(pokemon), tag: true })),
      ...Object.entries(boxed).map(([slot, pokemon]) => ({ slot, pick: trainerPick(pokemon) }))
    ]
    const dupes = duplicates(entries)
    const requested = Array.isArray(action.targets) ? action.targets : []
    const selected = [
      ...new Map(
        requested.map((ref) => {
          const entry = find(ref, boxed)
          if (!dupes.includes(entry.slot)) {
            throw new Error('The duplicate selection changed.')
          }
          return [entry.slot, entry]
        })
      ).values()
    ]
    return release(save, selected, at)
  }
  if (type === 'box' || type === 'choose' || type === 'pet') {
    const target = find(action.target, party)
    if (type === 'pet') {
      return pet(save, target, context)
    }
    const selection =
      type === 'box'
        ? { dex: target.pokemon.dex, form: target.pokemon.form ?? undefined, fresh: true }
        : action
    return choose(save, target, selection, context)
  }

  const boxOnly = ['bring-out', 'care', 'release', 'purify'].includes(type)
  const target = find(action.target, boxOnly ? boxed : { ...boxed, ...party })
  const { pokemon, slot } = target
  const pick = trainerPick(pokemon)
  switch (type) {
    case 'use':
      return applyToPokemon(save, target, item, context)
    case 'take-held': {
      const result = takeHeld(pick)
      if (!result) {
        throw new Error('This Pokémon is not holding anything.')
      }
      return putPokemon(
        { ...save, bag: addItem(save.bag, result.back) },
        slot,
        savedPokemon(result.pick, pokemon)
      )
    }
    case 'everstone':
      return putPokemon(save, slot, { ...pokemon, stay: !pokemon.stay })
    case 'rename':
      return putPokemon(save, slot, { ...pokemon, nick: cleanNick(action.name) })
    case 'lock':
      return putPokemon(save, slot, { ...pokemon, locked: !pokemon.locked })
    case 'purify': {
      if (!canPurify(pick)) {
        throw new Error('Purifying a Shadow Pokémon takes four hearts.')
      }
      const updated = savedPokemon(purified(pick), pokemon)
      return settleBadges(
        putPokemon({ ...save, bag: addMoney(save.bag, PURIFY_PAY) }, slot, updated),
        slots,
        updated
      )
    }
    case 'bring-out':
      return bringOut(save, target, find(action.destination, party), context)
    case 'care':
      return updateCare(save, target)
    case 'release':
      return release(save, [target], at)
    default:
      throw new Error('Unknown trainer action.')
  }
}
