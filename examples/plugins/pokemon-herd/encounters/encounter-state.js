import { abilityOf, rollAbil } from './rules/abilities.js'
import { megaForm } from './rules/dex.js'
import {
  bossPick,
  BEATEN_MS,
  outbreakAt,
  outbreakPace,
  outbreakPick,
  raidPhase
} from './rules/events.js'
import { rollGender } from './rules/gender.js'
import { shinyOdds } from './rules/items.js'
import { VISIT_EVERY } from './rules/settings.js'
import {
  allowance,
  bestEffect,
  effortOf,
  fighterKey,
  healthNow,
  isLegendary,
  purse,
  PURSE_CHANCE,
  speedOf,
  wildPick
} from './rules/trainer.js'
import {
  loadRival,
  loadTower,
  newTrainer,
  rivalGreet,
  rivalStarter,
  rivalTrainer,
  RIVAL_LIVES,
  RIVAL_POTIONS,
  RIVAL_RETRY_MS,
  TEAM_EFFORT,
  towerTrainer,
  TRAINER_ODDS,
  WAIT_MS
} from './rules/trainers.js'
import { rollSize, WEATHER_SHARE } from './rules/weather.js'
import { actFor, DASH_SPEED } from './rules/wildacts.js'

export const ENCOUNTER_VERSION = 1
export const CROSS_MS = 39000
const LURES = {
  static: 'electric',
  'lightning-rod': 'electric',
  'magnet-pull': 'steel',
  'flash-fire': 'fire',
  'storm-drain': 'water',
  harvest: 'grass'
}

export function createEncounterState(now) {
  return {
    version: ENCOUNTER_VERSION,
    visitor: null,
    visitAt: null,
    outbreakFrom: null,
    call: null,
    clash: null,
    raid: null,
    counters: {},
    tower: loadTower(null),
    rival: loadRival(null, now),
    health: {},
    spar: { last: {}, records: null },
    result: null
  }
}

export function hpOf(state, slot, now) {
  return healthNow(
    Object.hasOwn(state.health, slot) ? state.health[slot] : null,
    now,
    state.tower.run?.at
  )
}

export function canFight(state, party, slot, now) {
  const hp = hpOf(state, slot, now)
  return (
    Object.hasOwn(party, slot) &&
    hp != null &&
    hp > 0.001 &&
    !state.tower.run?.out.includes(slot) &&
    !Object.hasOwn(state.counters, slot)
  )
}

export function pickTrainerMon(m, random) {
  return {
    dex: m.dex,
    nature: m.nature,
    trainer: true,
    size: 1,
    abil: rollAbil(m.dex, random, !!m.alpha && random() < 0.5),
    ...(m.held ? { held: m.held } : {}),
    ...(m.moves ? { moves: m.moves } : {}),
    ...(m.mega != null ? { mega: 'on', ...(m.mega ? { megaKind: m.mega } : {}) } : { mega: 'off' }),
    ...(m.legend ? { legend: true } : {}),
    ...(m.alpha ? { alpha: true } : {})
  }
}

const megaOf = (dex) => megaForm(dex)?.kind ?? null
const within = ([from, to], random) => from + (to - from) * random()
const asTrainer = (tr, now, random) => ({
  id: `${now}-${tr.cls}-${tr.tower ?? 0}`,
  appearedAt: now,
  expiresAt: now + WAIT_MS,
  pick: pickTrainerMon(tr.team[0], random),
  trainer: { ...tr, idx: 0, fighter: null }
})

export function dueOutbreak(state, context) {
  return context.settings.outbreaks ? outbreakAt(context.now, context.outbreak) : null
}

export function scheduleVisitor(state, context, first = false) {
  const { now, random, settings } = context
  const pace = VISIT_EVERY[settings.visitors]
  if (!pace) {
    state.visitAt = null
    return
  }
  const every = dueOutbreak(state, context) ? outbreakPace(pace) : pace
  const wait = within(every, random)
  state.visitAt = now + Math.min(wait, first ? within([2, 5], random) : Infinity) * 60000
}

export function clearVisitor(state, context) {
  state.visitor = null
  state.clash = null
  if (state.call) {
    state.visitAt = context.now
  } else {
    scheduleVisitor(state, context)
  }
}

export function createVisitor(state, context, deltas) {
  const { now, random, party, dex, settings, weather, daily, perks, jobs, workingSlots } = context
  const raid = state.raid
  const phase = raidPhase(raid, now)
  if (phase === 'beaten' && !raid.caught && !raid.offered) {
    raid.offered = true
    const pick = { ...bossPick(raid.boss), abil: rollAbil(raid.boss.dex, random, true) }
    state.visitor = {
      id: `raid-${raid.id}`,
      pick,
      raid: raid.id,
      appearedAt: now,
      expiresAt: raid.beaten + BEATEN_MS,
      giftAt: now - 5000,
      throws: 0
    }
    deltas.seen.push(pick.dex)
    return
  }
  if (state.visitor || phase === 'egg' || phase === 'battle') {
    return
  }
  const run = state.tower.run
  if (run) {
    if (now < run.nextAt) {
      return
    }
    const tr = towerTrainer(random, now, run.wins + 1, { megaOf })
    const next = asTrainer(tr, now, random)
    if (run.fighter && canFight(state, party, run.fighter, now)) {
      next.trainer.fighter = run.fighter
      next.trainer.nextAt = now + 4000
    }
    state.visitor = next
    return
  }
  if (!VISIT_EVERY[settings.visitors]) {
    return
  }
  const outbreak = dueOutbreak(state, context)
  if (outbreak && state.outbreakFrom !== outbreak.from) {
    state.outbreakFrom = outbreak.from
    state.visitAt = Math.min(state.visitAt ?? Infinity, now + 15000)
  }
  const interval = outbreak
    ? outbreakPace(VISIT_EVERY[settings.visitors])
    : VISIT_EVERY[settings.visitors]
  if (state.visitAt == null || state.visitAt > now + interval[1] * 60000) {
    scheduleVisitor(state, context, true)
  }
  if (now < state.visitAt && !state.call) {
    return
  }
  const call = state.call
  state.call = null
  const caught = new Set(dex.caught)
  const roster = Object.entries(party)
  const [leadSlot, lead] = roster[0] ?? []
  const lureType = lead && LURES[abilityOf(lead, leadSlot)]
  const lured = lureType && random() < 0.5
  let pick = wildPick(new Set(roster.map(([, p]) => p.dex)), random, {
    legend: call === 'legend',
    shinyOdds: Math.max(8, Math.round(shinyOdds(jobs) / perks.shiny)),
    caught,
    boost: lured ? [lureType] : weather?.types,
    share: lured ? 1 : WEATHER_SHARE
  })
  if (outbreak) {
    pick = outbreakPick(pick, outbreak, random)
  }
  if (!outbreak && !pick.legend && !call) {
    const record = state.rival
    if (now >= record.nextAt) {
      record.starter ??= rivalStarter(context.topDex ?? null, random)
      const tr = rivalTrainer(random, now, record, { megaOf, yours: roster.map(([, p]) => p.dex) })
      state.visitor = asTrainer(
        {
          ...tr,
          lives: RIVAL_LIVES,
          potions: RIVAL_POTIONS,
          greet: rivalGreet(record, random)
        },
        now,
        random
      )
      state.rival = { ...record, meets: record.meets + 1, nextAt: now + RIVAL_RETRY_MS }
      return
    }
    if (random() * TRAINER_ODDS < 1) {
      const held = Object.values(context.ownedPicks ?? party)
      state.visitor = asTrainer(
        newTrainer(random, now, {
          megaOf,
          owned: {
            legends: dex.caught.filter(isLegendary).length,
            megas: held.filter((p) => megaForm(p.dex)).length,
            alphas: held.filter((p) => p.alpha).length
          }
        }),
        now,
        random
      )
      return
    }
  }
  pick.size = rollSize(random)
  const gender = rollGender(pick.dex, random)
  if (gender) {
    pick.gender = gender
  }
  pick.abil = rollAbil(pick.dex, random, !!pick.alpha && random() < 0.5, pick.form)
  const act = outbreak
    ? null
    : actFor(pick, { boosted: weather?.types, working: workingSlots.length > 0 }, random)
  const crossing = CROSS_MS / (act?.kind === 'dash' ? DASH_SPEED : 1)
  const actMs = act?.ms ?? 0
  if (actMs) {
    act.from = now + Math.round(crossing * within([0.3, 0.6], random))
    act.until = act.from + actMs
  }
  const stake = purse(pick, random, PURSE_CHANCE[settings.visitors] ?? 1)
  state.visitor = {
    id: `${now}-${pick.dex}`,
    pick,
    act,
    giftAt: null,
    throws: 0,
    appearedAt: now,
    crossing,
    expiresAt: now + crossing + actMs,
    purse: allowance(daily, 'purse', stake)
  }
  deltas.seen.push(pick.dex)
}

export function visitorPickAt(visitor, now) {
  const active = visitor.act && now >= visitor.act.from && now < visitor.act.until
  const { kind } = visitor.act ?? {}
  return {
    ...visitor.pick,
    asleep: active && kind === 'nap',
    friendly: active && kind === 'friendly'
  }
}

export function nextTrainerMon(tr, yours, random) {
  if (tr.rival && yours && tr.idx + 2 < tr.team.length) {
    const key = fighterKey(yours.dex, { form: yours.form })
    const last = tr.team.length - 1
    const fit = (i) => {
      const m = tr.team[i]
      const speed = speedOf(m.dex, { nature: m.nature, effort: tr.effort ?? TEAM_EFFORT })
      const ownSpeed = speedOf(key, { nature: yours.nature, effort: effortOf(yours) })
      return (
        bestEffect(m.dex, key) -
        0.5 * bestEffect(key, m.dex) +
        (speed > ownSpeed ? 0.25 : 0) -
        (i === last ? 0.75 : 0)
      )
    }
    let best = tr.idx + 1
    for (let i = best + 1; i <= last; i++) {
      if (fit(i) > fit(best)) {
        best = i
      }
    }
    if (best !== tr.idx + 1) {
      ;[tr.team[tr.idx + 1], tr.team[best]] = [tr.team[best], tr.team[tr.idx + 1]]
    }
  }
  tr.idx++
  return pickTrainerMon(tr.team[tr.idx], random)
}
