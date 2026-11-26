import { mountWorldBattles } from './world-battles.js'
import { bindWorldInput } from './input.js'
import { createLandscape } from './landscape.js'
import {
  advanceSpar,
  attention,
  bounds,
  clearWalk,
  moodOf,
  sparActors,
  tickWorld,
  TICK_MS
} from './motion.js'
import { dropTarget, onDizzy, onFocus, shaken } from './reactions.js'
import { restSpot } from './rest.js'
import { nightness, RAINBOW_MS, seasonAt, weatherOf } from './scene.js'
import { assignEntity, createActor, paintActors } from './view.js'
import { ITEMS } from '../../encounters/rules/items.js'

const DEFAULT_SETTINGS = {
  rows: 1,
  scale: 0.75,
  background: 'scenery',
  sky: 'muted',
  theme: 'auto',
  weather: true,
  campfire: true,
  spar: true,
  tags: true
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const numberIn = (v, lo, hi, fallback) => (Number.isFinite(v) ? clamp(v, lo, hi) : fallback)
const canSpar = (actor) => !attention(actor.mood) && actor.mood !== 'working'

export function mountWorld(container, callbacks = {}) {
  const document = container.ownerDocument
  const view = document.defaultView
  const root = document.createElement('div')
  root.className = 'pokemon-world'
  root.setAttribute('role', 'group')
  root.setAttribute('aria-label', 'Pokémon Herd')
  root.setAttribute('aria-keyshortcuts', 'B Alt+Shift+B S Shift+F10')
  root.tabIndex = 0
  const style = document.createElement('link')
  style.rel = 'stylesheet'
  style.href = new URL('./world.css', import.meta.url).href
  const canvas = document.createElement('canvas')
  canvas.className = 'pokemon-world__landscape'
  canvas.setAttribute('aria-hidden', 'true')
  const notices = document.createElement('div')
  notices.className = 'pokemon-world__notices'
  notices.setAttribute('role', 'status')
  const arrival = document.createElement('span')
  arrival.hidden = true
  const boostStatus = document.createElement('div')
  notices.append(arrival, boostStatus)
  root.append(style, canvas, notices)
  container.append(root)

  const landscape = createLandscape(canvas)
  const systemMotion = view.matchMedia('(prefers-reduced-motion: reduce)')
  const systemLight = view.matchMedia('(prefers-color-scheme: light)')
  const controller = new AbortController()
  const battles = mountWorldBattles(root, controller.signal)
  const options = { clock: Date.now, random: Math.random, ...callbacks }
  const actors = new Map()
  const field = { width: 0, settings: { ...DEFAULT_SETTINGS }, weather: 'clear' }
  let visitor
  let boosts = {}
  let boostText = ''
  let hovered
  let lastFocus
  let focusedId
  let fixedTime = null
  let pair = null
  let lastTick = -Infinity
  let lastPaint = -Infinity
  let lastScenery = -Infinity
  let request

  const now = () => fixedTime ?? options.clock()
  const actorList = () => (visitor ? [...actors.values(), visitor] : [...actors.values()])

  function setGeometry() {
    const { settings } = field
    field.ground = Math.round(44 + 42 * settings.scale)
    field.rowHeight = field.ground + 45
    root.style.height = `${settings.rows * field.rowHeight + 2}px`
    root.style.setProperty('--pokemon-ground', `${field.ground}px`)
    root.style.setProperty('--pokemon-row-height', `${field.rowHeight}px`)
    root.dataset.background = settings.background
    const width = root.clientWidth
    field.visible = width > 0
    if (field.width === width || width <= 0) {
      return
    }
    const [lo, hi] = bounds(width)
    for (const actor of actors.values()) {
      const x = field.width ? actor.x / field.width : actor.x
      actor.x = clamp(x * width, lo, hi)
      clearWalk(actor)
    }
    field.width = width
  }

  function syncAgents(agents) {
    const {
      width,
      settings: { rows }
    } = field
    const ids = new Set(agents.map((agent) => agent.id))
    for (const [id, actor] of actors) {
      if (ids.has(id)) {
        continue
      }
      actor.button.remove()
      actors.delete(id)
      if (hovered === actor) {
        hovered = null
      }
      if (pair?.first === actor || pair?.second === actor) {
        pair = null
      }
    }
    const sizes = Array.from({ length: rows }, () => 0)
    for (const actor of actors.values()) {
      sizes[actor.row]++
    }
    const totals = [...sizes]
    const assignments = new Map()
    for (const agent of agents) {
      if (actors.has(agent.id) || assignments.has(agent.id)) {
        continue
      }
      const row = totals.indexOf(Math.min(...totals))
      assignments.set(agent.id, row)
      totals[row]++
    }
    const timestamp = now()
    const rowPositions = Array.from({ length: rows }, () => [])
    for (const actor of actors.values()) {
      rowPositions[actor.row].push(actor.x)
    }
    for (const agent of agents) {
      const actor = actors.get(agent.id)
      if (actor) {
        assignEntity(actor, agent)
      } else {
        const row = assignments.get(agent.id)
        const fraction = ++sizes[row] / (totals[row] + 1)
        const x = width
          ? restSpot(fraction * width, rowPositions[row], ...bounds(width), 42)
          : fraction
        // If the host starts hidden, keep the fraction until ResizeObserver sees the first width.
        const next = createActor(document, agent, timestamp, x, row)
        next.pauseUntil = timestamp + 300 * options.random()
        actors.set(agent.id, next)
        rowPositions[row].push(x)
        insertActor(next)
      }
    }
  }

  function updateVisitor(entity) {
    if (visitor?.entity.id !== entity?.id) {
      visitor?.button.remove()
      if (hovered === visitor) {
        hovered = null
      }
      visitor = entity ? createActor(document, entity, now(), 0, 0, true) : null
      if (visitor) {
        insertActor(visitor)
      }
    }
    if (visitor && entity) {
      assignEntity(visitor, entity)
    }
  }

  function positionVisitor(timestamp) {
    if (!visitor) {
      return
    }
    const { entity } = visitor
    const { from = 0.82, to = from, startedAt = visitor.born, duration = 39000 } = entity
    const t = clamp((timestamp - startedAt) / Math.max(1, duration), 0, 1)
    visitor.row = Math.round(numberIn(entity.row, 0, field.settings.rows - 1, 0))
    visitor.x = field.reduced
      ? clamp(((from + to) * field.width) / 2, ...bounds(field.width))
      : (from + (to - from) * t) * field.width
    visitor.dir = to > from ? 'r' : 'l'
    visitor.moving = t < 1 && from !== to && !field.reduced
    visitor.mood = visitor.moving ? 'working' : 'idle'
  }

  function atmosphere(timestamp) {
    const { settings } = field
    const date = new Date(timestamp)
    const hour = date.getHours() + date.getMinutes() / 60
    const night = nightness(hour)
    const season = seasonAt(date)
    const scenic = settings.background === 'scenery'
    const list = [...actors.values()]
    const waits = list
      .filter(({ entity }) => attention(entity.state))
      .map(({ entity, statusAt }) =>
        Math.max(0, timestamp - (entity.stateStartedAt ?? statusAt ?? timestamp))
      )
    const weather = scenic && settings.weather ? weatherOf(waits) : 'clear'
    if (weather !== field.weather) {
      field.rainbow =
        weather === 'clear' && scenic && settings.weather && !waits.length
          ? { at: timestamp, x: 0.25 + options.random() * 0.5 }
          : null
      field.stormAt = weather === 'storm' ? timestamp : -Infinity
    }
    if (field.rainbow && timestamp - field.rainbow.at >= RAINBOW_MS) {
      field.rainbow = null
    }
    const camp =
      scenic &&
      settings.campfire &&
      night >= 0.5 &&
      !!list.length &&
      list.every(({ entity }) => !attention(entity.state) && entity.state !== 'working')
    const reduced = settings.reducedMotion ?? systemMotion.matches
    if (reduced && !field.reduced) {
      for (const actor of list) {
        clearWalk(actor)
      }
    }
    if (!camp && field.camp) {
      for (const actor of list) {
        if (actor.track?.kind === 'camp') {
          clearWalk(actor)
        }
      }
    }
    const scheme = document.documentElement.classList
    const light =
      settings.theme === 'light' ||
      (settings.theme === 'auto' &&
        (scheme.contains('light') || (!scheme.contains('dark') && systemLight.matches)))
    Object.assign(field, { weather, camp, reduced, light, night, season, hour })
    root.dataset.weather = weather
    root.dataset.campfire = String(camp)
  }

  function focusActor(actor, timestamp) {
    onFocus(
      actor,
      moodOf(actor, timestamp, field.night),
      timestamp,
      actor.assets.has,
      actor.assets.msOf
    )
    clearWalk(actor)
    actor.x = clamp(actor.x, ...bounds(field.width))
  }

  function paint(frame, force = false) {
    if (!field.visible) {
      return
    }
    const timestamp = now()
    if (force || timestamp - lastTick >= TICK_MS || timestamp < lastTick) {
      atmosphere(timestamp)
      if (lastFocus !== undefined && focusedId && lastFocus !== focusedId) {
        const focused = actors.get(focusedId)
        if (focused) {
          focusActor(focused, timestamp)
        }
      }
      lastFocus = focusedId
      const next = tickWorld(actors, field, options, timestamp, !pair && timestamp !== lastTick)
      pair = next ?? advanceSpar(pair, field, options, timestamp)
      lastTick = timestamp
    } else {
      // Walk interpolation also runs between decision ticks.
      for (const actor of actors.values()) {
        const track = actor.track
        if (!track) {
          continue
        }
        const t = clamp((timestamp - track.start) / track.duration, 0, 1)
        actor.x = track.from + (track.target - track.from) * t
      }
    }
    positionVisitor(timestamp)
    const announcement = visitor?.entity.arrival
    const caption = announcement && timestamp < announcement.until ? announcement.text : ''
    if (caption !== arrival.textContent) {
      arrival.textContent = caption
      arrival.hidden = !caption
    }
    const active = Object.entries(boosts).filter(([, until]) => until > timestamp)
    const labels = active.map(
      ([id, until]) =>
        `${ITEMS[id].icon} ${ITEMS[id].name} · ${Math.ceil((until - timestamp) / 60_000)} min`
    )
    if (labels.join('|') !== boostText) {
      boostText = labels.join('|')
      boostStatus.replaceChildren(
        ...labels.map((label) => {
          const pill = document.createElement('span')
          pill.textContent = label
          return pill
        })
      )
    }
    const list = actorList()
    battles.prepare(list, timestamp)
    const heads = paintActors(list, { ...field, now: timestamp, hovered, focusedId })
    battles.paint(list, timestamp, field.reduced, field.settings.battleSounds)
    if (force || frame - lastScenery >= 125) {
      landscape({ ...field, now: timestamp, heads })
      lastScenery = frame
    }
  }

  function frame(timestamp) {
    if (timestamp - lastPaint >= 32) {
      paint(timestamp)
      lastPaint = timestamp
    }
    if (!controller.signal.aborted) {
      request = view.requestAnimationFrame(frame)
    }
  }

  function pet(actor, event) {
    focusActor(actor, now())
    options.onPet?.(actor.entity, event)
    paint(view.performance.now(), true)
  }

  function interactPosition(event) {
    const rect = root.getBoundingClientRect()
    const [lo, hi] = bounds(field.width)
    const row = clamp(
      Math.floor((event.clientY - rect.top - root.clientTop) / field.rowHeight),
      0,
      field.settings.rows - 1
    )
    return { x: clamp(event.clientX - rect.left - root.clientLeft, lo, hi), row }
  }

  const connect = bindWorldInput(
    root,
    options,
    {
      now,
      pet,
      activate(actor, event) {
        pet(actor, event)
        options.onFocus?.(actor.entity, event)
      },
      hover(actor, clientX) {
        hovered = actor
        if (actor) {
          const x = clientX - root.getBoundingClientRect().left - root.clientLeft
          actor.hoverSide = x < actor.x ? 'l' : 'r'
        }
      },
      drag(actor, event) {
        if (actors.get(actor.entity.id) !== actor) {
          return
        }
        if (!actor.dragging) {
          actor.dragStart = { x: actor.x, row: actor.row }
        }
        actor.dragging = true
        clearWalk(actor)
        const { x, row } = interactPosition(event)
        if (x !== actor.x) {
          actor.dir = x > actor.x ? 'r' : 'l'
        }
        actor.x = x
        actor.row = row
      },
      drop(actor, event, flips, commit) {
        if (!actor.dragging || actors.get(actor.entity.id) !== actor) {
          return
        }
        actor.dragging = false
        if (!commit) {
          actor.x = clamp(actor.dragStart.x, ...bounds(field.width))
          actor.row = Math.min(actor.dragStart.row, field.settings.rows - 1)
          paint(view.performance.now(), true)
          return
        }
        const timestamp = now()
        const { row, x } = interactPosition(event)
        Object.assign(actor, { x, row, pauseUntil: timestamp + 900, settledAt: timestamp })
        const target = dropTarget(
          actorList().filter((other) => other !== actor),
          x,
          row
        )
        const dizzy = shaken(flips, timestamp)
        if (dizzy) {
          onDizzy(actor, timestamp, actor.assets.has, actor.assets.msOf)
        } else if (
          target &&
          target !== visitor &&
          field.settings.spar &&
          canSpar(actor) &&
          canSpar(target)
        ) {
          pair = sparActors(actor, target, 'drop', field, options, timestamp)
        }
        options.onDrop?.({
          agent: actor.entity,
          target: target && target !== visitor ? target.entity : null,
          visitor: target && target === visitor ? target.entity : null,
          x,
          row,
          shaken: dizzy
        })
        paint(view.performance.now(), true)
      },
      navigate(actor, dx, dy) {
        const list = actorList()
        const next = actor
          ? list
              .filter((other) =>
                dx
                  ? other.row === actor.row && Math.sign(other.x - actor.x) === dx
                  : Math.sign(other.row - actor.row) === dy
              )
              .sort(
                (a, b) =>
                  Math.abs(a.row - actor.row) - Math.abs(b.row - actor.row) ||
                  Math.abs(a.x - actor.x) - Math.abs(b.x - actor.x)
              )[0]
          : list[0]
        next?.button.focus({ preventScroll: true })
      }
    },
    controller.signal
  )

  function insertActor(actor) {
    root.append(actor.button)
    connect(actor)
  }

  const resize = new ResizeObserver(() => {
    setGeometry()
    paint(view.performance.now(), true)
  })
  resize.observe(root)
  setGeometry()
  request = view.requestAnimationFrame(frame)

  return {
    update(patch) {
      if (controller.signal.aborted) {
        return
      }
      if ('now' in patch) {
        fixedTime = patch.now
      }
      if (patch.settings) {
        const prevRows = field.settings.rows
        const settings = { ...field.settings, ...patch.settings }
        settings.rows = Math.round(numberIn(settings.rows, 1, 3, DEFAULT_SETTINGS.rows))
        settings.scale = numberIn(settings.scale, 0.5, 1.25, DEFAULT_SETTINGS.scale)
        field.settings = settings
        if (settings.rows !== prevRows) {
          const width = field.width || 1
          const perRow = Math.floor(actors.size / settings.rows)
          const extra = actors.size % settings.rows
          for (const [i, actor] of [...actors.values()].entries()) {
            actor.row = i % settings.rows
            const count = perRow + Number(actor.row < extra)
            actor.x = (width * (Math.floor(i / settings.rows) + 1)) / (count + 1)
            clearWalk(actor)
          }
          pair = null
        }
        if (!settings.spar) {
          pair = null
        }
      }
      setGeometry()
      if (patch.agents) {
        syncAgents(patch.agents)
        if (!('focusedId' in patch)) {
          focusedId = patch.agents.find(({ focused }) => focused)?.id ?? null
        }
      }
      if ('focusedId' in patch) {
        focusedId = patch.focusedId
        if (focusedId === undefined) {
          lastFocus = undefined
        }
      }
      if (patch.boosts) {
        boosts = patch.boosts
      }
      if ('battle' in patch) {
        battles.update(patch.battle)
      }
      if ('visitor' in patch) {
        updateVisitor(patch.visitor)
      }
      root.tabIndex = actors.size || visitor ? -1 : 0
      paint(view.performance.now(), true)
    },
    dispose() {
      controller.abort()
      view.cancelAnimationFrame(request)
      resize.disconnect()
      root.remove()
      actors.clear()
      visitor = null
      hovered = null
      pair = null
    }
  }
}
