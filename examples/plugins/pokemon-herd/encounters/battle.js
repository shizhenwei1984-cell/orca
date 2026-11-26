import {
  abilityName,
  abilityOf,
  afterHit,
  canStatus,
  contactStatus,
  endTurn,
  knownImmune,
  leftovers,
  lockOf,
  locks,
  megaAbility,
  megaEvolve,
  meet,
  newSide,
  onHit,
  orbStatus,
  quickClaw,
  sayName,
  selfHurt,
  SKIP_SAY,
  slotsOf,
  speedMul,
  stageBy,
  stageWords,
  statusEnd,
  statusSkip,
  STATUS_SAY,
  sturdyHolds,
  suckerFails
} from './rules/abilities.js'
import { MOVE_FLAGS } from './rules/ability-data.js'
import { evolutionsOf, megaForm } from './rules/dex.js'
import { RECHARGE } from './rules/move-stages.js'
import { DRAIN, missOf, movesetOf, pickMove, powerOf, PRIORITY } from './rules/moves.js'
import { SIDE_EFFECTS } from './rules/spar.js'
import {
  damage,
  effortOf,
  fighterKey,
  hitBack,
  hitWild,
  hpRatio,
  isFormKey,
  moveHow,
  OVERKILL,
  OVERKILL_GREEN,
  OWN_TAKE,
  RED,
  speedOf,
  typesOf
} from './rules/trainer.js'
import { RIVAL_POTION, RIVAL_POTION_AT, TEAM_EFFORT } from './rules/trainers.js'
import { boosts, WEATHER_HIT } from './rules/weather.js'
import { GRUMPY_HIT } from './rules/wildacts.js'

const STAGE_STATS = ['atk', 'def', 'spa', 'spd', 'spe']
const STANCE_ABILITIES = ['protean', 'libero']
const FAINTED = 0.001
const clampHp = (hp) => Math.max(0, Math.min(1, hp))

export function battleKey(pick, opponent = false) {
  const mega =
    !pick.form &&
    (opponent ? pick.mega === 'on' : pick.mega !== 'off') &&
    megaForm(pick.dex, pick.megaKind)
  return fighterKey(pick.dex, { form: pick.form, mega: mega ? (mega.kind ?? '') : null })
}

export function chosenMoves(pick, key) {
  const kind = /^\d+m([XY]?)$/.exec(String(key))?.[1]
  return (kind === undefined ? pick.moves : pick.megaMoves?.[kind || 'M']) ?? null
}

export function boostMove(move, weather) {
  return boosts(weather, move.type)
    ? { ...move, mul: move.mul * WEATHER_HIT, boosted: weather.icon }
    : move
}

function enterSide(pick, slot, key) {
  return newSide(abilityOf(pick, slot), 1, {
    item: pick.held,
    nfe: !megaAbility(key) && evolutionsOf(pick.dex).length > 0
  })
}

function meetFighters(v, pick, slot, key, wildKey) {
  const idx = v.trainer?.idx ?? -1
  const old = v.battle
  const newOwn = old?.slot !== slot || old?.key !== key
  const newWild = old?.idx !== idx
  const own = newOwn ? enterSide(pick, slot, key) : old.own
  const wild = newWild ? enterSide(v.pick, v.id, wildKey) : old.wild
  const entry = []
  function describe(result, a, b) {
    for (const [side, abilities, stages] of [
      [a, result.a, result.stages?.a],
      [b, result.b, result.stages?.b]
    ]) {
      const notes = [
        ...abilities.map(sayName).filter(Boolean),
        ...(stages?.length ? [stageWords(stages)] : [])
      ]
      if (notes.length) {
        entry.push({ side, notes })
      }
    }
  }
  if (newOwn || newWild) {
    const [oa, wa] = [own.ab, wild.ab]
    if (!newOwn && oa === 'intimidate') {
      own.ab = ''
    }
    if (!newWild && wa === 'intimidate') {
      wild.ab = ''
    }
    describe(meet(own, wild), 'own', 'opponent')
    own.ab = oa
    wild.ab = wa
  }
  for (const [side, other, fighter, by, against] of [
    [own, wild, key, 'own', 'opponent'],
    [wild, own, wildKey, 'opponent', 'own']
  ]) {
    const ab = megaAbility(fighter)
    if (!ab || side.mega) {
      continue
    }
    side.mega = true
    describe(megaEvolve(side, other, ab), by, against)
  }
  v.battle = { slot, key, idx, own, wild }
  return entry
}

function targetTypes(att, def, defKey, type) {
  let tt = def.typeAs ? [def.typeAs] : null
  if (att.ab === 'scrappy' && (type === 'normal' || type === 'fighting')) {
    const types = tt ?? typesOf(defKey)
    if (types.includes('ghost')) {
      tt = types.filter((t) => t !== 'ghost')
    }
  }
  return tt ? { tt } : {}
}

function applySideEffect(att, def, types, move, roll, hit, first, random) {
  const notes = []
  if (att.ab === 'sheer-force' && MOVE_FLAGS[move.name]?.includes('e')) {
    return { notes }
  }
  const [what, chance] = SIDE_EFFECTS[move.name] ?? []
  if (!what || hit.fainted) {
    return { notes }
  }
  if (STAGE_STATS.includes(what) && hit.eff > 0 && random() < chance) {
    const stages = []
    stageBy(def, what, -1, stages)
    if (stages.length) {
      notes.push(stageWords(stages))
      if (def.ab === 'defiant' || def.ab === 'competitive') {
        const raised = []
        stageBy(def, def.ab === 'defiant' ? 'atk' : 'spa', 2, raised)
        if (raised.length) {
          notes.push(`${abilityName(def.ab)}! ${stageWords(raised)}`)
        }
      }
    }
  }
  if (
    STATUS_SAY[what] &&
    !roll.miss &&
    hit.eff > 0 &&
    random() < chance &&
    canStatus(def, what, types)
  ) {
    def.status = what
    notes.push(STATUS_SAY[what])
  }
  const flinch =
    what === 'flinch' && !roll.miss && def.ab !== 'inner-focus' && random() < chance && first
  return { notes, flinch }
}

function strike(a, b, move, answer, first, flinched, takeHit, weather, random) {
  const att = a.side
  const def = b.side
  const by = a.by
  const event = { side: by, move: move.name, type: move.type, physical: move.physical, notes: [] }
  if (att.recharge) {
    att.recharge = false
    return { ...event, move: null, notes: ['It must recharge!'] }
  }
  const skipped = statusSkip(att, random)
  if (skipped === 'thaw') {
    event.notes.push(SKIP_SAY.thaw)
  } else if (skipped || flinched) {
    return { ...event, move: null, notes: [SKIP_SAY[skipped] ?? 'It flinched!'] }
  }
  if (move.status) {
    if (move.inflict) {
      if (move.miss) {
        event.notes.push('It missed!')
      } else if (canStatus(def, move.inflict, b.types)) {
        def.status = move.inflict
        event.notes.push(STATUS_SAY[move.inflict])
      } else {
        event.notes.push("It doesn't affect it!")
      }
    } else {
      const stages = []
      for (const [stat, n] of move.stages) {
        stageBy(att, stat, n, stages)
      }
      if (locks(att) && !att.locked) {
        att.locked = move.name
      }
      event.notes.push(stages.length ? stageWords(stages) : 'Nothing more')
    }
    return event
  }
  if (suckerFails(move, answer, !first)) {
    return { ...event, notes: ['But it failed!'] }
  }

  const roll = onHit(
    att,
    def,
    move,
    { weather, missRate: move.missRate ?? missOf(move.name) },
    random
  )
  const hit = takeHit(roll)
  const sturdy = hit.fainted && sturdyHolds(def, def.hp)
  if (sturdy) {
    hit.hp = 0.01
    hit.fainted = false
  }
  if (roll.heal) {
    hit.hp = Math.min(1, def.hp + roll.heal)
  }
  const after = afterHit(att, def, move, { ...roll, fainted: hit.fainted }, roll.type, random)
  const effect = applySideEffect(att, def, b.types, move, roll, hit, first, random)
  const dealt = Math.max(0, def.hp - hit.hp)
  const ratio = hpRatio(b.key, a.key)
  def.hp = hit.hp
  if (RECHARGE.includes(move.name) && !move.risen && !roll.miss) {
    att.recharge = true
  }
  const cost = selfHurt(att, move, roll, dealt, ratio, def)
  const contact = contactStatus(
    def,
    att,
    move,
    !roll.miss && roll.mul > 0 && !hit.fainted,
    a.types,
    random
  )
  const drain = DRAIN[move.name] && dealt > 0 && !roll.miss ? dealt * DRAIN[move.name] * ratio : 0
  att.hp = clampHp(att.hp - cost.hurt + drain)
  const abilities = [
    ...new Set([...roll.said.att, ...roll.said.def, ...after.att, ...after.def, sturdy])
  ]
  event.notes.push(...abilities.map((ab) => ab && sayName(ab)).filter(Boolean), ...effect.notes)
  if (after.stages?.att.length) {
    event.notes.push(stageWords(after.stages.att))
  }
  if (cost.word) {
    event.notes.push(cost.word)
  }
  event.notes.push(...cost.said.map(sayName).filter(Boolean))
  if (drain) {
    event.notes.push(sayName('drain'))
  }
  if (contact) {
    event.notes.push(`${abilityName(def.ab)}! ${STATUS_SAY[contact]}`)
  }
  return {
    ...event,
    flinch: effect.flinch,
    type: roll.type,
    damage: dealt,
    targetHp: def.hp,
    ownHp: att.hp,
    miss: roll.miss,
    crit: roll.crit,
    effectiveness: hit.eff
  }
}

function finishTurn(fighter) {
  const { side, types, by } = fighter
  const notes = endTurn(side).map(sayName).filter(Boolean)
  if (side.hp > FAINTED) {
    const heal = leftovers(side)
    if (heal) {
      notes.push('Leftovers')
    }
    side.hp += heal
    const status = statusEnd(side)
    if (status.delta) {
      notes.push(status.word)
    }
    side.hp = clampHp(side.hp + status.delta)
    const orb = orbStatus(side, types)
    if (orb) {
      side.status = orb
      notes.push(STATUS_SAY[orb])
    }
  }
  return notes.length ? { side: by, notes, ownHp: side.hp } : null
}

function averageDamage(a, b, take = 1) {
  return (move) => {
    const stab = a.side.typeAs
      ? a.side.typeAs === move.type
      : a.types.includes(move.type) || STANCE_ABILITIES.includes(a.side.ab)
    return damage(a.key, b.key, () => 0.5, {
      mul: (stab ? 1.5 : 1) * take,
      type: move.type,
      ...moveHow({ ...move, power: powerOf(move.name) }),
      alphaAttacker: !!a.pick.alpha,
      alphaTarget: !!b.pick.alpha,
      ctx: { na: a.pick.nature, nb: b.pick.nature, ea: a.effort, eb: b.effort }
    }).dmg
  }
}

function selectMove(a, b, names, weather, random, ai = {}) {
  const immune = (m) => knownImmune(b.side, m, slotsOf(b.pick.dex, b.pick.form))
  const options = {
    targetSize: b.pick.size,
    moves: names,
    weather: weather?.id,
    lock: lockOf(a.side),
    immune,
    ...ai
  }
  let move = boostMove(pickMove(a.key, b.key, random, options), weather)
  for (let retry = 0; retry < 2 && immune(move); retry++) {
    move = boostMove(pickMove(a.key, b.key, random, options), weather)
  }
  return move
}

function tactics(a, b, names, hit, hitBack, slower) {
  const threats = movesetOf(b.key, names)
    .filter((m) => !m.status)
    .map(hitBack)
  return {
    ai: true,
    dmgOf: hit,
    targetHp: b.side.hp,
    slower,
    threatened: threats.some((n) => n >= a.side.hp),
    stages: a.side.st,
    selfHp: a.side.hp,
    first: !a.side.turns,
    targetStatus: b.side.status,
    foeBest: Math.max(0, ...threats)
  }
}

// The exchange from upstream main.js, with display timing and save writes owned by the caller.
export function battleExchange(v, { party, slot, hp, move, itemTurn, weather, perks, random }) {
  const pick = party[slot]
  const wildPick = v.pick
  const key = battleKey(pick)
  const wildKey = battleKey(wildPick, true)
  const trainer = v.trainer
  const prior = v.battle
  const swapped =
    trainer && prior?.slot && prior.slot !== slot && prior.own.hp > FAINTED && party[prior.slot]
  const forfeit = swapped || itemTurn
  const entry = meetFighters(v, pick, slot, key, wildKey)
  const { own, wild } = v.battle
  own.hp = hp
  wild.hp = wildPick.hp ?? 1
  own.status = v.statuses?.[slot] ?? null
  wild.status = wildPick.status ?? null
  own.fallen = trainer?.fallen ?? 0
  wild.fallen = trainer?.idx ?? 0
  const potion =
    trainer?.rival &&
    trainer.potions > 0 &&
    wild.hp < RIVAL_POTION_AT &&
    trainer.potionIdx !== trainer.idx &&
    !forfeit
  if (potion) {
    trainer.potions--
    trainer.potionIdx = trainer.idx
    wild.hp = clampHp(wild.hp + RIVAL_POTION)
    entry.push({ side: 'opponent', notes: ['Potion! +50%'], ownHp: wild.hp })
  }
  if (forfeit) {
    entry.push({ side: 'own', notes: [swapped ? 'Switched in!' : 'Item used!'] })
  }
  const a = { key, pick, side: own, effort: effortOf(pick), types: typesOf(key), by: 'own' }
  const b = {
    key: wildKey,
    pick: wildPick,
    side: wild,
    effort: trainer ? (trainer.effort ?? TEAM_EFFORT) : 1,
    types: typesOf(wildKey),
    by: 'opponent'
  }
  const aSpeed =
    speedOf(key, { nature: pick.nature, effort: a.effort * perks.speed }) *
    speedMul(own, weather?.id)
  const bSpeed =
    speedOf(wildKey, { nature: wildPick.nature, effort: b.effort }) * speedMul(wild, weather?.id)
  const damageA = averageDamage(a, b)
  const damageB = averageDamage(b, a, OWN_TAKE)
  const aNames = chosenMoves(pick, key)
  const bNames = wildPick.moves
  const ownMove = selectMove(a, b, move ? [move] : aNames, weather, random, {
    ...tactics(a, b, bNames, damageA, damageB, aSpeed < bSpeed),
    ...(!trainer
      ? { catching: true, koAt: (wild.hp > RED ? OVERKILL_GREEN : OVERKILL) * wild.hp }
      : {})
  })
  let wildMove = selectMove(
    b,
    a,
    bNames,
    weather,
    random,
    trainer ? tactics(b, a, aNames, damageB, damageA, bSpeed < aSpeed) : { random: true }
  )
  if (swapped) {
    const previous = {
      key: prior.key,
      pick: party[prior.slot],
      side: prior.own,
      types: typesOf(prior.key)
    }
    const intended = selectMove(b, previous, bNames, weather, random, {
      ai: true,
      dmgOf: averageDamage(b, previous, OWN_TAKE),
      targetHp: previous.side.hp,
      slower:
        speedOf(previous.key, { nature: previous.pick.nature, effort: effortOf(previous.pick) }) >
        bSpeed,
      threatened: false,
      stages: wild.st,
      selfHp: wild.hp,
      first: !wild.turns,
      targetStatus: previous.side.status,
      foeBest: 0
    })
    wildMove = intended.struggle
      ? intended
      : boostMove(
          pickMove(wildKey, key, random, {
            targetSize: pick.size,
            weather: weather?.id,
            moves: [intended.base ?? intended.name],
            meant: true
          }),
          weather
        )
  }
  own.turns = (own.turns ?? 0) + 1
  wild.turns = (wild.turns ?? 0) + 1
  const aPriority = (PRIORITY[ownMove.name] ?? 0) + quickClaw(own, random)
  const bPriority = (PRIORITY[wildMove.name] ?? 0) + quickClaw(wild, random)
  const wildFirst =
    !potion && (forfeit || (aPriority === bPriority ? bSpeed > aSpeed : bPriority > aPriority))
  const megaBonus = pick.mega !== 'off' && !!megaForm(pick.dex, pick.megaKind) && !isFormKey(key)
  const asWild = { ...wildPick, dex: wildKey }
  const hitA = (roll) =>
    hitWild(
      { ...asWild, hp: wild.hp },
      key,
      random,
      !!pick.alpha,
      megaBonus,
      !!pick.shadow,
      roll.mul,
      roll.type,
      { ...ownMove, miss: roll.miss, crit: roll.crit },
      {
        na: pick.nature,
        ea: a.effort * (ownMove.physical ? perks.physical : perks.special),
        ...(trainer ? { nb: wildPick.nature, eb: b.effort } : {}),
        ...targetTypes(own, wild, wildKey, roll.type)
      }
    )
  const hitB = (roll) =>
    hitBack(
      {
        dex: key,
        hp: own.hp,
        alpha: !!pick.alpha,
        shadow: !!pick.shadow,
        hearts: pick.hearts ?? 0,
        mega: megaBonus
      },
      asWild,
      random,
      roll.mul * (wildPick.grumpy ? GRUMPY_HIT : 1) * perks.take,
      roll.type,
      { ...wildMove, miss: roll.miss, crit: roll.crit },
      {
        nb: pick.nature,
        ...(trainer ? { na: wildPick.nature, ea: b.effort } : {}),
        ...targetTypes(wild, own, key, roll.type)
      }
    )
  const turns = []
  const order = wildFirst
    ? [
        [b, a, wildMove, ownMove, hitB],
        [a, b, ownMove, wildMove, hitA]
      ]
    : [
        [a, b, ownMove, wildMove, hitA],
        [b, a, wildMove, ownMove, hitB]
      ]
  for (const [att, def, selected, answer, hit] of order) {
    if (
      (forfeit && att === a) ||
      (potion && att === b) ||
      att.side.hp <= FAINTED ||
      def.side.hp <= FAINTED
    ) {
      continue
    }
    const turn = strike(
      att,
      def,
      selected,
      att === a ? (potion ? null : answer) : forfeit ? null : answer,
      turns.length === 0,
      turns.at(-1)?.flinch,
      hit,
      weather?.id,
      random
    )
    turns.push(turn)
  }
  const end = [finishTurn(a), finishTurn(b)].filter(Boolean)
  v.statuses = { ...v.statuses, [slot]: own.status ?? null }
  wildPick.status = wild.status ?? null
  wildPick.hp = wild.hp
  return {
    entry,
    turns,
    end,
    hp: own.hp,
    fainted: own.hp <= FAINTED,
    opponentFainted: wild.hp <= FAINTED
  }
}
