import {
  addItem,
  addMoney,
  ITEMS,
  badgeGifts,
  badgeProgress,
  badgeSet,
  perks,
  shinyOdds
} from './encounters/rules/items.js'
import {
  BONUS,
  NATURES,
  dayOf,
  dueGoals,
  loadDaily,
  progress,
  taskPay,
  withCaught,
  withEvolved,
  withSeen
} from './encounters/rules/trainer.js'
import { abilityOf } from './encounters/rules/abilities.js'
import { BORN_KEPT, careWork, hatchPick } from './trainer-rules/breed.mjs'
import { hasForm, hasShiny, isWalkable } from './encounters/rules/dex.js'
import { rollGender } from './encounters/rules/gender.js'
import { learnableOf } from './encounters/rules/moves.js'
import { evolveJobs, evolveNeeds, friendOf } from './encounters/rules/picks.js'
import { typeOf } from './encounters/rules/types.js'
import { rollSize, withRecord } from './encounters/rules/weather.js'

export const MINUTE = 60_000

export function trainerPick(pokemon) {
  const { friendship, stageJobs, jobs: _jobs, id: _id, starter: _starter, ...pick } = pokemon
  return { ...pick, jobs: stageJobs, friend: friendship, hearts: Math.floor(friendship / 20) }
}

export function savedPokemon(pick, previous, id, jobs = previous?.jobs ?? 0) {
  const { friend: _friend, hearts: _hearts, jobs: stageJobs = 0, pastJobs, ...rest } = pick
  return {
    ...rest,
    ...((previous?.id ?? id) ? { id: previous?.id ?? id } : {}),
    starter: previous?.starter ?? pick.dex,
    stageJobs,
    ...(pastJobs ? { pastJobs } : {}),
    friendship: friendOf(pick),
    jobs
  }
}

export function resolvePartyMember(save, terminalId) {
  let found
  for (const [slot, member] of Object.entries(save.party)) {
    if (
      member.terminalId === terminalId &&
      member.pokemon &&
      !(found?.member.lastAt >= member.lastAt)
    ) {
      found = { slot, member, pick: trainerPick(member.pokemon) }
    }
  }
  return found
}

export function isNight(at) {
  const date = new Date(at)
  const minute = date.getHours() * 60 + date.getMinutes()
  return minute <= 360 || minute >= 1080
}

export function changeItems(save, deltas) {
  let { bag } = save
  for (const [id, count] of Object.entries(deltas)) {
    if (!Object.hasOwn(ITEMS, id) || !Number.isSafeInteger(count)) {
      throw new Error('Invalid item change')
    }
    if (count < 0 && (bag.items[id] ?? 0) < -count) {
      return null
    }
    bag = addItem(bag, id, count)
  }
  return { ...save, bag }
}

function pay(save, { money, item, count }) {
  if (money) {
    return { ...save, bag: addMoney(save.bag, money) }
  }
  if (item) {
    return changeItems(save, { [item]: count ?? 1 })
  }
  return save
}

export function today(save, at, slots) {
  if (save.daily?.day === dayOf(at)) {
    return save.daily
  }
  const types = [
    ...new Set(
      slots.flatMap((slot) =>
        save.party[slot]?.pokemon ? [typeOf(save.party[slot].pokemon.dex)] : []
      )
    )
  ]
  return loadDaily(save.daily, at, { wild: save.visitors, types })
}

export function creditResearch(save, at, slots, event, count, dex) {
  if (save.daily?.day > dayOf(at)) {
    return save
  }
  const result = progress(today(save, at, slots), event, count, dex)
  let next = { ...save, daily: result.daily }
  for (const task of result.done) {
    next = pay(next, taskPay(task))
  }
  if (result.bonus) {
    next = pay(pay(next, BONUS), { item: 'azure-flute', count: 1 })
  }
  return next
}

function payDexGoals(save) {
  const due = dueGoals(save.dex)
  if (!due.length) {
    return save
  }
  const next = due.reduce(pay, save)
  return { ...next, dex: { ...next.dex, goals: [...next.dex.goals, ...due.map(({ n }) => n)] } }
}

export function registerSeen(save, dexes) {
  const dex = withSeen(save.dex, dexes)
  return dex ? { ...save, dex } : save
}

export function registerCaught(
  save,
  pick,
  id,
  at,
  slots = [],
  { hatched = false, research = !hatched } = {}
) {
  if (Object.hasOwn(save.box, id)) {
    return save
  }
  if (
    !Number.isInteger(pick.dex) ||
    !isWalkable(pick.dex) ||
    (pick.form && !hasForm(pick.dex, pick.form))
  ) {
    throw new Error('Unknown Pokémon')
  }
  const caught = { ...pick, caught: pick.caught ?? at, caughtAs: pick.caughtAs ?? pick.dex }
  const dex = {
    ...withCaught(save.dex, caught),
    sizes: withRecord(save.dex.sizes, caught) ?? save.dex.sizes
  }
  const next = payDexGoals({
    ...save,
    dex,
    box: { ...save.box, [id]: savedPokemon(caught, null, id) }
  })
  return research ? creditResearch(next, at, slots, 'catch', 1) : next
}

export function registerEvolution(save, pokemon) {
  const bag = {
    ...save.bag,
    marks: { ...save.bag.marks, evolutions: (save.bag.marks.evolutions ?? 0) + 1 }
  }
  const dex = withEvolved(save.dex, [trainerPick(pokemon)])
  const next = registerSeen({ ...save, bag, dex: dex ?? save.dex }, [pokemon.dex])
  return dex ? payDexGoals(next) : next
}

function badgeFacts(save, slots) {
  let best = 0
  let evolve = 0
  for (const slot of slots) {
    const pokemon = save.party[slot]?.pokemon
    if (!pokemon) {
      continue
    }
    best = Math.max(best, Math.floor(pokemon.friendship / 20))
    if (
      evolveNeeds(pokemon).some(({ ways }) =>
        ways.some((way) => ['jobs', 'day', 'night'].includes(way))
      )
    ) {
      evolve = Math.max(evolve, pokemon.stageJobs / evolveJobs(pokemon.dex))
    }
  }
  return { best, evolve, caught: save.dex.caught.length, towerBest: save.towerBest ?? 0 }
}

export function trainerBadges(save, slots) {
  return badgeProgress(save.work, save.bag.marks, badgeFacts(save, slots)).map(
    ({ id, name, how, perk, earned, fraction, left }) => ({
      id,
      name,
      how,
      perk,
      earned,
      fraction,
      left
    })
  )
}

export function trainerPerks(save, slots = []) {
  return perks(badgeSet(save.work, save.bag.marks, badgeFacts(save, slots)))
}

export function trainerShinyOdds(save, slots) {
  return Math.max(8, Math.round(shinyOdds(save.work.jobs) / trainerPerks(save, slots).shiny))
}

export function settleBadges(save, slots = [], pokemon) {
  const marks =
    pokemon?.friendship >= 100 && !save.bag.marks.fullHearts
      ? { ...save.bag.marks, fullHearts: true }
      : save.bag.marks
  const { gifts, seen } = badgeGifts(save.work, marks, badgeFacts(save, slots))
  if (!gifts.length && marks === save.bag.marks) {
    return save
  }
  const bag = { ...save.bag, marks: { ...marks, seen } }
  return { ...save, bag: gifts.reduce((current, item) => addItem(current, item), bag) }
}

export function creditWork(save, at, slots, ms, boxed, rnd) {
  let next = creditResearch(save, at, slots, 'work', ms / MINUTE)
  if (!next.care.egg && next.care.pair.length < 2) {
    return next
  }
  const warm = slots.some((slot) => {
    const pokemon = next.party[slot]?.pokemon
    return (
      pokemon &&
      ['flame-body', 'magma-armor', 'steam-engine'].includes(abilityOf(trainerPick(pokemon), slot))
    )
  })
  const result = careWork(
    next.care,
    boxed,
    ms / MINUTE,
    at,
    rnd,
    (dex) => learnableOf(dex).map(({ name }) => name),
    warm ? 2 : 1
  )
  if (!result.hatched) {
    return { ...next, care: result.care }
  }
  const dex = result.hatched.dex
  const natures = Object.keys(NATURES)
  const pick = hatchPick(result.hatched, at, {
    shiny: rnd() * trainerShinyOdds(next, slots) < 1 && hasShiny(dex),
    size: rollSize(rnd),
    gender: rollGender(dex, rnd),
    nature: natures[Math.floor(rnd() * natures.length)]
  })
  const slot = `egg:${result.care.hatched}`
  next = registerCaught(next, pick, slot, at, slots, { hatched: true })
  const born = { dex, slot, at, shiny: pick.shiny }
  return {
    ...next,
    care: { ...result.care, last: born, born: [...result.care.born, born].slice(-BORN_KEPT) }
  }
}
