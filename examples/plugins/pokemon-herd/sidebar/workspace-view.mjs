import { button, element, keyboardMenu, menu, popup } from './row-controls.mjs'

const { host, shell } = window.orca
const method = 'workspace.view'
const names = { chat: 'Chat', editor: 'Editor', terminal: 'Terminal tab' }
const glyphs = { chat: 'C', editor: 'E', terminal: 'T' }
const reviewNames = {
  open: 'Open',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed',
  loading: 'Loading review…',
  unavailable: 'Review unavailable'
}

export function workspaceView({ onChange, announce, ask }) {
  let view = null
  let revision = 0
  const available = host.has(method)
  const read = async (reset) => {
    const current = ++revision
    if (reset) {
      view = null
      onChange()
    }
    try {
      const next = await host.call(method)
      if (current === revision) {
        view = next
        onChange()
      }
    } catch {
      if (current === revision && view) {
        view = null
        onChange()
      }
    }
  }
  const invoke = (method, params) => host.call(method, params).then(() => read(false), announce)

  if (available) {
    window.orca.on('workspace.viewChanged', ({ reset }) => void read(reset))
    void read(false)
  }

  function accessItems(scoped) {
    const { workspace, grant } = scoped
    const items = [
      [
        grant ? 'Change workspace access…' : 'Allow workspace access…',
        () => invoke('workspace.viewAccess', { workspace })
      ]
    ]
    if (grant) {
      items.push([
        'Remove workspace access…',
        () => invoke('workspace.viewAccess', { workspace, revoke: true })
      ])
    }
    return items
  }

  function row(scoped, tab, rail) {
    const { workspace, selected, grant } = scoped
    const target = { workspace, tab: tab.id }
    const active = tab.id === selected
    const select = () => invoke('workspace.selectTab', target)
    const label = `${names[tab.type]} · ${tab.title}`
    const item = element('div', '', rail ? 'workspace-tab compact' : 'workspace-tab')
    const control = button(rail ? glyphs[tab.type] : tab.title, select, 'ellipsis')
    control.dataset.control = tab.id
    control.title = label
    control.setAttribute('aria-label', label)
    if (active) {
      control.setAttribute('aria-current', 'true')
    }
    item.dataset.current = String(active)
    item.append(control)
    if (grant === 'rename' && tab.type !== 'editor') {
      const items = () => [
        ['Select tab', select],
        [
          'Rename tab…',
          () =>
            ask('Rename tab', { name: tab.title }, (title) =>
              host.call('workspace.renameTab', { ...target, title })
            )
        ]
      ]
      if (rail) {
        control.oncontextmenu = (event) => {
          event.preventDefault()
          popup(control, items(), event.clientX, event.clientY)
        }
        keyboardMenu(control, items)
      } else {
        menu(item, `Actions for ${label}`, items, tab.id)
      }
    }
    return item
  }

  function review(scoped, rail) {
    const { git, workspace } = scoped
    const status = git.review
    const label = status.number
      ? `${status.provider === 'gitlab' ? 'MR' : 'PR'} #${status.number} · ${reviewNames[status.state]}`
      : reviewNames[status.state]
    const item = element('div', '', 'workspace-review')
    const refresh = () => invoke('workspace.refreshReview', { workspace })
    const open = () => shell.openExternal(status.url).catch(announce)
    if (status.url && shell?.openExternal) {
      const link = button(rail ? `#${status.number}` : label, open)
      link.title = label
      link.setAttribute('aria-label', label)
      link.dataset.control = 'workspace-review-link'
      item.append(link)
    } else {
      item.append(element('span', rail ? 'PR' : label, 'meta'))
      item.title = label
    }
    const retry = button('↻', refresh)
    retry.dataset.control = 'workspace-review-refresh'
    retry.title = 'Refresh review status'
    retry.setAttribute('aria-label', retry.title)
    retry.disabled = status.refreshing
    item.append(retry)
    return item
  }

  function standalone(scoped, rail, query) {
    const active = element('section', '', 'standalone-workspace-view')
    if (!rail) {
      const heading = element('div', '', 'workspace-row')
      heading.append(element('strong', 'Active workspace', 'meta'))
      menu(heading, 'Active workspace access', () => accessItems(scoped), 'active-scope')
      active.append(heading)
    } else if (scoped.grant) {
      const access = button('⋯', () => popup(access, accessItems(scoped)))
      access.dataset.control = 'active-scope'
      access.setAttribute('aria-label', 'Active workspace access')
      active.append(access)
    }
    active.append(content(scoped, rail, query))
    return active
  }

  function content(scoped, rail, query = '') {
    const list = element('div', '', rail ? 'workspace-view compact' : 'workspace-view')
    if (!scoped.grant) {
      const [label, open] = accessItems(scoped)[0]
      const allow = button(rail ? '⋯' : label, open)
      allow.title = label
      allow.setAttribute('aria-label', label)
      allow.dataset.control = 'workspace-view-access'
      list.append(allow)
      return list
    }
    if (scoped.git) {
      if (!rail && scoped.git.checkout === 'detached') {
        list.append(element('span', 'Detached HEAD', 'meta'))
      }
      const upstream = scoped.git.upstream
      if (upstream?.ahead || upstream?.behind) {
        const counts = element(
          'span',
          [upstream.ahead && `↑${upstream.ahead}`, upstream.behind && `↓${upstream.behind}`]
            .filter(Boolean)
            .join(' '),
          'meta'
        )
        counts.setAttribute('aria-label', `${upstream.ahead} ahead, ${upstream.behind} behind`)
        list.append(counts)
      }
      list.append(review(scoped, rail))
    }
    for (const tab of scoped.tabs) {
      if (!query || tab.title.toLocaleLowerCase().includes(query)) {
        list.append(row(scoped, tab, rail))
      }
    }
    if (!rail && scoped.truncated) {
      list.append(element('span', 'Some tabs are outside the listing limit.', 'meta'))
    }
    return list
  }

  const matches = (workspace) =>
    view?.workspaceId === workspace.id && view.hostId === workspace.hostId
  return {
    refresh: () => available && void read(false),
    activationTarget: (workspace) =>
      view?.grant && !view.workspaceId && view.hostId === workspace.hostId
        ? view.workspace
        : workspace.id,
    forWorkspace: (workspace) => (matches(workspace) ? view : null),
    current: () => view,
    matches,
    accessItems,
    content,
    standalone
  }
}
