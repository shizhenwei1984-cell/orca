const ARROWS = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1]
}

export function bindWorldInput(root, options, actions, signal) {
  let pointer
  let held
  let suppressClick = false
  const buttons = new WeakMap()
  const from = (target) => buttons.get(target.closest?.('.pokemon-world__actor'))
  const anchorFor = (actor) => (actor ? (actor.tag.hidden ? actor.body : actor.tag) : root)

  function menu(actor, x, y) {
    const anchor = anchorFor(actor)
    const rect = anchor.getBoundingClientRect()
    options.onMenu?.({
      agent: actor?.button.dataset.kind === 'agent' ? actor.entity : null,
      visitor: actor?.button.dataset.kind === 'visitor' ? actor.entity : null,
      x: x ?? rect.left,
      y: y ?? rect.bottom,
      anchor
    })
  }

  function menuAfterRelease(actor, x, y) {
    setTimeout(() => {
      if (!signal.aborted && root.isConnected && (!actor || root.contains(actor.button))) {
        menu(actor, x, y)
      }
    }, 0)
  }

  function finish(event, commit) {
    if (!pointer || event.pointerId !== pointer.id) {
      return
    }
    clearTimeout(held)
    const { actor, dragged, id, button, flips, menu: heldForMenu, x, y } = pointer
    pointer = null
    if (button.hasPointerCapture(id)) {
      button.releasePointerCapture(id)
    }
    if (heldForMenu && commit) {
      menuAfterRelease(actor, x, y)
    } else if (dragged) {
      suppressClick = true
      actions.drop(actor, event, flips, commit)
    }
  }

  root.addEventListener(
    'pointerdown',
    (event) => {
      if (pointer && !root.contains(pointer.button)) {
        clearTimeout(held)
        pointer = null
      }
      if (event.button !== 0 || !event.isPrimary || pointer) {
        return
      }
      const actor = from(event.target)
      suppressClick = false
      const button = actor?.button ?? root
      pointer = {
        id: event.pointerId,
        button,
        actor,
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        direction: 0,
        flips: []
      }
      if (actor || event.pointerType === 'touch') {
        button.setPointerCapture(event.pointerId)
      }
      if (event.pointerType === 'touch' && options.onMenu) {
        held = setTimeout(() => {
          if (!pointer || pointer.dragged || !root.contains(pointer.button)) {
            return
          }
          suppressClick = true
          pointer.menu = true
        }, 550)
      }
    },
    { signal }
  )

  root.addEventListener(
    'pointermove',
    (event) => {
      const actor = from(event.target)
      if (actor && !pointer && event.pointerType === 'mouse') {
        actions.hover(actor, event.clientX)
      }
      if (!pointer || pointer.menu || event.pointerId !== pointer.id) {
        return
      }
      const distance = Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y)
      if (distance >= 7) {
        clearTimeout(held)
      }
      if (pointer.actor?.button.dataset.kind !== 'agent' || (distance < 7 && !pointer.dragged)) {
        return
      }
      pointer.dragged = true
      const dx = event.clientX - pointer.lastX
      if (Math.abs(dx) >= 3) {
        const direction = Math.sign(dx)
        if (pointer.direction !== 0 && direction !== pointer.direction) {
          pointer.flips.push(actions.now())
        }
        pointer.direction = direction
        pointer.lastX = event.clientX
      }
      actions.drag(pointer.actor, event)
    },
    { signal }
  )

  root.addEventListener(
    'pointerout',
    (event) => {
      if (from(event.target) !== from(event.relatedTarget ?? root)) {
        actions.hover(null)
      }
      if (
        pointer?.button === root &&
        !root.hasPointerCapture(pointer.id) &&
        !root.contains(event.relatedTarget)
      ) {
        finish(event, false)
      }
    },
    { signal }
  )
  root.addEventListener('pointerup', (event) => finish(event, true), { signal })
  root.addEventListener('pointercancel', (event) => finish(event, false), { signal })
  root.addEventListener('lostpointercapture', (event) => finish(event, false), { signal })
  root.addEventListener(
    'click',
    (event) => {
      if (suppressClick && event.detail > 0) {
        suppressClick = false
        return
      }
      const actor = from(event.target)
      if (actor?.button.dataset.kind === 'visitor') {
        options.onWild?.(actor.entity)
      } else if (actor) {
        actions.activate(actor, event)
      }
    },
    { signal }
  )
  root.addEventListener(
    'contextmenu',
    (event) => {
      if (!options.onMenu) {
        return
      }
      event.preventDefault()
      if (pointer?.menu) {
        return
      }
      const actor = from(event.target)
      const { clientX, clientY } = event
      const open = () => menuAfterRelease(actor, clientX, clientY)
      // Opening before pointerup lets the same right click dismiss the popover.
      if (event.buttons & 2) {
        root.ownerDocument.addEventListener('pointerup', open, { signal, once: true })
      } else {
        open()
      }
    },
    { signal }
  )

  root.addEventListener(
    'keydown',
    (event) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey) {
        return
      }
      const actor = from(event.target)
      const key = event.key.toLowerCase()
      if (event.altKey) {
        const command = key === 'b' ? 'bag' : key === 'p' ? 'open-picker' : null
        if (
          event.shiftKey &&
          !event.repeat &&
          command &&
          options.onCommand?.(command, actor?.entity) === true
        ) {
          event.preventDefault()
        }
        return
      }
      if (
        options.onMenu &&
        (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
      ) {
        event.preventDefault()
        menu(actor)
      } else if (ARROWS[event.key]) {
        event.preventDefault()
        actions.navigate(actor, ...ARROWS[event.key])
      } else if (key === 'p' && actor?.button.dataset.kind === 'agent') {
        event.preventDefault()
        if (!event.repeat) {
          actions.pet(actor, event)
        }
      } else if ((key === 's' || key === 'b') && options.onCommand) {
        if (
          !event.repeat &&
          options.onCommand(key === 's' ? 'settings' : 'bag', actor?.entity ?? null) !== false
        ) {
          event.preventDefault()
        }
      }
    },
    { signal }
  )

  signal.addEventListener('abort', () => clearTimeout(held), { once: true })
  return (actor) => buttons.set(actor.button, actor)
}
