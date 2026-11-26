import { EFFECT_TAIL } from './battle-timeline.js'
import { drawResidue } from './battle-residue.js'
import {
  blowWord,
  burstParts,
  chargeParts,
  damageText,
  DASH_SHORT,
  HITSTOP,
  KNOCK_BACK,
  KNOCK_OUT,
  MISS_KNOCK,
  MISS_WORD,
  knockOf,
  moveStyle,
  physicalParts,
  RESIDUE_FROM,
  SHAKE_MS,
  signatureParts,
  slashParts,
  specialParts,
  speedLines
} from './fx.js'

const STRIKE = { glow: '#fff6c8', core: '#ffd23a', mid: '#fff2a8', hot: '#ffffff', look: 'star' }
const clamp = (value) => Math.max(0, Math.min(1, value))
const mix = (from, to, time) => from + (to - from) * time
const easeIn = (t) => t * t
const easeOut = (t) => 1 - easeIn(1 - t)
const easing = {
  'ease-in': easeIn,
  'ease-out': easeOut,
  'ease-in-out': (t) => (1 - Math.cos(t * Math.PI)) / 2,
  linear: (t) => t
}

export function battleOutcome({ turn, strike, eff, faint }) {
  if (turn.miss) {
    return MISS_WORD
  }
  if (!strike) {
    return turn.notes?.length ? [turn.notes.join(' · ')] : null
  }
  return faint ? ['Fainted!'] : blowWord(eff, turn.crit)
}

export function mountBattleEffects(parent, className) {
  const canvas = parent.ownerDocument.createElement('canvas')
  canvas.className = className
  canvas.setAttribute('aria-hidden', 'true')
  parent.append(canvas)
  const ctx = canvas.getContext('2d')
  const plans = new WeakMap()
  let painted = false

  function clear() {
    if (painted) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      painted = false
    }
  }

  function begin() {
    clear()
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (!width || !height) {
      return false
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    painted = true
    return true
  }

  function shape(x, y, width, height, color, opacity = 1, round = false, ring = false) {
    if (width <= 0 || height <= 0 || opacity <= 0) {
      return
    }
    ctx.globalAlpha = clamp(opacity)
    ctx.beginPath()
    if (round) {
      ctx.roundRect(x - width / 2, y - height / 2, width, height, Math.min(width, height) / 2)
    } else {
      ctx.rect(x - width / 2, y - height / 2, width, height)
    }
    if (ring) {
      ctx.lineWidth = 2
      ctx.strokeStyle = color
      ctx.stroke()
    } else {
      ctx.fillStyle = color
      ctx.fill()
    }
  }

  function label(words, x, y, opacity = 1) {
    const [text, color = '#ffffff'] = words
    ctx.font = '600 11px sans-serif'
    const width = Math.min(canvas.width, ctx.measureText(text).width + 8)
    x = Math.max(width / 2, Math.min(x, canvas.width - width / 2))
    y = Math.max(8, Math.min(y, canvas.height - 8))
    shape(x, y, width, 16, '#000000b8', opacity)
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x, y, Math.max(1, width - 6))
  }

  function draw(beat, now, source, target, { reduced, labels = false }) {
    const { turn, at, launch, land, dash, strike, weight, eff, faint } = beat
    const elapsed = now - land
    if (now < at || elapsed >= EFFECT_TAIL) {
      return
    }
    if (labels && turn.move && elapsed < 220) {
      label(
        [
          turn.boosted ? `${turn.move} ${turn.boosted}` : turn.move,
          turn.ultimate ? '#ffd23f' : '#ffffff'
        ],
        source.x,
        source.top - 11
      )
    }
    if (elapsed >= 0 && elapsed < 780) {
      const outcome = battleOutcome(beat)
      if (labels && outcome) {
        const actor = turn.statusTick || turn.statusAction ? source : target
        label(outcome, actor.x, actor.top - 11)
      }
      const number = strike && !turn.miss && damageText(turn.damage, eff, turn.side === 'opponent')
      if (number && !reduced) {
        label(
          number,
          target.x,
          target.top + 8 - 22 * easeOut(elapsed / 900),
          Math.min(1, (900 - elapsed) / 450)
        )
      }
    }
    if (reduced || !strike) {
      return
    }

    const dir = Math.sign(target.x - source.x) || 1
    const scale = Math.min(1, canvas.width / 215, canvas.height / 83)
    const y = target.y / scale
    const x = target.x / scale
    const sx = source.x / scale
    const distance = Math.abs(x - sx)
    const gap = Math.min(1, distance / 60)
    const mouth = sx + 14 * dir * gap
    const end = x - 12 * dir * gap
    const tilt = (source.y - target.y) / scale
    const ground = target.ground / scale
    const geometry = [mouth, end, x, y, ground, dir].join(':')
    let plan = plans.get(beat)
    if (plan?.geometry !== geometry) {
      const style = turn.type ? moveStyle(turn.type, turn.blue) : STRIKE
      const seed = land % 100000
      const args = [turn.type ?? 'normal', mouth, end, y, seed, style, turn.move]
      const flight = turn.ultimate
        ? signatureParts(...args)
        : dash || !turn.type
          ? []
          : specialParts(...args)
      const marks =
        !turn.miss && turn.physical && turn.type
          ? physicalParts(turn.type, x, y, ground - 2, dir, seed, style, turn.move)
          : []
      plan = {
        geometry,
        style,
        flight,
        lead: flight.reduce((span, part) => Math.max(span, -part.at), land - at),
        marks,
        burst: burstParts(style, turn.physical && turn.type ? weight * 0.5 : weight, seed),
        charge: chargeParts(style, 5),
        streaks: speedLines(style, dir),
        slash: turn.type ? [] : slashParts(style, dir, weight)
      }
      plans.set(beat, plan)
    }
    const { style, flight, lead, marks, burst, charge, streaks, slash } = plan
    const s = (px, py, w, h, ...paint) =>
      shape(px * scale, py * scale, w * scale, h * scale, ...paint)
    const drawParts = (parts, time, flying = false) => {
      for (const { a, b, at: offset, ms, color, round, ring, ease } of parts) {
        const age = time - offset
        if (age < 0 || age >= ms || (flying && turn.miss && offset >= 0)) {
          continue
        }
        const t = (easing[ease] ?? easeOut)(age / ms)
        const px = mix(a.x, b.x, t)
        const along = flying && end !== mouth ? clamp((px - mouth) / (end - mouth)) : 1
        const py = mix(a.y, b.y, t) + (1 - along) * tilt - (flying && turn.miss ? along * 16 : 0)
        s(
          px,
          py,
          mix(a.w, b.w, t),
          mix(a.h, b.h, t),
          color,
          mix(a.o ?? 1, b.o ?? 1, t),
          round,
          ring
        )
      }
    }
    if (turn.type && now < launch) {
      const t = easeIn(clamp((now - at) / (launch - at)))
      for (const { dx, dy, size, color } of charge) {
        s(mouth + dx * (1 - t), y + tilt + dy * (1 - t), size, size, color, 0.25 + t * 0.75, true)
      }
      s(mouth, y + tilt, 4 + 20 * t, 4 + 20 * t, style.glow, 0.15 + 0.3 * t, true)
      s(mouth, y + tilt, 2 + 8 * t, 2 + 8 * t, style.hot, 0.3 + 0.6 * t, true)
    }
    const flightTime = elapsed < 0 ? (elapsed * lead) / Math.max(1, land - at) : elapsed
    drawParts(flight, flightTime, true)

    if (dash && now >= launch) {
      const stop = !turn.miss && (turn.crit || turn.ultimate || eff >= 2) ? HITSTOP : 0
      const t =
        elapsed < 0
          ? easeIn(clamp((now - launch) / (land - launch)))
          : 1 - easeOut(clamp((elapsed - stop) / 260))
      const dx = dir * Math.max(0, distance - DASH_SHORT) * t
      const dy = -tilt * t
      if (t > 0) {
        source.shift(dx * scale, dy * scale)
      }
      if (elapsed < stop && t > 0) {
        for (const part of streaks) {
          s(sx + dx + part.x, y + tilt + dy + part.y, part.w, part.h, part.color, part.opacity * t)
        }
        if (turn.type === 'flying') {
          s(
            sx + dx,
            y + tilt + dy,
            60,
            (source.ground - source.top) / scale + 8,
            style.hot,
            0.6,
            true,
            true
          )
        }
      }
    }
    if (turn.type && !dash && now >= launch && now < launch + 180) {
      source.shift(-dir * 5 * Math.sin(((now - launch) / 180) * Math.PI) * scale, 0)
    }
    if (elapsed >= 0) {
      const knock = turn.miss ? MISS_KNOCK : knockOf(weight)
      const t = elapsed - (!turn.miss && weight >= 0.85 ? HITSTOP : 0)
      const push =
        t < 70 ? easeOut(clamp(t / 70)) : 1 - easeOut(clamp((t - KNOCK_OUT) / KNOCK_BACK))
      const shake = knock.shake && t >= 0 && t < SHAKE_MS ? 2 * Math.sin(t / 15) : 0
      if (push || shake || faint) {
        target.shift(
          dir * knock.px * push * scale,
          shake * scale,
          faint ? clamp(1 - (elapsed - 270) / 420) : 1
        )
      }
      if (!turn.miss) {
        const grow = (part, duration, opacity, ring = false) => {
          const t = clamp(elapsed / duration)
          const diameter = mix(part.from, part.to, easeOut(t))
          s(x - dir * 6, y, diameter, diameter, part.color, opacity * (1 - easeIn(t)), true, ring)
        }
        grow(burst.ring, 360, 0.8, true)
        grow(burst.flash, 220, 0.95)
        for (const part of burst.sparks) {
          const t = easeOut(clamp(elapsed / 380))
          s(
            x - dir * 6 + part.dx * t,
            y + part.dy * t,
            part.w,
            part.h,
            part.color,
            1 - easeIn(clamp(elapsed / 420)),
            part.round
          )
        }
        for (const part of slash) {
          s(
            x + part.x - dir * 4,
            y + part.y - 4,
            part.w,
            part.h,
            part.color,
            1 - clamp(elapsed / 480)
          )
        }
        drawResidue(s, turn.type, style, x, y, ground, elapsed)
      }
    }
    drawParts(marks, elapsed)
  }

  function aura({ type, elapsed, duration }, { x, y, ground }) {
    drawResidue(shape, type, moveStyle(type), x, y, ground, elapsed + RESIDUE_FROM, duration)
  }

  return { begin, clear, draw, label, aura }
}
