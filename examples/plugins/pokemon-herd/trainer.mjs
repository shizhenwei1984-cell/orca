import { fullName } from './encounters/rules/dex.js'
import { appearanceOf } from './catalog/trainer-catalog.mjs'
import { species, starterDex } from './panel/pokemon.mjs'
import { loadCare } from './trainer-rules/breed.mjs'
import { genderFrom } from './encounters/rules/gender.js'
import {
  addItem,
  addMoney,
  CANDY_JOB_MS,
  jobPay,
  loadBag,
  loadBoosts,
  MAX_ITEM,
  pickup,
  pickupDelay
} from './encounters/rules/items.js'
import {
  FRIEND,
  expShareTarget,
  gainJob,
  hash,
  nameFor,
  withFriend
} from './encounters/rules/picks.js'
import { pokemonId } from './trainer-actions.mjs'
import { abilityOf } from './encounters/rules/abilities.js'
import { loadDex } from './encounters/rules/trainer.js'
import {
  MINUTE,
  creditResearch,
  creditWork,
  isNight,
  registerEvolution,
  registerSeen,
  savedPokemon,
  settleBadges,
  trainerPick,
  trainerPerks
} from './trainer-game.mjs'

const QUICK_COOLDOWN = 10 * MINUTE
const HUNGRY_AFTER = 5 * MINUTE

export function loadTrainer(raw) {
  if (raw !== null && (raw?.version !== 1 || !raw.bag || !raw.work || !raw.party)) {
    throw new Error('Unsupported trainer save')
  }
  return {
    ...raw,
    version: 1,
    bag: loadBag(raw?.bag && { ...raw.bag, v: 1 }),
    work: raw?.work ?? { jobs: 0, ms: 0 },
    party: raw?.party ?? {},
    box: raw?.box ?? {},
    dex: loadDex(
      raw?.dex ?? {
        v: 1,
        seen: Object.values(raw?.party ?? {}).map((member) => member.pokemon?.dex)
      }
    ),
    care: loadCare(raw?.care),
    receipts: raw?.receipts ?? {},
    visitors: raw?.visitors ?? false
  }
}

function needsInput(state) {
  return state === 'waiting' || state === 'blocked'
}

function trackRun(previous, event) {
  const { state, receivedAt: at } = event
  const replaced = previous?.sessionId && event.sessionId && previous.sessionId !== event.sessionId
  const prior = replaced ? undefined : previous?.run
  const phaseSince = prior?.state === state ? prior.phaseSince : at
  const ms = prior?.state === 'working' && state !== 'working' ? at - prior.phaseSince : 0
  const taskMs = (prior?.taskMs ?? 0) + ms
  const task = state === 'done' ? taskMs : 0
  const held = previous?.pokemon?.held
  let input = needsInput(state) ? (prior?.input ?? { since: at, hungry: false }) : null
  let friend = 0
  let berry = 0
  let quickAt =
    state === 'done' || state === 'working'
      ? Math.max(previous?.quickAt ?? 0, previous?.petAt ?? 0)
      : (previous?.quickAt ?? 0)
  let quick = false
  if (prior?.input) {
    const waited = at - prior.input.since
    const hungry = prior.input.hungry || (waited >= HUNGRY_AFTER && held !== 'leftovers')
    if (hungry && !prior.input.hungry) {
      friend += FRIEND.hungry
    }
    if (input) {
      input = { ...input, hungry }
    } else if (hungry) {
      berry = 1
    } else if (waited < MINUTE && at - quickAt > QUICK_COOLDOWN) {
      quickAt = at
      friend += FRIEND.quick
      quick = true
    }
  }
  const credited = prior?.credited ?? 0
  const uncredited = ms ? Math.max(0, ms - credited) : 0
  const run = {
    state,
    phaseSince,
    taskMs: state === 'done' ? 0 : taskMs,
    input,
    credited: state === 'working' && prior?.state === state ? credited : 0
  }
  return { run, ms, uncredited, task, friend, berry, quick, quickAt }
}

function gainFriendship(pokemon, points) {
  return savedPokemon(withFriend(trainerPick(pokemon), points), pokemon)
}

export function workingMinutes(
  save,
  at,
  confirmedSlots,
  { slots = confirmedSlots, rnd = Math.random } = {}
) {
  let total = 0
  const party = { ...save.party }
  for (const slot of confirmedSlots) {
    const member = party[slot]
    const run = member?.run
    if (run?.state !== 'working') {
      continue
    }
    const ran = at - run.phaseSince
    const add = ran - (run.credited ?? 0)
    if (add < MINUTE) {
      continue
    }
    total += add
    party[slot] = { ...member, run: { ...run, credited: ran } }
  }
  return total ? creditWork({ ...save, party }, at, slots, total, boxedPicks(save), rnd) : save
}

function boxedPicks(save) {
  return Object.fromEntries(
    Object.entries(save.box).map(([slot, pokemon]) => [slot, trainerPick(pokemon)])
  )
}

export function recordStatus(
  save,
  event,
  {
    slots = [event.paneKey],
    rnd = Math.random,
    initialPick,
    evolve = true,
    workspaceId = event.workspaceListId ?? event.workspaceId
  } = {}
) {
  const { paneKey, receivedAt: at } = event
  const previous = Object.hasOwn(save.party, paneKey) ? save.party[paneKey] : undefined
  if (previous ? at <= previous.lastAt : !event.workspaceId && !event.terminalId) {
    return save
  }
  const { run, ms, uncredited, task, friend, berry, quick, quickAt } = trackRun(previous, event)
  let pokemon = previous?.pokemon ?? null
  if (!pokemon && (event.sessionId || event.terminalId || task)) {
    const { dex, form } = initialPick ?? { dex: starterDex(event) }
    pokemon = savedPokemon(
      { dex, ...(form ? { form } : {}), gender: genderFrom(dex, hash(`${paneKey}:gender`)) },
      null,
      `starter:${paneKey}:${at}`
    )
  }
  const companion = {
    ...previous,
    terminalId: event.terminalId ?? previous?.terminalId ?? null,
    workspaceId:
      workspaceId ?? event.workspaceListId ?? event.workspaceId ?? previous?.workspaceId ?? null,
    title: event.title ?? previous?.title ?? null,
    sessionId: event.sessionId ?? previous?.sessionId ?? null,
    lastAt: at,
    quickAt,
    pokemon,
    run,
    workMs: (previous?.workMs ?? 0) + ms,
    lastReward: previous?.lastReward ?? 0
  }
  let next = {
    ...save,
    work:
      ms || task ? { jobs: save.work.jobs + Number(task > 0), ms: save.work.ms + ms } : save.work,
    party: { ...save.party, [paneKey]: companion }
  }
  if (pokemon && !previous?.pokemon) {
    next = registerSeen(next, [pokemon.dex])
  }
  if (pokemon && friend) {
    pokemon = gainFriendship(pokemon, friend)
  }
  if (pokemon && berry && next.bag.items.berry > 0) {
    next = { ...next, bag: addItem(next.bag, 'berry', -1) }
    pokemon = gainFriendship(pokemon, FRIEND.meal)
    companion.careNote = { kind: 'feed', at }
    next = creditResearch(next, at, slots, 'berry', 1)
  }
  if (quick) {
    companion.careNote = { kind: 'pet', at }
    next = creditResearch(next, at, slots, 'quick', 1)
  }
  if (uncredited) {
    next = creditWork(next, at, slots, uncredited, boxedPicks(next), rnd)
  }
  if (task) {
    next = creditResearch(next, at, slots, 'job', 1, pokemon.dex)
    const pay = jobPay(task, pokemon.held === 'amulet-coin')
    const { bag } = next
    let paid = addMoney(bag, pay)
    companion.lastReward = paid.money - bag.money
    if (task >= CANDY_JOB_MS) {
      paid = addItem(paid, 'rare-candy')
    }
    if (new Date(at).getHours() < 5) {
      paid.marks = { ...paid.marks, nightJob: true }
    }
    next = { ...next, bag: paid }
    const pick = trainerPick(pokemon)
    const how = { night: isNight(at), evolve }
    const result = gainJob(pick, paneKey, how, at)
    pokemon = savedPokemon(result.pick, pokemon, undefined, pokemon.jobs + 1)
    if (result.evolved) {
      next = registerEvolution(next, pokemon)
    }
    if (evolve && pick.held === 'exp-share') {
      const picks = Object.fromEntries(
        slots.flatMap((slot) => {
          const active = next.party[slot]?.pokemon
          return active ? [[slot, trainerPick(active)]] : []
        })
      )
      const slot = expShareTarget(picks, paneKey)
      if (slot) {
        const member = next.party[slot]
        const shared = gainJob(picks[slot], slot, how, at)
        const grown = savedPokemon(shared.pick, member.pokemon)
        next.party[slot] = { ...member, pokemon: grown }
        if (shared.evolved) {
          next = registerEvolution(next, grown)
        }
      }
    }
  }
  companion.pokemon = pokemon
  return settleBadges(next, slots, pokemon)
}

export function dueCare({ pokemon, run, pickupAt }, at, settings) {
  if (!pokemon || !run) {
    return null
  }
  if (
    run.input &&
    !run.input.hungry &&
    at - run.input.since >= HUNGRY_AFTER &&
    pokemon.held !== 'leftovers'
  ) {
    return 'hunger'
  }
  return settings.pickup &&
    run.state !== 'working' &&
    !needsInput(run.state) &&
    (pickupAt == null || pickupAt <= at)
    ? 'pickup'
    : null
}

export function sampleCare(save, at, slots, settings, rnd = Math.random) {
  let bag = save.bag
  let party = save.party
  for (const slot of slots) {
    const member = party[slot]
    const { pokemon, run } = member
    const due = dueCare(member, at, settings)
    let next = member
    if (due === 'hunger') {
      next = {
        ...next,
        pokemon: gainFriendship(pokemon, FRIEND.hungry),
        run: { ...run, input: { ...run.input, hungry: true } }
      }
    } else if (due === 'pickup') {
      const ability = abilityOf(trainerPick(pokemon), slot)
      const gatherer = ability === 'pickup' || ability === 'honey-gather'
      const delay =
        (pickupDelay(rnd) * trainerPerks(save, slots).pickup * (gatherer ? 2 / 3 : 1)) /
        (pokemon.held === 'amulet-coin' ? 2 : 1)
      next = { ...next, pickupAt: at + delay }
      if (member.pickupAt != null) {
        const item = ability === 'honey-gather' && rnd() < 0.5 ? 'honey' : pickup(rnd)
        if ((bag.items[item] ?? 0) < MAX_ITEM) {
          bag = addItem(bag, item)
          next.careNote = { kind: 'pickup', at, item }
        }
      }
    }
    if (next !== member) {
      if (party === save.party) {
        party = { ...party }
      }
      party[slot] = next
    }
  }
  return party === save.party ? save : { ...save, party, bag }
}

export function trainerView(save, terminalIds) {
  const terminals = new Set(terminalIds)
  const matches = new Map()
  for (const [slot, member] of Object.entries(save.party)) {
    const id = member.terminalId
    if (member.pokemon && terminals.has(id) && !(matches.get(id)?.member.lastAt >= member.lastAt)) {
      matches.set(id, { slot, member })
    }
  }
  const companions = Array.from(matches, ([terminalId, { slot, member }]) => {
    const { starter, dex, form, jobs, stageJobs, friendship } = member.pokemon
    return {
      terminalId,
      ref: { slot, id: pokemonId(member.pokemon, slot) },
      hungry: !!member.run?.input?.hungry,
      careNote: member.careNote ?? null,
      evolvedAt: member.pokemon.evolvedAt ?? null,
      evolvedFrom: member.pokemon.evolvedFrom ?? null,
      starter,
      dex,
      appearance: appearanceOf(member.pokemon),
      ...(form || !Object.hasOwn(species, dex) ? { name: fullName(dex, form) } : {}),
      ...(member.pokemon.nick ? { cardName: nameFor(member.pokemon) } : {}),
      jobs,
      stageJobs,
      friendship,
      workMs: member.workMs,
      lastReward: member.lastReward
    }
  })
  return {
    ...save.work,
    money: save.bag.money,
    boosts: loadBoosts(save.boosts, Date.now()),
    candy: save.bag.items['rare-candy'] ?? 0,
    berries: ['berry', 'sitrus-berry'].filter((item) => save.bag.items[item] > 0),
    companions
  }
}
