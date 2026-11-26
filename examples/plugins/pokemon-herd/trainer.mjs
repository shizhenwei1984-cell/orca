import { species, starterDex } from './panel/pokemon.mjs'

const MINUTE = 60_000
const DOLLAR = MINUTE / 5
const MAX_MONEY = 999_999
const MAX_ITEMS = 999
const MAX_FRIENDSHIP = 100
const QUICK_COOLDOWN = 10 * MINUTE
const HUNGRY_AFTER = 5 * MINUTE

export function loadTrainer(raw) {
  if (raw === null) {
    return {
      version: 1,
      bag: { money: 0, change: 0, items: {}, marks: {} },
      work: { jobs: 0, ms: 0 },
      party: {}
    }
  }
  if (raw?.version !== 1 || !raw.bag || !raw.work || !raw.party) {
    throw new Error('Unsupported trainer save')
  }
  return raw
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
  let quickAt = previous?.quickAt ?? 0
  if (prior?.input) {
    const waited = at - prior.input.since
    const hungry = prior.input.hungry || (waited >= HUNGRY_AFTER && held !== 'leftovers')
    if (hungry && !prior.input.hungry) {
      friend -= 10
    }
    if (input) {
      input = { ...input, hungry }
    } else if (hungry) {
      berry = 1
    } else if (waited < MINUTE && at - quickAt > QUICK_COOLDOWN) {
      quickAt = at
      friend += 4
    }
  }
  const run = { state, phaseSince, taskMs: state === 'done' ? 0 : taskMs, input }
  return { run, ms, task, friend, berry, quickAt }
}

function gainFriendship(pokemon, points) {
  const gained = points > 0 && pokemon.held === 'soothe-bell' ? points * 2 : points
  const friendship = Math.max(0, Math.min(MAX_FRIENDSHIP, pokemon.friendship + gained))
  return { ...pokemon, friendship }
}

function finishJob(pokemon, at) {
  const stageJobs = pokemon.stageJobs + (pokemon.held === 'lucky-egg' ? 2 : 1)
  const counted = { ...pokemon, jobs: pokemon.jobs + 1, stageJobs }
  const evolution = species[pokemon.dex]?.evolution
  if (pokemon.stay || !evolution?.jobs || stageJobs < evolution.jobs) {
    return counted
  }
  return { ...counted, dex: evolution.dex, stageJobs: 0, evolvedAt: at }
}

function reward(bag, task, held, evolved, at) {
  const multiplier = held === 'amulet-coin' ? 2 : 1
  // Carry the rounding difference across the whole trainer, including jobs on other panes.
  const units = Math.min(300 * DOLLAR, DOLLAR + task) * multiplier + bag.change
  const pay = Math.round(units / DOLLAR)
  const change = units - pay * DOLLAR
  const money = Math.min(MAX_MONEY, bag.money + pay)
  const items =
    task >= 30 * MINUTE
      ? { ...bag.items, 'rare-candy': Math.min(MAX_ITEMS, (bag.items['rare-candy'] ?? 0) + 1) }
      : bag.items
  const marks = {
    ...bag.marks,
    nightJob: bag.marks.nightJob || new Date(at).getHours() < 5,
    evolutions: (bag.marks.evolutions ?? 0) + Number(evolved)
  }
  return { ...bag, money, change, items, marks }
}

export function recordStatus(save, event) {
  const { paneKey, receivedAt: at } = event
  const previous = Object.hasOwn(save.party, paneKey) ? save.party[paneKey] : undefined
  if (previous ? at <= previous.lastAt : !event.workspaceId && !event.terminalId) {
    return save
  }
  const { run, ms, task, friend, berry, quickAt } = trackRun(previous, event)
  let bag = save.bag
  let pokemon = previous?.pokemon ?? null
  if (!pokemon && (event.sessionId || event.terminalId || task)) {
    const starter = starterDex(event)
    pokemon = { starter, dex: starter, jobs: 0, stageJobs: 0, friendship: 0 }
  }
  if (pokemon && friend) {
    pokemon = gainFriendship(pokemon, friend)
  }
  if (pokemon && berry && bag.items.berry > 0) {
    bag = { ...bag, items: { ...bag.items, berry: bag.items.berry - 1 } }
    pokemon = gainFriendship(pokemon, 10)
  }
  if (task) {
    pokemon = finishJob(pokemon, at)
    bag = reward(bag, task, pokemon.held, pokemon.evolvedAt === at, at)
  }
  const companion = {
    terminalId: event.terminalId ?? previous?.terminalId ?? null,
    sessionId: event.sessionId ?? previous?.sessionId ?? null,
    lastAt: at,
    quickAt,
    pokemon,
    run,
    workMs: (previous?.workMs ?? 0) + ms,
    lastReward: task ? bag.money - save.bag.money : (previous?.lastReward ?? 0)
  }
  return {
    ...save,
    bag,
    work:
      ms || task ? { jobs: save.work.jobs + Number(task > 0), ms: save.work.ms + ms } : save.work,
    party: { ...save.party, [paneKey]: companion }
  }
}

export function trainerView(save, terminalIds) {
  const terminals = new Set(terminalIds)
  const matches = new Map()
  for (const member of Object.values(save.party)) {
    const id = member.terminalId
    if (member.pokemon && terminals.has(id) && !(matches.get(id)?.lastAt >= member.lastAt)) {
      matches.set(id, member)
    }
  }
  const companions = Array.from(matches, ([terminalId, member]) => {
    const { starter, dex, jobs, stageJobs, friendship } = member.pokemon
    return {
      terminalId,
      starter,
      dex,
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
    candy: save.bag.items['rare-candy'] ?? 0,
    companions
  }
}
