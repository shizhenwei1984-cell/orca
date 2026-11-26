// SPDX-License-Identifier: Apache-2.0
// Adapted for Orca from Pokémon Sidebar’s agent card and rail. See NOTICE.
import { loadCatalogSprite, playCatalogSprite } from '../panel/catalog/sprite.mjs'
import { elapsed, STATUS } from './navigation.mjs'
import { button, element, menu, popup } from './row-controls.mjs'

function portrait(pokemon, fallback, signal) {
  const box = element('span', '', 'portrait')
  box.setAttribute('aria-hidden', 'true')
  const canvas = element('canvas')
  canvas.width = canvas.height = 64
  box.textContent = (pokemon?.name || fallback).slice(0, 1).toUpperCase()
  if (pokemon) {
    const { pick } = pokemon
    void loadCatalogSprite(pick, 'idle', { signal })
      .then(async (sprite) => {
        if (sprite) {
          await playCatalogSprite(canvas, { ...sprite, times: sprite.times.slice(0, 1) }, signal)
          box.replaceChildren(canvas)
        }
      })
      .catch(() => {})
  }
  return box
}

export function terminal(row, { rail, current, signal, focus, actions, showWorkspace }) {
  const { name, key, terminalId, agent, pokemon } = row
  const state = agent && STATUS[agent.state]
  const age = agent && elapsed(agent.stateStartedAt)
  const description = [name, state && `${state} · ${age}`, pokemon?.name]
    .filter(Boolean)
    .join(' · ')
  const control = terminalId ? button('', focus) : element('div')
  control.title = description
  if (key) {
    control.dataset.control = key
  }
  if (terminalId) {
    control.setAttribute('aria-label', rail ? description : `Focus terminal ${name}`)
  }
  if (current && terminalId) {
    control.setAttribute('aria-current', 'true')
  }
  if (rail) {
    control.className = 'rail-terminal'
    control.dataset.current = String(current)
    control.append(portrait(pokemon, name, signal))
    if (agent) {
      control.dataset.state = agent.state
      control.append(element('span', '', 'dot'))
    }
    if (terminalId) {
      control.oncontextmenu = (event) => {
        event.preventDefault()
        popup(control, actions(), event.clientX, event.clientY)
      }
    }
    return control
  }

  const wrapper = element('div', '', agent ? 'terminal-row agent-card' : 'terminal-row')
  wrapper.dataset.current = String(current)
  const label = element('span', '', 'terminal-label')
  const copy = element('span', '', 'card-copy')
  copy.append(element(agent ? 'strong' : 'span', name, 'ellipsis'))
  if (agent) {
    wrapper.dataset.state = agent.state
    const status = element('span', '', 'state meta')
    status.append(element('span', '', 'dot'), element('span', state), element('time', age))
    copy.append(status)
    if (showWorkspace) {
      const { name, project } = row.workspace
      const label = project && project !== name ? `${project} · ${name}` : name
      copy.append(element('span', label, 'meta ellipsis'))
    }
    const picture = portrait(pokemon, agent.agent || name, signal)
    label.append(picture)
  }
  if (pokemon) {
    const { evolution } = pokemon
    const family = [
      pokemon.shiny ? 'Shiny ' : '',
      pokemon.name,
      pokemon.held ? ` · ${pokemon.held}` : ''
    ].join('')
    copy.append(element('span', family, 'meta ellipsis'))
    const growth = element('span', '', 'growth meta')
    const hearts = element('span', `♥ ${pokemon.hearts}`, 'heart')
    hearts.title = `Friendship ${pokemon.friendship}/100`
    growth.title = pokemon.needs ?? evolution.note
    growth.append(hearts)
    if (evolution.progress !== null) {
      const progress = element('progress')
      progress.max = 1
      progress.value = evolution.progress
      progress.setAttribute('aria-label', 'Evolution progress')
      growth.append(progress)
    }
    if (evolution.note) {
      growth.append(element('span', evolution.note, 'ellipsis'))
    }
    copy.append(growth)
  }
  label.append(copy)
  control.append(label)
  wrapper.append(control)
  if (terminalId) {
    menu(wrapper, `Actions for ${name}`, actions, key)
  }
  return wrapper
}
