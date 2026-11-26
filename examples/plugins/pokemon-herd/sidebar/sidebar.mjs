// SPDX-License-Identifier: Apache-2.0
// Adapted for Orca from Pokémon Sidebar's lists, cards, menus and controls. See NOTICE.
import { choosePokemon } from './companion-picker.mjs'
import { agentGroups, groupsOf, projectKey, workspaceRows } from './navigation.mjs'
import { button, element, keyboardMenu, menu, popup } from './row-controls.mjs'
import { terminal } from './terminal-card.mjs'
import { workspaceView } from './workspace-view.mjs'

const { host, plugin } = window.orca
const byId = (id) => document.getElementById(id)
const list = byId('list')
const feedback = byId('feedback')
const confirm = byId('confirm')
const narrow = matchMedia('(width < 160px)')
const prefsKey = 'sidebar.preferences'
const defaults = {
  view: 'workspaces',
  sort: 'priority',
  rail: false,
  stacked: false,
  hidden: false,
  pins: []
}
let prefs = defaults
let index
let selected
let contextVersion = 0
let renameOrClose
let portraits
const readouts = new Map()
const failures = new Set()
const folded = new Set()
const pending = new Set()
let refreshIndex = false
let refreshAll = false
let refreshTimer
let refreshing = false
let save = Promise.resolve()

function announce(error) {
  feedback.textContent = typeof error === 'string' ? error : (error.detail ?? error.message)
}

async function invoke(method, params, after) {
  feedback.textContent = ''
  try {
    const value = await plugin.request(method, params)
    after?.(value)
  } catch (error) {
    announce(error)
  }
}

function readStorage(key) {
  return host.call('storage.get', { key }).then(({ value }) => value)
}

function writeStorage(key, value) {
  return host.call('storage.set', { key, value })
}

function setPrefs(update) {
  prefs = { ...prefs, ...update }
  const value = prefs
  save = save.catch(() => {}).then(() => writeStorage(prefsKey, value))
  void save.catch(announce)
  render()
}

function ask(title, { name, message = '', submit = 'Save', destructive = false }, action) {
  renameOrClose = action
  byId('confirm-title').textContent = title
  byId('confirm-message').textContent = message
  byId('confirm-error').textContent = ''
  byId('confirm-field').hidden = name === undefined
  byId('confirm-name').disabled = name === undefined
  byId('confirm-name').value = name ?? ''
  byId('submit').textContent = submit
  byId('submit').classList.toggle('destructive', destructive)
  confirm.showModal()
  if (name !== undefined) {
    byId('confirm-name').select()
  }
}

function workspaceActions(workspace, project) {
  const { id: workspaceId, projectId, hostId, name } = workspace
  const items = [
    [
      'Rename workspace',
      () =>
        ask('Rename workspace', { name }, (name) =>
          plugin.request('sidebar.renameWorkspace', { workspaceId, name })
        )
    ],
    [
      'New terminal',
      () => invoke('sidebar.newTerminal', { workspaceId }, () => schedule({ workspaceId }))
    ]
  ]
  if (project?.kind === 'git' && !project.hidden) {
    items.push([
      'New worktree',
      () =>
        ask(`New worktree in ${workspace.project}`, { name: '', submit: 'Create' }, (name) =>
          plugin.request(
            'sidebar.newWorkspace',
            { projectId, hostId, name },
            { timeoutMs: 120_000 }
          )
        )
    ])
  }
  if (scopedView.matches(workspace)) {
    items.push(...scopedView.accessItems(scopedView.current()))
  }
  if (project) {
    const hidden = !project.hidden
    items.push([
      hidden ? 'Hide project' : 'Show project',
      () =>
        invoke('sidebar.setProjectHidden', { projectId, hostId, hidden }, () =>
          schedule({ index: true })
        )
    ])
  }
  return items
}

function terminalActions(row) {
  const { terminalId, key, name, workspace, agent, pokemon } = row
  const items = [
    ['Focus terminal', () => focusTerminal(row)],
    [
      'New terminal in workspace',
      () =>
        invoke('sidebar.newTerminal', { workspaceId: workspace.id }, () =>
          schedule({ workspaceId: workspace.id })
        )
    ]
  ]
  if (index.activeWorkspace === workspace.id) {
    items.push([
      'Close terminal…',
      () =>
        ask(
          'Close terminal?',
          {
            message: `${name} and any process running in it will stop.`,
            submit: 'Close',
            destructive: true
          },
          () => plugin.request('sidebar.closeTerminal', { terminalId })
        )
    ])
  }
  if (agent) {
    const pinned = prefs.pins.includes(key)
    items.push([
      pinned ? 'Unpin agent' : 'Pin agent',
      () =>
        setPrefs({
          pins: pinned ? prefs.pins.filter((candidate) => candidate !== key) : [...prefs.pins, key]
        })
    ])
  }
  if (pokemon) {
    if (plugin.openPanel && index.activeWorkspace === workspace.id) {
      items.push(...scopedView.companionActions(workspace, terminalId, pokemon.ref))
    }
    items.push([
      'Choose another Pokémon…',
      () => choosePokemon(row, () => schedule({ workspaceId: workspace.id })).catch(announce)
    ])
  }
  return items
}

function focusTerminal(row) {
  return invoke('sidebar.focusTerminal', { terminalId: row.terminalId }, ({ focused }) => {
    if (!focused) {
      announce('Orca could not focus this terminal.')
      return
    }
    selected = row.key
    schedule({ index: true, workspaceId: row.workspace.id })
  })
}

function terminalRow(row, rail, showWorkspace = false) {
  return terminal(row, {
    rail,
    showWorkspace,
    current: selected === row.key && index.activeWorkspace === row.workspace.id,
    signal: portraits.signal,
    focus: () => focusTerminal(row),
    actions: () => terminalActions(row)
  })
}

function workspaceSection(workspace, rows, project, rail, query) {
  const scope = scopedView.forWorkspace(workspace)
  const current = Boolean(scope) || workspace.id === index.activeWorkspace
  const section = element('section')
  const title = button('', () =>
    invoke('sidebar.openWorkspace', { workspaceId: workspace.id }, () => {
      schedule({ index: true, workspaceId: workspace.id })
    })
  )
  title.title = [
    workspace.project !== workspace.name ? workspace.project : null,
    workspace.name,
    workspace.branch !== workspace.name ? workspace.branch : null,
    workspace.hostId === 'local' ? '' : workspace.hostId
  ]
    .filter(Boolean)
    .join(' · ')
  title.dataset.control = workspace.id
  if (current) {
    title.setAttribute('aria-current', 'true')
  }
  const openActions = (event) => {
    event.preventDefault()
    popup(title, workspaceActions(workspace, project), event.clientX, event.clientY)
  }
  if (rail) {
    const label =
      workspace.name === workspace.branch ? (workspace.project ?? workspace.name) : workspace.name
    title.textContent = label.slice(0, 1).toUpperCase()
    title.className = 'rail-workspace'
    title.dataset.current = String(current)
    title.setAttribute('aria-label', title.title)
    title.oncontextmenu = openActions
    keyboardMenu(title, () => workspaceActions(workspace, project))
    section.append(title)
  } else {
    const wrapper = element('div', '', 'workspace-row')
    wrapper.dataset.current = String(current)
    const label = element('span', '', 'workspace-label')
    label.append(element('strong', workspace.name, 'ellipsis'))
    if (workspace.branch && workspace.branch !== workspace.name) {
      label.append(element('span', workspace.branch, 'meta ellipsis'))
    }
    if (project?.hidden) {
      label.append(element('span', 'Hidden', 'meta'))
    }
    title.append(label)
    wrapper.append(title)
    menu(
      wrapper,
      `Actions for ${workspace.name}`,
      () => workspaceActions(workspace, project),
      workspace.id
    )
    section.append(wrapper)
  }
  if (scope) {
    section.append(scopedView.content(scope, rail, query))
  }
  if (rows.length) {
    const nested = element('div', '', 'terminal-list')
    nested.append(...rows.map((row) => terminalRow(row, rail)))
    section.append(nested)
  }
  if (!rail && failures.has(workspace.id)) {
    section.append(element('p', 'Could not read terminals and agents.', 'meta'))
  } else if (!rail && readouts.get(workspace.id)?.truncated) {
    section.append(element('p', 'Some terminals are outside the listing limit.', 'meta'))
  }
  return section
}

function disclosure(key, label, children) {
  const group = element('details')
  const summary = element('summary', label)
  summary.dataset.control = key
  group.open = !folded.has(key)
  group.append(summary, ...children)
  group.ontoggle = () => {
    if (group.isConnected) {
      if (group.open) {
        folded.delete(key)
      } else {
        folded.add(key)
      }
    }
  }
  return group
}

function render() {
  const rail = narrow.matches || prefs.rail
  document.body.dataset.rail = String(rail)
  byId('rail').textContent = rail ? 'Expand' : 'Collapse'
  byId('rail').setAttribute('aria-pressed', String(rail))
  byId('stacked').checked = prefs.stacked
  byId('hidden-projects').checked = prefs.hidden
  byId('sort').value = prefs.sort
  byId('workspaces').setAttribute('aria-pressed', String(prefs.view === 'workspaces'))
  byId('agents').setAttribute('aria-pressed', String(prefs.view === 'agents'))
  document.querySelector('nav').hidden = prefs.stacked
  byId('agent-filters').hidden = !prefs.stacked && prefs.view !== 'agents'
  if (!index) {
    return
  }
  const oldFocus =
    document.hasFocus() && list.contains(document.activeElement)
      ? document.activeElement.dataset.control
      : null
  const previousScroll = list.scrollTop
  portraits?.abort()
  portraits = new AbortController()

  const query = rail ? '' : byId('search').value.trim().toLocaleLowerCase()
  const status = byId('status').value
  const projects = new Map(index.projects.map((p) => [projectKey(p.id, p.hostId), p]))
  const projectFor = (w) => projects.get(projectKey(w.projectId, w.hostId))
  const workspaces = index.workspaces.filter((w) => prefs.hidden || !projectFor(w)?.hidden)
  const matches = (...labels) =>
    !query || labels.some((label) => label?.toLocaleLowerCase().includes(query))
  const scope = scopedView.current()
  const rooms = workspaces.map((workspace) => ({
    workspace,
    matches: matches(workspace.name, workspace.branch, workspace.project),
    rows: workspaceRows(workspace, readouts.get(workspace.id))
  }))
  const allAgents = rooms.flatMap(({ rows }) => rows.filter((row) => row.agent))
  byId('count').textContent = String(allAgents.length)
  const contents = document.createDocumentFragment()
  const showWorkspaces = rail || prefs.stacked || prefs.view === 'workspaces'
  if (showWorkspaces) {
    if (!rail && prefs.stacked) {
      contents.append(element('h2', 'Workspaces', 'group-title'))
    }
    const pinned =
      !rail && !prefs.stacked
        ? allAgents.filter(
            (row) =>
              prefs.pins.includes(row.key) &&
              matches(row.name, row.workspace.name, row.workspace.project, row.pokemon?.name)
          )
        : []
    const pinnedKeys = new Set(pinned.map((row) => row.key))
    if (pinned.length) {
      contents.append(
        disclosure(
          'workspaces:pinned',
          'Pinned',
          pinned.map((row) => terminalRow(row, false, true))
        )
      )
    }
    if (scope && !workspaces.some(scopedView.matches)) {
      contents.append(scopedView.standalone(scope, rail, query))
    }
    const visible = rooms.flatMap(({ workspace, matches: workspaceMatches, rows }) => {
      const selected = workspaceMatches
        ? rows
        : rows.filter((r) => matches(r.name, r.pokemon?.name))
      const scopedTabMatches =
        scopedView.matches(workspace) && scope.tabs.some((tab) => matches(tab.title))
      return workspaceMatches || selected.length || scopedTabMatches
        ? [{ workspace, rows: selected }]
        : []
    })
    const draw = ({ workspace, rows }) =>
      workspaceSection(
        workspace,
        rows.filter((row) => !pinnedKeys.has(row.key)),
        projectFor(workspace),
        rail,
        query
      )
    if (rail) {
      const stack = element('div', '', 'rail-list')
      stack.append(...visible.map(draw))
      contents.append(stack)
    } else {
      const remote = workspaces.some((w) => w.hostId !== 'local')
      const groups = groupsOf(visible, ({ workspace: w }) => [
        projectKey(w.projectId, w.hostId),
        [remote && (w.hostId === 'local' ? 'Local' : w.hostId), w.project]
          .filter(Boolean)
          .join(' · ')
      ])
      for (const { key, label, rows } of groups) {
        const entries = rows.map(draw)
        contents.append(...(label ? [disclosure(`workspace:${key}`, label, entries)] : entries))
      }
    }
    if (!visible.length) {
      contents.append(
        element(
          'p',
          workspaces.length ? 'No matching workspaces.' : 'No visible workspaces.',
          'meta'
        )
      )
    }
  }
  if (!rail && (prefs.stacked || prefs.view === 'agents')) {
    if (prefs.stacked) {
      contents.append(element('h2', 'Agents', 'group-title'))
    }
    const filtered = allAgents.filter(
      (r) =>
        (!status || status === r.agent.state) &&
        matches(r.name, r.workspace.name, r.workspace.project, r.agent.agent, r.pokemon?.name)
    )
    for (const { key, label, rows } of agentGroups(filtered, prefs.sort, prefs.pins)) {
      contents.append(
        disclosure(
          `agents:${prefs.sort}:${key}`,
          `${label ?? 'Project'} · ${rows.length}`,
          rows.map((r) => terminalRow(r, false, true))
        )
      )
    }
    if (!filtered.length) {
      contents.append(
        element(
          'p',
          refreshing && !allAgents.length ? 'Loading agents…' : 'No matching agents.',
          'meta'
        )
      )
    }
  }
  list.replaceChildren(contents)
  list.scrollTop = previousScroll
  if (oldFocus) {
    list.querySelector(`[data-control="${CSS.escape(oldFocus)}"]`)?.focus({ preventScroll: true })
  }
}

function schedule({ workspaceId, index: updateIndex = false, all = false } = {}) {
  refreshIndex ||= updateIndex
  refreshAll ||= all
  if (workspaceId) {
    pending.add(workspaceId)
  }
  if (!refreshing && !refreshTimer) {
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined
      void update()
    }, 60)
  }
}

async function update() {
  refreshing = true
  list.setAttribute('aria-busy', 'true')
  try {
    while (refreshIndex || refreshAll || pending.size) {
      const reloadIndex = refreshIndex
      const all = refreshAll
      const requested = new Set(pending)
      refreshAll = refreshIndex = false
      pending.clear()
      if (reloadIndex || !index) {
        const version = contextVersion
        const next = await plugin.request('sidebar.workspaces')
        if (index && version !== contextVersion) {
          next.activeWorkspace = index.activeWorkspace
        }
        index = next
        if (index.activeWorkspace) {
          requested.add(index.activeWorkspace)
        }
        const known = new Set(index.workspaces.map(({ id }) => id))
        for (const id of readouts.keys()) {
          if (!known.has(id)) {
            readouts.delete(id)
            failures.delete(id)
          }
        }
        render()
      }
      const known = index.workspaces.map(({ id }) => id)
      const ids = known.filter(
        (id) => all || requested.has(id) || (!readouts.has(id) && !failures.has(id))
      )
      ids.sort((a, b) => Number(b === index.activeWorkspace) - Number(a === index.activeWorkspace))
      for (let start = 0; start < ids.length; start += 4) {
        await Promise.all(
          ids.slice(start, start + 4).map(async (workspaceId) => {
            try {
              readouts.set(workspaceId, await plugin.request('sidebar.workspace', { workspaceId }))
              failures.delete(workspaceId)
            } catch {
              failures.add(workspaceId)
            }
          })
        )
        render()
      }
    }
    const notices = []
    if (index?.truncated) {
      notices.push('Some workspaces or projects are outside the listing limit.')
    }
    if (failures.size) {
      notices.push('Some terminals and agents could not be read. Refresh to retry.')
    }
    if ([...readouts.values()].some((data) => data.companions === null)) {
      notices.push('Could not read the trainer save.')
    }
    announce(notices.join(' '))
  } catch (error) {
    announce(error)
  } finally {
    refreshing = false
    list.setAttribute('aria-busy', 'false')
    render()
    if (refreshIndex || refreshAll || pending.size) {
      schedule()
    }
  }
}

byId('confirm-form').onsubmit = async (event) => {
  event.preventDefault()
  const submit = byId('submit')
  const cancel = byId('cancel')
  submit.disabled = cancel.disabled = true
  try {
    await renameOrClose(byId('confirm-name').value)
    confirm.close()
    schedule({ index: true, all: true })
  } catch (error) {
    byId('confirm-error').textContent = error.detail ?? error.message
  } finally {
    submit.disabled = cancel.disabled = false
  }
}
confirm.addEventListener('cancel', (event) => {
  if (byId('submit').disabled) {
    event.preventDefault()
  }
})
byId('cancel').onclick = () => confirm.close()
byId('rail').onclick = () => setPrefs({ rail: !prefs.rail })
byId('workspaces').onclick = () => setPrefs({ view: 'workspaces' })
byId('agents').onclick = () => setPrefs({ view: 'agents' })
byId('sort').onchange = (event) => setPrefs({ sort: event.target.value })
byId('status').onchange = render
byId('search').oninput = render
byId('stacked').onchange = (event) => setPrefs({ stacked: event.target.checked })
byId('hidden-projects').onchange = (event) => setPrefs({ hidden: event.target.checked })
byId('refresh').onclick = () => {
  schedule({ index: true, all: true })
  scopedView.refresh()
}
byId('hide-sidebar').onclick = () => {
  byId('preferences').hidePopover()
  void invoke('sidebar.toggleRightSidebar')
}
narrow.addEventListener('change', render)
setInterval(() => {
  if (!byId('actions').matches(':popover-open') && !confirm.open) {
    render()
  }
}, 30_000)

const scopedView = workspaceView({ onChange: render, announce, ask })

try {
  const stored = await readStorage(prefsKey)
  prefs = { ...defaults, ...stored }
  if (!['priority', 'workspace', 'project', 'prefix'].includes(prefs.sort)) {
    prefs.sort = defaults.sort
  }
  if (!Array.isArray(prefs.pins)) {
    prefs.pins = []
  }
} catch (error) {
  announce(error)
}

window.orca.on('workspace.changed', ({ context }) => {
  const workspaceId = context?.workspaceId ?? null
  if (workspaceId || !context) {
    contextVersion++
    if (index) {
      index.activeWorkspace = workspaceId
    }
  }
  schedule({ index: true, workspaceId })
})
for (const event of ['workspace.created', 'workspace.removed']) {
  window.orca.on(event, () => schedule({ index: true }))
}
window.orca.on('agent.status.changed', ({ workspaceListId, workspaceId }) => {
  schedule({ workspaceId })
  if (workspaceListId && workspaceListId !== workspaceId) {
    schedule({ workspaceId: workspaceListId })
  }
})
plugin.on('trainer.changed', () => {
  for (const [workspaceId, data] of readouts) {
    if (data.agents.length || data.companions?.length) {
      pending.add(workspaceId)
    }
  }
  schedule()
})
schedule({ index: true, all: true })
