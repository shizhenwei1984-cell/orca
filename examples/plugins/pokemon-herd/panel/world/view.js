import { ITEMS } from '../../encounters/rules/items.js'
import { attention } from './motion.js'
import { reactIcon } from './reactions.js'
import { paintSprite, spriteSet } from './sprites.js'
import { layoutTags } from './tags.js'

const STATES = {
  working: 'Working',
  waiting: 'Waiting for input',
  blocked: 'Blocked',
  done: 'Done',
  idle: 'Idle',
  sleep: 'Sleeping'
}
const EVOLVE_MS = 3000
const EVOLVE_BURST = 2000
const EVOLVE_SWAPS = [650, 950, 1175, 1344, 1470, 1565, 1636, 1696, 1756, 1816, 1876, 1936]

export function createActor(document, entity, now, x, row, visitor = false) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'pokemon-world__actor'
  button.dataset.actor = entity.id
  button.dataset.kind = visitor ? 'visitor' : 'agent'
  if (!visitor) {
    button.setAttribute('aria-keyshortcuts', 'P B S Alt+Shift+P Alt+Shift+B Shift+F10')
  }
  const [tag, body, sprite, badge] = ['tag', 'body', 'sprite', 'badge'].map((name) => {
    const span = document.createElement('span')
    span.className = `pokemon-world__${name}`
    span.setAttribute('aria-hidden', 'true')
    return span
  })
  body.append(sprite, badge)
  button.append(body, tag)
  const actor = {
    button,
    tag,
    body,
    sprite,
    badge,
    x,
    row,
    born: now,
    settledAt: now,
    pauseUntil: now,
    hoverSide: 'r',
    dir: 'r',
    mood: visitor ? 'working' : entity.state
  }
  assignEntity(actor, entity)
  return actor
}

export function assignEntity(actor, entity) {
  if (
    entity.sprites !== actor.entity?.sprites ||
    entity.spriteSpecies !== actor.entity?.spriteSpecies ||
    entity.species !== actor.entity?.species ||
    !actor.assets
  ) {
    if (actor.entity) {
      actor.flashUntil = actor.lastPaint + 1400
    }
    actor.assets = spriteSet(entity)
  }
  actor.entity = entity
}

function setLabel(actor, status, tags) {
  const { entity, button, tag } = actor
  const name = entity.label || entity.species || 'Companion'
  const label = [
    entity.parentId ? `Sub-agent of ${name}` : name,
    entity.species && entity.species !== name ? entity.species : null,
    status,
    entity.task
  ]
    .filter(Boolean)
    .join(' · ')
  if (button.getAttribute('aria-label') !== label) {
    button.setAttribute('aria-label', label)
    button.title = label
    tag.textContent = entity.parentId ? `↳ ${name}` : name
  }
  tag.hidden = !tags
}

export function paintActors(
  list,
  { width, rowHeight, ground, now, settings, reduced, hovered, season, focusedId }
) {
  const rows = Array.from({ length: settings.rows }, () => [])
  const heads = Array.from({ length: settings.rows }, () => [])
  for (const [rank, actor] of list.entries()) {
    const { entity } = actor
    rows[actor.row].push({
      id: actor,
      cx: actor.track?.target ?? actor.x,
      from: actor.track?.from,
      x: actor.x,
      settled: !actor.moving,
      since: actor.settledAt,
      rank: entity.id === focusedId ? -1 : rank,
      text: entity.label || entity.species || 'Companion'
    })
  }
  for (const [row, items] of rows.entries()) {
    const tags = layoutTags(items, width, { minW: 42, maxW: 160, maxLines: 2 })
    for (const { id: actor } of items) {
      const { entity, button, tag, body, sprite, badge } = actor
      const visitor = button.dataset.kind === 'visitor'
      const status = visitor
        ? 'Wild visitor'
        : entity.state === 'done' && actor.mood === 'sleep'
          ? 'Done · Sleeping'
          : STATES[actor.mood]
      const { careNote, hungry } = entity
      const careDuration = careNote?.kind === 'pickup' ? 8000 : 3200
      const care =
        careNote && now >= careNote.at && now - careNote.at < careDuration ? careNote.kind : ''
      const careIcon = care === 'pet' ? '♥' : care ? (ITEMS[careNote.item]?.icon ?? '🍓') : ''
      const pickup = care === 'pickup' ? ITEMS[careNote.item] : null
      const attentionIcon = attention(actor.mood)
        ? hungry
          ? '🥺'
          : actor.mood === 'blocked'
            ? '!'
            : '…'
        : ''
      const elapsed = now - (entity.evolvedAt ?? -Infinity)
      const evolved = elapsed >= 0 && elapsed < EVOLVE_MS
      const old = evolved && EVOLVE_SWAPS.filter((at) => elapsed >= at).length % 2 === 0
      const evolution =
        !reduced && evolved && entity.evolvedFrom && elapsed < EVOLVE_BURST
          ? {
              pick: old ? entity.evolvedFrom : entity.appearance,
              light: Math.min(1, elapsed / 500)
            }
          : null
      const flash = actor.flashUntil > now || evolved ? '✦' : ''
      const resting = entity.state === 'done' ? '✓' : actor.mood === 'sleep' ? 'zZ' : ''
      const icon = careIcon || attentionIcon || flash || reactIcon(actor, now) || resting
      const rival = entity.sameFolderRival && actor.mood === 'working'

      actor.lastPaint = now
      button.dataset.mood = visitor ? 'wild' : actor.mood
      button.dataset.focused = String(entity.id === focusedId)
      button.dataset.petted = String(care === 'pet')
      button.dataset.care = care
      button.dataset.evolution = evolution
        ? old
          ? 'before'
          : 'after'
        : !reduced && evolved && elapsed >= EVOLVE_BURST && elapsed < EVOLVE_BURST + 420
          ? 'burst'
          : evolved
            ? 'evolved'
            : ''
      button.dataset.row = row
      button.classList.toggle('pokemon-world__actor--dragging', !!actor.dragging)
      const description = [
        status,
        hungry && 'Hungry',
        pickup && `Found ${pickup.name}`,
        evolved && 'Evolved',
        rival && 'Working in the same folder as another agent'
      ]
      setLabel(actor, description.filter(Boolean).join(' · '), settings.tags || visitor)
      const scale = settings.scale * (entity.parentId ? 1.5 : 2)
      const { w, h } = paintSprite(sprite, actor, {
        now,
        scale,
        reduced,
        evolution,
        hovered: hovered === actor,
        season: season && (season.t < 0.5 ? season.a : season.b)
      })
      const grab = Math.max(28, Math.round(w * 0.74))
      const visibleHeight = Math.max(24, Math.round(h * 0.74))
      const y = row * rowHeight + ground
      const spot = tags.get(actor)
      body.style.left = `${Math.round(actor.x - grab / 2)}px`
      body.style.top = `${Math.round(y - visibleHeight - (actor.dragging ? 8 : 0))}px`
      body.style.width = `${grab}px`
      body.style.height = `${visibleHeight}px`
      tag.style.left = `${Math.round(spot.left)}px`
      tag.style.top = `${y + 11 + 17 * spot.line}px`
      tag.style.width = `${Math.round(spot.w)}px`

      const badgeText = visitor
        ? (entity.icon ?? '?')
        : pickup
          ? `${pickup.icon} ${pickup.name}`
          : evolved && !evolution
            ? 'Evolved'
            : icon || (rival ? '⚔' : '')
      if (badge.textContent !== badgeText) {
        badge.textContent = badgeText
      }
      badge.dataset.attention = attention(actor.mood) ? 'true' : 'false'
      badge.hidden = !badgeText
      actor.battlePosition = {
        x: actor.x,
        y: y - h / 2,
        top: y - h,
        ground: y
      }
      heads[row].push({
        x0: actor.x - grab / 2,
        x1: actor.x + grab / 2,
        top: ground - visibleHeight - (badgeText ? 17 : 0)
      })
    }
  }
  return heads
}
