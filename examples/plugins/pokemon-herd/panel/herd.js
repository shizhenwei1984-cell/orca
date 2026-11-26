import { loadCatalogSprite } from './catalog/sprite.mjs'
import { mountEncounterGame } from './encounters/encounter-game.js'
import { encounterSprites } from './encounters/encounter-sprites.js'
import { species, starterDex } from './pokemon.mjs'
import { mountTrainer } from './trainer.js'
import { worldInteractions } from './world-interactions.js'
import { bindWorldPreferences } from './world-preferences.js'
import { mountWorld } from './world/world.js'

const poses = {
  working: ['Working', 'walk', '640ms'],
  waiting: ['Waiting for input', 'idle', '1s'],
  blocked: ['Blocked', 'idle', '540ms'],
  done: ['Resting', 'sleep', '1.8s']
}
const herd = document.querySelector('#herd')
const message = document.querySelector('#message')
const retry = document.querySelector('#retry')
const count = document.querySelector('#count')
const heading = document.querySelector('#workspace')
const template = document.querySelector('#companion')
const trainer = document.querySelector('#trainer')
const wallet = document.querySelector('#wallet')
const work = document.querySelector('#work')
const candy = document.querySelector('#candy')
const progressError = document.querySelector('#progress-error')
const number = new Intl.NumberFormat()
const orca = window.orca
const worldContainer = document.querySelector('#world')
const showWorld = document.querySelector('#show-world')
const showParty = document.querySelector('#show-party')
const showSettings = document.querySelector('#show-settings')
const settings = document.querySelector('#world-settings')
const actions = document.querySelector('#world-actions')
const focusButton = document.querySelector('#focus-terminal')
const focusStatus = document.querySelector('#focus-status')
const lifetime = new AbortController()
const { signal } = lifetime
const cards = new Map()
let workspace
let roster = []
let progress = new Map()
let readingProgress = false
let progressDirty = false
const trainerGame = mountTrainer(() => [...(workspace?.terminals ?? [])].slice(0, 50))
let focusRequest

function publish(type, detail, cancelable = false) {
  return worldInteractions.dispatchEvent(
    new CustomEvent(type, {
      detail: { workspaceId: workspace?.context.workspaceId, ...detail },
      cancelable
    })
  )
}

const world = mountWorld(worldContainer, {
  onFocus: focusTerminal,
  onPet(agent, event) {
    playSound('pet', event)
    publish('pet', { agent })
  },
  onSpar(spar) {
    playSound('spar')
    publish('spar', spar)
  },
  onDrop: (drop) => publish('drop', drop),
  onWild: (visitor) => publish('wild', { visitor }),
  onMenu(menu) {
    if (publish('menu', menu, true)) {
      openActions(menu)
    }
  },
  onCommand(command, agent) {
    if (!publish('command', { command, agent }, true)) {
      return true
    }
    if (command === 'settings') {
      toggleSettings(settings.hidden)
      return true
    }
    return false
  }
})
const encounterContainer = document.querySelector('#encounters')
let battleSoundChanged = false
const encounters = mountEncounterGame(encounterContainer, {
  request: (name, input) => orca.plugin.request(name, input, { signal }),
  interactions: worldInteractions,
  world: worldContainer,
  ...encounterSprites(loadCatalogSprite),
  onSettings({ battleSounds }) {
    battleSoundChanged = true
    return orca.storage.set('battle.sounds', battleSounds)
  },
  signal
})
void orca.storage
  .get('battle.sounds')
  .then((value) => {
    if (!battleSoundChanged && typeof value === 'boolean') {
      encounters.update({ settings: { battleSounds: value } })
    }
  })
  .catch(() => {})
const playSound = bindWorldPreferences(orca, signal, (settings) => {
  world.update({ settings })
  encounters.update({ settings })
})

function selectView(party) {
  actions.hidePopover()
  worldContainer.hidden = party
  encounterContainer.hidden = party
  herd.hidden = !party
  showWorld.setAttribute('aria-pressed', String(!party))
  showParty.setAttribute('aria-pressed', String(party))
  if (!workspace?.error) {
    showRosterStatus()
  }
}

function toggleSettings(open) {
  actions.hidePopover()
  settings.hidden = !open
  showSettings.setAttribute('aria-expanded', String(open))
  if (open) {
    settings.querySelector('select:enabled, input:enabled, button:enabled').focus()
  } else {
    showSettings.focus()
  }
}

function openActions({ agent, x, y, anchor }) {
  focusButton.hidden = !agent
  focusButton.onclick = (event) => {
    actions.hidePopover()
    void focusTerminal(agent, event)
  }
  const source = anchor.closest('button') ?? anchor
  if (!actions.matches(':popover-open')) {
    actions.showPopover({ source })
  }
  actions.style.left = `${Math.max(0, Math.min(x, innerWidth - actions.offsetWidth))}px`
  actions.style.top = `${Math.max(0, Math.min(y, innerHeight - actions.offsetHeight))}px`
  actions.querySelector('button:not([hidden])').focus()
}

async function focusTerminal(agent, event) {
  if (!event.isTrusted || !workspace?.terminals.has(agent.id)) {
    return
  }
  focusRequest?.abort()
  const request = new AbortController()
  focusRequest = request
  focusStatus.hidden = true
  const { workspaceId } = workspace.context
  try {
    const result = await orca.plugin.request(
      'terminal.focus',
      {
        terminalId: agent.id,
        ...(workspaceId ? { workspaceId } : {})
      },
      { signal: request.signal }
    )
    if (!result.focused && !request.signal.aborted) {
      focusStatus.textContent = 'Orca could not focus this terminal.'
      focusStatus.hidden = false
    }
  } catch (error) {
    if (!request.signal.aborted) {
      focusStatus.textContent = `Could not focus this terminal. ${error.message}`
      focusStatus.hidden = false
    }
  }
}

function duration(ms) {
  const sec = Math.floor(ms / 1000)
  const min = Math.floor(sec / 60)
  const hours = Math.floor(min / 60)
  if (hours) {
    return `${hours}h ${min % 60}m`
  }
  return min ? `${min}m ${sec % 60}s` : `${sec}s`
}

function jobCount(jobs) {
  return `${number.format(jobs)} ${jobs === 1 ? 'job' : 'jobs'}`
}

function updatePose(row, pokemon, state) {
  const [label, pose, duration] = poses[state]
  row.dataset.state = state
  row.querySelector('.state').textContent = label
  const sprite = row.querySelector('.sprite')
  sprite.hidden = !pokemon?.walk
  if (!pokemon?.walk) {
    return
  }
  sprite.style.backgroundImage = `url('./sprites/${pokemon.name.toLowerCase()}-${pose}.png')`
  sprite.style.setProperty('--frames', pose === 'sleep' ? 2 : pokemon[pose])
  sprite.style.setProperty('--duration', duration)
}

function paintCompanion({ row, starter, state }, member) {
  const dex = member?.dex ?? starter
  const current = species[dex]
  updatePose(row, species[member?.starter ?? starter], state)
  row.querySelector('small').textContent = member?.name ?? current?.name ?? `#${dex}`
  row.querySelector('.progress').hidden = !member
  if (member) {
    const reward = member.lastReward ? ` · +₽${number.format(member.lastReward)} last job` : ''
    row.querySelector('.career').textContent =
      `${jobCount(member.jobs)} · ${duration(member.workMs)} worked${reward}`
    const evolution = current?.evolution
    const next = evolution?.jobs
      ? ` · ${member.stageJobs}/${evolution.jobs} to ${species[evolution.dex].name}`
      : evolution?.item
        ? ` · Evolves with a ${evolution.item}`
        : ''
    row.querySelector('.growth').textContent = `Friendship ${member.friendship}/100${next}`
  }
}

function paintRoster() {
  const entities = []
  const stale = new Set(cards.keys())
  for (const agent of roster) {
    const key = agent.terminalId ?? agent
    const row = cards.get(key) ?? template.content.firstElementChild.cloneNode(true)
    if (!cards.has(key)) {
      cards.set(key, row)
      herd.append(row)
    }
    stale.delete(key)
    const label = agent.title || agent.agent || 'Agent'
    const name = row.querySelector('strong')
    name.textContent = name.title = label
    row.querySelector('.care').onclick = () => trainerGame.openParty(agent.terminalId)
    const member = progress.get(agent.terminalId)
    const starter = starterDex(agent)
    paintCompanion({ row, starter, state: agent.state }, member)
    if (workspace?.terminals.has(agent.terminalId)) {
      entities.push({
        id: agent.terminalId,
        label,
        species: member?.name ?? species[member?.dex ?? starter]?.name ?? `#${member?.dex}`,
        spriteSpecies: species[member?.starter ?? starter]?.name,
        state: agent.state,
        stateStartedAt: agent.stateStartedAt
      })
    }
  }
  for (const key of stale) {
    cards.get(key).remove()
    cards.delete(key)
  }
  world.update({ agents: entities })
  if (workspace) {
    const scope = workspace.scope
    publish('roster', {
      agents: entities,
      signal: scope.signal,
      setVisitor(visitor) {
        if (!scope.signal.aborted) {
          world.update({ visitor })
        }
      }
    })
  }
}

function showRosterStatus() {
  const size = roster.length
  count.textContent = size ? `${size} ${size === 1 ? 'agent' : 'agents'}` : ''
  message.hidden = size > 0
  message.textContent = workspace
    ? 'Start a terminal agent in this workspace to meet its Pokémon.'
    : 'Open a workspace to see its Pokémon.'
  if (roster.some(({ terminalId }) => !workspace.terminals.has(terminalId))) {
    message.hidden = worldContainer.hidden
    message.textContent = 'Open Party to see agents Orca could not match to a listed terminal.'
  }
}

function updateRetry() {
  retry.hidden = progressError.hidden && !workspace?.error
}

async function readProgress() {
  if (signal.aborted) {
    return
  }
  progressDirty = true
  if (readingProgress) {
    return
  }
  readingProgress = true
  while (progressDirty && !signal.aborted) {
    progressDirty = false
    const current = workspace
    try {
      const view = await orca.plugin.request(
        'trainer.read',
        { terminalIds: [...(current?.terminals ?? [])].slice(0, 50) },
        { signal }
      )
      if (signal.aborted || current !== workspace) {
        continue
      }
      wallet.textContent = `₽${number.format(view.money)}`
      work.textContent = `${jobCount(view.jobs)} · ${duration(view.ms)} worked`
      candy.textContent = `${number.format(view.candy)} Rare Candy`
      candy.hidden = view.candy === 0
      trainer.hidden = false
      progressError.hidden = true
      updateRetry()
      progress = new Map(view.companions.map((member) => [member.terminalId, member]))
      paintRoster()
    } catch (error) {
      if (!signal.aborted && current === workspace) {
        progressError.hidden = false
        progressError.textContent = `Could not read trainer progress. ${error.message}`
        updateRetry()
      }
    }
  }
  readingProgress = false
}

async function readAgents(current) {
  current.dirty = true
  if (current.reading) {
    return
  }
  current.reading = true
  while (current.dirty && !current.read.signal.aborted) {
    current.dirty = false
    try {
      const { agents } = await orca.host.call(
        'agents.list',
        current.context.workspaceId && orca.api.minor >= 10
          ? { workspaceId: current.context.workspaceId }
          : {},
        { signal: current.read.signal }
      )
      if (current.read.signal.aborted) {
        return
      }
      const seen = new Set()
      roster = agents.filter(({ terminalId }) => {
        if (!terminalId) {
          return true
        }
        if (seen.has(terminalId)) {
          return false
        }
        seen.add(terminalId)
        return true
      })
      current.error = false
      paintRoster()
      showRosterStatus()
    } catch (error) {
      if (!current.read.signal.aborted) {
        current.error = true
        message.hidden = false
        message.textContent = `Could not read agents. ${error.message}`
      }
    }
    updateRetry()
  }
  current.reading = false
}

function refresh(context) {
  const previous = workspace
  const terminals = new Set(context?.terminals.map(({ id }) => id))
  const sameWorkspace =
    previous &&
    context &&
    (context.workspaceId
      ? context.workspaceId === previous.context.workspaceId
      : [...terminals].some((id) => previous.terminals.has(id)))
  previous?.read.abort()
  workspace = context
    ? {
        context,
        terminals,
        scope: sameWorkspace ? previous.scope : new AbortController(),
        read: new AbortController()
      }
    : undefined
  actions.hidePopover()
  if (!sameWorkspace) {
    previous?.scope.abort()
    focusRequest?.abort()
    focusStatus.hidden = true
    roster = []
    progress = new Map()
    world.update({ agents: [], visitor: null })
  } else {
    roster = roster.filter(({ terminalId }) => terminals.has(terminalId))
  }
  heading.textContent = context?.displayName || 'Pokémon Herd'
  paintRoster()
  showRosterStatus()
  updateRetry()
  void readProgress()
  void trainerGame.refresh(true)
  if (workspace) {
    if (!roster.length) {
      message.textContent = 'Loading agents…'
    }
    void readAgents(workspace)
  }
}

showWorld.onclick = () => selectView(false)
showParty.onclick = () => selectView(true)
showSettings.onclick = () => toggleSettings(settings.hidden)
document.querySelector('#world-action-settings').onclick = () => toggleSettings(true)
settings.addEventListener(
  'keydown',
  (event) => {
    if (!event.defaultPrevented && event.key === 'Escape') {
      event.preventDefault()
      toggleSettings(false)
    }
  },
  { signal }
)
retry.onclick = () => {
  if (workspace) {
    void readAgents(workspace)
  }
  void readProgress()
}

// workspace.changed replays the current context when the panel subscribes.
const subscriptions = [
  orca.plugin.on('trainer.changed', () => {
    void readProgress()
    void encounters.refresh()
  }),
  orca.on('agent.status.changed', (event) => {
    if (
      workspace &&
      (workspace.terminals.has(event.terminalId) ||
        (!workspace.context.workspaceId && !event.terminalId) ||
        (workspace.context.workspaceId && workspace.context.workspaceId === event.workspaceListId))
    ) {
      void readAgents(workspace)
    }
  }),
  orca.on('workspace.changed', ({ context }) => refresh(context))
]
window.addEventListener(
  'pagehide',
  () => {
    lifetime.abort()
    focusRequest?.abort()
    workspace?.read.abort()
    workspace?.scope.abort()
    for (const subscription of subscriptions) {
      subscription.dispose()
    }
    world.dispose()
  },
  { once: true }
)
