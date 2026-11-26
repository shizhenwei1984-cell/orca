import { openCompanionPicker } from './catalog/companion-picker.mjs'
import { openMoveEditor } from './move-editor.js'

const dialog = document.querySelector('#trainer-game')
const tabs = document.querySelector('#trainer-tabs')
const body = document.querySelector('#trainer-view')
const status = document.querySelector('#trainer-feedback')
const retry = document.querySelector('#trainer-action-retry')
const client = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(18)), (byte) =>
  byte.toString(16).padStart(2, '0')
).join('')
const currency = new Intl.NumberFormat()
const money = (value) => `₽${currency.format(value)}`
const minutes = (value) => `${Math.ceil(value)} min`
const sections = ['Party', 'Bag', 'Shop', 'Box', 'Day Care', 'Research', 'Badges', 'Pokédex']

let scope = new AbortController()
let getTerminals
let active = 'Bag'
let game
let sequence = 0
let requestVersion = 0
let pending
let busy = false
let picking = false
let focusedTerminal = null
let chooseCompanion = false
let focusedCompanion = null
let group = 'Balls'
let selectedRegion = ''
let dexSearch = ''
const query = { search: '', sort: 'new', filter: '', page: 0 }

function node(tag, text = '', className = '') {
  const element = document.createElement(tag)
  element.textContent = text
  if (className) {
    element.className = className
  }
  return element
}

function button(label, click, { disabled = false, kind = '', id = '' } = {}) {
  const element = node('button', label, kind)
  element.type = 'button'
  element.disabled = disabled
  if (id) {
    element.id = id
  }
  element.onclick = click
  return element
}

function field(label, control) {
  const wrapper = node('label', label, 'trainer-field')
  wrapper.append(control)
  return wrapper
}

function select(label, choices, current, change) {
  const dropdown = node('select')
  for (const [value, name] of choices) {
    const option = node('option', name)
    option.value = value
    dropdown.append(option)
  }
  dropdown.value = current
  dropdown.onchange = () => change(dropdown.value)
  return field(label, dropdown)
}

function toolbar(...controls) {
  const wrapper = node('div', '', 'trainer-toolbar')
  wrapper.append(...controls)
  return wrapper
}

function card(title, detail) {
  const section = node('section', '', 'trainer-entry')
  section.append(node('h3', title))
  if (detail) {
    section.append(node('p', detail))
  }
  return section
}

function formatProgress(value, max, label) {
  const bar = node('progress')
  bar.max = max
  bar.value = value
  bar.setAttribute('aria-label', label)
  return bar
}

async function refresh(force = false) {
  if (!dialog.open || (busy && !force)) {
    return
  }
  const request = ++requestVersion
  try {
    const next = await window.orca.plugin.request(
      'trainer.game',
      {
        terminalIds: getTerminals(),
        query
      },
      { signal: scope.signal }
    )
    if (request !== requestVersion || !dialog.open) {
      return
    }
    game = next
    if (force || !body.contains(document.activeElement)) {
      render()
    }
  } catch (error) {
    if (request !== requestVersion) {
      return
    }
    status.textContent = error.message
  }
}

async function submit(action, fromPicker = false) {
  const newAction = pending && action && JSON.stringify(pending.action) !== JSON.stringify(action)
  if (busy || newAction || (pending && action && !fromPicker)) {
    if (fromPicker) {
      throw new Error('Retry the pending trainer action first.')
    }
    return
  }
  if (action && !pending) {
    pending = { client, sequence: ++sequence, action, terminalIds: getTerminals() }
  }
  if (!pending) {
    return
  }
  busy = true
  body.inert = true
  status.textContent = ''
  retry.hidden = true
  const { signal } = scope
  try {
    const result = await window.orca.plugin.request('trainer.command', pending, { signal })
    if (!signal.aborted) {
      pending = undefined
      await refresh(true)
      if (!signal.aborted) {
        status.textContent = result.ok ? 'Saved.' : result.message
      }
    }
    return result
  } catch (error) {
    if (!signal.aborted) {
      status.textContent = error.message
      retry.hidden = false
    }
    if (fromPicker) {
      throw error
    }
  } finally {
    if (!signal.aborted) {
      busy = false
      body.inert = false
    }
  }
}

async function changeCompanion(pokemon, opener) {
  if (picking) {
    return
  }
  picking = true
  const { signal } = scope
  const isCurrent = () =>
    !signal.aborted &&
    dialog.open &&
    active === 'Party' &&
    game?.party.some(({ ref }) => ref.slot === pokemon.ref.slot && ref.id === pokemon.ref.id)
  if (opener) {
    opener.disabled = true
  }
  try {
    await openCompanionPicker(pokemon, game, {
      terminalIds: getTerminals(),
      submit: (action) => submit(action, true),
      isCurrent,
      signal
    })
  } catch (error) {
    if (!signal.aborted) {
      status.textContent = error.message
    }
  } finally {
    if (!signal.aborted) {
      picking = false
      if (opener) {
        opener.disabled = false
      }
      if (opener?.isConnected) {
        opener.focus()
      } else if (dialog.open) {
        tabs.querySelector('[aria-pressed="true"]')?.focus()
      }
    }
  }
}

function teachMoves(pokemon) {
  if (pending || busy) {
    retry.focus()
    return
  }
  return openMoveEditor(pokemon, {
    load: (target, signal) =>
      window.orca.plugin.request(
        'trainer.moves',
        { target, terminalIds: getTerminals() },
        { signal }
      ),
    submit: (action) => submit(action, true),
    signal: scope.signal,
    restoreFocus: () => {
      const opener = [...body.querySelectorAll('[data-move-target]')].find(
        (control) =>
          control.dataset.moveTarget === pokemon.moveTarget.slot &&
          control.dataset.moveId === pokemon.moveTarget.id
      )
      const fallback = tabs.querySelector('[aria-pressed="true"]')
      const focus = opener ?? fallback
      focus?.focus()
    }
  })
}

function act(label, action, options) {
  return button(label, () => void submit(action), options)
}

function itemLabel(id) {
  return game.items.find((item) => item.id === id)?.name ?? id
}

function itemUse(pokemon) {
  const drop = node('select')
  drop.setAttribute('aria-label', `Item for ${pokemon.name}`)
  const placeholder = node('option', 'Choose item')
  placeholder.value = ''
  drop.append(placeholder)
  for (const id of pokemon.items) {
    const option = node('option', itemLabel(id))
    option.value = id
    drop.append(option)
  }
  const use = button(
    'Use item',
    () => submit({ type: 'use', item: drop.value, target: pokemon.ref }),
    { disabled: true }
  )
  drop.onchange = () => {
    use.disabled = !drop.value
  }
  return toolbar(drop, use)
}

function pokemonCard(pokemon) {
  const target = pokemon.ref
  const traits = [
    pokemon.gender === 'f' ? '♀' : pokemon.gender === 'm' ? '♂' : '',
    pokemon.shiny ? 'Shiny' : '',
    pokemon.alpha ? 'Alpha' : '',
    pokemon.shadow ? 'Shadow' : '',
    pokemon.hatched ? 'Hatched' : pokemon.caught ? 'Caught' : '',
    pokemon.nature,
    pokemon.ability
  ].filter(Boolean)
  const entry = card(pokemon.name, [pokemon.title, ...traits].filter(Boolean).join(' · '))
  entry.append(node('p', `Friendship ${pokemon.friendship}/100 · ${pokemon.jobs} jobs`))
  const teach = button('Teach moves', () => void teachMoves(pokemon))
  teach.dataset.moveTarget = pokemon.moveTarget.slot
  teach.dataset.moveId = pokemon.moveTarget.id
  entry.append(node('p', `Moves · ${pokemon.moves.join(' · ')}`), toolbar(teach))
  if (pokemon.held) {
    entry.append(node('p', `Holding ${itemLabel(pokemon.held)}`))
  }
  if (pokemon.stay) {
    entry.append(node('p', 'Everstone active'))
  } else if (pokemon.needs) {
    entry.append(node('p', `Evolves ${pokemon.needs}`))
  }

  const rename = node('form', '', 'trainer-toolbar')
  const name = node('input')
  name.value = pokemon.nick
  name.maxLength = 16
  name.placeholder = 'Nickname'
  name.setAttribute('aria-label', `Nickname for ${pokemon.name}`)
  const save = node('button', 'Rename')
  save.type = 'submit'
  rename.onsubmit = (event) => {
    event.preventDefault()
    void submit({ type: 'rename', target, name: name.value })
  }
  rename.append(name, save)

  const actions = toolbar(
    act(pokemon.stay ? 'Remove Everstone' : 'Use Everstone', { type: 'everstone', target }),
    act(pokemon.locked ? 'Unlock' : 'Lock', { type: 'lock', target })
  )
  if (pokemon.held) {
    actions.append(act('Take held item', { type: 'take-held', target }))
  }
  if (pokemon.terminalId) {
    const change = button('Change Pokémon', () => void changeCompanion(pokemon, change))
    actions.prepend(
      change,
      act('Pet', { type: 'pet', target }, { disabled: pokemon.friendship === 100 })
    )
    actions.append(act('Box it', { type: 'box', target }))
  } else {
    actions.prepend(
      act(pokemon.inCare ? 'Leave Day Care' : 'Put in Day Care', { type: 'care', target })
    )
    if (pokemon.purify) {
      actions.append(act('Purify', { type: 'purify', target }))
    }
    if (!pokemon.locked) {
      actions.append(releaseButton(pokemon))
    }
    if (game.party.length) {
      entry.append(bringOut(pokemon))
    }
  }
  if (pokemon.items.length) {
    entry.append(itemUse(pokemon))
  }
  entry.append(rename, actions)
  return entry
}

function bringOut(pokemon) {
  let destination = game.party.find(({ terminalId }) => terminalId === focusedTerminal)
  const choice = select(
    'Bring out to',
    [
      ['', 'Choose an agent'],
      ...game.party.map((member) => [member.ref.slot, member.title || member.name])
    ],
    destination?.ref.slot ?? '',
    (id) => {
      destination = game.party.find(({ ref }) => ref.slot === id)
      bring.disabled = !destination
    }
  )
  const bring = button(
    'Bring out',
    () => void submit({ type: 'bring-out', target: pokemon.ref, destination: destination.ref }),
    { disabled: !destination }
  )
  return toolbar(choice, bring)
}

function confirmAction(label, confirm, action) {
  let armed = false
  const control = button(
    label,
    () => {
      if (armed) {
        void submit(action)
      } else {
        armed = true
        control.textContent = confirm
      }
    },
    { kind: 'trainer-destructive' }
  )
  control.onblur = () => {
    armed = false
    control.textContent = label
  }
  return control
}

function releaseButton(pokemon) {
  return confirmAction(`Release (+${money(pokemon.releasePay)})`, 'Confirm release', {
    type: 'release',
    target: pokemon.ref
  })
}

function party() {
  if (focusedCompanion) {
    renderFocusedCompanion()
    return
  }
  if (!game.party.length) {
    body.append(node('p', 'Start a terminal agent in this workspace to meet its Pokémon.'))
    return
  }
  const companions = [...game.party].sort(
    (a, b) => Number(b.terminalId === focusedTerminal) - Number(a.terminalId === focusedTerminal)
  )
  if (!chooseCompanion) {
    body.append(...companions.map(pokemonCard))
    return
  }
  body.append(node('p', 'Choose a companion.'))
  for (const pokemon of companions) {
    const choice = button(
      [pokemon.title, pokemon.name].filter(Boolean).join(' · '),
      () => void changeCompanion(pokemon, choice)
    )
    choice.dataset.terminalId = pokemon.terminalId
    body.append(choice)
  }
}

function shop() {
  const groups = [...new Set(game.items.map(({ group: key }) => key))]
  body.append(
    select(
      'Category',
      groups.map((key) => [key, key]),
      group,
      (key) => {
        group = key
        render()
        body.querySelector('select')?.focus()
      }
    )
  )
  for (const item of game.items.filter((entry) => entry.group === group)) {
    const row = card(item.name, item.about)
    const quantity = node('input')
    quantity.type = 'number'
    quantity.min = '1'
    quantity.max = String(Math.max(1, item.maxBuy, item.count))
    quantity.value = '1'
    quantity.setAttribute('aria-label', `${item.name} quantity`)
    const trade = (type) => void submit({ type, item: item.id, count: quantity.valueAsNumber })
    row.append(
      node('p', `${money(item.price)} to buy · ${money(item.sell)} to sell · ${item.count} in Bag`),
      toolbar(
        quantity,
        button('Buy', () => trade('buy'), { disabled: !item.maxBuy }),
        button('Sell', () => trade('sell'), { disabled: !item.count })
      )
    )
    body.append(row)
  }
}

function bag() {
  const available = game.items.filter((item) => item.count || game.boosts[item.id] > Date.now())
  if (!available.length) {
    body.append(node('p', 'Your Bag is empty.'))
  }
  for (const item of available) {
    const row = card(`${item.name} ×${item.count}`, item.about)
    const until = game.boosts[item.id]
    const applicable = game.party.filter((member) => member.items.includes(item.id))
    if (until) {
      row.append(node('p', `Active for ${minutes((until - Date.now()) / 60_000)}`))
    }
    if (item.kind === 'boost' && item.count) {
      row.append(act('Activate', { type: 'boost', item: item.id }))
    }
    if (applicable.length) {
      let target = applicable[0].ref
      const choices = select(
        'Pokémon',
        applicable.map((member) => [member.ref.slot, member.name]),
        target.slot,
        (id) => {
          target = applicable.find((member) => member.ref.slot === id).ref
        }
      )
      row.append(
        toolbar(
          choices,
          button('Use item', () => void submit({ type: 'use', item: item.id, target }))
        )
      )
    }
    body.append(row)
  }
  body.append(button('Open Shop', () => open('Shop')))
}

function searchField(label, value, onSearch) {
  const input = node('input')
  input.type = 'search'
  input.maxLength = 80
  input.value = value
  input.onchange = () => onSearch(input.value.trim())
  input.onkeydown = (event) => {
    if (event.key === 'Enter') {
      input.blur()
    }
  }
  return field(label, input)
}

function renderFocusedCompanion() {
  const pokemon = game.party.find(
    ({ terminalId, ref }) =>
      terminalId === focusedTerminal &&
      ref.slot === focusedCompanion.slot &&
      ref.id === focusedCompanion.id
  )
  body.append(
    pokemon ? pokemonCard(pokemon) : node('p', 'This companion is no longer in the party.')
  )
}

function box() {
  if (focusedCompanion) {
    renderFocusedCompanion()
    body.append(button('Show all boxed Pokémon', () => open('Box')))
    return
  }
  const { entries, page, lastPage, count, total, canUndo } = game.box
  function updateSearch(changes) {
    Object.assign(query, { page: 0, ...changes })
    void refresh(true)
  }
  body.append(
    toolbar(
      searchField('Search Box', query.search, (search) => updateSearch({ search })),
      select(
        'Sort',
        [
          ['new', 'Newest'],
          ['dex', 'Pokédex number'],
          ['name', 'Name'],
          ['hearts', 'Friendship']
        ],
        query.sort,
        (sort) => updateSearch({ sort })
      ),
      select(
        'Filter',
        [
          ['', 'All'],
          ['caught', 'Caught'],
          ['shiny', 'Shiny'],
          ['alpha', 'Alpha'],
          ['shadow', 'Shadow'],
          ['locked', 'Locked'],
          ['held', 'Holds an item'],
          ['hatched', 'Hatched']
        ],
        query.filter,
        (filter) => updateSearch({ filter })
      )
    )
  )
  if (canUndo) {
    body.append(act('Undo release', { type: 'undo-release' }))
  }
  if (!entries.length) {
    body.append(
      node(
        'p',
        count
          ? 'No Pokémon match this search.'
          : 'Box a party Pokémon or catch one to fill the Box.'
      )
    )
  }
  const dupes = entries.filter(({ duplicate }) => duplicate)
  if (dupes.length) {
    body.append(
      confirmAction(
        `Release ${dupes.length} duplicates on this page`,
        'Confirm duplicate release',
        { type: 'release-duplicates', targets: dupes.map(({ ref }) => ref) }
      )
    )
  }
  for (const pokemon of entries) {
    const details = node('details')
    details.dataset.pokemonId = pokemon.ref.id
    details.append(
      node(
        'summary',
        `${pokemon.name}${pokemon.locked ? ' · Locked' : ''}${pokemon.inCare ? ' · Day Care' : ''}`
      ),
      pokemonCard(pokemon)
    )
    body.append(details)
  }
  if (lastPage) {
    body.append(
      toolbar(
        button('Previous', () => updateSearch({ page: page - 1 }), { disabled: page === 0 }),
        node('span', `Page ${page + 1} of ${lastPage + 1} · ${total} Pokémon`),
        button('Next', () => updateSearch({ page: page + 1 }), { disabled: page === lastPage })
      )
    )
  }
}

function dayCare() {
  const care = game.care
  const parents = card('Parents', care.match)
  if (!care.parents.length) {
    parents.append(node('p', 'Choose two Pokémon from the Box to leave at Day Care.'))
  }
  for (const parent of care.parents) {
    parents.append(
      toolbar(node('span', parent.name), act('Take out', { type: 'care', target: parent.ref }))
    )
  }
  parents.append(button('Open Box', () => open('Box')))
  body.append(parents)
  if (care.egg) {
    const egg = card(
      `${care.egg.name} egg`,
      `${minutes(care.egg.need - care.egg.done)} of work to hatch`
    )
    egg.append(formatProgress(care.egg.done, care.egg.need, 'Hatching progress'))
    body.append(egg)
  } else if (care.match && care.match.includes('%')) {
    body.append(node('p', `${minutes(care.nextTry)} of work until the next chance to lay an egg.`))
  }
  if (care.hatched) {
    const hatched = card(`${care.hatched} hatched`)
    for (const entry of care.born) {
      hatched.append(node('p', `${entry.shiny ? 'Shiny ' : ''}${entry.name}`))
    }
    body.append(hatched)
  }
}

function research() {
  const { day, tasks, done, recap } = game.research
  body.append(node('p', day))
  for (const task of tasks) {
    const entry = card(
      task.text,
      `${Math.floor(task.n)}/${task.goal} · ${task.reward}${task.n >= task.goal ? ' earned' : ''}`
    )
    entry.append(formatProgress(task.n, task.goal, task.text))
    body.append(entry)
  }
  body.append(
    node(
      'p',
      done
        ? 'Daily bonus earned · 5 Ultra Balls and an Azure Flute'
        : 'Finish all three tasks to earn 5 Ultra Balls and an Azure Flute.'
    )
  )
  if (recap) {
    body.append(node('p', recap))
  }
}

function badges() {
  for (const badge of game.badges) {
    const entry = card(
      badge.name,
      badge.earned ? `Earned · ${badge.perk}` : `${badge.how} · ${badge.left}`
    )
    entry.append(formatProgress(badge.fraction, 1, badge.name))
    body.append(entry)
  }
  const { jobs, goal, odds } = game.charm
  const charm = card(
    'Shiny Charm',
    jobs >= goal ? `Earned · Shiny odds 1 in ${odds}` : `${jobs}/${goal} jobs`
  )
  charm.append(formatProgress(Math.min(jobs, goal), goal, 'Shiny Charm progress'))
  body.append(charm)
}

function pokedex() {
  const dex = game.dex
  body.append(node('p', `${dex.caught} caught · ${dex.seen} seen · ${dex.total} species`))
  if (dex.goal) {
    body.append(node('p', `Next reward at ${dex.goal.count} caught · ${dex.goal.reward}`))
  }
  body.append(
    toolbar(
      select(
        'Region',
        [
          ['', 'All regions'],
          ...dex.regions.map(({ region, caught, total }) => [
            region,
            `${region} (${caught}/${total})`
          ])
        ],
        selectedRegion,
        (region) => {
          selectedRegion = region
          render()
        }
      ),
      searchField('Search Pokédex', dexSearch, (search) => {
        dexSearch = search
        render()
      })
    )
  )
  const search = dexSearch.toLowerCase()
  for (const pokemon of dex.species) {
    if (
      (selectedRegion && pokemon.region !== selectedRegion) ||
      (search && !pokemon.name.toLowerCase().includes(search) && String(pokemon.dex) !== search)
    ) {
      continue
    }
    const traits = [
      pokemon.shiny && 'Shiny',
      pokemon.alpha && 'Alpha',
      pokemon.male && '♂',
      pokemon.female && '♀'
    ].filter(Boolean)
    const entry = card(
      `#${pokemon.dex} ${pokemon.name}`,
      [pokemon.caught ? 'Caught' : 'Seen', ...traits].join(' · ')
    )
    if (pokemon.sizes) {
      entry.append(
        node('p', `Size records ${pokemon.sizes[0].toFixed(2)}–${pokemon.sizes[1].toFixed(2)}×`)
      )
    }
    body.append(entry)
  }
  if (body.childElementCount === (dex.goal ? 3 : 2)) {
    body.append(node('p', 'No species recorded for this search.'))
  }
}

const renderers = {
  Party: party,
  Bag: bag,
  Shop: shop,
  Box: box,
  'Day Care': dayCare,
  Research: research,
  Badges: badges,
  Pokédex: pokedex
}

function render() {
  if (!game) {
    return
  }
  const expanded = new Set(
    [...body.querySelectorAll('details[open]')].map((details) => details.dataset.pokemonId)
  )
  body.replaceChildren()
  document.querySelector('#trainer-game-wallet').textContent = money(game.money)
  renderers[active]()
  for (const details of body.querySelectorAll('details')) {
    details.open = expanded.has(details.dataset.pokemonId)
  }
  for (const tab of tabs.children) {
    tab.setAttribute('aria-pressed', String(tab.textContent === active))
  }
}

function open(section, { terminalId = null, companion = null, choose = false } = {}) {
  active = section
  focusedTerminal = terminalId
  focusedCompanion = companion
  chooseCompanion = choose
  if (!dialog.open) {
    dialog.showModal()
  }
  body.scrollTop = 0
  if (game && !companion && !choose) {
    render()
  } else {
    body.replaceChildren(node('p', 'Loading trainer…'))
  }
  return refresh(true)
}

export function mountTrainer(getTerminalIds) {
  getTerminals = getTerminalIds
  for (const section of sections) {
    tabs.append(button(section, () => open(section)))
  }
  document.querySelector('#open-trainer').onclick = () => open('Bag')
  document.querySelector('#close-trainer').onclick = () => dialog.close()
  retry.onclick = () => void submit()
  window.orca.plugin.on('trainer.changed', () => void refresh())
  return {
    open,
    openParty: (terminalId) => open('Party', { terminalId }),
    openBoxFor: (terminalId) => open('Box', { terminalId }),
    openCompanion: (section, terminalId, companion) => open(section, { terminalId, companion }),
    async openCompanionMoves(pokemon) {
      const current = scope
      await open('Party', { terminalId: pokemon.terminalId, companion: pokemon.ref })
      if (scope === current && dialog.open && focusedCompanion === pokemon.ref) {
        await teachMoves(pokemon)
      }
    },
    async openPicker({ id = null, ref } = {}) {
      const current = scope
      await open('Party', { terminalId: id, choose: !ref })
      if (scope !== current || !dialog.open || active !== 'Party' || focusedTerminal !== id) {
        return
      }
      const pokemon = game?.party.find(
        (member) =>
          member.terminalId === id &&
          (!ref || (member.ref.slot === ref.slot && member.ref.id === ref.id))
      )
      const choices = [...body.querySelectorAll('button[data-terminal-id]')]
      if (pokemon) {
        await changeCompanion(
          pokemon,
          choices.find((choice) => choice.dataset.terminalId === id)
        )
      } else if (ref) {
        status.textContent = 'That Pokémon is no longer available.'
      } else {
        choices[0]?.focus()
      }
    },
    reset() {
      scope.abort()
      scope = new AbortController()
      requestVersion++
      game = pending = undefined
      busy = picking = body.inert = false
      status.textContent = ''
      retry.hidden = true
      if (dialog.open) {
        dialog.close()
      }
      body.replaceChildren()
    },
    refresh,
    submit
  }
}
