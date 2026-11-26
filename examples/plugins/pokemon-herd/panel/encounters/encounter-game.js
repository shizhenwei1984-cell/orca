import { appearanceOf } from '../../catalog/trainer-catalog.mjs'
import { prepareBattleArt } from './battle-sprites.js'
import { mountBattleStage } from './battle-stage.js'
import { mountEncounterPanel } from './encounter-panel.js'

// Pokerdr's wild acts stop near a companion on the same row.
const NEAR = 24
const motionKinds = new Set(['tease', 'nap', 'challenge', 'curious', 'friendly', 'weather'])
const clamp = (value) => Math.min(1, Math.max(0, value))
const center = (rect) => rect.left + rect.width / 2
const activeRaid = (raid) => raid?.phase === 'battle' || raid?.phase === 'egg'
const mapVisitorId = (visitor, raid) => (activeRaid(raid) || visitor?.raid ? raid?.id : visitor?.id)

export function mountEncounterGame(
  root,
  { request, sprite, cry, onVisitor, onBattle, onSettings, onRare, interactions, world, signal }
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
    onCapture:
      onSettings &&
      ((patch) => {
        Promise.resolve()
          .then(() => onSettings(patch))
          .catch(() => panel.setCapture(settings))
      }),
    onSound(value) {
      stage.sound(value, true)
      Promise.resolve()
        .then(() => onSettings?.({ battleSounds: value }))
        .then(
          () => {
            sound = value
          },
          () => {
            panel.sound(sound)
            stage.sound(sound)
          }
        )
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
    const rain = worldNode()?.dataset.weather
    return {
      ...(scope.workspaceId && { workspaceId: scope.workspaceId }),
      terminalIds: scope.terminalIds.slice(0, 50),
      ...(rain && { rain })
    }
  }

  function worldVisitor(model) {
    const { raid, busy, now, result } = model
    const visitor = activeRaid(raid) ? null : model.visitor
    if (busy && (result?.kind === 'caught' || result?.kind === 'fled')) {
      sendVisitor(null)
      return
    }
    const visitorId = mapVisitorId(visitor, raid)
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
    const tags = pick?.tags ?? []
    const rare = tags.includes('Legendary')
      ? 'Legendary'
      : tags.includes('Alpha')
        ? tags.includes('Shadow')
          ? 'Shadow Alpha'
          : 'Alpha'
        : tags.includes('Shiny')
          ? 'Shiny'
          : null
    const arrival =
      rare && visitor?.appearedAt && !visitor.trainer && !visitor.raid
        ? { text: `${rare} ${label} appeared!`, until: visitor.appearedAt + 3500 }
        : null
    const waiting = visitor?.trainer || !visitor?.appearedAt || visitor.raid
    const parked = busy || (act && motionKinds.has(act.kind) && now >= act.from && now < act.until)
    if (visitorMotion?.id !== visitorId) {
      visitorMotion = { id: visitorId, from: -0.08, startedAt: visitor?.appearedAt ?? now }
      if (arrival && now < arrival.until) {
        onRare?.(pick, scope.signal)
      }
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
      appearance: pick ? appearanceOf(pick) : undefined,
      from: start,
      to: end,
      startedAt: motion.startedAt,
      duration: Math.max(1, (visitor?.expiresAt ?? now + 1) - motion.startedAt),
      row: 0,
      icon,
      arrival
    }
    motion.entity = entity
    sendVisitor(entity)
  }

  function presentBattle(model) {
    const { result, party, visitor, raid } = model
    const own = party.find(({ slot }) => slot === (result?.slot ?? result?.hit?.pane))
    const opponent =
      result?.kind === 'spar'
        ? party.find(({ slot }) => slot === result.opponent)
        : {
            terminalId: result?.visitorId,
            status: result?.visitorId === visitor?.id ? visitor?.status : null
          }
    const fight = result?.turns?.length || result?.hit
    const valid =
      own?.terminalId &&
      opponent?.terminalId &&
      (!result.ownId || own.pokemonId === result.ownId) &&
      (!result.opponentId || opponent.pokemonId === result.opponentId)
    const statuses = new Map(party.map(({ terminalId, status }) => [terminalId, status]))
    if (visitor && !activeRaid(raid)) {
      statuses.set(mapVisitorId(visitor, raid), visitor.status)
    }
    onBattle?.({
      statuses,
      game:
        fight && valid
          ? {
              result,
              own: own.terminalId,
              opponent: opponent.terminalId,
              spar: result.kind === 'spar'
            }
          : null
    })
    const target = activeRaid(raid) ? raid.pick : visitor?.pick
    const lead = party.find(({ fighter }) => fighter) ?? party[0]
    prepareBattleArt(target, false)
    if (target) {
      prepareBattleArt(lead, lead?.mega === 'auto')
    }
    stage.render(fight && !valid ? { ...model, result: null } : model, model.now, {
      own: result?.kind === 'spar' ? null : own?.status,
      opponent: result?.kind === 'spar' ? null : opponent?.status
    })
  }

  function partyMember(actor) {
    return snapshot?.party.find(
      ({ terminalId, slot, pokemonId }) =>
        terminalId === (actor?.terminalId ?? actor?.id) &&
        (!actor?.ref || (actor.ref.slot === slot && actor.ref.id === pokemonId))
    )
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
      const model = await request('encounter.read', input(), active.signal)
      if (scope !== active || lifetime.signal.aborted) {
        return
      }
      readFailure = false
      snapshot = model
      if (!model) {
        panel.reset()
        stage.clear()
        sendVisitor(null)
        onBattle?.(null)
        return
      }
      worldVisitor(model)
      panel.render(model)
      presentBattle(model)
      checkProximity()
    } catch (error) {
      if (scope === active && !lifetime.signal.aborted) {
        readFailure = true
        panel.showReadError(error.message)
      }
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
    const member = snapshot.party.find(({ slot }) => slot === action.slot)
    const pokemonId = member?.pokemonId
    if (['attack', 'raid-hit', 'spar'].includes(action.type)) {
      prepareBattleArt(member, member?.mega === 'auto')
    }
    const opponentId = snapshot.party.find(({ slot }) => slot === action.opponent)?.pokemonId
    const payload = {
      ...input(),
      client,
      sequence: ++sequence,
      revision: snapshot.revision,
      action: {
        ...action,
        ...(pokemonId && { pokemonId }),
        ...(opponentId && { opponentId })
      }
    }
    sending = active
    view.clearTimeout(refreshTimer)
    try {
      try {
        return await request('encounter.command', payload, active.signal)
      } catch (error) {
        if (scope !== active) {
          throw error
        }
        return await request('encounter.command', payload, active.signal)
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
    if (visitor.id === snapshot.visitor?.id && !activeRaid(snapshot.raid)) {
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
      if (
        snapshot?.visitor &&
        !activeRaid(snapshot.raid) &&
        mapVisitorId(snapshot.visitor, snapshot.raid) === visitor.id
      ) {
        return panel.activateVisitor()
      }
      if (snapshot?.raid?.id === visitor.id) {
        panel.focus()
      }
    },
    onDrop: drop,
    onSpar: spar,
    onMenu({ visitor }) {
      if (visitor && visitor.id === mapVisitorId(snapshot?.visitor, snapshot?.raid)) {
        panel.focus()
        return true
      }
      return false
    }
  }

  function reset() {
    view.clearTimeout(refreshTimer)
    sendVisitor(null)
    onBattle?.(null)
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
      const before = settings
      settings = { ...settings, ...patch.settings }
      if (settings.ball !== before.ball || settings.bait !== before.bait) {
        panel.setCapture(settings)
      }
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
  return {
    update,
    refresh,
    menuActions: panel.menuActions,
    captureControls: panel.captureControls,
    worldCallbacks,
    destroy
  }
}
