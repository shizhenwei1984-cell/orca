import { spriteVariants } from '../catalog/dex.mjs'
import { loadCatalogSprite } from './catalog/sprite.mjs'

const PORTRAIT_SIZE = 40
const VIEW = 'workspace.companions'
const PORTRAIT = 'workspace.companionPortrait'
const ACCESS = 'workspace.viewAccess'

async function portraitPixels(pick, options) {
  const sprite = await loadCatalogSprite(pick, 'idle', options)
  if (!sprite) {
    return null
  }
  const image = new Image()
  image.src = sprite.src
  await image.decode()
  options.signal.throwIfAborted()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = PORTRAIT_SIZE
  const context = canvas.getContext('2d')
  const scale = Math.min(PORTRAIT_SIZE / sprite.width, PORTRAIT_SIZE / sprite.height, 2)
  const w = Math.round(sprite.width * scale)
  const h = Math.round(sprite.height * scale)
  context.imageSmoothingEnabled = false
  context.drawImage(
    image,
    0,
    sprite.row * sprite.height,
    sprite.width,
    sprite.height,
    Math.floor((PORTRAIT_SIZE - w) / 2),
    Math.floor((PORTRAIT_SIZE - h) / 2),
    w,
    h
  )
  const { data } = context.getImageData(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE)
  return btoa(String.fromCharCode(...data))
}

export function mountWorkspaceCompanions(orca, root, signal, repaint) {
  const rows = new Map()
  const images = new Map()
  if (!orca.host.has(VIEW)) {
    return { rows, syncPortraits() {} }
  }
  const buttons = [...root.querySelectorAll('[data-companion-access]')]
  const status = root.querySelector('[role=status]')
  let workspace
  let grants
  let timer
  let pending
  let again = false

  function syncPortraits(agents, season) {
    if (!workspace || !grants?.portraits) {
      return
    }
    const active = new Set()
    const publish = (target, rgba, signal) =>
      orca.host.call(PORTRAIT, { workspace, target, rgba }, { signal })
    for (const { id, appearance, state } of agents) {
      const target = rows.get(id)?.target
      if (!target) {
        continue
      }
      active.add(target)
      const working = state === 'working'
      const key = spriteVariants(appearance, { working, season })
        .map(({ folder }) => folder)
        .join(':')
      const old = images.get(target)
      if (old?.key === key) {
        continue
      }
      old?.abort.abort()
      const abort = new AbortController()
      const image = { key, abort }
      images.set(target, image)
      const current = AbortSignal.any([signal, abort.signal])
      void (async () => {
        if (old) {
          await publish(target, null, current)
        }
        const rgba = await portraitPixels(appearance, { working, season, signal: current })
        if (rgba && !current.aborted) {
          await publish(target, rgba, current)
        } else if (!current.aborted) {
          images.delete(target)
        }
      })().catch(() => {
        if (images.get(target) === image) {
          images.delete(target)
        }
      })
    }
    for (const [target, image] of images) {
      if (!active.has(target)) {
        image.abort.abort()
        images.delete(target)
        void publish(target, null, signal).catch(() => {})
      }
    }
  }

  function reset() {
    pending?.abort()
    pending = undefined
    again = false
    clearTimeout(timer)
    workspace = grants = undefined
    rows.clear()
    for (const image of images.values()) {
      image.abort.abort()
    }
    images.clear()
    root.hidden = true
  }

  async function read() {
    clearTimeout(timer)
    if (signal.aborted) {
      return
    }
    if (pending) {
      again = true
      return
    }
    const request = new AbortController()
    pending = request
    try {
      const snapshot = await orca.host.call(VIEW, undefined, {
        signal: AbortSignal.any([signal, request.signal])
      })
      if (pending !== request || signal.aborted) {
        return
      }
      workspace = snapshot?.workspace
      grants = snapshot?.grants
      rows.clear()
      for (const companion of snapshot?.companions ?? []) {
        rows.set(companion.terminalId, companion)
      }
      root.hidden = !workspace
      for (const button of buttons) {
        const granted = grants?.[button.dataset.companionAccess] === true
        button.setAttribute('aria-pressed', String(granted))
      }
      repaint()
    } catch {
      if (pending === request && !signal.aborted) {
        rows.clear()
        repaint()
      }
    } finally {
      if (pending === request) {
        pending = undefined
        if (again) {
          again = false
          void read()
        } else if (grants?.fatigue || grants?.portraits) {
          timer = setTimeout(read, 2500)
        }
      }
    }
  }

  for (const button of buttons) {
    button.addEventListener(
      'click',
      async () => {
        const capability = button.dataset.companionAccess
        const current = workspace
        if (!current) {
          return
        }
        status.textContent = ''
        try {
          await orca.host.call(
            ACCESS,
            { workspace: current, capability, revoke: grants[capability] },
            { signal }
          )
        } catch (error) {
          if (workspace === current && !signal.aborted) {
            status.textContent = error.message
          }
        }
      },
      { signal }
    )
  }
  orca.on('workspace.viewChanged', (event) => {
    if (event.reset) {
      reset()
      repaint()
    } else if (event.fatigueExpired) {
      for (const companion of rows.values()) {
        delete companion.sessionLimitNear
      }
      repaint()
    }
    void read()
  })
  signal.addEventListener('abort', reset, { once: true })
  void read()
  return { rows, syncPortraits }
}
