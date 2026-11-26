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

export function createActor(document, entity, now, x, row, visitor = false) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'pokemon-world__actor'
  button.dataset.actor = entity.id
  button.dataset.kind = visitor ? 'visitor' : 'agent'
  if (!visitor) {
    button.setAttribute('aria-keyshortcuts', 'P S')
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
  const label = [name, entity.species && entity.species !== name ? entity.species : null, status]
    .filter(Boolean)
    .join(' · ')
  if (button.getAttribute('aria-label') !== label) {
    button.setAttribute('aria-label', label)
    button.title = label
    tag.textContent = entity.parentId ? `↳ ${name}` : name
  }
  tag.hidden = !tags
}

export function paintActors(list, { width, rowHeight, ground, now, settings, reduced, hovered }) {
  const rows = Array.from({ length: settings.rows }, () => [])
  const heads = Array.from({ length: settings.rows }, () => [])
  for (const [rank, actor] of list.entries()) {
    const { entity } = actor
    rows[actor.row].push({
      id: actor,
      cx: actor.track?.target ?? actor.x,
      from: actor.track?.from,
      settled: !actor.moving,
      since: actor.settledAt,
      rank: entity.focused ? -1 : rank,
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
      const shots = actor.react?.shot
      const activeShot = shots && now >= shots.at && now < shots.until && !reduced
      const icon = attention(actor.mood)
        ? actor.mood === 'blocked'
          ? '!'
          : '…'
        : actor.petUntil > now
          ? '♥'
          : actor.flashUntil > now
            ? '✦'
            : reactIcon(actor, now) ||
              (entity.state === 'done' ? '✓' : actor.mood === 'sleep' ? 'zZ' : '')
      const rival =
        entity.rivalGroup &&
        actor.mood === 'working' &&
        list.some(
          (other) =>
            other !== actor &&
            other.mood === 'working' &&
            other.entity.rivalGroup === entity.rivalGroup
        )

      actor.lastPaint = now
      button.dataset.mood = visitor ? 'wild' : actor.mood
      button.dataset.focused = entity.focused ? 'true' : 'false'
      button.dataset.petted = actor.petUntil > now ? 'true' : 'false'
      button.dataset.row = row
      button.classList.toggle('pokemon-world__actor--dragging', !!actor.dragging)
      setLabel(actor, status, settings.tags || visitor)
      const scale = settings.scale * (entity.parentId ? 1.5 : 2)
      const { w, h } = paintSprite(sprite, actor, {
        now,
        scale,
        reduced,
        hovered: hovered === actor
      })
      const grab = Math.max(28, Math.round(w * 0.74))
      const visibleHeight = Math.max(24, Math.round(h * 0.74))
      const y = row * rowHeight + ground
      const spot = tags.get(actor)
      const left =
        actor.moving || actor.dragging
          ? Math.min(width - spot.w, Math.max(0, actor.x - spot.w / 2))
          : spot.left
      body.style.left = `${Math.round(actor.x - grab / 2)}px`
      body.style.top = `${Math.round(y - visibleHeight - (actor.dragging ? 8 : 0))}px`
      body.style.width = `${grab}px`
      body.style.height = `${visibleHeight}px`
      tag.style.left = `${Math.round(left)}px`
      tag.style.top = `${y + 11 + 17 * spot.line}px`
      tag.style.width = `${Math.round(spot.w)}px`

      const badgeText = visitor ? (entity.icon ?? '?') : icon || (rival ? '⚔' : '')
      if (badge.textContent !== badgeText) {
        badge.textContent = badgeText
      }
      badge.dataset.attention = attention(actor.mood) ? 'true' : 'false'
      badge.hidden = !badgeText
      if (actor.shot) {
        actor.shot.hidden = !activeShot
      }
      if (activeShot) {
        if (!actor.shot) {
          actor.shot = button.ownerDocument.createElement('span')
          actor.shot.className = 'pokemon-world__shot'
          actor.shot.setAttribute('aria-hidden', 'true')
          button.append(actor.shot)
        }
        const x =
          shots.from + ((shots.to - shots.from) * (now - shots.at)) / (shots.until - shots.at)
        actor.shot.textContent = shots.icon
        actor.shot.style.left = `${Math.round(x)}px`
        actor.shot.style.top = `${y - 28}px`
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
