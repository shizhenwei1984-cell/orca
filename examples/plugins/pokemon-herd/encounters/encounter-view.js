import { battleKey } from './battle.js'
import { canFight, dueOutbreak, hpOf, visitorPickAt } from './encounter-state.js'
import { encounterContext, movesFor } from './encounters.js'
import { fullName } from './rules/dex.js'
import { cooldownLeft, raidPhase } from './rules/events.js'
import { ITEMS } from './rules/items.js'
import {
  AUTO_BAIT,
  BAIT,
  baitFor,
  ballFor,
  BALLS,
  catchChance,
  LEGEND_THROWS
} from './rules/trainer.js'
import { TOWER_HEAL_IDS, TOWER_BENCH_HEALS } from './rules/trainers.js'
import { sizeClass } from './rules/weather.js'

const inBag = (ids, items) =>
  ids.filter((id) => items[id] > 0).map((id) => ({ id, name: ITEMS[id].name, count: items[id] }))

function captureOffer(context, v, pick) {
  const { items, ball, bait, night, perks } = context
  const bag = inBag(BALLS, items)
  const berries = inBag(Object.keys(BAIT), items)
  const chance = {}
  for (const { id: ballId } of bag) {
    chance[ballId] = Object.fromEntries(
      [AUTO_BAIT, '', ...berries.map(({ id }) => id)].map((id) => {
        const selectedBait = baitFor(items, pick, ballId, id || null)
        return [
          id,
          catchChance(ballId, pick, selectedBait, {
            throws: v.throws,
            night,
            catchMul: perks.catchMul
          })
        ]
      })
    )
  }
  return {
    ball: ballFor(items, pick),
    selectedBall: ball,
    selectedBerry: bait,
    bag,
    berries,
    chance,
    throws: v.throws,
    remaining: pick.legend ? Math.max(0, LEGEND_THROWS - v.throws) : null
  }
}

export function describePick(pick, hp = null) {
  if (!pick) {
    return null
  }
  return {
    dex: pick.dex,
    form: pick.form,
    shiny: !!pick.shiny,
    name: pick.nick || fullName(pick.dex, pick.form),
    hp,
    tags: [
      pick.shiny && 'Shiny',
      pick.alpha && 'Alpha',
      pick.legend && 'Legendary',
      pick.shadow && 'Shadow',
      sizeClass(pick.size),
      pick.asleep && 'Asleep',
      pick.friendly && 'Friendly',
      pick.outbreak && 'Outbreak'
    ].filter(Boolean)
  }
}

const describeReward = (reward) =>
  reward && {
    money: reward.money ?? 0,
    items: [...(reward.item ? [[reward.item, reward.count]] : []), ...(reward.items ?? [])].map(
      ([id, count]) => ({ name: ITEMS[id]?.name ?? id, count })
    ),
    again: !!reward.again
  }

export function renderEncounterSnapshot(state, options) {
  const context = encounterContext(options)
  const { now, party, items, settings } = context
  const v = state.visitor
  const tr = v?.trainer
  const pick = v && visitorPickAt(v, now)
  const canThrow = pick && !tr && v.giftAt != null && now >= v.giftAt + 800 && !state.clash
  const raid = state.raid
  const phase = settings.raids ? raidPhase(raid, now) : null
  const run = state.tower.run
  const outbreak = dueOutbreak(state, context)
  const result = state.result
  const revealed = !result?.revealAt || now >= result.revealAt
  return {
    now,
    busy: !!state.clash,
    canStartTower: Object.keys(party).some((slot) => canFight(state, party, slot, now)),
    visitor: v && {
      id: v.id,
      pick: describePick(pick, pick.hp ?? 1),
      expiresAt: v.expiresAt,
      raid: !!v.raid,
      trainer: tr && {
        name: tr.name,
        title: tr.title,
        floor: tr.tower,
        remaining: tr.team.length - tr.idx,
        fighter: tr.fighter,
        greet: tr.greet,
        lives: tr.lives,
        choiceUntil: tr.choice?.until
      },
      canGift: !state.clash && !tr && v.giftAt == null,
      catch: canThrow ? captureOffer(context, v, pick) : null
    },
    party: Object.entries(party).map(([slot, mon]) => ({
      slot,
      ...describePick(mon, hpOf(state, slot, now)),
      able: canFight(state, party, slot, now),
      restsUntil: state.health[slot]?.rest ?? null,
      cooldownUntil: phase === 'battle' ? now + cooldownLeft(raid, slot, now) : null,
      moves:
        v && !state.clash ? movesFor(v, party, slot).map(({ name, type }) => ({ name, type })) : [],
      fighter: tr?.fighter === slot,
      mega: /m[XY]?$/.test(String(battleKey(mon)))
    })),
    healing: inBag(TOWER_HEAL_IDS, items),
    calls: settings.visitors === 'off' || state.call ? [] : inBag(['honey', 'azure-flute'], items),
    raid: phase && {
      id: raid.id,
      phase,
      pick: phase !== 'egg' ? describePick(raid.boss, raid.hp) : null,
      at: raid.at,
      deadline: phase === 'egg' ? raid.hatch : raid.until
    },
    outbreak: outbreak && { name: fullName(outbreak.dex), until: outbreak.until },
    tower: {
      best: state.tower.best,
      run: run && {
        wins: run.wins,
        lives: run.lives - run.faints,
        out: run.out,
        benchHeals: TOWER_BENCH_HEALS - run.benchHeals,
        nextAt: run.nextAt
      }
    },
    rival: {
      name: state.rival.name,
      wins: state.rival.wins,
      losses: state.rival.losses,
      nextAt: state.rival.nextAt
    },
    nextVisit: state.call ? null : state.visitAt,
    callPending: !!state.call,
    result: result && {
      ...result,
      kind: revealed ? result.kind : 'throwing',
      reward: revealed ? describeReward(result.reward) : null,
      ball: ITEMS[result.ball]?.name,
      bait: ITEMS[result.bait]?.name,
      item: ITEMS[result.item]?.name,
      own: describePick(result.own),
      pick: describePick(result.pick)
    }
  }
}
