import { entryOf, genderChoices, spriteVariants } from './dex.mjs'

export const SPRITE_REQUEST = 'catalog.sprite'
const REVISION = 'ced880d7598b9d505a267dbed5d05482197b05ff'
const SOURCE = `https://raw.githubusercontent.com/PMDCollab/SpriteCollab/${REVISION}/sprite`
const CREDITS = `https://github.com/PMDCollab/SpriteCollab/blob/${REVISION}/sprite`
const POSES = { idle: 'Idle', walk: 'Walk', sleep: 'Sleep' }
const PNG_HEADER = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

async function fetchAsset(path, limit) {
  const response = await fetch(`${SOURCE}/${path}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(6500)
  })
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel()
    if (response.status === 404) {
      return null
    }
    throw new Error('SpriteCollab artwork is unavailable')
  }
  let length = 0
  const chunks = []
  for await (const chunk of response.body) {
    length += chunk.byteLength
    if (length > limit) {
      throw new Error('SpriteCollab asset exceeds the download limit')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, length)
}

function animationIndex(xml) {
  const index = new Map()
  for (const [, body] of xml.matchAll(/<Anim>([\s\S]*?)<\/Anim>/g)) {
    const read = (name) => body.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]?.trim()
    const name = read('Name')
    if (/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(name ?? '')) {
      index.set(name, {
        name,
        copy: read('CopyOf'),
        width: Number(read('FrameWidth')),
        height: Number(read('FrameHeight')),
        times: [...body.matchAll(/<Duration>\s*(\d+)\s*<\/Duration>/g)]
          .slice(0, 64)
          .map(([, time]) => Math.max(16, Math.min(60_000, Math.round((Number(time) * 1000) / 60))))
      })
    }
  }
  return index
}

function animationFor(index, pose) {
  for (const name of new Set([POSES[pose], ...(pose === 'sleep' ? ['Idle'] : []), 'Walk'])) {
    let animation = index.get(name)
    for (let i = 0; animation?.copy && i < 8; i++) {
      animation = index.get(animation.copy)
    }
    if (
      animation &&
      !animation.copy &&
      Number.isInteger(animation.width) &&
      Number.isInteger(animation.height) &&
      animation.width > 0 &&
      animation.height > 0
    ) {
      return animation
    }
  }
  return null
}

function spriteFromPng(bytes, animation, variant, pose) {
  if (bytes.length < 33 || !bytes.subarray(0, PNG_HEADER.length).equals(PNG_HEADER)) {
    throw new Error('SpriteCollab returned an invalid PNG')
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (!width || !height || width > 4096 || height > 4096 || width * height > 4_194_304) {
    throw new Error('SpriteCollab image dimensions exceed the limit')
  }
  const cols = Math.floor(width / animation.width)
  const rows = Math.floor(height / animation.height)
  if (!cols || !rows) {
    throw new Error('SpriteCollab frame dimensions exceed the sheet')
  }
  const times = animation.times.length ? animation.times.slice(0, cols) : [160]
  return {
    src: `data:image/png;base64,${bytes.toString('base64')}`,
    width: animation.width,
    height: animation.height,
    times,
    row: pose === 'walk' && rows >= 8 ? 2 : 0,
    shiny: variant.shiny,
    credits: `${CREDITS}/${variant.folder}/credits.txt`
  }
}

function spriteRequest(input) {
  const { pick, pose, working = false, season = 0 } = input ?? {}
  if (
    !entryOf(pick) ||
    !Object.hasOwn(POSES, pose) ||
    typeof pose !== 'string' ||
    typeof working !== 'boolean' ||
    !Number.isInteger(season) ||
    season < 0 ||
    season > 3 ||
    (pick.shiny !== undefined && typeof pick.shiny !== 'boolean') ||
    (pick.gender !== undefined && !genderChoices(pick.dex).includes(pick.gender)) ||
    (pick.mega !== undefined && !['on', 'off', 'auto'].includes(pick.mega)) ||
    (pick.megaKind !== undefined && !['', 'X', 'Y'].includes(pick.megaKind))
  ) {
    throw new Error('Invalid catalog sprite request')
  }
  return { variants: spriteVariants(pick, { working, season }), pose }
}

/** @param {{panels: {handle: (name: string, handle: (input: unknown) => Promise<unknown>) => unknown}}} orca */
export function registerCatalogSprites(orca) {
  const animations = new Map()
  const sprites = new Map()
  const pending = new Map()

  async function load(variants, pose) {
    for (const variant of variants) {
      const { folder } = variant
      if (!animations.has(folder)) {
        const bytes = await fetchAsset(`${folder}/AnimData.xml`, 128 * 1024)
        if (animations.size >= 64) {
          animations.delete(animations.keys().next().value)
        }
        animations.set(folder, bytes && animationIndex(bytes.toString('utf8')))
      }
      const index = animations.get(folder)
      const animation = index && animationFor(index, pose)
      if (animation) {
        const bytes = await fetchAsset(`${folder}/${animation.name}-Anim.png`, 512 * 1024)
        if (bytes) {
          return spriteFromPng(bytes, animation, variant, pose)
        }
      }
    }
    return null
  }

  return orca.panels.handle(SPRITE_REQUEST, async (input) => {
    const { variants, pose } = spriteRequest(input)
    const key = `${variants.map(({ folder }) => folder).join('|')}:${pose}`
    if (sprites.has(key)) {
      return sprites.get(key)
    }
    if (pending.has(key)) {
      return pending.get(key)
    }
    if (pending.size >= 8) {
      throw new Error('Sprite downloads are busy')
    }
    const result = load(variants, pose)
      .then((sprite) => {
        if (sprite) {
          if (sprites.size >= 32) {
            sprites.delete(sprites.keys().next().value)
          }
          sprites.set(key, sprite)
        }
        return sprite
      })
      .finally(() => pending.delete(key))
    pending.set(key, result)
    return result
  })
}
