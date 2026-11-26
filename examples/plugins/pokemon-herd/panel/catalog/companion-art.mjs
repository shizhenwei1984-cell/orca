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
  const { dex, form, gender, shiny, mega, megaKind } = pick
  const key = [dex, form, gender, shiny || '', mega, megaKind, pose, working, season].join(':')
  let art = arts.get(key)
  if (art && Date.now() < art.retryAt) {
    arts.delete(key)
    arts.set(key, art)
    return art
  }
  const options = { working, season }
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
  const sprite = art.asset.sprite
  if (sprite && sprite !== art.sprite) {
    art.sprite = sprite
    art.sheet = {
      ...sprite,
      frames: sprite.times.length,
      frameDurations: sprite.times,
      duration: sprite.times.reduce((sum, time) => sum + time, 0),
      facing: sprite.facing ?? 'd'
    }
  }
  return art.sheet
}
