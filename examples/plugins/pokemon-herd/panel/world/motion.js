import {
  battle,
  battleSpots,
  COMBO_GAP,
  effectiveMood,
  onCombo,
  onFidget,
  onPoke,
  onSeason,
  onStatus,
  onStir,
  sleepAfter,
  sparPair,
  teasePair,
  teaseSpot
} from './reactions.js'
import { campSeats, restSpot } from './rest.js'
import { entryX, exitX, wrapOk, wrapRow } from './wrap.js'

const SPEED = { working: 70, idle: 32 }
const OFF = 40
const CAMP_GAP = 46
const REST_GAP = 60
export const TICK_MS = 250
export const attention = (state) => state === 'blocked' || state === 'waiting'
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const toward = (from, to) => (from < to ? 'r' : 'l')

export function bounds(width) {
  const edge = Math.min(28, Math.floor(width / 3))
  return [edge, width - edge]
}

export function clearWalk(actor) {
  actor.moving = false
  actor.track = null
}

function walk(actor, target, speed, now, kind = 'walk') {
  actor.dir = toward(actor.x, target)
  actor.track = {
    from: actor.x,
    target,
    start: now,
    duration: Math.max(1, (Math.abs(target - actor.x) * 1000) / speed),
    kind
  }
  actor.moving = true
}

function updateWalk(actor, field, now, rnd, members) {
  const {
    width,
    settings: { rows },
    reduced
  } = field
  const track = actor.track
  if (!track) {
    return
  }
  const [lo, hi] = bounds(width)
  const t = reduced ? 1 : clamp((now - track.start) / track.duration, 0, 1)
  actor.x = track.from + (track.target - track.from) * t
  if (t < 1) {
    return
  }

  clearWalk(actor)
  actor.settledAt = now
  if (track.kind === 'exit') {
    const row = wrapRow(actor.row, actor.dir, rows)
    if (
      wrapOk(
        members.map((list) => list.length),
        row,
        members.flat().length,
        rows
      )
    ) {
      members[actor.row].splice(members[actor.row].indexOf(actor), 1)
      members[row].push(actor)
      actor.row = row
      actor.x = entryX(actor.dir, width, OFF)
      walk(actor, actor.dir === 'r' ? lo : hi, SPEED[actor.mood], now, 'enter')
      return
    }
    walk(actor, actor.dir === 'r' ? hi : lo, SPEED[actor.mood], now, 'enter')
    return
  }
  actor.pauseUntil = now + (actor.mood === 'working' ? 300 + 1500 * rnd() : 4000 + 8000 * rnd())
}

export function moodOf(actor, now, night) {
  const { state, stateStartedAt = actor.statusAt } = actor.entity
  const canRest = state === 'idle' || state === 'done'
  const raw = canRest && now - stateStartedAt >= sleepAfter(night) ? 'sleep' : state
  const mood = effectiveMood(raw, actor, now)
  return state === 'done' && mood === 'idle' ? 'done' : mood
}

function startSpar(a, b, reason, field, options, now) {
  const [lo, hi] = bounds(field.width)
  const spots = battleSpots(a.x, b.x, lo, hi)
  for (const [actor, x] of [
    [a, spots.ax],
    [b, spots.bx]
  ]) {
    clearWalk(actor)
    actor.x = x
  }
  const until = battle(a, b, a.assets, b.assets, now, options.random)
  a.pauseUntil = b.pauseUntil = until + 1000
  options.onSpar?.({ first: a.entity, second: b.entity, reason })
}

export function sparActors(a, b, reason, field, options, now) {
  if (b.mood === 'sleep') {
    clearWalk(b)
    const until = onPoke(a, b, now, a.assets.has, b.assets.has, a.assets.msOf, b.assets.msOf)
    a.pauseUntil = b.pauseUntil = until
    return { first: a, second: b, reason, until }
  }
  startSpar(a, b, reason, field, options, now)
  return null
}

export function tickWorld(actors, field, options, now, selectPair) {
  const { settings, width, night, camp, season, reduced } = field
  const { random: rnd } = options
  const list = [...actors.values()]
  const rowMembers = Array.from({ length: settings.rows }, () => [])
  const [lo, hi] = bounds(width)
  for (const actor of list) {
    rowMembers[actor.row].push(actor)
  }

  const seats = new Map()
  if (camp) {
    for (const members of rowMembers) {
      const ordered = [...members].sort((a, b) => a.x - b.x)
      const gap = Math.min(CAMP_GAP, (hi - lo) / (ordered.length + 1))
      const xs = campSeats(ordered.length, width / 2, gap, lo, hi)
      ordered.forEach((actor, i) => seats.set(actor, xs[i]))
    }
  }

  for (const actor of list) {
    const {
      entity,
      assets: { has, msOf }
    } = actor
    if (actor.status !== entity.state) {
      actor.statusAt = now
      if (actor.status !== undefined) {
        onStatus(
          actor,
          actor.status,
          attention(entity.state) ? 'blocked' : entity.state,
          now,
          has,
          msOf
        )
      }
      actor.status = entity.state
      actor.pauseUntil = now
    }
    const mood = moodOf(actor, now, night)
    onStir(actor, mood, now, night >= 0.5, has, msOf, rnd)
    actor.mood = moodOf(actor, now, night)
    if (actor.dragging) {
      continue
    }
    if (
      actor.track &&
      ((!SPEED[actor.mood] && actor.track.kind !== 'camp') || actor.react?.until > now)
    ) {
      clearWalk(actor)
      actor.x = clamp(actor.x, lo, hi)
    }
    updateWalk(actor, field, now, rnd, rowMembers)
    if (actor.react?.until > now || actor.moving) {
      continue
    }
    if (camp) {
      const seat = seats.get(actor)
      if (Math.abs(actor.x - seat) >= 5 && !reduced) {
        walk(actor, seat, SPEED.idle, now, 'camp')
      } else {
        actor.x = seat
        actor.dir = toward(actor.x, width / 2)
      }
      continue
    }
    if (!SPEED[actor.mood] || now < actor.pauseUntil || reduced) {
      continue
    }
    if (
      actor.mood === 'idle' &&
      ((settings.background !== 'plain' &&
        rnd() < 0.3 &&
        onSeason(actor, season.t < 0.5 ? season.a : season.b, now, has, msOf)) ||
        (rnd() < 0.15 && onFidget(actor, now, has, msOf, rnd)))
    ) {
      actor.pauseUntil = actor.react.until + 3000 + 5000 * rnd()
      continue
    }
    const lead = actors.get(entity.parentId)
    const side = rnd() < 0.5 ? 'l' : 'r'
    const next = wrapRow(actor.row, side, settings.rows)
    if (
      !lead &&
      settings.rows > 1 &&
      rnd() < 0.3 &&
      wrapOk(
        rowMembers.map((members) => members.length),
        next,
        list.length,
        settings.rows
      )
    ) {
      walk(actor, exitX(side, width, OFF), SPEED[actor.mood], now, 'exit')
      continue
    }
    let target = lo + (hi - lo) * rnd()
    if (Math.abs(target - actor.x) < 60) {
      target = clamp(actor.x + (target >= actor.x ? 60 : -60), lo, hi)
    }
    const others = rowMembers[actor.row]
      .filter((other) => other !== actor && !other.moving)
      .map((other) => other.x)
    target = lead
      ? clamp(
          (lead.track?.target ?? lead.x) + (actor.x < lead.x ? -1 : 1) * (36 + 20 * rnd()),
          lo,
          hi
        )
      : restSpot(target, others, lo, hi, REST_GAP)
    if (Math.abs(target - actor.x) >= 8) {
      walk(actor, target, SPEED[actor.mood], now)
    } else {
      actor.pauseUntil = now + 1000 + 2000 * rnd()
    }
  }

  for (const actor of list) {
    const lead = actors.get(actor.entity.parentId)
    if (!lead || lead.row === actor.row || actor.dragging || camp) {
      continue
    }
    clearWalk(actor)
    actor.row = lead.row
    actor.x = clamp(lead.x + (lead.x > width / 2 ? -44 : 44), lo, hi)
  }
  if (reduced || camp || !selectPair) {
    return
  }

  if (settings.spar) {
    for (const actor of list) {
      const lead = actors.get(actor.entity.parentId)
      if (
        !lead ||
        actor.mood !== 'working' ||
        lead.mood !== 'working' ||
        lead.entity.leadWorking === false ||
        actor.dragging ||
        lead.dragging ||
        now - (lead.lastCombo ?? -Infinity) < COMBO_GAP ||
        actor.react?.until > now ||
        lead.react?.until > now
      ) {
        continue
      }
      for (const member of [lead, actor]) {
        clearWalk(member)
        onCombo(
          member,
          lead.dir,
          now,
          member.assets.has,
          member.assets.msOf,
          member === lead ? '⚡' : null
        )
      }
      break
    }
    const ready = list.filter((a) => !a.moving && !a.dragging && !(a.react?.until > now))
    if (rnd() < 1 / 240) {
      const pair = sparPair(
        ready.filter((a) => a.mood === 'idle'),
        now
      )
      if (pair) {
        startSpar(...pair, 'ambient', field, options, now)
        return
      }
    }
    if (rnd() < 1 / 480) {
      const pair = teasePair(ready, now)
      if (pair) {
        const [first, second] = pair
        walk(first, teaseSpot(first.x, second.x, lo, hi), SPEED.idle * 1.5, now, 'tease')
        return { first, second, reason: 'tease' }
      }
    }
  }
}

export function advanceSpar(pair, field, options, now) {
  if (!pair) {
    return null
  }
  const { first, second, reason, until } = pair
  if (
    first.dragging ||
    second.dragging ||
    attention(first.mood) ||
    attention(second.mood) ||
    first.mood === 'working' ||
    second.mood === 'working' ||
    first.row !== second.row
  ) {
    return null
  }
  if (until !== undefined) {
    if (now < until) {
      return pair
    }
    startSpar(first, second, reason, field, options, now)
    return null
  }
  if (first.track?.kind === 'tease') {
    return pair
  }
  if (second.mood !== 'sleep' || Math.abs(first.x - second.x) > 58) {
    return null
  }
  return sparActors(first, second, reason, field, options, now)
}
