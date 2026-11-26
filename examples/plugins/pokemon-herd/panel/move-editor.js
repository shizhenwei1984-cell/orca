import { MAX_MOVES } from '../encounters/rules/moves.js'

const dialog = document.querySelector('#move-editor')
const title = document.querySelector('#move-editor-title')
const close = document.querySelector('#close-move-editor')
const form = document.querySelector('#move-editor-form')
const select = form.querySelector('select')
const formField = document.querySelector('#move-editor-form-field')
const count = document.querySelector('#move-editor-count')
const options = document.querySelector('#move-editor-options')
const status = document.querySelector('#move-editor-status')
const save = form.querySelector('[type="submit"]')
const reset = document.querySelector('#reset-moves')
const retry = document.querySelector('#retry-moves')

export async function openMoveEditor(pokemon, { load, submit, signal, restoreFocus }) {
  if (dialog.open || signal.aborted) {
    return
  }
  const lifetime = new AbortController()
  const editing = AbortSignal.any([signal, lifetime.signal])
  const { moveTarget: target, name } = pokemon
  let pending
  let busy = false
  title.textContent = `Teach moves · ${name}`
  form.hidden = true
  retry.hidden = true
  status.textContent = 'Loading moves…'
  dialog.showModal()
  const onAbort = () => dialog.close()
  signal.addEventListener('abort', onAbort, { once: true })
  dialog.addEventListener(
    'close',
    () => {
      lifetime.abort()
      signal.removeEventListener('abort', onAbort)
      if (!signal.aborted) {
        restoreFocus()
      }
    },
    { once: true }
  )
  close.addEventListener('click', onAbort, { signal: editing })
  dialog.addEventListener(
    'cancel',
    (event) => {
      if (busy) {
        event.preventDefault()
      }
    },
    { signal: editing }
  )

  let forms
  try {
    forms = await load(target, editing)
  } catch (error) {
    if (!editing.aborted) {
      status.textContent = error.message
    }
    return
  }
  if (editing.aborted) {
    return
  }
  select.replaceChildren(...forms.map(({ key, name }) => new Option(name, key)))
  select.value = forms.some(({ key }) => key === pokemon.activeMoveForm)
    ? pokemon.activeMoveForm
    : forms[0].key
  select.disabled = false
  formField.hidden = forms.length === 1
  form.hidden = false
  status.textContent = ''

  let selected
  let current
  function updateControls() {
    const full = selected.size >= MAX_MOVES
    count.textContent = `${selected.size} of ${MAX_MOVES} selected.${full ? ' Clear a move to make room.' : ''}`
    for (const input of options.querySelectorAll('input')) {
      input.disabled = !!pending || (full && !input.checked)
    }
    select.disabled = !!pending
    save.disabled =
      !!pending || !selected.size || current.selected.join('\n') === [...selected].join('\n')
    reset.disabled = !!pending || !current.custom
  }

  function showForm() {
    current = forms.find(({ key }) => key === select.value)
    selected = new Set(current.selected)
    const byName = new Map(current.options.map((move) => [move.name, move]))
    const names = [...new Set([...selected, ...byName.keys()])]
    options.replaceChildren(
      ...names.map((name) => {
        const move = byName.get(name)
        const label = document.createElement('label')
        const toggle = document.createElement('input')
        toggle.type = 'checkbox'
        toggle.checked = selected.has(name)
        toggle.addEventListener('change', () => {
          if (toggle.checked) {
            selected.add(name)
          } else {
            selected.delete(name)
          }
          updateControls()
        })
        const text = document.createElement('span')
        text.textContent = name
        if (move) {
          const details = document.createElement('small')
          details.textContent = [move.type, move.kind, move.power || null]
            .filter(Boolean)
            .join(' · ')
          text.append(details)
        }
        label.append(toggle, text)
        return label
      })
    )
    updateControls()
  }

  async function apply(action) {
    pending = action
    busy = close.disabled = retry.disabled = true
    updateControls()
    status.textContent = ''
    try {
      const result = await submit(action)
      if (editing.aborted) {
        return
      }
      if (result.ok) {
        dialog.close()
      } else {
        form.hidden = true
        status.textContent = result.message
        close.focus()
      }
      retry.hidden = true
    } catch (error) {
      if (!editing.aborted) {
        status.textContent = error.message
        retry.hidden = false
        retry.disabled = false
        retry.focus()
      }
    } finally {
      busy = close.disabled = retry.disabled = false
    }
  }
  const teach = (moves) => void apply({ type: 'teach-moves', target, form: select.value, moves })
  form.addEventListener(
    'submit',
    (event) => {
      event.preventDefault()
      if (!save.disabled) {
        teach([...selected])
      }
    },
    { signal: editing }
  )
  select.addEventListener('change', showForm, { signal: editing })
  reset.addEventListener('click', () => teach(null), { signal: editing })
  retry.addEventListener('click', () => void apply(pending), { signal: editing })
  showForm()
  if (forms.length > 1) {
    select.focus()
  } else {
    options.querySelector('input')?.focus()
  }
}
