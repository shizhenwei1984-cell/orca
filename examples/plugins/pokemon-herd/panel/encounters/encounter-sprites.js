export function encounterSprites(loadCatalogSprite) {
  const cache = new Map()

  async function crop(sprite) {
    if (!sprite) {
      return null
    }
    const { src, width, height, times, row } = sprite
    const image = new Image()
    image.src = src
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = width * times.length
    canvas.height = height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, row * height, canvas.width, height, 0, 0, canvas.width, height)
    const sheet = {
      src: canvas.toDataURL(),
      width,
      height,
      frames: times.length,
      duration: times.reduce((total, frame) => total + frame, 0),
      frameDurations: times
    }
    canvas.width = width
    context.drawImage(image, 0, row * height, width, height, 0, 0, width, height)
    return { sheet, portrait: canvas.toDataURL() }
  }

  function art(pick, pose) {
    const key = [pick.dex, pick.form, pick.gender, pick.shiny, pick.mega, pick.megaKind, pose].join(
      ':'
    )
    if (cache.has(key)) {
      return cache.get(key)
    }
    if (cache.size >= 48) {
      cache.delete(cache.keys().next().value)
    }
    const pending = Promise.resolve()
      .then(() => loadCatalogSprite(pick, pose, { working: pick.mega === 'auto' }))
      .then(crop)
      .catch(() => {
        cache.delete(key)
        return null
      })
    cache.set(key, pending)
    return pending
  }

  return {
    async sprite(pick) {
      return (await art(pick, 'idle'))?.portrait
    },
    async sprites(pick) {
      const entries = await Promise.all(
        ['idle', 'walk', 'sleep'].map(async (pose) => [pose, (await art(pick, pose))?.sheet])
      )
      return Object.fromEntries(entries.filter(([, sheet]) => sheet))
    }
  }
}
