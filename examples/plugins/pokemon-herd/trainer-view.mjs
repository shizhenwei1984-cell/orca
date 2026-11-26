import { abilityName, abilityOf } from './encounters/rules/abilities.js'
import { appearanceOf, catalogUnlocks } from './catalog/trainer-catalog.mjs'
import { canBreed, LAY, LAY_MIN, whyNot } from './trainer-rules/breed.mjs'
import { duplicates, releasePay, sortBox } from './trainer-rules/box.mjs'
import { nameOf, regionOf } from './encounters/rules/dex.js'
import {
  CHARM_JOBS,
  groupOf,
  grouped,
  itemAbout,
  ITEMS,
  loadBoosts,
  maxBuy,
  PRICE,
  sellPrice
} from './encounters/rules/items.js'
import { canPurify, nameFor, needsText } from './encounters/rules/picks.js'
import {
  dexByRegion,
  DEX_TOTAL,
  goalText,
  natureOf,
  nextGoal,
  recapText,
  taskPay,
  taskText
} from './encounters/rules/trainer.js'
import { boxedPokemon, itemOptions, pokemonId } from './trainer-actions.mjs'
import { today, trainerBadges, trainerPick, trainerShinyOdds } from './trainer-game.mjs'

const BOX_PAGE = 18
const fold = (value) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

function showPokemon(pokemon, slot, save, at, member) {
  const pick = trainerPick(pokemon)
  return {
    ref: { slot, id: pokemonId(pokemon, slot) },
    name: nameFor(pick),
    dex: pick.dex,
    appearance: appearanceOf(pick),
    form: pick.form ?? null,
    terminalId: member?.terminalId ?? null,
    title: member?.title ?? null,
    gender: pick.gender ?? null,
    shiny: !!pick.shiny,
    alpha: !!pick.alpha,
    shadow: !!pick.shadow,
    caught: !!pick.caught,
    hatched: !!pick.hatched,
    nature: natureOf(pick)?.name ?? null,
    ability: abilityName(abilityOf(pick, slot)),
    jobs: pokemon.jobs,
    friendship: pokemon.friendship,
    locked: !!pick.locked,
    held: pick.held ?? null,
    stay: !!pick.stay,
    nick: pick.nick ?? '',
    needs: needsText(pick) ?? null,
    purify: canPurify(pick),
    releasePay: member ? null : releasePay(pick),
    inCare: save.care.pair.includes(slot),
    items: itemOptions(pokemon, slot, save.bag, at)
  }
}

function boxView(save, at, slots, closed, query) {
  const boxed = boxedPokemon(save, closed)
  const entries = Object.entries(boxed).map(([slot, pokemon]) => ({
    slot,
    pick: trainerPick(pokemon),
    pokemon
  }))
  const active = slots.flatMap((slot) => {
    const pokemon = save.party[slot]?.pokemon
    return pokemon ? [{ slot, pick: trainerPick(pokemon), tag: true }] : []
  })
  const dupes = new Set(duplicates([...active, ...entries]))
  const text = fold(query.search)
  const matching = sortBox(entries, query.sort).filter(({ pick }) => {
    if (query.filter && !pick[query.filter]) {
      return false
    }
    return (
      !text ||
      [nameFor(pick), natureOf(pick)?.name].some((value) => value && fold(value).includes(text))
    )
  })
  const lastPage = Math.max(0, Math.ceil(matching.length / BOX_PAGE) - 1)
  const page = Math.min(query.page, lastPage)
  return {
    page,
    lastPage,
    total: matching.length,
    count: entries.length,
    entries: matching.slice(page * BOX_PAGE, (page + 1) * BOX_PAGE).map(({ slot, pokemon }) => ({
      ...showPokemon(pokemon, slot, save, at),
      duplicate: dupes.has(slot)
    })),
    canUndo: !!save.undo && at - save.undo.at < 10_000
  }
}

function dayCareView(save) {
  const { care } = save
  const parents = care.pair.flatMap((slot) => {
    const pokemon = save.box[slot]
    return pokemon
      ? [
          {
            ref: { slot, id: pokemonId(pokemon, slot) },
            name: nameFor(trainerPick(pokemon)),
            pokemon
          }
        ]
      : []
  })
  const [a, b] = parents.map(({ pokemon }) => trainerPick(pokemon))
  const match = canBreed(a, b)
  return {
    parents: parents.map(({ ref, name }) => ({ ref, name })),
    match: match
      ? `${LAY[match] * 100}% chance every ${LAY_MIN} minutes worked`
      : a && b
        ? whyNot(a, b)
        : '',
    nextTry: LAY_MIN - care.left,
    egg: care.egg ? { ...care.egg, name: nameOf(care.egg.dex) } : null,
    hatched: care.hatched,
    born: care.born
      .map(({ dex, at, shiny }) => ({ name: nameOf(dex), at, shiny: !!shiny }))
      .toReversed()
  }
}

function pokedexView(dex) {
  const seen = new Set(dex.seen)
  const caught = new Set(dex.caught)
  const shiny = new Set(dex.shiny)
  const alpha = new Set(dex.alpha)
  const male = new Set(dex.male)
  const female = new Set(dex.female)
  const goal = nextGoal(dex)
  return {
    caught: caught.size,
    seen: seen.size,
    total: DEX_TOTAL,
    regions: dexByRegion(dex),
    goal: goal ? { count: goal.n, reward: goalText(goal) } : null,
    species: [...seen]
      .sort((a, b) => a - b)
      .map((id) => ({
        dex: id,
        name: nameOf(id),
        region: regionOf({ dex: id }),
        caught: caught.has(id),
        shiny: shiny.has(id),
        alpha: alpha.has(id),
        male: male.has(id),
        female: female.has(id),
        sizes: dex.sizes[id] ?? null
      }))
  }
}

export function gameView(save, { at, slots, closed, query }) {
  const daily = today(save, at, slots)
  return {
    money: save.bag.money,
    catalog: catalogUnlocks(save),
    items: grouped(Object.keys(ITEMS)).map((id) => ({
      id,
      name: ITEMS[id].name,
      kind: ITEMS[id].kind ?? null,
      group: groupOf(id),
      about: itemAbout(id),
      count: save.bag.items[id] ?? 0,
      price: PRICE[id],
      sell: sellPrice(id),
      maxBuy: maxBuy(save.bag, id)
    })),
    boosts: loadBoosts(save.boosts, at),
    party: slots.flatMap((slot) => {
      const member = save.party[slot]
      return member?.pokemon ? [showPokemon(member.pokemon, slot, save, at, member)] : []
    }),
    box: boxView(save, at, slots, closed, query),
    care: dayCareView(save),
    research: {
      day: daily.day,
      recap: recapText(daily.yesterday),
      done: daily.bonus,
      tasks: daily.tasks.map((task) => ({
        ...task,
        text: taskText(task),
        reward: goalText(taskPay(task))
      }))
    },
    badges: trainerBadges(save, slots),
    charm: { jobs: save.work.jobs, goal: CHARM_JOBS, odds: trainerShinyOdds(save, slots) },
    dex: pokedexView(save.dex)
  }
}
