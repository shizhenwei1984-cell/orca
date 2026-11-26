import { battleExchange, battleKey, boostMove, chosenMoves } from './battle.js'
import {
  canFight,
  clearVisitor,
  createEncounterState,
  createVisitor,
  ENCOUNTER_VERSION,
  hpOf,
  nextTrainerMon,
  visitorPickAt
} from './encounter-state.js'
import { abilityOf, lockOf, megaAbility, sayName, stageWords } from './rules/abilities.js'
import { evolutionsOf } from './rules/dex.js'
import {
  COUNTER_LAND_MS,
  cooldownLeft,
  eggsOn,
  laysEgg,
  newRaid,
  raidHit,
  raidPhase,
  raidReward,
  RAID_REST
} from './rules/events.js'
import { perks as badgePerks, ITEMS, pickup, visitorGift } from './rules/items.js'
import { movesetOf, pickMove } from './rules/moves.js'
import { FRIEND, MAX_HEARTS, REVIVE, useItem as applyItem, withFriend } from './rules/picks.js'
import { DEFAULTS } from './rules/settings.js'
import { NOTE_TEXT, recordOf, sparTurns, whoOf, withResult } from './rules/spar.js'
import {
  allowance,
  AUTO_BAIT,
  BAIT,
  baitFor,
  ballFor,
  BALLS,
  caughtPick,
  dayOf,
  effortOf,
  loadDex,
  LEGEND_THROWS,
  OWN_REST,
  throwBall,
  TIP
} from './rules/trainer.js'
import {
  rivalNext,
  rivalPay,
  towerWin,
  trainerPay,
  TOWER_BENCH_HEALS,
  TOWER_HEAL_IDS,
  TOWER_LIVES,
  TOWER_NEXT_MS,
  TOWER_SWITCH
} from './rules/trainers.js'
import { weatherNow } from './rules/weather.js'
import { FLEE_SPEED, HALT, TEASE_PURSE } from './rules/wildacts.js'

export { createEncounterState } from './encounter-state.js'

const GIFT_WAIT_MS = 800
const SPAR_GAP = 600000
const BOOST_GAP = 30000
const CHOOSE_MS = 6000
const nextBattleAt = (now, exchange) =>
  now + (exchange.entry.length ? 900 : 0) + (exchange.turns.length > 1 ? 3030 : 2040)
const throwEnd = (shakes) => 740 + Math.max(1, shakes) * 700

export function encounterContext(options) {
  const date = new Date(options.now)
  const night = date.getHours() < 6 || date.getHours() >= 18
  const season =
    (Math.floor(date.getHours() / 2) +
      Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000) +
      (date.getMinutes() >= 110 - (date.getHours() % 2) * 60 ? 1 : 0)) %
    4
  return {
    ...options,
    day: dayOf(options.now),
    night,
    weather: options.weather ?? weatherNow('clear', { a: season, t: 0 }, Number(night)),
    settings: { ...DEFAULTS, ...options.settings },
    party: options.party ?? {},
    items: options.items ?? {},
    dex: options.dex ?? loadDex(null),
    daily: options.daily?.day === dayOf(options.now) ? options.daily : { count: {} },
    perks: { ...badgePerks(new Set()), ...options.perks },
    workingSlots: options.workingSlots ?? [],
    jobs: options.jobs ?? 0,
    ball: options.ball ?? null,
    bait: options.bait === undefined ? AUTO_BAIT : options.bait
  }
}

export function movesFor(visitor, party, slot) {
  const pick = party[slot]
  const key = battleKey(pick)
  const lock = visitor.battle?.slot === slot ? lockOf(visitor.battle.own) : null
  return movesetOf(key, chosenMoves(pick, key)).filter((move) => !lock || move.name === lock)
}

function addItems(deltas, id, count) {
  deltas.items[id] = (deltas.items[id] ?? 0) + count
}

function pay(deltas, reward) {
  deltas.money += reward.money ?? 0
  if (reward.item) {
    addItems(deltas, reward.item, reward.count)
  }
  for (const [id, n] of reward.items ?? []) {
    addItems(deltas, id, n)
  }
}

const research = (deltas, event, count = 1) => deltas.research.push({ event, count })

function cappedPay(context, deltas, kind, amount) {
  const value = allowance(context.daily, kind, amount)
  if (!value) {
    return 0
  }
  deltas.money += value
  research(deltas, kind, value)
  return value
}

function saveHp(state, slot, hp, now, rest = OWN_REST) {
  const record = { hp, at: now, ...(hp <= 0.001 ? { rest: now + rest } : {}) }
  state.health = { ...state.health, [slot]: record }
}

function endTower(state, context, reason) {
  const { now } = context
  const { run } = state.tower
  for (const slot of Object.keys(state.health)) {
    const hp = hpOf(state, slot, now)
    if (hp != null) {
      saveHp(state, slot, hp, now)
    }
  }
  state.tower.best = Math.max(state.tower.best, run.wins)
  state.tower.run = null
  if (state.visitor?.trainer?.tower) {
    clearVisitor(state, context)
  }
  if (!state.call) {
    state.visitAt = now + 60000
  }
  state.result = { kind: 'tower-ended', reason, wins: run.wins, at: now }
}

function loseTrainer(state, context) {
  const { now, random } = context
  const { trainer, pick } = state.visitor
  if (trainer.tower) {
    endTower(state, context, 'No fighters left')
    return
  }
  if (trainer.rival) {
    state.rival = {
      ...state.rival,
      losses: state.rival.losses + 1,
      nextAt: rivalNext(now, random)
    }
  }
  state.result = { kind: 'trainer-lost', trainer: trainer.name, pick, at: now }
  clearVisitor(state, context)
}

function winTrainer(state, context, deltas) {
  const { now, random, perks, day } = context
  const { trainer, pick } = state.visitor
  let reward
  if (trainer.tower) {
    const tower = state.tower
    const floor = towerWin(trainer.tower, tower.paid, day)
    tower.paid = floor.paid
    tower.best = Math.max(tower.best, trainer.tower)
    tower.run = {
      ...tower.run,
      wins: trainer.tower,
      fighter: trainer.fighter,
      benchHeals: 0,
      nextAt: now + TOWER_NEXT_MS
    }
    reward = floor.pay
  } else if (trainer.rival) {
    reward = rivalPay({ ...state.rival, meets: trainer.meets }, random)
    state.rival = { ...state.rival, wins: state.rival.wins + 1, nextAt: rivalNext(now, random) }
  } else {
    reward = trainerPay(trainer, random)
  }
  reward = { ...reward, money: Math.round(reward.money * perks.trainerPay) }
  pay(deltas, reward)
  deltas.marks.trainers = 1
  state.result = {
    kind: 'trainer-won',
    trainer: trainer.name,
    pick,
    floor: trainer.tower,
    reward,
    at: now
  }
  clearVisitor(state, context)
}

function runExchange(state, context, slot, move, itemTurn = false) {
  const { now, party } = context
  const v = state.visitor
  const tr = v.trainer
  const active = visitorPickAt(v, now)
  const ownBefore = hpOf(state, slot, now)
  const opponentBefore = v.pick.hp ?? 1
  if (active.asleep) {
    v.pick.grumpy = true
  }
  if (active.asleep || active.friendly) {
    v.expiresAt -= v.act.until - now
    v.act.until = now
  }
  const exchange = battleExchange(v, { ...context, slot, hp: ownBefore, move, itemTurn })
  const until = nextBattleAt(now, exchange)
  if (tr) {
    tr.fought = true
    tr.fighter = slot
    tr.nextAt = null
    tr.choice = null
    tr.itemTurn = false
  } else {
    v.expiresAt += until - now
  }
  state.clash = { kind: 'exchange', slot, at: now, until, ...exchange }
  state.result = {
    kind: 'exchange',
    visitorId: v.id,
    pick: v.pick,
    own: party[slot],
    ownBefore,
    opponentBefore,
    ...state.clash,
    at: now
  }
}

function settleExchange(state, context) {
  const { now, party } = context
  const { slot, hp, fainted, opponentFainted } = state.clash
  const v = state.visitor
  const tr = v.trainer
  saveHp(state, slot, hp, state.clash.until)
  state.clash = null
  if (!tr) {
    if (opponentFainted) {
      state.result = { ...state.result, kind: 'wild-fainted' }
      clearVisitor(state, context)
    }
    return
  }
  if (fainted) {
    tr.fallen = (tr.fallen ?? 0) + 1
    tr.fighter = null
    if (tr.rival) {
      tr.lives--
    }
    if (tr.tower && state.tower.run) {
      const run = state.tower.run
      run.faints++
      run.out = [...new Set([...run.out, slot])]
    }
    if (
      tr.lives <= 0 ||
      (tr.tower && state.tower.run.faints >= state.tower.run.lives) ||
      !Object.keys(party).some((key) => canFight(state, party, key, now))
    ) {
      loseTrainer(state, context)
      return
    }
  }
  if (opponentFainted) {
    state.clash = { kind: 'trainer-faint', slot, until: now + 2200 }
    return
  }
  tr.nextAt = tr.fighter ? now + 500 : null
  v.expiresAt = Math.max(v.expiresAt, now + 60000)
}

function settleTrainerFaint(state, context, deltas) {
  const { now, party, random } = context
  const v = state.visitor
  const tr = v.trainer
  if (tr.idx + 1 >= tr.team.length) {
    winTrainer(state, context, deltas)
    return
  }
  v.pick = nextTrainerMon(tr, party[state.clash.slot], random)
  state.clash = null
  v.expiresAt = Math.max(v.expiresAt, now + 60000)
  tr.nextAt = tr.fighter ? now + 2700 : null
  state.result = { kind: 'send-out', pick: v.pick, trainer: tr.name, at: now }
}

function chooseOrFight(state, context, slot, move, itemTurn = false) {
  const tr = state.visitor.trainer
  if (
    tr &&
    context.settings.chooseMoves &&
    !move &&
    !itemTurn &&
    !tr.choice &&
    (!state.visitor.battle?.slot || state.visitor.battle.slot === slot) &&
    movesFor(state.visitor, context.party, slot).length
  ) {
    tr.choice = { slot, until: context.now + CHOOSE_MS }
    tr.nextAt = null
    tr.fighter = slot
    return
  }
  runExchange(state, context, slot, move, itemTurn)
}

function settleTimed(state, context, deltas, allowAutomaticMove) {
  const { now, party, settings } = context
  for (const [slot, counter] of Object.entries(state.counters)) {
    if (now < counter.at) {
      continue
    }
    if (Object.hasOwn(party, slot)) {
      const hp = Math.max(0, (hpOf(state, slot, counter.at) ?? 0) - counter.dmg)
      saveHp(state, slot, hp, counter.at, RAID_REST)
    }
    delete state.counters[slot]
  }

  if (state.clash) {
    if (now < state.clash.until) {
      return
    }
    if (state.clash.kind === 'exchange') {
      settleExchange(state, context)
    } else if (state.clash.kind === 'trainer-faint') {
      settleTrainerFaint(state, context, deltas)
    } else {
      const terminal = state.clash.terminal
      state.clash = null
      if (terminal) {
        clearVisitor(state, context)
      }
    }
  }
  if (state.clash) {
    return
  }
  const run = state.tower.run
  if (run) {
    const slots = Object.keys(party)
    run.lives = Math.min(TOWER_LIVES, Math.max(run.lives, slots.length))
    if (!slots.some((slot) => !run.out.includes(slot))) {
      endTower(state, context, 'No fighters left')
    }
  }
  const v = state.visitor
  const tr = v?.trainer
  if (
    v &&
    ((!run && !tr?.tower && !v.raid && settings.visitors === 'off') ||
      (tr?.tower && !state.tower.run))
  ) {
    clearVisitor(state, context)
  } else if (tr?.fought && !Object.keys(party).some((slot) => canFight(state, party, slot, now))) {
    loseTrainer(state, context)
  } else if (
    tr?.choice &&
    (!settings.chooseMoves || now >= tr.choice.until) &&
    canFight(state, party, tr.choice.slot, now)
  ) {
    runExchange(state, context, tr.choice.slot, null)
  } else if (
    allowAutomaticMove &&
    tr?.fighter &&
    tr.nextAt != null &&
    now >= tr.nextAt &&
    canFight(state, party, tr.fighter, now)
  ) {
    chooseOrFight(state, context, tr.fighter, null, tr.itemTurn)
  } else if (v && now >= v.expiresAt) {
    state.result = { kind: 'departed', pick: v.pick, trainer: tr?.name, at: now }
    if (tr?.tower) {
      endTower(state, context, 'Trainer left')
    } else {
      clearVisitor(state, context)
    }
  }
}

function takeGift(state, context, deltas) {
  const v = state.visitor
  if (v.giftAt != null || v.trainer) {
    return 'The gift has already been collected.'
  }
  const gift = visitorGift(context.random)
  const count = gift.n * (v.pick.alpha ? 2 : 1)
  v.giftAt = context.now
  addItems(deltas, gift.id, count)
  research(deltas, 'gift')
  const money = cappedPay(context, deltas, 'purse', v.purse ?? 0)
  state.result = {
    kind: 'gift',
    pick: v.pick,
    reward: { item: gift.id, count, money },
    at: context.now
  }
}

function capture(state, context, deltas, action) {
  const { items, now, random, perks, night, party } = context
  const v = state.visitor
  if (v.trainer || v.giftAt == null || now < v.giftAt + GIFT_WAIT_MS) {
    return 'Collect the visitor’s gift first.'
  }
  if (
    action.ball != null &&
    (!BALLS.includes(action.ball) || !Object.hasOwn(items, action.ball) || items[action.ball] <= 0)
  ) {
    return 'That ball is unavailable.'
  }
  const ball = ballFor(items, v.pick, Object.hasOwn(action, 'ball') ? action.ball : context.ball)
  if (!ball) {
    return 'There are no Poké Balls available.'
  }
  const wantedBait = Object.hasOwn(action, 'bait') ? action.bait : context.bait
  if (wantedBait != null && wantedBait !== AUTO_BAIT && !Object.hasOwn(BAIT, wantedBait)) {
    return 'That Berry is unavailable.'
  }
  const pick = visitorPickAt(v, now)
  const bait = baitFor(items, pick, ball, wantedBait)
  const result = throwBall(ball, pick, random, bait, {
    throws: v.throws,
    night,
    catchMul: perks.catchMul
  })
  addItems(deltas, ball, -1)
  if (bait) {
    addItems(deltas, bait, -1)
    research(deltas, 'berry')
  }
  if (ball === 'master-ball' && context.ball === ball) {
    deltas.selection.ball = null
  }
  v.throws++
  const fled = result.fled || (!result.caught && pick.legend && v.throws >= LEGEND_THROWS)
  const terminal = result.caught || fled
  const until = now + throwEnd(result.shakes) + (terminal ? 2500 : 0)
  state.clash = { kind: 'throw', until, terminal }
  state.result = {
    kind: result.caught ? 'caught' : fled ? 'fled' : 'broke-free',
    pick,
    ball,
    bait,
    shakes: result.shakes,
    revealAt: now + throwEnd(result.shakes),
    at: now
  }
  if (v.act?.until > now && now >= v.act.from) {
    v.expiresAt -= v.act.until - now
    v.act.until = now
  }
  if (!v.raid) {
    v.expiresAt += until - now
  }
  if (!result.caught) {
    if (!terminal && v.act?.kind === 'teleport') {
      v.teleportAt = until
    }
    return
  }
  const found = caughtPick(pick, now, random, ball)
  const [slot, lead] = Object.entries(party)[0] ?? []
  if (lead?.nature && abilityOf(lead, slot) === 'synchronize' && random() < 0.5) {
    found.nature = lead.nature
  }
  if (state.raid && v.raid === state.raid.id) {
    state.raid.caught = now
  }
  deltas.box[`box-${now}-${found.dex}`] = found
  research(deltas, 'catch')
  if (BAIT[bait]?.double) {
    const item = pickup(random)
    addItems(deltas, item, 1)
    state.result.reward = { item, count: 1 }
  }
}

function strikeRaid(state, context, deltas, slot) {
  const { now, party, random, weather, workingSlots } = context
  const raid = state.raid
  if (raidPhase(raid, now) !== 'battle') {
    return 'The raid boss is unavailable.'
  }
  if (cooldownLeft(raid, slot, now)) {
    return 'This Pokémon is waiting to strike again.'
  }
  const pick = party[slot]
  const key = battleKey(pick)
  const move = boostMove(
    pickMove(key, raid.boss.dex, random, {
      moves: chosenMoves(pick, key),
      weather: weather?.id
    }),
    weather
  )
  const { raid: updated, hit } = raidHit(raid, key, slot, move.type, now, random, {
    alpha: !!pick.alpha,
    shadow: !!pick.shadow,
    hearts: pick.hearts ?? 0,
    move,
    drop: true,
    working: workingSlots.includes(slot),
    effort: effortOf(pick),
    nature: pick.nature,
    weather: weather?.id,
    agents: Object.keys(party).length
  })
  state.raid = updated
  if (hit.back) {
    state.counters = { ...state.counters, [slot]: { at: now + COUNTER_LAND_MS, dmg: hit.back.dmg } }
  }
  state.result = {
    kind: 'raid-hit',
    visitorId: raid.id,
    own: pick,
    ownBefore: hpOf(state, slot, now),
    opponentBefore: raid.hp,
    pick: raid.boss,
    hit,
    hp: updated.hp,
    at: now
  }
  if (updated.beaten && !updated.paid) {
    const reward = raidReward(updated.boss)
    updated.paid = true
    pay(deltas, reward)
    state.result = { ...state.result, kind: 'raid-won', reward }
    createVisitor(state, context, deltas)
  }
}

function sparSide(pick, slot) {
  const key = battleKey(pick)
  return {
    key,
    alpha: !!pick.alpha,
    shadow: !!pick.shadow,
    hearts: pick.hearts ?? 0,
    size: pick.size,
    effort: effortOf(pick),
    nature: pick.nature,
    moves: chosenMoves(pick, key),
    ab: abilityOf(pick, slot),
    megaAb: megaAbility(key),
    held: pick.held,
    nfe: !megaAbility(key) && evolutionsOf(pick.dex).length > 0
  }
}

function spar(state, context, deltas, action) {
  const { party, now, random, weather, day } = context
  const { slot, opponent, source = 'drop' } = action
  if (slot === opponent || !canFight(state, party, opponent, now)) {
    return 'Choose another Pokémon that can spar.'
  }
  if (source !== 'drop' && source !== 'ambient' && source !== 'wake') {
    return 'Unknown spar type.'
  }
  if (state.clash || state.visitor?.trainer?.fighter) {
    return 'Wait for the current battle to finish.'
  }
  const picks = [party[slot], party[opponent]]
  const last = state.spar.last
  const since = now - Math.max(last[slot] ?? -Infinity, last[opponent] ?? -Infinity)
  const gap = source === 'ambient' && context.xAttack ? BOOST_GAP : SPAR_GAP
  if (source === 'ambient' && (!context.settings.spar || since < gap)) {
    return 'These Pokémon are waiting to spar again.'
  }
  const match = sparTurns(
    sparSide(picks[0], slot),
    sparSide(picks[1], opponent),
    random,
    (move) => boostMove(move, weather),
    weather?.id
  )
  const won = match.winner === 'a' ? 0 : 1
  const lost = 1 - won
  const slots = [slot, opponent]
  const who = slots.map((key, i) => whoOf(key, picks[i]))
  state.spar.records = withResult(state.spar.records, who[won], who[lost], day)
  state.spar.last = { ...last, [slot]: now, [opponent]: now }
  const hasBonus = source === 'ambient' || (source === 'drop' && since >= SPAR_GAP)
  const bonus = hasBonus ? FRIEND.spar : 0
  deltas.party[slots[won]] = withFriend(
    { ...picks[won], sparW: (picks[won].sparW ?? 0) + 1 },
    FRIEND.spar + bonus
  )
  deltas.party[slots[lost]] = withFriend(
    { ...picks[lost], sparL: (picks[lost].sparL ?? 0) + 1 },
    bonus
  )
  if (Math.max(...slots.map((key) => deltas.party[key].hearts)) >= MAX_HEARTS) {
    deltas.marks.fullHearts = true
  }
  const money = hasBonus
    ? cappedPay(context, deltas, 'tip', source === 'drop' ? TIP.drop : TIP.spar)
    : 0
  if (hasBonus) {
    research(deltas, 'spar')
  }
  const until = now + match.turns.length * 1050 + 900
  state.clash = { kind: 'spar', until }
  state.result = {
    kind: 'spar',
    slot,
    opponent,
    own: picks[0],
    pick: picks[1],
    hp: match.hp,
    winner: match.winner,
    record: recordOf(state.spar.records, who[won], who[lost], day),
    money,
    until,
    at: now,
    entry: ['a', 'b'].map((by) => ({
      side: by === 'a' ? 'own' : 'opponent',
      notes: [...match.entry[by].map(sayName), stageWords(match.entryStages[by])].filter(Boolean)
    })),
    statusBefore: { own: null, opponent: null },
    turns: match.turns.map((turn) => ({
      side: turn.by === 'a' ? 'own' : 'opponent',
      move: turn.move?.name,
      type: turn.move?.type,
      physical: turn.move?.physical,
      dash: turn.move?.dash,
      ultimate: turn.move?.ultimate,
      boosted: turn.move?.boosted,
      blue: battleKey(picks[turn.by === 'a' ? 0 : 1]) === '6mX',
      status: turn.move?.status,
      ailments: turn.ailments,
      statusAction: turn.statusAction,
      statusTick: turn.tick?.kind,
      damage: turn.dmg,
      targetHp: turn.hp,
      ownHp: turn.tick?.hp ?? turn.recoil?.hp ?? turn.drain?.hp,
      miss: turn.move?.miss,
      crit: turn.move?.crit,
      effectiveness: turn.move?.eff,
      notes: [
        ...(turn.abil ?? []).map(sayName),
        NOTE_TEXT.skip[turn.skip],
        NOTE_TEXT.effect[turn.effect],
        NOTE_TEXT.tick[turn.tick?.kind],
        turn.recoil?.word,
        turn.setup
      ].filter(Boolean)
    }))
  }
}

function heal(state, context, deltas, slot, item) {
  const { now, party, items, day, night } = context
  if (
    !Object.hasOwn(party, slot) ||
    !TOWER_HEAL_IDS.includes(item) ||
    !Object.hasOwn(items, item) ||
    items[item] <= 0
  ) {
    return 'That healing item is unavailable.'
  }
  if (state.clash?.slot === slot || Object.hasOwn(state.counters, slot)) {
    return 'Wait for the blow to land.'
  }
  const hp = hpOf(state, slot, now)
  const effect = applyItem(party[slot], slot, item, { day, night, hpOf: () => hp }, now)
  if (!effect) {
    return 'This Pokémon cannot use that item now.'
  }
  const run = state.tower.run
  const tr = state.visitor?.trainer
  const isHeal = effect.revive || effect.heal
  const bench = run && isHeal && (tr?.fighter !== slot || REVIVE[item])
  if (bench && run.benchHeals >= TOWER_BENCH_HEALS) {
    return 'The bench heal has been used on this floor.'
  }
  if (isHeal) {
    saveHp(state, slot, effect.revive || Math.min(1, hp + effect.heal), now)
  }
  if (bench) {
    run.benchHeals++
    if (effect.revive) {
      run.out = run.out.filter((key) => key !== slot)
    }
  }
  if (tr?.fought && tr.fighter === slot && isHeal) {
    tr.choice = null
    tr.itemTurn = true
    tr.nextAt = now + 700
  }
  if (effect.pick !== party[slot]) {
    deltas.party[slot] = effect.pick
  }
  if (effect.pick.hearts >= MAX_HEARTS) {
    deltas.marks.fullHearts = true
  }
  if (effect.pick.fed !== party[slot].fed) {
    research(deltas, 'berry')
  }
  addItems(deltas, item, -1)
  if (!state.clash) {
    state.result = { kind: 'healed', own: party[slot], item, hp: hpOf(state, slot, now), at: now }
  }
}

function applyAction(state, context, deltas, action) {
  const { now, random, party, dex, day, settings, items } = context
  if (action.type === 'tick') {
    return
  }
  if (action.type === 'work') {
    const raid = state.raid
    const laid = eggsOn(raid, day)
    if (settings.raids && laysEgg(action.before, action.after, raidPhase(raid, now), laid)) {
      state.raid = newRaid(now, random, {
        day,
        eggs: laid,
        caught: new Set(dex.caught),
        agents: Object.keys(party).length
      })
      state.result = { kind: 'raid-egg', at: now }
    }
    return
  }
  if (action.type === 'call') {
    if (settings.visitors === 'off') {
      return 'Turn on visitors first.'
    }
    if (state.call) {
      return 'A visitor is already on its way.'
    }
    const item = action.item
    if (item !== 'honey' && item !== 'azure-flute') {
      return 'That item cannot call a visitor.'
    }
    if ((items[item] ?? 0) <= 0) {
      return `There is no ${ITEMS[item].name} in the Bag.`
    }
    addItems(deltas, item, -1)
    state.call = item === 'honey' ? 'honey' : 'legend'
    return
  }
  if (action.type === 'tower-start') {
    if (state.tower.run) {
      return 'A climb is already active.'
    }
    if (!Object.keys(party).some((slot) => canFight(state, party, slot, now))) {
      return 'A ready Pokémon is needed to enter the Tower.'
    }
    state.tower.run = {
      at: now,
      nextAt: now,
      wins: 0,
      faints: 0,
      out: [],
      benchHeals: 0,
      lives: Math.min(TOWER_LIVES, Object.keys(party).length)
    }
    if (state.visitor && !state.visitor.trainer && !state.visitor.raid && !state.clash) {
      state.visitor.expiresAt = Math.min(state.visitor.expiresAt, now + 3000)
    }
    return
  }
  if (action.type === 'tower-quit') {
    if (!state.tower.run) {
      return 'There is no active climb.'
    }
    endTower(state, context, 'Climb ended')
    return
  }
  if (action.type === 'party-switch') {
    const slot = action.slot
    if (!Object.hasOwn(party, slot)) {
      return 'That Pokémon is unavailable.'
    }
    if (state.clash?.slot === slot || Object.hasOwn(state.counters, slot)) {
      return 'Wait for the blow to land.'
    }
    const hp = hpOf(state, slot, now)
    if (state.tower.run && hp != null) {
      saveHp(state, slot, Math.max(0.01, hp - TOWER_SWITCH), now)
    }
    const visitor = state.visitor
    if (visitor?.battle?.slot === slot) {
      visitor.battle.slot = null
    }
    if (visitor?.statuses) {
      delete visitor.statuses[slot]
    }
    if (visitor?.trainer?.fighter === slot) {
      visitor.trainer.choice = null
      visitor.trainer.itemTurn = true
      visitor.trainer.nextAt = now + 700
    }
    return
  }
  if (action.type === 'heal') {
    return heal(state, context, deltas, action.slot, action.item)
  }
  if (
    ['attack', 'raid-hit', 'spar'].includes(action.type) &&
    !canFight(state, party, action.slot, now)
  ) {
    return 'That Pokémon is unavailable.'
  }
  if (action.type === 'spar') {
    return spar(state, context, deltas, action)
  }
  if (action.type === 'raid-hit') {
    if (action.id !== state.raid?.id) {
      return 'That raid has ended.'
    }
    if (state.clash) {
      return 'Wait for the current battle to finish.'
    }
    return strikeRaid(state, context, deltas, action.slot)
  }
  const v = state.visitor
  if (!v || action.id !== v.id) {
    return 'That visitor has already left.'
  }
  if (state.clash) {
    return 'Wait for the current action to finish.'
  }
  if (action.type === 'nearby') {
    const act = v.act
    const slot = action.slot
    if (!act || act.from != null || !Object.hasOwn(HALT, act.kind) || !Object.hasOwn(party, slot)) {
      return 'That visitor has already moved on.'
    }
    const working = context.workingSlots.includes(slot)
    if ((act.kind === 'curious') !== working && act.kind !== 'friendly') {
      return 'The visitor is looking for another Pokémon.'
    }
    if (act.kind === 'challenge' && !canFight(state, party, slot, now)) {
      return 'That Pokémon is unavailable.'
    }
    const ms = HALT[act.kind]
    Object.assign(act, { slot, from: now, until: now + ms })
    v.expiresAt += ms
    if (act.kind === 'tease') {
      v.purse = Math.round(v.purse * TEASE_PURSE)
      v.expiresAt = act.until + (v.expiresAt - act.until) / FLEE_SPEED
    }
    if (act.kind === 'challenge') {
      act.until = now
      runExchange(state, context, slot)
    }
    return
  }
  if (action.type === 'gift') {
    return takeGift(state, context, deltas)
  }
  if (action.type === 'throw') {
    return capture(state, context, deltas, action)
  }
  if (action.type === 'withdraw') {
    if (!v.trainer?.fighter) {
      return 'There is no active fighter.'
    }
    v.trainer.fighter = null
    v.trainer.nextAt = null
    v.trainer.choice = null
    return
  }
  if (action.type === 'attack') {
    if (
      action.move != null &&
      !movesFor(v, party, action.slot).some(({ name }) => name === action.move)
    ) {
      return 'This Pokémon cannot use that move.'
    }
    chooseOrFight(state, context, action.slot, action.move, v.trainer?.itemTurn)
    return
  }
  return 'Unknown encounter action.'
}

// Commit state and deltas together. Only tick advances automatic attacks or introduces a visitor.
export function transitionEncounter(previous, action, options) {
  if (!Number.isFinite(options.now) || typeof options.random !== 'function') {
    throw new TypeError('Encounter transitions require time and a random source')
  }
  const context = encounterContext(options)
  const before = previous ?? createEncounterState(context.now)
  if (before.version !== ENCOUNTER_VERSION) {
    throw new RangeError('Unsupported encounter state version')
  }
  const state = structuredClone(before)
  const deltas = {
    items: {},
    money: 0,
    marks: {},
    selection: {},
    party: {},
    box: {},
    seen: [],
    research: []
  }
  if (action.type !== 'work') {
    settleTimed(state, context, deltas, action.type === 'tick')
  }
  const error = applyAction(state, context, deltas, action)
  if (error) {
    return { state: before, deltas: null, error }
  }
  if (action.type === 'tick' || action.type === 'call' || action.type === 'tower-start') {
    if (!state.clash) {
      createVisitor(state, context, deltas)
    }
  }
  return { state, deltas }
}
