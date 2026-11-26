import { mountBattleStage } from './battle-stage.js'
import { mountEncounterPanel } from './encounter-panel.js'

// Pokerdr's wild acts stop near a companion on the same row.
const NEAR = 24
const motionKinds = new Set(['tease', 'nap', 'challenge', 'curious', 'friendly', 'weather'])
const clamp = (value) => Math.min(1, Math.max(0, value))
const center = (rect) => rect.left + rect.width / 2

export function mountEncounterGame(
  root,
  { request, sprite, sprites, cry, onVisitor, onSettings, interactions, world, signal }
) {
  const document = root.ownerDocument
  const view = document.defaultView
  const lifetime = new AbortController()
  const client = Array.from(view.crypto.getRandomValues(new Uint8Array(18)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
  const reduced = view.matchMedia('(prefers-reduced-motion: reduce)')
  let sequence = 0
  let scope
  let settings = {}
  let snapshot
  let refreshTimer
  let reading
  let sending
  let issuedNear
  let visitorMotion
  let sound = false
  let readFailure = false

  const panel = mountEncounterPanel(root, {
    onAction: command,
    sprite,
    onSound(value) {
      sound = value
      stage.sound(value, true)
      Promise.resolve()
        .then(() => onSettings?.({ battleSounds: value }))
        .catch(() => {})
    }
  })
  const stage = mountBattleStage(panel.stage, {
    sprite,
    cry: cry ?? ((dex) => request('encounter.cry', { dex })),
    reducedMotion: () => settings.reducedMotion ?? reduced.matches
  })

  function worldNode() {
    return world?.matches('.pokemon-world') ? world : world?.querySelector('.pokemon-world')
  }

  function sendVisitor(visitor) {
    const setter = scope?.setVisitor ?? onVisitor
    setter?.(visitor)
  }

  function input() {
    return {
      workspaceId: scope.workspaceId,
      terminalIds: scope.terminalIds,
      settings,
      rain: worldNode()?.dataset.weather
    }
  }

  function worldVisitor(model) {
    const { visitor, raid, busy, now, result } = model
    if (busy && (result?.kind === 'caught' || result?.kind === 'fled')) {
      sendVisitor(null)
      return
    }
    const visitorId =
      visitor?.id ?? (raid?.phase === 'battle' || raid?.phase === 'egg' ? raid.id : null)
    if (!visitorId) {
      visitorMotion = null
      sendVisitor(null)
      return
    }
    const pick = visitor?.pick ?? raid.pick
    const label = visitor?.trainer
      ? visitor.trainer.name
      : raid?.phase === 'egg'
        ? 'Raid egg'
        : pick.name
    const act = visitor?.act
    const waiting = visitor?.trainer || !visitor?.appearedAt || visitor.raid
    const parked = busy || (act && motionKinds.has(act.kind) && now >= act.from && now < act.until)
    if (visitorMotion?.id !== visitorId) {
      visitorMotion = { id: visitorId, from: -0.08, startedAt: visitor?.appearedAt ?? now }
    }
    const motion = visitorMotion
    const from = motion.from
    const to = waiting ? 0.79 : 1.1
    const duration = motion.entity?.duration ?? visitor?.crossing ?? 1
    if (visitor?.teleportAt <= now && visitor.teleportAt !== motion.teleportAt) {
      motion.teleportAt = visitor.teleportAt
      motion.startedAt = visitor.teleportAt
      motion.from = visitor.throws % 2 ? 0.64 : 0.22
      motion.parkedAt = null
    } else if (parked && motion.parkedAt == null) {
      motion.parkedAt = Math.min(
        0.96,
        Math.max(0.04, from + (to - from) * clamp((now - motion.startedAt) / duration))
      )
    } else if (!parked && motion.parkedAt != null) {
      motion.from = motion.parkedAt
      motion.startedAt = now
      motion.parkedAt = null
    }
    const start = waiting ? to : (motion.parkedAt ?? motion.from)
    const end = waiting || motion.parkedAt != null ? start : to
    const icon = visitor?.trainer
      ? '⚔'
      : !visitor
        ? raid.phase === 'egg'
          ? '🥚'
          : '⚔'
        : act?.kind === 'dash' || (act && now >= act.from && now < act.until)
          ? act.icon
          : visitor.catch
            ? '◉'
            : visitor.canGift
              ? '✦'
              : '?'
    const entity = {
      id: visitorId,
      label,
      species: pick?.name ?? label,
      from: start,
      to: end,
      startedAt: motion.startedAt,
      duration: Math.max(1, (visitor?.expiresAt ?? now + 1) - motion.startedAt),
      row: 0,
      icon
    }
    const spriteKey =
      pick && [pick.dex, pick.form, pick.shiny, pick.gender, pick.mega, pick.megaKind].join(':')
    if (spriteKey && sprites && spriteKey !== motion.spriteKey) {
      motion.spriteKey = spriteKey
      motion.sprites = undefined
      const active = scope
      Promise.resolve()
        .then(() => sprites(pick))
        .then((sheets) => {
          if (
            scope === active &&
            visitorMotion === motion &&
            motion.spriteKey === spriteKey &&
            sheets
          ) {
            motion.sprites = sheets
            sendVisitor({ ...motion.entity, sprites: sheets })
          }
        })
        .catch(() => {})
    }
    motion.entity = entity
    sendVisitor(motion.sprites ? { ...entity, sprites: motion.sprites } : entity)
  }

  function partyMember(actor) {
    return snapshot?.party.find(({ terminalId }) => terminalId === (actor?.terminalId ?? actor?.id))
  }

  function actorNearVisitor(visitor) {
    const field = worldNode()
    const visitorBody = field?.querySelector('[data-kind="visitor"] .pokemon-world__body')
    if (!visitorBody?.getClientRects().length) {
      return
    }
    const row = visitorBody.parentElement.dataset.row
    const visitorX = center(visitorBody.getBoundingClientRect())
    const candidates = field.querySelectorAll('[data-kind="agent"] .pokemon-world__body')
    for (const node of candidates) {
      const { actor, mood, row: actorRow } = node.parentElement.dataset
      if (row !== actorRow || Math.abs(center(node.getBoundingClientRect()) - visitorX) > NEAR) {
        continue
      }
      const member = partyMember({ id: actor })
      const kind = visitor.act.kind
      if (
        member &&
        ((kind === 'challenge' && member.able && mood === 'idle') ||
          (kind === 'curious' && mood === 'working') ||
          (kind === 'tease' && (mood === 'idle' || mood === 'sleep' || mood === 'done')) ||
          (kind === 'friendly' && mood !== 'blocked'))
      ) {
        return member
      }
    }
  }

  function checkProximity() {
    const visitor = snapshot?.visitor
    if (!visitor?.act?.proximity || snapshot.busy || sending || issuedNear === visitor.id) {
      return
    }
    const member = actorNearVisitor(visitor)
    if (!member) {
      return
    }
    issuedNear = visitor.id
    void command({ type: 'nearby', id: visitor.id, slot: member.slot })
      .then((result) => {
        if (result?.error === 'The encounter changed. Try again.' && issuedNear === visitor.id) {
          issuedNear = undefined
        }
      })
      .catch(() => {
        if (issuedNear === visitor.id) {
          issuedNear = undefined
        }
      })
  }

  function scheduleRefresh() {
    view.clearTimeout(refreshTimer)
    if (!scope || sending || document.hidden || lifetime.signal.aborted) {
      return
    }
    const interval = readFailure
      ? 4000
      : snapshot?.visitor || snapshot?.raid || snapshot?.busy
        ? 420
        : 1800
    refreshTimer = view.setTimeout(() => void refresh(), interval)
  }

  async function refresh() {
    if (!scope || sending || reading || lifetime.signal.aborted) {
      return
    }
    const active = scope
    reading = active
    view.clearTimeout(refreshTimer)
    try {
      const model = await request('encounter.read', input())
      if (scope !== active || lifetime.signal.aborted) {
        return
      }
      readFailure = false
      snapshot = model
      if (!model) {
        panel.reset()
        stage.clear()
        sendVisitor(null)
        return
      }
      worldVisitor(model)
      panel.render(model)
      stage.render(model, model.now)
      checkProximity()
    } catch {
      readFailure = true
    } finally {
      if (reading === active) {
        reading = null
      }
      if (scope === active) {
        scheduleRefresh()
      }
    }
  }

  async function command(action) {
    if (!scope || !snapshot || sending || lifetime.signal.aborted) {
      return { error: 'The encounter is still loading.' }
    }
    const active = scope
    const pokemonId = snapshot.party.find(({ slot }) => slot === action.slot)?.pokemonId
    const opponentId = snapshot.party.find(({ slot }) => slot === action.opponent)?.pokemonId
    const payload = {
      ...input(),
      client,
      sequence: ++sequence,
      revision: snapshot.revision,
      action: { ...action, pokemonId, opponentId }
    }
    sending = active
    view.clearTimeout(refreshTimer)
    try {
      try {
        return await request('encounter.command', payload)
      } catch {
        return await request('encounter.command', payload)
      }
    } finally {
      if (sending === active) {
        sending = null
      }
      if (scope === active) {
        await refresh()
      }
    }
  }

  function drop({ agent, visitor, shaken }) {
    const member = partyMember(agent)
    if (shaken || !visitor || !member?.able || snapshot.busy) {
      return
    }
    if (visitor.id === snapshot.visitor?.id) {
      return panel.submit({ type: 'attack', id: visitor.id, slot: member.slot })
    }
    if (visitor.id === snapshot.raid?.id && snapshot.raid.phase === 'battle') {
      return panel.submit({ type: 'raid-hit', id: visitor.id, slot: member.slot })
    }
  }

  function spar({ first, second, reason }) {
    const member = partyMember(first)
    const opponent = partyMember(second)
    if (!member?.able || !opponent?.able || snapshot.busy || sending) {
      return
    }
    const source = reason === 'tease' ? 'wake' : reason
    return command({ type: 'spar', slot: member.slot, opponent: opponent.slot, source }).catch(
      () => {}
    )
  }

  const worldCallbacks = {
    onWild(visitor) {
      if (snapshot?.visitor?.id === visitor.id) {
        return panel.activateVisitor()
      }
      if (snapshot?.raid?.id === visitor.id) {
        panel.focus()
      }
    },
    onDrop: drop,
    onSpar: spar,
    onMenu({ visitor }) {
      if (visitor?.id === snapshot?.visitor?.id && visitor) {
        panel.focus()
        return true
      }
      return false
    }
  }

  function reset() {
    view.clearTimeout(refreshTimer)
    sendVisitor(null)
    scope = undefined
    reading = undefined
    sending = undefined
    snapshot = undefined
    visitorMotion = undefined
    issuedNear = undefined
    panel.reset()
    stage.reset()
  }

  function update(patch) {
    if (lifetime.signal.aborted) {
      return
    }
    if (patch.settings) {
      settings = { ...settings, ...patch.settings }
      if (
        typeof patch.settings.battleSounds === 'boolean' &&
        patch.settings.battleSounds !== sound
      ) {
        sound = patch.settings.battleSounds
        panel.sound(sound)
        stage.sound(sound)
      }
    }
    if (patch.world) {
      world = patch.world
    }
    if (patch.signal?.aborted) {
      return
    }
    if (
      (patch.signal && scope?.signal !== patch.signal) ||
      ('workspaceId' in patch && patch.workspaceId !== scope?.workspaceId)
    ) {
      reset()
    }
    if (patch.terminalIds) {
      if (!scope) {
        scope = { workspaceId: patch.workspaceId, signal: patch.signal }
        const active = scope
        patch.signal?.addEventListener(
          'abort',
          () => {
            if (scope === active) {
              reset()
            }
          },
          { signal: lifetime.signal, once: true }
        )
      }
      scope.terminalIds = patch.terminalIds
      if (patch.setVisitor) {
        scope.setVisitor = patch.setVisitor
      }
    }
    void refresh()
  }

  const listen = { signal: lifetime.signal }
  interactions?.addEventListener(
    'roster',
    ({ detail }) =>
      update({
        ...detail,
        terminalIds: detail.agents.map(({ terminalId, id }) => terminalId ?? id)
      }),
    listen
  )
  interactions?.addEventListener(
    'wild',
    ({ detail }) => worldCallbacks.onWild(detail.visitor),
    listen
  )
  interactions?.addEventListener('drop', ({ detail }) => drop(detail), listen)
  interactions?.addEventListener('spar', ({ detail }) => spar(detail), listen)
  interactions?.addEventListener(
    'menu',
    (event) => {
      if (worldCallbacks.onMenu(event.detail)) {
        event.preventDefault()
      }
    },
    listen
  )
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) {
        view.clearTimeout(refreshTimer)
      } else {
        void refresh()
      }
    },
    listen
  )
  const proximity = view.setInterval(checkProximity, 180)

  function destroy() {
    lifetime.abort()
    view.clearInterval(proximity)
    reset()
    panel.destroy()
    stage.destroy()
  }

  signal?.addEventListener('abort', destroy, { once: true })
  return { update, refresh, worldCallbacks, destroy }
}
