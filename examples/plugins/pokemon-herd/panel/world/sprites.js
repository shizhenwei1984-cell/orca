import { pose } from './reactions.js'
import { worldCatalogSheet } from '../catalog/companion-art.mjs'

const FALLBACK = Object.fromEntries(
  Object.entries({
    pikachu: [4, 6],
    bulbasaur: [6, 3],
    charmander: [4, 4],
    squirtle: [4, 8]
  }).map(([species, [walk, idle]]) => [
    species,
    Object.fromEntries(
      [
        ['walk', walk, 640],
        ['idle', idle, 1200],
        ['sleep', 2, 1800]
      ].map(([name, frames, duration]) => [
        name,
        {
          src: new URL(`../sprites/${species}-${name}.png`, import.meta.url).href,
          width: 40,
          height: 40,
          bottom: 2,
          frames,
          duration,
          facing: name === 'walk' ? 'r' : 'd'
        }
      ])
    )
  ])
)

const hop = (t) => Math.abs(Math.sin(t * Math.PI))
const shift = (t) => Math.sin(t * 2 * Math.PI)
const GESTURES = {
  Wake: [600, (t) => [0, -8 * hop(t), 0]],
  Dance: [720, (t) => [3 * shift(t), -7 * hop(t), 8 * shift(t)]],
  Hurt: [440, (t, side) => [-8 * side * hop(t), -3 * hop(t), -10 * side * hop(t)]],
  Charge: [550, (t, side) => [5 * side * hop(t), 0, 16 * side * hop(t)]],
  Eat: [680, (t) => [0, 0, 14 * hop(t)]],
  DeepBreath: [1300, (t) => [0, hop(t) * 2, -6 * hop(t)]],
  LookUp: [800, (t) => [0, -2 * hop(t), -14 * hop(t)]],
  Shake: [450, (t) => [2 * shift(t * 3), 0, 6 * shift(t * 3)]],
  Attack: [520, (t, side) => [14 * side * hop(t), -6 * hop(t), 12 * side * hop(t)]],
  Head: [600, (t, side) => [7 * side * hop(t), 0, 17 * side * hop(t)]],
  Tumble: [700, (t) => [3 * shift(t), -4 * hop(t), 18 * shift(t)]],
  SpAttack: [720, (t, side) => [5 * side * hop(t), -7 * hop(t), 12 * side * hop(t)]],
  Hop: [500, (t) => [0, -8 * hop(t), 0]],
  Nod: [650, (t) => [0, 0, 10 * shift(t)]]
}

export function spriteSet(entity) {
  const fallback = FALLBACK[entity.species?.toLowerCase()]
  const sprites = { ...fallback, ...entity.sprites }
  const has = new Set([...Object.keys(GESTURES), ...Object.keys(sprites.reactions ?? {})])
  const msOf = (name) => sprites.reactions?.[name]?.duration ?? GESTURES[name][0]
  return { sprites, has, msOf }
}

function frameAt(sheet, elapsed) {
  const t = elapsed % sheet.duration
  if (sheet.frameDurations) {
    let end = 0
    const frame = sheet.frameDurations.findIndex((duration) => t < (end += duration))
    return frame === -1 ? sheet.frames - 1 : frame
  }
  return Math.floor((t * sheet.frames) / sheet.duration)
}

export function paintSprite(node, actor, { now, scale, reduced, hovered, season = 0 }) {
  const { sprites } = actor.assets
  const current = pose(actor, actor.mood, now, hovered, actor.hoverSide)
  const facing = current.face ?? { idleL: 'l', idleR: 'r', walkL: 'l', walkR: 'r' }[current.sprite]
  const side = (facing ?? actor.dir) === 'r' ? 1 : -1
  const anim = current.anim
  const standingTurn =
    facing &&
    current.sprite.startsWith('idle') &&
    !sprites[current.sprite] &&
    sprites.idle?.facing === 'd' &&
    sprites.walk
  const original = anim
    ? (sprites.reactions?.[anim] ?? sprites.idleD ?? sprites.idle)
    : (sprites[current.sprite] ??
      (current.sprite.startsWith('walk') ? sprites.walk : null) ??
      (current.sprite === 'sleep' ? sprites.sleep : null) ??
      (standingTurn || sprites.idle || sprites.idleD))
  const pick = actor.entity.appearance
  const catalogPose = current.sprite.startsWith('walk')
    ? 'walk'
    : current.sprite === 'sleep'
      ? 'sleep'
      : 'idle'
  const sheet =
    pick && !(anim && sprites.reactions?.[anim])
      ? worldCatalogSheet(actor, pick, catalogPose, season)
      : original
  const actualAnimation = anim && sprites.reactions?.[anim]
  const step = anim && actor.react?.seq?.find((item) => now >= item.at && now < item.until)
  const elapsed = Math.max(0, anim ? now - (step?.at ?? actor.react?.at ?? now) : now - actor.born)
  const [dx, dy, angle] =
    !reduced && anim && !actualAnimation && GESTURES[anim]
      ? GESTURES[anim][1]((elapsed % GESTURES[anim][0]) / GESTURES[anim][0], side)
      : [0, 0, 0]
  const baseWidth = sheet?.width ?? 18
  const baseHeight = sheet?.height ?? 18
  const w = Math.round(baseWidth * scale)
  const h = Math.round(baseHeight * scale)
  const freezeFrame = reduced || (!pick && standingTurn) || (anim && !actualAnimation)
  const frame = sheet && !freezeFrame ? frameAt(sheet, elapsed) : 0
  const sourceDirection = sheet?.facing ?? (current.sprite.endsWith('R') ? 'r' : 'l')
  const row = sheet?.rows >= 8 ? ({ l: 2, r: 6 }[facing] ?? 0) : (sheet?.row ?? 0)
  const flip = facing && facing !== 'd' && sourceDirection !== 'd' && facing !== sourceDirection
  node.classList.toggle('pokemon-world__sprite--placeholder', !sheet)
  node.style.width = `${w}px`
  node.style.height = `${h}px`
  node.style.marginBottom = `${-Math.round((sheet?.bottom ?? 0) * scale)}px`
  node.style.transform = `translate(${Math.round(dx * scale)}px, ${Math.round(dy * scale)}px) rotate(${angle}deg) scaleX(${flip ? -1 : 1})`
  node.style.backgroundImage = sheet ? `url(${JSON.stringify(sheet.src)})` : ''
  node.style.backgroundSize = sheet
    ? `${w * (sheet.cols ?? sheet.frames)}px ${h * (sheet.rows ?? 1)}px`
    : ''
  node.style.backgroundPosition = `${-frame * w}px ${-row * h}px`
  if (node.dataset.credits !== (sheet?.credits ?? '')) {
    node.dataset.credits = sheet?.credits ?? ''
  }
  return { w, h }
}
