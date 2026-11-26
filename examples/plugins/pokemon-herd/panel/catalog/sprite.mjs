import { spriteVariants } from '../../catalog/dex.mjs'

const BUNDLED = {
  '0001': ['bulbasaur', { walk: 6, idle: 3 }],
  '0004': ['charmander', { walk: 4, idle: 4 }],
  '0007': ['squirtle', { walk: 4, idle: 8 }],
  '0025': ['pikachu', { walk: 4, idle: 6 }]
}
const DURATIONS = { walk: 640, idle: 1000, sleep: 1800 }

/** @typedef {'idle' | 'walk' | 'sleep' | 'battle-idle' | 'attack' | 'special' | 'hurt'} Pose */
/** @typedef {{src: string, width: number, height: number, times: number[], row: number, cols: number, rows: number, facing?: string, shiny: boolean, credits: string}} Sprite */

function bundledSprite(folder, pose) {
  const entry = BUNDLED[folder]
  if (!entry) {
    return null
  }
  const [name, frames] = entry
  const count = pose === 'sleep' ? 2 : frames[pose]
  if (!count) {
    return null
  }
  return {
    src: new URL(`../sprites/${name}-${pose}.png`, import.meta.url).href,
    width: 40,
    height: 40,
    times: Array(count).fill(DURATIONS[pose] / count),
    row: 0,
    cols: count,
    rows: 1,
    facing: pose === 'walk' ? 'r' : 'd',
    shiny: false,
    credits: `https://github.com/PMDCollab/SpriteCollab/blob/ced880d7598b9d505a267dbed5d05482197b05ff/sprite/${folder}/credits.txt`
  }
}

export function localCatalogSprite(pick, pose, options) {
  const [variant] = spriteVariants(pick, options)
  return variant ? bundledSprite(variant.folder, pose) : null
}

/**
 * @param {import('../../catalog/dex.mjs').Pick} pick
 * @param {Pose} pose
 * @param {{working?: boolean, season?: number, signal?: AbortSignal}} options
 * @returns {Promise<Sprite | null>}
 */
export async function loadCatalogSprite(pick, pose, { working = false, season = 0, signal } = {}) {
  signal?.throwIfAborted()
  const variants = spriteVariants(pick, { working, season })
  if (!variants.length) {
    return null
  }
  const local = bundledSprite(variants[0].folder, pose)
  if (local) {
    return local
  }
  const { dex, form, gender, shiny, mega, megaKind } = pick
  const identity = {
    dex,
    ...(form ? { form } : {}),
    ...(gender ? { gender } : {}),
    shiny: shiny === true,
    ...(mega ? { mega } : {}),
    ...(megaKind !== undefined ? { megaKind } : {})
  }
  try {
    const result = await window.orca?.plugin.request(
      'catalog.sprite',
      { pick: identity, pose, working, season },
      { signal }
    )
    if (result) {
      return result
    }
  } catch {
    signal?.throwIfAborted()
  }
  for (const { folder } of variants.slice(1)) {
    const fallback = bundledSprite(folder, pose)
    if (fallback) {
      return fallback
    }
  }
  return null
}

/** @param {HTMLCanvasElement} canvas @param {Sprite} sprite @param {AbortSignal} signal */
export async function playCatalogSprite(canvas, sprite, signal) {
  const sheet = new Image()
  sheet.src = sprite.src
  await sheet.decode()
  signal.throwIfAborted()
  const context = canvas.getContext('2d')
  const { width, height, times, row } = sprite
  const scale = Math.min(2, canvas.width / width, canvas.height / height)
  const w = Math.round(width * scale)
  const h = Math.round(height * scale)
  const x = Math.floor((canvas.width - w) / 2)
  const y = Math.floor((canvas.height - h) / 2)
  context.imageSmoothingEnabled = false
  const draw = (frame) => {
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(sheet, frame * width, row * height, width, height, x, y, w, h)
  }
  draw(0)
  if (times.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return
  }
  let index = 0
  let deadline = performance.now() + times[0]
  let animation
  const tick = (time) => {
    if (time >= deadline) {
      index = (index + 1) % times.length
      deadline = time + times[index]
      draw(index)
    }
    animation = requestAnimationFrame(tick)
  }
  animation = requestAnimationFrame(tick)
  signal.addEventListener('abort', () => cancelAnimationFrame(animation), { once: true })
}
