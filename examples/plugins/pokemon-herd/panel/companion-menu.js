import { disposeCompanionArt, paintCompanionArt } from './catalog/companion-art.mjs'
import { HOLD_SHOWN } from '../encounters/rules/items.js'

export function renderCompanionMenu(root, menu, { signal, labels, onAction, onMega }) {
  const { card, source, mates, held, uses, holds } = menu
  const node = (tag, text = '') => {
    const element = document.createElement(tag)
    element.textContent = text
    return element
  }
  const button = (label, run) => {
    const element = node('button', label)
    element.type = 'button'
    element.onclick = (event) => {
      if (event.isTrusted && !signal.aborted) {
        run()
      }
    }
    return element
  }
  const art = (appearance, size) => {
    const canvas = node('canvas')
    canvas.width = canvas.height = size
    canvas.setAttribute('aria-hidden', 'true')
    paintCompanionArt(canvas, appearance, 'idle', false)
    signal.addEventListener('abort', () => disposeCompanionArt(canvas), { once: true })
    return canvas
  }
  const section = (label, children) => {
    const group = node('section')
    const chips = node('div')
    chips.className = 'companion-chips'
    chips.append(...children)
    group.append(node('h3', label), chips)
    return group
  }
  const details = node('div')
  details.append(
    node('strong', `${card.shiny ? '✨ ' : ''}${card.name}`),
    node('small', [...card.types, card.ability].filter(Boolean).join(' · ')),
    node(
      'small',
      [
        `♥ ${card.friendship}`,
        `${card.jobs} jobs`,
        card.hp == null ? 'Fainted' : `HP ${Math.round(card.hp * 100)}%`
      ].join(' · ')
    ),
    node('small', card.moves.join(' · '))
  )
  const heading = node('header')
  heading.append(art(card.appearance, 48), details)
  root.replaceChildren(heading)
  if (card.hasMega) {
    root.append(button('Mega settings', onMega))
  }
  const itemChip = (item, holding) =>
    button(`${item.icon} ${item.name} ×${item.count}`, () =>
      onAction(
        { type: 'use', item: item.id },
        holding ? `Gave ${card.name} ${item.name} to hold.` : `Used ${item.name} on ${card.name}.`
      )
    )
  if (uses.length) {
    root.append(
      section(
        'Use from the Bag',
        uses.map((item) => itemChip(item, false))
      )
    )
  }
  if (held || holds.length) {
    const items = holds.map((item) => itemChip(item, true))
    const take = held
      ? [
          button(`${held.icon} Take ${held.name}`, () =>
            onAction({ type: 'take-held' }, `Returned ${held.name} to the Bag.`)
          )
        ]
      : []
    const chips = section('Held items', [...take, ...items.slice(0, HOLD_SHOWN)])
    const rest = items.slice(HOLD_SHOWN)
    if (rest.length) {
      const more = node('details')
      more.append(node('summary', `More held items (${rest.length})`))
      const grid = node('div')
      grid.className = 'companion-chips'
      grid.append(...rest)
      more.append(grid)
      chips.append(more)
    }
    root.append(chips)
  }
  if (mates.length) {
    root.append(
      section(
        'Swap with another agent',
        mates.map(({ target, appearance, name, title }) => {
          const label = labels.get(target.terminalId) || title || 'Agent'
          const swap = button('', () =>
            onAction(
              { type: 'swap-companions', target: source, destination: target },
              `Swapped ${card.name} and ${name}.`
            )
          )
          swap.className = 'companion-mate'
          swap.setAttribute('aria-label', `Swap with ${name} · ${label}`)
          swap.append(
            art({ ...appearance, mega: 'off' }, 36),
            node('strong', `${appearance.shiny ? '✨ ' : ''}${name}`),
            node('small', label)
          )
          return swap
        })
      )
    )
  }
}
