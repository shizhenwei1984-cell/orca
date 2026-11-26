import { spriteVariants } from '../../catalog/dex.mjs'
import { loadCatalogSprite, localCatalogSprite, playCatalogSprite } from './sprite.mjs'

const arts = new Map()
const cards = new WeakMap()
const queue = []
let loading = 0

function drain() {
  while (loading < 4 && queue.length) {
    loading++
    void queue
      .shift()()
      .finally(() => {
        loading--
        drain()
      })
  }
}

function catalogArt(pick, pose, working, season) {
  const options = { working, season }
  const key = [pose, ...spriteVariants(pick, options).map(({ folder }) => folder)].join(':')
  let art = arts.get(key)
  if (art && Date.now() < art.retryAt) {
    arts.delete(key)
    arts.set(key, art)
    return art
  }
  const local = localCatalogSprite(pick, pose, options)
  art = { sprite: local, retryAt: Infinity }
  if (!local) {
    art.ready = new Promise((resolve) => {
      queue.push(async () => {
        art.sprite = await loadCatalogSprite(pick, pose, options)
        if (!art.sprite) {
          art.retryAt = Date.now() + 15_000
        }
        resolve(art.sprite)
      })
      drain()
    })
  }
  arts.set(key, art)
  if (arts.size > 192) {
    arts.delete(arts.keys().next().value)
  }
  return art
}

export function paintCompanionArt(canvas, pick, pose, working, season) {
  const art = catalogArt(pick, pose, working, season)
  const prior = cards.get(canvas)
  if (prior?.art === art) {
    return
  }
  prior?.abort.abort()
  const abort = new AbortController()
  const { signal } = abort
  cards.set(canvas, { art, abort })
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
  canvas.removeAttribute('title')
  void Promise.resolve(art.sprite ?? art.ready)
    .then(async (sprite) => {
      if (sprite && !signal.aborted) {
        await playCatalogSprite(canvas, sprite, signal)
        canvas.title = `PMD SpriteCollab · ${sprite.credits}`
      }
    })
    .catch(() => {})
}

export function disposeCompanionArt(canvas) {
  cards.get(canvas)?.abort.abort()
  cards.delete(canvas)
}

async function anchorSheet(sheet) {
  const image = new Image()
  image.src = sheet.src
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = sheet.width * sheet.frames
  canvas.height = sheet.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const rows = sheet.rows >= 8 ? [0, 2, 6] : [0]
  let bottom = sheet.height - 1
  for (const row of rows) {
    const y = row * sheet.height
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    for (let pixel = canvas.width * canvas.height - 1; pixel >= 0; pixel--) {
      const padding = sheet.height - 1 - Math.floor(pixel / canvas.width)
      if (padding >= bottom) {
        break
      }
      if (data[pixel * 4 + 3]) {
        bottom = padding
        break
      }
    }
  }
  sheet.bottom = bottom
}

export function worldCatalogSheet(actor, pick, pose, season) {
  const working = actor.entity.state === 'working'
  let art = actor.catalogArt
  if (
    art?.pick !== pick ||
    art.pose !== pose ||
    art.working !== working ||
    art.season !== season ||
    Date.now() >= art.asset.retryAt
  ) {
    art = { pick, pose, working, season, asset: catalogArt(pick, pose, working, season) }
    actor.catalogArt = art
  }
  return anchoredSheet(art.asset)
}

export function catalogSheet(pick, pose, working, season = 0) {
  return anchoredSheet(catalogArt(pick, pose, working, season))
}

function anchoredSheet(asset) {
  const sprite = asset.sprite
  if (sprite && !asset.sheet) {
    const sheet = {
      ...sprite,
      frames: sprite.times.length,
      frameDurations: sprite.times,
      duration: sprite.times.reduce((sum, time) => sum + time, 0),
      facing: sprite.facing ?? 'd',
      bottom: 2
    }
    asset.sheet = sheet
    if (!sprite.facing) {
      void anchorSheet(sheet).catch(() => {})
    }
  }
  return asset.sheet
}
