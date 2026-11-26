import { species, starterDex } from './pokemon.mjs'

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
let revision = 0
let context
let agentReadFailed = false
let terminals = new Set()
const companions = new Map()
let progress = new Map()
let readingProgress = false
let progressDirty = false

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
  sprite.style.backgroundImage = `url('./sprites/${pokemon.name.toLowerCase()}-${pose}.png')`
  sprite.style.setProperty('--frames', pose === 'sleep' ? 2 : pokemon[pose])
  sprite.style.setProperty('--duration', duration)
}

function paintCompanion({ row, starter, state }, member) {
  const dex = member?.dex ?? starter
  const current = species[dex]
  updatePose(row, species[member?.starter ?? starter], state)
  row.querySelector('small').textContent = current.name
  row.querySelector('.progress').hidden = !member
  if (member) {
    const reward = member.lastReward ? ` · +₽${number.format(member.lastReward)} last job` : ''
    row.querySelector('.career').textContent =
      `${jobCount(member.jobs)} · ${duration(member.workMs)} worked${reward}`
    const evolution = current.evolution
    const next = evolution?.jobs
      ? ` · ${member.stageJobs}/${evolution.jobs} to ${species[evolution.dex].name}`
      : evolution?.item
        ? ` · Evolves with a ${evolution.item}`
        : ''
    row.querySelector('.growth').textContent = `Friendship ${member.friendship}/100${next}`
  }
}

function addAgent(agent) {
  const row = template.content.firstElementChild.cloneNode(true)
  const companion = {
    row,
    starter: starterDex(agent),
    state: agent.state,
    lastAt: agent.receivedAt ?? 0
  }
  const title = agent.title || agent.agent || 'Agent'
  const name = row.querySelector('strong')
  name.textContent = name.title = title
  paintCompanion(companion, progress.get(agent.terminalId))
  if (agent.terminalId) {
    companions.set(agent.terminalId, companion)
  }
  herd.append(row)
}

function updateCount() {
  const size = herd.childElementCount
  count.textContent = size ? `${size} ${size === 1 ? 'agent' : 'agents'}` : ''
  message.hidden = size > 0
  if (!size) {
    message.textContent = context
      ? 'Start a terminal agent in this workspace to meet its Pokémon.'
      : 'Open a workspace to see its Pokémon.'
  }
}

function applyStatus(event) {
  const companion = companions.get(event.terminalId)
  if (companion) {
    if (event.receivedAt > companion.lastAt) {
      companion.lastAt = event.receivedAt
      companion.state = event.state
      paintCompanion(companion, progress.get(event.terminalId))
    }
  } else {
    addAgent(event)
  }
}

async function readProgress() {
  progressDirty = true
  if (readingProgress) {
    return
  }
  readingProgress = true
  while (progressDirty) {
    progressDirty = false
    const version = revision
    try {
      const view = await window.orca.plugin.request('trainer.read', { terminalIds: [...terminals] })
      if (version !== revision) {
        continue
      }
      wallet.textContent = `₽${number.format(view.money)}`
      work.textContent = `${jobCount(view.jobs)} · ${duration(view.ms)} worked`
      candy.textContent = `${number.format(view.candy)} Rare Candy`
      candy.hidden = view.candy === 0
      trainer.hidden = false
      progressError.hidden = true
      retry.hidden = !agentReadFailed
      progress = new Map(view.companions.map((member) => [member.terminalId, member]))
      for (const [id, companion] of companions) {
        paintCompanion(companion, progress.get(id))
      }
    } catch (error) {
      if (version === revision) {
        progressError.hidden = false
        progressError.textContent = `Could not read trainer progress. ${error.message}`
        retry.hidden = false
      }
    }
  }
  readingProgress = false
}

// Events received during a snapshot also apply to its result.
let pendingStates = null
async function refresh(nextContext) {
  const version = ++revision
  context = nextContext
  terminals = new Set(context?.terminals.map((terminal) => terminal.id))
  heading.textContent = context?.displayName || 'Pokémon Herd'
  agentReadFailed = false
  retry.hidden = progressError.hidden
  herd.replaceChildren()
  companions.clear()
  progress.clear()
  pendingStates = null
  updateCount()
  void readProgress()
  if (!context) {
    return
  }
  message.textContent = 'Loading agents…'
  const changes = new Map()
  pendingStates = changes
  try {
    const { agents } = await window.orca.host.call(
      'agents.list',
      context.workspaceId ? { workspaceId: context.workspaceId } : {}
    )
    if (version !== revision) {
      return
    }
    for (const agent of agents) {
      addAgent(agent)
    }
    for (const event of changes.values()) {
      applyStatus(event)
    }
    updateCount()
  } catch (error) {
    if (version === revision) {
      showError(error)
    }
  } finally {
    if (version === revision) {
      pendingStates = null
    }
  }
}

function showError(error) {
  agentReadFailed = true
  message.hidden = false
  message.textContent = `Could not read agents. ${error.message}`
  retry.hidden = false
}

async function readContext() {
  const version = revision
  try {
    const current = await window.orca.host.call('workspace.readContext')
    if (version === revision) {
      await refresh(current)
    }
  } catch (error) {
    if (version === revision) {
      showError(error)
    }
  }
}

retry.onclick = readContext
window.orca.plugin.on('trainer.changed', readProgress)
window.orca.on('workspace.changed', ({ context }) => refresh(context))
window.orca.on('agent.status.changed', (event) => {
  if (!context) {
    return
  }
  const knownWorkspace = context.workspaceId && context.workspaceId === event.workspaceListId
  if (!knownWorkspace && !terminals.has(event.terminalId)) {
    return
  }
  if (!event.terminalId) {
    if (!pendingStates) {
      void refresh(context)
    }
    return
  }
  if (pendingStates) {
    if (!(pendingStates.get(event.terminalId)?.receivedAt >= event.receivedAt)) {
      pendingStates.set(event.terminalId, event)
    }
  } else {
    applyStatus(event)
    updateCount()
  }
})
void readContext()
