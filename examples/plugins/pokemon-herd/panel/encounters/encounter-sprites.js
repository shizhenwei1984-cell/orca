export function encounterSprites(loadCatalogSprite) {
  const cache = new Map()

  async function crop(sprite) {
    if (!sprite) {
      return null
    }
    const { src, width, height, row } = sprite
    const image = new Image()
    image.src = src
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, row * height, width, height, 0, 0, width, height)
    return canvas.toDataURL()
  }

  function sprite(pick) {
    const key = [pick.dex, pick.form, pick.gender, pick.shiny, pick.mega, pick.megaKind].join(':')
    if (cache.has(key)) {
      return cache.get(key)
    }
    if (cache.size >= 48) {
      cache.delete(cache.keys().next().value)
    }
    const pending = Promise.resolve()
      .then(() => loadCatalogSprite(pick, 'idle', { working: pick.mega === 'auto' }))
      .then(crop)
      .catch(() => {
        cache.delete(key)
        return null
      })
    cache.set(key, pending)
    return pending
  }

  return { sprite }
}
