import { STATUS_NAMES_SHORT } from '../../encounters/rules/abilities.js'
import { STATUS_COLOR } from '../../encounters/rules/spar.js'
import { catalogSheet } from '../catalog/companion-art.mjs'
import { EFFECT_TAIL, oppositeSide } from './battle-timeline.js'

const POSES = ['battle-idle', 'attack', 'special', 'hurt']
const AURA_TYPE = { brn: 'fire', par: 'electric', psn: 'poison', frz: 'ice', thaw: 'ice' }
const IDLE_ROW = { r: 1, l: 7 }
const ACTION_ROW = { r: 2, l: 6 }

export function prepareBattleArt(pick, working, season) {
  if (pick) {
    for (const pose of POSES) {
      catalogSheet(pick, pose, working, season)
    }
  }
}

export function battleSheet(pick, { pose, working, season, reduced }) {
  if (!pick) {
    return null
  }
  const options = [working, season]
  const action = !reduced && pose !== 'battle-idle' && catalogSheet(pick, pose, ...options)
  const idle =
    action ||
    catalogSheet(pick, 'battle-idle', ...options) ||
    catalogSheet(pick, 'idle', ...options)
  return idle && { sheet: idle, pose: action ? pose : 'battle-idle' }
}

export function battleCell(sheet, { facing, elapsed, still }, posed) {
  const row = sheet.rows >= 8 ? (posed ? ACTION_ROW : IDLE_ROW)[facing] : (sheet.row ?? 0)
  const flip = sheet.rows < 8 && sheet.facing && sheet.facing !== 'd' && sheet.facing !== facing
  let time = still ? 0 : Math.min(elapsed, sheet.duration - 1)
  const frame = sheet.times?.findIndex((duration) => (time -= duration) < 0) ?? 0
  return { row, flip, frame: Math.max(0, frame) }
}

export function statusTag(status) {
  return [STATUS_NAMES_SHORT[status], STATUS_COLOR[status]]
}

export function battleSprites(beats, statusBefore, now) {
  const sides = {
    own: { pose: 'battle-idle', elapsed: 0, status: statusBefore?.own },
    opponent: { pose: 'battle-idle', elapsed: 0, status: statusBefore?.opponent }
  }
  const animate = (side, pose, elapsed) => {
    Object.assign(sides[side], { pose, elapsed })
  }
  const aura = (side, status, elapsed, duration) => {
    if (elapsed >= 0 && elapsed < duration && AURA_TYPE[status]) {
      sides[side].aura = { type: AURA_TYPE[status], elapsed, duration }
    }
  }
  for (const { turn, at, launch, land, strike } of beats) {
    if (now < at) {
      break
    }
    const source = turn.side
    const target = oppositeSide(source)
    const elapsed = now - land
    if (turn.statusAction === 'thaw') {
      sides[source].status = null
    }
    aura(source, turn.statusAction, now - at, turn.statusAction === 'thaw' ? 700 : 900)
    if ((strike || (turn.status && turn.move)) && now >= launch - 90 && elapsed < 240) {
      animate(source, turn.physical ? 'attack' : 'special', now - launch + 90)
    }
    if (elapsed < 0) {
      continue
    }
    if (strike && !turn.miss) {
      if (elapsed < 550) {
        animate(target, 'hurt', elapsed)
      }
      if (elapsed < 170) {
        sides[target].flash = 0.95 * (1 - (elapsed / 170) ** 2)
      }
    }
    if (turn.ailments) {
      for (const side of Object.keys(sides)) {
        const status = turn.ailments[side]
        if (status !== sides[side].status) {
          sides[side].status = status
          aura(side, status, elapsed, 1300)
        }
      }
    }
    aura(source, turn.statusTick, elapsed, 800)
  }
  return sides
}

export function battleActive(beats, now) {
  return now >= beats[0].at && now < beats.at(-1).land + EFFECT_TAIL
}

export function paintBattleMask(node, { flash, status } = {}) {
  const glowing = !!flash && node.style.backgroundImage !== ''
  if (!glowing && node.hasAttribute('data-battle-flash')) {
    for (const property of [
      '--battle-flash',
      '--battle-mask',
      '--battle-mask-size',
      '--battle-mask-position'
    ]) {
      node.style.removeProperty(property)
    }
  }
  node.toggleAttribute('data-battle-flash', glowing)
  if (glowing) {
    node.style.setProperty('--battle-flash', flash)
    node.style.setProperty('--battle-mask', node.style.backgroundImage)
    node.style.setProperty('--battle-mask-size', node.style.backgroundSize)
    node.style.setProperty('--battle-mask-position', node.style.backgroundPosition)
  }
  if (statusTag(status)[0]) {
    node.dataset.battleStatus = status
  } else {
    delete node.dataset.battleStatus
  }
}
