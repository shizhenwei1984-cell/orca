import { loadCatalogSprite } from './catalog/sprite.mjs'
import { mountEncounterGame } from './encounters/encounter-game.js'
import { encounterSprites } from './encounters/encounter-sprites.js'
import { species, starterDex } from './pokemon.mjs'
import { disposeCompanionArt, paintCompanionArt } from './catalog/companion-art.mjs'
import { renderCompanionMenu } from './companion-menu.js'
import { mountTrainer } from './trainer.js'
import { mountWorldCare, mountWorldCries } from './world-care.js'
import { worldInteractions } from './world-interactions.js'
import { mountHerdStrip } from './herd-strip.js'
import { bindHerdSettings } from './herd-settings.js'
import { bindWorldPreferences } from './world-preferences.js'
import { mountWorld } from './world/world.js'
import { seasonAt } from './world/scene.js'
import { youngOf } from '../encounters/rules/picks.js'
import { nameOf } from '../encounters/rules/dex.js'

const poses = {
  working: ['Working', 'walk'],
  waiting: ['Waiting for input', 'idle'],
  blocked: ['Blocked', 'idle'],
  done: ['Resting', 'sleep']
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
const settings = document.querySelector('#herd-settings')
const actions = document.querySelector('#world-actions')
const showActions = document.querySelector('#show-world-actions')
const careStatus = document.querySelector('#care-status')
const focusStatus = document.querySelector('#focus-status')
const lifetime = new AbortController()
const { signal } = lifetime
const openSettingsPage = bindHerdSettings(orca, signal)
const cards = new Map()
let workspace
let roster = []
let progress = new Map()
let readingProgress = false
let progressDirty = false
let focusRequest
let menuRequest
let showFamily = true
const care = mountWorldCare(orca, careStatus, (action) => {
  if (action.type === 'pet') {
    preferences.play('pet')
  }
  void readProgress()
})
const cry = mountWorldCries(orca, () => preferences.get())
const trainerGame = mountTrainer(() => [...(workspace?.terminals ?? [])].slice(0, 50))

function publish(type, detail, cancelable = false) {
  return worldInteractions.dispatchEvent(
    new CustomEvent(type, {
      detail: {
        workspaceId: workspace?.context.workspaceId,
        signal: workspace?.scope.signal,
        ...detail
      },
      cancelable
    })
  )
}

const world = mountWorld(worldContainer, {
  onFocus: focusTerminal,
  onPet(agent, event) {
    if (event.isTrusted) {
      preferences.arm(event)
      void careFor(agent, { type: 'pet' })
    }
  },
  onSpar(spar) {
    preferences.play('spar')
    publish('spar', spar)
  },
  onDrop: (drop) => publish('drop', drop),
  onWild: (visitor) => publish('wild', { visitor }),
  onMenu(menu) {
    if (publish('menu', menu, true)) {
      openActions(menu)
    }
  },
  onCommand: runCommand
})
const encounterContainer = document.querySelector('#encounters')
const encounters = mountEncounterGame(encounterContainer, {
  request: (name, input, scope) =>
    orca.plugin.request(name, input, { signal: scope ? AbortSignal.any([signal, scope]) : signal }),
  interactions: worldInteractions,
  world: worldContainer,
  onBattle: (battle) => world.update({ battle }),
  ...encounterSprites(loadCatalogSprite),
  onRare: (pick, scope) => void cry('cryRare', pick.dex, scope),
  onSettings: (patch) => preferences.patch(patch),
  signal
})
const preferences = bindWorldPreferences(orca, signal, (settings) => {
  const familyChanged = showFamily !== settings.family
  showFamily = settings.family
  world.update({ settings })
  encounters.update({ settings })
  if (familyChanged) {
    paintRoster()
  }
})

function careFor(agent, action, message) {
  const ref = progress.get(agent.id)?.ref
  if (
    !workspace?.terminals.has(agent.id) ||
    !ref ||
    ref.id !== agent.ref?.id ||
    ref.slot !== agent.ref.slot
  ) {
    return
  }
  return care(action, agent, workspace.scope.signal, [...workspace.terminals].slice(0, 50), message)
}

function runCommand(command, agent) {
  if (!publish('command', { command, agent }, true)) {
    return true
  }
  if (command === 'settings') {
    toggleSettings(settings.hidden)
    return true
  }
  if (command === 'bag') {
    void trainerGame.open('Bag')
    return true
  }
  if (command === 'open-picker' && agent?.ref) {
    void trainerGame.openPicker(agent)
    return true
  }
  return false
}

function selectView(party) {
  actions.hidePopover()
  worldContainer.hidden = party
  encounterContainer.hidden = party
  showActions.hidden = party
  herd.hidden = !party
  showWorld.setAttribute('aria-pressed', String(!party))
  showParty.setAttribute('aria-pressed', String(party))
  if (!workspace?.error) {
    showRosterStatus()
  }
}

function toggleSettings(open) {
  actions.hidePopover()
  void openSettingsPage(open)
}

function openActions({ agent, x, y, anchor }) {
  actions.hidePopover()
  menuRequest?.abort()
  const scope = workspace?.scope.signal
  const items = agent
    ? [['Focus terminal', (event) => void focusTerminal(agent, event)]]
    : ['Box', 'Bag', 'Shop', 'Research', 'Pokédex'].map((section) => [
        section,
        () => void trainerGame.open(section)
      ])
  if (agent?.ref) {
    items.push(
      [
        'Pet',
        (event) => {
          preferences.arm(event)
          void careFor(agent, { type: 'pet' })
        }
      ],
      ['Pokémon details', () => void trainerGame.openParty(agent.id)],
      ['Bring out from Box', () => void trainerGame.openBoxFor(agent.id)],
      ['Change Pokémon', () => runCommand('open-picker', agent)]
    )
  } else if (!agent) {
    items.push(...encounters.menuActions())
    if (workspace) {
      const choose = preferences.get().chooseMoves
      items.push([
        choose ? 'Choose moves automatically' : 'Choose moves manually',
        () => {
          void preferences.patch({ chooseMoves: !choose }).catch((error) => {
            careStatus.textContent = error.message
          })
        }
      ])
    }
    items.push(['Settings', () => toggleSettings(true)])
  }
  actions.setAttribute('aria-label', agent ? `${agent.species} actions` : 'World actions')
  actions.replaceChildren(
    ...items.map(([label, run]) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.onclick = (event) => {
        actions.hidePopover()
        if (event.isTrusted && !scope?.aborted) {
          run(event)
        }
      }
      return button
    })
  )
  if (!agent) {
    actions.append(
      ...encounters.captureControls(preferences.get(), (patch) => {
        if (scope?.aborted) {
          return
        }
        void preferences
          .patch(patch)
          .then(() => actions.hidePopover())
          .catch((error) => {
            careStatus.textContent = error.message
          })
      })
    )
  }
  const position = () => {
    actions.style.left = `${Math.max(4, Math.min(x, innerWidth - actions.offsetWidth - 4))}px`
    actions.style.top = `${Math.max(4, Math.min(y, innerHeight - actions.offsetHeight - 4))}px`
  }
  if (agent?.ref && scope && workspace) {
    menuRequest = new AbortController()
    const signal = AbortSignal.any([scope, menuRequest.signal])
    const content = document.createElement('div')
    content.className = 'companion-menu'
    const loading = document.createElement('small')
    loading.setAttribute('role', 'status')
    content.append(loading)
    actions.append(content)
    const spinner = setTimeout(() => {
      loading.textContent = 'Loading companion…'
    }, 200)
    void orca.plugin
      .request(
        'trainer.companion-menu',
        {
          terminalIds: [...workspace.terminals].slice(0, 50),
          target: agent.ref
        },
        { signal }
      )
      .then((menu) => {
        if (signal.aborted || !actions.matches(':popover-open')) {
          return
        }
        if (!menu) {
          loading.textContent = 'This companion changed.'
          return
        }
        renderCompanionMenu(content, menu, {
          signal,
          labels: new Map(
            roster.map(({ terminalId, title, agent }) => [terminalId, title || agent])
          ),
          onAction(action, message) {
            actions.hidePopover()
            void careFor(agent, action, message)
          },
          onMega() {
            actions.hidePopover()
            runCommand('open-picker', agent)
          },
          onTeach(card) {
            actions.hidePopover()
            void trainerGame.openCompanionMoves(card)
          }
        })
        position()
      })
      .catch(() => {
        if (!signal.aborted) {
          loading.textContent = 'Could not load companion actions.'
        }
      })
      .finally(() => clearTimeout(spinner))
  }
  actions.showPopover({ source: anchor.closest('button') ?? anchor })
  position()
  actions.firstElementChild.focus()
}

actions.addEventListener('beforetoggle', (event) => {
  if (event.newState === 'closed') {
    menuRequest?.abort()
  }
})

async function focusTerminal(agent, event) {
  const terminalId = agent.parentId ?? agent.id
  if (!event.isTrusted || !workspace?.terminals.has(terminalId)) {
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
        terminalId,
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

function paintCompanion(row, appearance, state, member, season) {
  const { dex } = appearance
  const current = species[dex]
  const [label, pose] = poses[state]
  row.dataset.state = state
  row.querySelector('.state').textContent = label
  paintCompanionArt(row.querySelector('.sprite'), appearance, pose, state === 'working', season)
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
  const children = []
  const stale = new Set(cards.keys())
  const { a, b, t } = seasonAt(new Date())
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
    const task = workspace?.terminals.has(agent.terminalId) ? agent.task?.title?.trim() : ''
    const caption = row.querySelector('.task')
    caption.textContent = task || ''
    caption.hidden = !task
    const member = progress.get(agent.terminalId)
    const starter = starterDex(agent)
    row.querySelector('.care').onclick = () => trainerGame.openParty(agent.terminalId)
    const appearance = member?.appearance ?? { dex: starter }
    paintCompanion(row, appearance, agent.state, member, t < 0.5 ? a : b)
    if (workspace?.terminals.has(agent.terminalId)) {
      entities.push({
        id: agent.terminalId,
        label,
        species: member?.name ?? species[member?.dex ?? starter]?.name,
        appearance,
        ref: member?.ref,
        hungry: member?.hungry,
        careNote: member?.careNote,
        evolvedAt: member?.evolvedAt,
        evolvedFrom: member?.evolvedFrom,
        state: agent.state,
        stateStartedAt: agent.stateStartedAt,
        leadWorking: agent.leadWorking,
        sameFolderRival: agent.sameFolderRival,
        task
      })
      if (showFamily && agent.children?.length) {
        const young = youngOf(appearance)
        for (const child of agent.children) {
          children.push({
            id: child.id,
            parentId: agent.terminalId,
            label,
            species: nameOf(young.dex),
            appearance: young,
            state: child.state,
            stateStartedAt: child.state === 'idle' ? undefined : child.startedAt
          })
        }
      }
    }
  }
  for (const key of stale) {
    const row = cards.get(key)
    disposeCompanionArt(row.querySelector('.sprite'))
    row.remove()
    cards.delete(key)
  }
  world.update({
    agents: [...entities, ...children],
    focusedId: workspace?.context.focusedTerminalId ?? null
  })
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
      world.update({ boosts: view.boosts })
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
  clearTimeout(current.agentRefresh)
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
      const previous = new Map(roster.map((agent) => [agent.terminalId, agent.state]))
      const seen = new Set()
      const next = agents.filter(({ terminalId }) => {
        if (!terminalId) {
          return true
        }
        if (seen.has(terminalId)) {
          return false
        }
        seen.add(terminalId)
        return true
      })
      if (current.error || JSON.stringify(next) !== JSON.stringify(roster)) {
        roster = next
        paintRoster()
      }
      for (const agent of roster) {
        if (!previous.has(agent.terminalId) || previous.get(agent.terminalId) === agent.state) {
          continue
        }
        const preference =
          agent.state === 'done'
            ? 'cryDone'
            : agent.state === 'blocked' || agent.state === 'waiting'
              ? 'cryBlocked'
              : null
        if (preference && !worldContainer.hidden) {
          void cry(
            preference,
            progress.get(agent.terminalId)?.dex ?? starterDex(agent),
            current.scope.signal
          )
        }
      }
      current.error = false
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
  if (
    !current.read.signal.aborted &&
    roster.some(({ state, task }) => state === 'working' || task)
  ) {
    current.agentRefresh = setTimeout(() => void readAgents(current), 5000)
  }
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
  clearTimeout(previous?.agentRefresh)
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
    careStatus.textContent = ''
    trainerGame.reset()
    roster = []
    progress = new Map()
    world.update({ agents: [], visitor: null, focusedId: undefined })
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
showActions.onclick = () => {
  if (actions.matches(':popover-open')) {
    actions.hidePopover()
    return
  }
  const { left, bottom } = showActions.getBoundingClientRect()
  openActions({ x: left, y: bottom, anchor: showActions })
}
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

mountHerdStrip(orca, worldContainer, signal)

let activationSubscription

function onWorkspaceChanged({ context }) {
  const prior = workspace?.context
  if (
    prior &&
    context &&
    prior.workspaceId === context.workspaceId &&
    prior.displayName === context.displayName &&
    prior.branch === context.branch &&
    prior.terminals.length === context.terminals.length &&
    prior.terminals.every(
      ({ id, title }, i) => id === context.terminals[i].id && title === context.terminals[i].title
    )
  ) {
    workspace.context = context
    world.update({ focusedId: context.focusedTerminalId ?? null })
    return
  }
  refresh(context)
  activationSubscription?.dispose()
  if (context && orca.plugin.onActivate) {
    activationSubscription = orca.plugin.onActivate(
      async ({ action, terminalId, workspaceId, input }) => {
        const origin = workspace
        if (!origin) {
          return
        }
        if (workspaceId && workspaceId !== origin.context.workspaceId) {
          if (origin.context.workspaceId || action === 'box' || action === 'care') {
            return
          }
        }
        if (action === 'bag') {
          runCommand('bag')
        } else if (action === 'pick') {
          await trainerGame.openPicker({ id: origin.terminals.has(terminalId) ? terminalId : null })
        } else if (action === 'care' || action === 'box') {
          const [term, slot, id] = input ?? []
          if (origin.terminals.has(term)) {
            await trainerGame.openCompanion(action === 'care' ? 'Party' : 'Box', term, { slot, id })
          }
        }
      },
      context.workspaceId
    )
  }
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
  orca.on('workspace.changed', onWorkspaceChanged)
]
window.addEventListener(
  'pagehide',
  () => {
    lifetime.abort()
    trainerGame.reset()
    focusRequest?.abort()
    workspace?.read.abort()
    clearTimeout(workspace?.agentRefresh)
    workspace?.scope.abort()
    activationSubscription?.dispose()
    for (const subscription of subscriptions) {
      subscription.dispose()
    }
    for (const row of cards.values()) {
      disposeCompanionArt(row.querySelector('.sprite'))
    }
    world.dispose()
  },
  { once: true }
)
