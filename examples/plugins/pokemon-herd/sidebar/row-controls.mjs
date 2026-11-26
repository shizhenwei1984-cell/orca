// SPDX-License-Identifier: Apache-2.0
// Adapted for Orca from Pokémon Sidebar’s card menus. See NOTICE.
const actions = document.getElementById('actions')

export function element(tag, text = '', className = '') {
  const node = document.createElement(tag)
  node.textContent = text
  if (className) {
    node.className = className
  }
  return node
}

export function button(label, click, className) {
  const node = element('button', label, className)
  node.type = 'button'
  node.onclick = click
  return node
}

export function popup(anchor, rows, x, y) {
  if (actions.matches(':popover-open')) {
    actions.hidePopover()
  }
  const rect = anchor.getBoundingClientRect()
  actions.replaceChildren(
    ...rows.map(([label, action]) =>
      button(label, () => {
        actions.hidePopover()
        void action()
      })
    )
  )
  actions.style.left = '0px'
  actions.style.top = '0px'
  actions.showPopover()
  const { width, height } = actions.getBoundingClientRect()
  actions.style.left = `${Math.max(4, Math.min(x ?? rect.left, innerWidth - width - 4))}px`
  actions.style.top = `${Math.max(4, Math.min(y ?? rect.bottom, innerHeight - height - 4))}px`
  actions.firstElementChild.focus({ preventScroll: true })
}

export function menu(row, label, getItems, key) {
  const trigger = button('⋯', () => popup(trigger, getItems()))
  trigger.setAttribute('aria-label', label)
  trigger.setAttribute('aria-haspopup', 'true')
  trigger.dataset.control = `menu:${key}`
  row.oncontextmenu = (event) => {
    event.preventDefault()
    popup(trigger, getItems(), event.clientX, event.clientY)
  }
  row.append(trigger)
}

export function keyboardMenu(control, items) {
  control.onkeydown = (event) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault()
      popup(control, items())
    }
  }
}
