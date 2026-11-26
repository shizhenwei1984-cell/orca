import {
  canChoose,
  dexNumber,
  entryKey,
  entryOf,
  favoriteKeys,
  genderChoices,
  megaForms,
  REGIONS,
  searchEntries,
  TYPES
} from '../../catalog/dex.mjs'
import { loadCatalogSprite, playCatalogSprite } from './sprite.mjs'

const PAGE_SIZE = 36
const genders = { m: 'Male', f: 'Female' }
const titleCase = (value) => value[0].toUpperCase() + value.slice(1)

const pickerMarkup = `
  <header class="catalog-heading">
    <h2 id="catalog-title">Choose a Pokémon</h2>
    <button type="button" data-cancel>Cancel</button>
  </header>
  <form class="catalog-search">
    <label>Search Pokémon<input type="search" placeholder="Name, number, form or type" autofocus></label>
    <details>
      <summary>Filters</summary>
      <div class="catalog-filters">
        <label>Region<select name="region"></select></label>
        <label>Type<select name="type"></select></label>
        <label>Second type<select name="secondType"></select></label>
        <label><input type="checkbox" name="mega"> Mega evolution</label>
        <label><input type="checkbox" name="favorite"> Favorites</label>
        <label><input type="checkbox" name="available"> Available to choose</label>
        <label data-source hidden>New companions<select name="source"><option value="starters">Starters</option><option value="any">All available Pokémon</option><option value="favorites">Favorites</option></select></label>
      </div>
    </details>
  </form>
  <div class="catalog-toolbar">
    <span data-count role="status"></span>
    <button type="button" data-random>Random</button>
  </div>
  <ul class="catalog-list" aria-label="Pokémon results"></ul>
  <footer class="catalog-pagination">
    <button type="button" data-previous>Previous</button>
    <span data-page></span>
    <button type="button" data-next>Next</button>
  </footer>
  <section class="catalog-preview" aria-labelledby="catalog-preview-title" hidden>
    <div class="catalog-art">
      <canvas width="144" height="108" aria-hidden="true"></canvas>
      <span data-art-status role="status"></span>
      <button type="button" data-retry-art hidden>Retry preview</button>
    </div>
    <div class="catalog-preview-details">
      <div class="catalog-toolbar">
        <h3 id="catalog-preview-title"></h3>
        <button type="button" data-favorite aria-pressed="false">Favorite</button>
      </div>
      <p data-detail></p>
      <div class="catalog-variants">
        <label>Animation<select name="pose"><option value="idle">Idle</option><option value="walk">Walk</option><option value="sleep">Sleep</option></select></label>
        <label data-gender>Gender<select name="gender"></select></label>
        <label data-mega>Preview form<select name="megaView"></select></label>
        <label data-mega>Mega evolution<select name="megaMode"><option value="auto">While working</option><option value="on">Always</option><option value="off">Off</option></select></label>
        <label data-shiny><input type="checkbox" name="shiny"> Preview shiny</label>
      </div>
      <p data-availability></p>
    </div>
  </section>
  <footer class="catalog-action">
    <span data-save-status role="status"></span>
    <button type="button" data-choose disabled>Choose Pokémon</button>
  </footer>
`

/** @typedef {import('../../catalog/dex.mjs').Pick} Pick */
/**
 * @param {{ current?: Pick | null, onSelect: (pick: Pick) => void | Promise<void>,
 * onClose?: () => void, favorites?: string[],
 * onFavoritesChange?: (keys: string[], change: {key: string, favorite: boolean}) => string[] | Promise<string[] | void> | void,
 * source?: string, onSourceChange?: (source: string) => Promise<void>,
 * unlocks?: import('../../catalog/dex.mjs').Unlocks, taken?: ReadonlySet<number> }} options
 * @returns {HTMLDialogElement}
 */
export function openCatalogPicker({
  current = null,
  onSelect,
  onClose,
  favorites = [],
  onFavoritesChange,
  source = 'starters',
  onSourceChange,
  unlocks = {},
  taken = new Set()
}) {
  const dialog = document.createElement('dialog')
  dialog.className = 'catalog-picker'
  dialog.setAttribute('aria-labelledby', 'catalog-title')
  dialog.innerHTML = pickerMarkup
  const find = (selector) => dialog.querySelector(selector)
  const field = (name) => find(`[name="${name}"]`)
  const search = find('input[type="search"]')
  const region = field('region')
  const type = field('type')
  const secondType = field('secondType')
  const favoriteFilter = field('favorite')
  const sourceField = field('source')
  const available = field('available')
  const megaFilter = field('mega')
  const list = find('.catalog-list')
  const preview = find('.catalog-preview')
  const pose = field('pose')
  const gender = field('gender')
  const megaView = field('megaView')
  const megaMode = field('megaMode')
  const shiny = field('shiny')
  const canvas = find('canvas')
  const artStatus = find('[data-art-status]')
  const retry = find('[data-retry-art]')
  const choose = find('[data-choose]')
  const favorite = find('[data-favorite]')
  const random = find('[data-random]')
  const previous = find('[data-previous]')
  const next = find('[data-next]')
  const saveStatus = find('[data-save-status]')

  let keys = favoriteKeys(favorites)
  let page = 0
  let results = []
  let selected
  let art
  let scheduled
  let saving = false
  let savingFavorite = false
  const currentEntry = entryOf(current)
  const currentKey = currentEntry && entryKey(currentEntry)
  const eligible = (entry) => canChoose(entry, unlocks)
  const selectable = (entry) => entry === currentEntry || eligible(entry)
  const randomChoices = () =>
    results.filter((entry) => entry !== selected && entry !== currentEntry && selectable(entry))

  region.replaceChildren(new Option('Any region', ''), ...REGIONS.map((name) => new Option(name)))
  for (const input of [type, secondType]) {
    input.replaceChildren(
      new Option('Any type', ''),
      ...TYPES.map((name) => new Option(titleCase(name), name))
    )
  }
  available.checked = unlocks.trainer === true

  function renderResults() {
    results = searchEntries(search.value, {
      region: region.value,
      types: [type.value, secondType.value].filter(Boolean),
      mega: megaFilter.checked,
      keys: favoriteFilter.checked ? new Set(keys) : undefined,
      available: unlocks.trainer ? eligible : available.checked ? selectable : undefined
    })
    const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE))
    page = Math.min(page, pages - 1)
    list.replaceChildren(
      ...results.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((entry, i) => {
        const item = document.createElement('li')
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.index = String(page * PAGE_SIZE + i)
        button.dataset.current = String(currentKey === entryKey(entry))
        button.setAttribute('aria-pressed', String(selected === entry))
        const name = document.createElement('span')
        name.textContent = entry.name
        const detail = document.createElement('small')
        detail.textContent = `${dexNumber(entry.dex)} · ${entry.types.map(titleCase).join(' / ')}${selectable(entry) ? '' : ' · Locked'}`
        button.append(name, detail)
        item.append(button)
        return item
      })
    )
    find('[data-count]').textContent = results.length
      ? `${results.length} Pokémon`
      : 'No Pokémon match'
    find('[data-page]').textContent = `${page + 1} of ${pages}`
    find('.catalog-pagination').hidden = pages === 1
    previous.disabled = page === 0
    next.disabled = page + 1 === pages
    random.disabled = !randomChoices().length
  }

  function renderChoice() {
    const mega = megaForms(selected)[Number(megaView.value) - 1]
    const types = mega?.types ?? selected.types
    const key = entryKey(selected)
    const favoriteOn = keys.includes(key)
    find('[data-detail]').textContent =
      `${dexNumber(selected.dex)} · ${selected.region} · ${types.map(titleCase).join(' / ')}`
    favorite.setAttribute('aria-pressed', String(favoriteOn))
    favorite.textContent = favoriteOn ? 'Favorited' : 'Favorite'
    const canPreviewShiny = mega?.shiny ?? selected.shiny
    find('[data-shiny]').hidden = !canPreviewShiny
    find('[data-availability]').textContent = !selectable(selected)
      ? 'This Pokémon is locked.'
      : shiny.checked &&
          canPreviewShiny &&
          !unlocks.shinyUnlocked?.has(selected.dex) &&
          !(currentKey === key && current?.shiny)
        ? 'Catch a shiny to choose its shiny form directly.'
        : ''
    choose.disabled = saving || !selectable(selected)
  }

  function renderArt() {
    clearTimeout(scheduled)
    art?.abort()
    art = new AbortController()
    const { signal } = art
    canvas.hidden = true
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    retry.hidden = true
    artStatus.textContent = ''
    const mega = megaForms(selected)[Number(megaView.value) - 1]
    const pick = {
      dex: selected.dex,
      form: selected.form,
      gender: gender.value || undefined,
      shiny: shiny.checked && (mega?.shiny ?? selected.shiny),
      mega: mega ? 'on' : 'off',
      megaKind: mega?.kind
    }
    scheduled = setTimeout(async () => {
      artStatus.textContent = 'Loading preview…'
      try {
        const sprite = await loadCatalogSprite(pick, pose.value, { signal })
        if (!sprite) {
          throw new Error('No preview')
        }
        await playCatalogSprite(canvas, sprite, signal)
        signal.throwIfAborted()
        canvas.hidden = false
        canvas.title = `PMD SpriteCollab · ${sprite.credits}`
        artStatus.textContent = pick.shiny && !sprite.shiny ? 'Showing regular colors' : ''
      } catch {
        if (!signal.aborted) {
          artStatus.textContent = 'Preview unavailable'
          retry.hidden = false
        }
      }
    }, 160)
  }

  function showPreview(entry) {
    selected = entry
    const same = currentKey === entryKey(entry)
    const megas = megaForms(entry)
    const choices = genderChoices(entry.dex)
    gender.replaceChildren(
      ...(choices.length > 1 ? [new Option('Random', '')] : []),
      ...choices.map((value) => new Option(genders[value], value))
    )
    if (same && choices.includes(current.gender)) {
      gender.value = current.gender
    }
    find('[data-gender]').hidden = !choices.length
    megaView.replaceChildren(
      new Option('Regular', '0'),
      ...megas.map(({ kind }, i) => new Option(kind ? `Mega ${kind}` : 'Mega', String(i + 1)))
    )
    if (same && current.mega === 'on' && megas.length) {
      megaView.value = String(
        Math.max(
          0,
          megas.findIndex(({ kind }) => kind === current.megaKind)
        ) + 1
      )
    }
    megaMode.value = current?.mega ?? 'auto'
    for (const control of dialog.querySelectorAll('[data-mega]')) {
      control.hidden = !megas.length
    }
    shiny.checked = same && current.shiny === true
    find('#catalog-preview-title').textContent = entry.name
    preview.hidden = false
    random.disabled = !randomChoices().length
    for (const button of list.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(results[Number(button.dataset.index)] === entry))
    }
    renderChoice()
    renderArt()
  }

  const resetPage = () => {
    page = 0
    list.scrollTop = 0
    renderResults()
  }

  function cleanup() {
    if (!dialog.isConnected) {
      return
    }
    clearTimeout(scheduled)
    art?.abort()
    dialog.remove()
    onClose?.()
  }

  function closePicker() {
    dialog.close()
    cleanup()
  }
  find('.catalog-search').addEventListener('submit', (event) => {
    event.preventDefault()
    if (!saving && results.length) {
      showPreview(results.length === 1 ? results[0] : results[page * PAGE_SIZE])
    }
  })
  search.addEventListener('input', resetPage)
  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && list.firstElementChild) {
      event.preventDefault()
      list.firstElementChild.firstElementChild.focus()
    }
  })
  find('.catalog-filters').addEventListener('change', resetPage)
  list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-index]')
    if (button && !saving) {
      showPreview(results[Number(button.dataset.index)])
    }
  })
  function movePage(offset, stay) {
    page += offset
    list.scrollTop = 0
    renderResults()
    if (stay.disabled) {
      list.firstElementChild?.firstElementChild.focus()
    }
  }
  previous.onclick = () => movePage(-1, previous)
  next.onclick = () => movePage(1, next)
  random.onclick = () => {
    if (saving) {
      return
    }
    const choices = randomChoices()
    const unused = choices.filter((entry) => !taken.has(entry.dex))
    const pool = unused.length ? unused : choices
    if (pool.length) {
      showPreview(pool[Math.floor(Math.random() * pool.length)])
    }
  }
  for (const control of [pose, gender, megaView, shiny]) {
    control.addEventListener('change', () => {
      renderChoice()
      renderArt()
    })
  }
  retry.onclick = renderArt
  find('[data-source]').hidden = !onSourceChange || unlocks.trainer
  available.closest('label').hidden = !!unlocks.trainer
  sourceField.value = source
  sourceField.onchange = async () => {
    sourceField.disabled = true
    saveStatus.textContent = ''
    try {
      await onSourceChange(sourceField.value)
      source = sourceField.value
    } catch {
      sourceField.value = source
      saveStatus.textContent = 'Could not save the companion source. Try again.'
    } finally {
      sourceField.disabled = false
    }
  }
  favorite.onclick = async () => {
    if (savingFavorite) {
      return
    }
    savingFavorite = true
    favorite.disabled = true
    saveStatus.textContent = ''
    const key = entryKey(selected)
    const enabled = !keys.includes(key)
    const updated = enabled ? [...keys, key] : keys.filter((saved) => saved !== key)
    try {
      keys = (await onFavoritesChange?.(updated, { key, favorite: enabled })) ?? updated
      renderChoice()
      renderResults()
    } catch {
      saveStatus.textContent = 'Could not save favorite. Try again.'
    } finally {
      savingFavorite = false
      favorite.disabled = false
    }
  }
  choose.onclick = async () => {
    if (saving || !selectable(selected)) {
      return
    }
    const same = currentKey === entryKey(selected)
    const { dex, form } = selected
    const megas = megaForms(selected)
    const kind =
      megas[Number(megaView.value) - 1]?.kind ??
      megas.find(({ kind }) => same && kind === current.megaKind)?.kind
    const nextGender = gender.value
    const nextPick = {
      dex,
      ...(form ? { form } : {}),
      shiny:
        selected.shiny &&
        ((shiny.checked && unlocks.shinyUnlocked?.has(dex)) ||
          (same && current.shiny === true && !unlocks.shinyUnlocked?.has(dex))),
      ...(megas.length ? { mega: megaMode.value } : {}),
      ...(kind !== undefined ? { megaKind: kind } : {}),
      ...(nextGender ? { gender: nextGender } : {})
    }
    saving = true
    choose.disabled = true
    saveStatus.textContent = ''
    find('[data-cancel]').disabled = true
    try {
      await onSelect(nextPick)
    } catch (error) {
      saveStatus.textContent = error.message || 'Could not save Pokémon. Try again.'
      saving = false
      find('[data-cancel]').disabled = false
      renderChoice()
      return
    }
    closePicker()
  }
  find('[data-cancel]').onclick = closePicker
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    if (!saving) {
      closePicker()
    }
  })
  dialog.addEventListener('close', cleanup, { once: true })

  document.body.append(dialog)
  renderResults()
  dialog.showModal()
  if (currentEntry) {
    showPreview(currentEntry)
  }
  return dialog
}
