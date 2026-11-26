import { moveEditorForms, moveForms } from '../encounters/move-loadouts.js'
import { MAX_MOVES, ULTIMATE } from '../encounters/rules/moves.js'
import { typeLabel } from '../encounters/rules/types.js'
import { moveInfo } from './move-details.js'

const dialogMarkup = `
  <header>
    <h2 id="move-editor-title"></h2>
    <button type="button" data-close autofocus>Close</button>
  </header>
  <form hidden>
    <label data-form-field>Form<select name="form"></select></label>
    <p data-stats></p>
    <section aria-labelledby="move-slots-title">
      <h3 id="move-slots-title"></h3>
      <ol data-slots></ol>
      <p data-signatures></p>
      <p data-count aria-live="polite"></p>
    </section>
    <section aria-labelledby="learnable-moves-title">
      <h3 id="learnable-moves-title">Learnable moves</h3>
      <div class="move-toolbar">
        <label>Move kind<select name="kind">
          <option value="">All kinds</option>
          <option>Physical</option>
          <option>Special</option>
          <option>Status</option>
        </select></label>
        <label>Move type<select name="type"></select></label>
      </div>
      <p data-matches role="status"></p>
      <ul data-options aria-label="Matching moves"></ul>
    </section>
  </form>
  <p data-status role="status"></p>
  <footer class="move-toolbar" hidden>
    <button type="submit" form="move-editor-form" data-save>Save moves</button>
    <button type="button" data-reset>Reset to default</button>
    <button type="button" data-retry hidden>Retry action</button>
  </footer>
`

function moveButton(label, click) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.addEventListener('click', click)
  return button
}

export function openMovePreview(entry, megaKind, restoreFocus) {
  const pick = { dex: entry.dex, form: entry.form }
  const megaName = megaKind === '' ? 'Mega' : `Mega ${megaKind}`
  const activeMoveForm = moveForms(pick).find(({ name }) => name === megaName)?.key
  return openMoveEditor(
    { name: entry.name, activeMoveForm },
    { load: () => moveEditorForms(pick), restoreFocus }
  )
}

export async function openMoveEditor(pokemon, { load, submit, signal, restoreFocus }) {
  const previous = document.querySelector('#move-editor')
  if (previous?.open || signal?.aborted) {
    return false
  }
  previous?.remove()
  const dialog = document.createElement('dialog')
  dialog.id = 'move-editor'
  dialog.className = 'move-editor'
  dialog.setAttribute('aria-labelledby', 'move-editor-title')
  dialog.innerHTML = dialogMarkup
  const find = (selector) => dialog.querySelector(selector)
  const form = find('form')
  form.id = 'move-editor-form'
  const select = find('[name="form"]')
  const kind = find('[name="kind"]')
  const type = find('[name="type"]')
  const status = find('[data-status]')
  const close = find('[data-close]')
  const options = find('[data-options]')
  const slots = find('[data-slots]')
  const save = find('[data-save]')
  const reset = find('[data-reset]')
  const retry = find('[data-retry]')
  const editing = !!submit
  find('#move-editor-title').textContent =
    `${editing ? 'Teach moves' : 'Inspect moves'} · ${pokemon.name}`
  find('#move-slots-title').textContent = editing ? 'Selected moves' : 'Default moves'
  status.textContent = 'Loading moves…'

  const lifetime = new AbortController()
  const onAbort = () => dialog.close()
  let pending
  let busy = false
  let saved = false
  const finished = new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        lifetime.abort()
        signal?.removeEventListener('abort', onAbort)
        dialog.remove()
        if (!signal?.aborted) {
          restoreFocus?.()
        }
        resolve(saved)
      },
      { once: true }
    )
  })
  signal?.addEventListener('abort', onAbort, { once: true })
  close.onclick = onAbort
  dialog.oncancel = (event) => {
    if (busy) {
      event.preventDefault()
    }
  }
  document.body.append(dialog)
  dialog.showModal()

  let forms
  try {
    forms = await load(pokemon.moveTarget, lifetime.signal)
  } catch (error) {
    status.textContent = error.message
    return finished
  }
  if (!dialog.open) {
    return finished
  }
  select.replaceChildren(...forms.map(({ key, name }) => new Option(name, key)))
  select.value = forms.some(({ key }) => key === pokemon.activeMoveForm)
    ? pokemon.activeMoveForm
    : forms[0].key
  find('[data-form-field]').hidden = forms.length === 1
  form.hidden = false
  find('footer').hidden = !editing
  status.textContent = ''

  let current
  let selected
  let byName
  let rows

  function renderOptions() {
    const sorted = [...rows].sort(
      ([a], [b]) =>
        Number(selected.has(b.name)) - Number(selected.has(a.name)) ||
        Number(b.recommended) - Number(a.recommended) ||
        b.power - a.power
    )
    let matching = 0
    for (const [move, row, toggle] of sorted) {
      row.hidden =
        (kind.value && move.kind !== kind.value) || (type.value && move.type !== type.value)
      matching += Number(!row.hidden)
      const on = selected.has(move.name)
      if (toggle) {
        toggle.textContent = on ? 'Remove' : 'Add'
        toggle.setAttribute('aria-label', `${toggle.textContent} ${move.name}`)
        toggle.disabled = !!pending || (on ? selected.size === 1 : selected.size === MAX_MOVES)
      }
      row.dataset.selected = String(on)
    }
    options.append(...sorted.map(([, row]) => row))
    find('[data-matches]').textContent = matching
      ? `${matching} of ${rows.length} learnable moves`
      : 'No learnable moves match these filters.'
  }

  function renderSelection() {
    const active = document.activeElement
    const names = [...selected]
    slots.replaceChildren(
      ...Array.from({ length: MAX_MOVES }, (_, index) => {
        const name = names[index]
        const slot = document.createElement('li')
        if (name) {
          slot.append(moveInfo(byName.get(name)))
          if (editing) {
            const remove = moveButton('Remove', () => changeMove(name))
            remove.setAttribute('aria-label', `Remove ${name} from slot ${index + 1}`)
            remove.disabled = !!pending || names.length === 1
            slot.append(remove)
          }
        } else {
          slot.textContent = 'Empty'
        }
        return slot
      })
    )
    const signatures = [...new Set(names.map((name) => byName.get(name).rise))].filter(
      (name) => name && !selected.has(name)
    )
    find('[data-signatures]').textContent = signatures.length
      ? `Eligible moves can rise on a 1 in ${1 / ULTIMATE} roll to ${signatures.join(', ')}.`
      : ''
    find('[data-count]').textContent = editing
      ? `${names.length} of ${MAX_MOVES} selected.${names.length === MAX_MOVES ? ' Remove a move to replace it.' : ''}`
      : ''
    renderOptions()
    kind.disabled = type.disabled = select.disabled = !!pending
    save.disabled =
      !!pending ||
      !names.every((name) => byName.get(name).learnable) ||
      current.selected.join('\n') === names.join('\n')
    reset.disabled = !!pending || !current.custom
    if (active?.isConnected && !active.disabled) {
      active.focus({ preventScroll: true })
    }
  }

  function changeMove(name) {
    if (selected.has(name)) {
      selected.delete(name)
    } else {
      selected.add(name)
    }
    const active = document.activeElement
    renderSelection()
    if (!active?.isConnected || active.disabled) {
      const row = rows.find(([move]) => move.name === name)?.[1]
      const info =
        row && !row.hidden ? row.querySelector('summary') : slots.querySelector('summary')
      info?.focus({ preventScroll: true })
    }
  }

  function showForm() {
    current = forms.find(({ key }) => key === select.value)
    const { attack, specialAttack, types } = current.stats
    const side = attack >= specialAttack ? 'Physical' : 'Special'
    find('[data-stats]').textContent =
      `${types.map(typeLabel).join(' / ')} · ${side} side · Attack ${attack} · Sp. Atk ${specialAttack}`
    selected = new Set(current.selected)
    byName = new Map(current.options.map((move) => [move.name, move]))
    const typesFound = new Map()
    rows = current.options
      .filter((move) => move.learnable)
      .map((move) => {
        typesFound.set(move.type, (typesFound.get(move.type) ?? 0) + 1)
        const row = document.createElement('li')
        row.append(moveInfo(move))
        const toggle = editing ? moveButton('Add', () => changeMove(move.name)) : null
        if (toggle) {
          row.append(toggle)
        }
        return [move, row, toggle]
      })
    kind.value = ''
    type.replaceChildren(
      new Option('All types', ''),
      ...[...typesFound]
        .sort(([, a], [, b]) => b - a)
        .map(([name, count]) => new Option(`${typeLabel(name)} (${count})`, name))
    )
    options.replaceChildren()
    renderSelection()
  }

  async function apply(action) {
    pending = action
    busy = close.disabled = retry.disabled = true
    renderSelection()
    status.textContent = ''
    try {
      const result = await submit(action)
      if (!dialog.open) {
        return
      }
      if (result.ok) {
        saved = true
        dialog.close()
      } else {
        form.hidden = true
        find('footer').hidden = true
        status.textContent = result.message
      }
      retry.hidden = true
    } catch (error) {
      if (dialog.open) {
        status.textContent = error.message
        retry.hidden = false
      }
    } finally {
      busy = close.disabled = retry.disabled = false
      if (dialog.open) {
        ;(retry.hidden ? close : retry).focus()
      }
    }
  }
  const teach = (moves) =>
    void apply({
      type: 'teach-moves',
      target: pokemon.moveTarget,
      form: select.value,
      moves
    })
  form.onsubmit = (event) => {
    event.preventDefault()
    if (editing && !save.disabled) {
      teach([...selected])
    }
  }
  select.onchange = showForm
  kind.onchange = type.onchange = renderOptions
  reset.onclick = () => teach(null)
  retry.onclick = () => void apply(pending)
  showForm()
  ;(forms.length > 1 ? select : slots.querySelector('summary'))?.focus()
  return finished
}
