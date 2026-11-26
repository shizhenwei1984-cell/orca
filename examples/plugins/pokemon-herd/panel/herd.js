const species = [
  { name: 'Pikachu', walk: 4, idle: 6 },
  { name: 'Bulbasaur', walk: 6, idle: 3 },
  { name: 'Charmander', walk: 4, idle: 4 },
  { name: 'Squirtle', walk: 4, idle: 8 }
]
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
let revision = 0
let context
let terminals = new Set()
const companions = new Map()

function speciesFor(agent) {
  let hash = 0
  for (const char of agent.sessionId || agent.terminalId || agent.agent || 'Pokémon') {
    hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0
  }
  return species[hash % species.length]
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

function addAgent(agent) {
  const row = template.content.firstElementChild.cloneNode(true)
  const pokemon = speciesFor(agent)
  const title = agent.title || agent.agent || 'Agent'
  const name = row.querySelector('strong')
  name.textContent = name.title = title
  row.querySelector('small').textContent = pokemon.name
  updatePose(row, pokemon, agent.state)
  if (agent.terminalId) {
    companions.set(agent.terminalId, { row, pokemon })
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
    updatePose(companion.row, companion.pokemon, event.state)
  } else {
    addAgent(event)
  }
}

// Events received during a snapshot also apply to its result.
let pendingStates = null
async function refresh(nextContext) {
  const version = ++revision
  context = nextContext
  terminals = new Set(context?.terminals.map((terminal) => terminal.id))
  heading.textContent = context?.displayName || 'Pokémon Herd'
  retry.hidden = true
  herd.replaceChildren()
  companions.clear()
  pendingStates = null
  updateCount()
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
    pendingStates.set(event.terminalId, event)
  } else {
    applyStatus(event)
    updateCount()
  }
})
void readContext()
