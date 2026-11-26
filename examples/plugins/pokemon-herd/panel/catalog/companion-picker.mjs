import { openMoveEditor } from '../move-editor.js'
import { openCatalogPicker } from './picker.mjs'

export async function openCompanionPicker(
  pokemon,
  game,
  { terminalIds, submit, isCurrent, signal }
) {
  const ask = (name, data, abort = signal) =>
    window.orca.plugin.request(name, data, { signal: abort })
  const requestPreferences = (change) => ask('catalog.preferences', change)
  const loadBox = (entry) => ask('trainer.catalog-box', { terminalIds, entry })
  const [{ source, favorites }, boxed] = await Promise.all([
    requestPreferences(null),
    loadBox().catch(() => null)
  ])
  if (signal?.aborted || (isCurrent && !isCurrent())) {
    return
  }
  const commit = (action) => {
    if (isCurrent && !isCurrent()) {
      throw new Error('That Pokémon is no longer available.')
    }
    return submit(action)
  }
  const choose = async (action) => {
    const result = await commit(action)
    if (!result.ok) {
      throw new Error(result.message)
    }
  }
  const { caught, shinyUnlocked, ...unlocks } = game.catalog
  const dialog = openCatalogPicker({
    current: pokemon.appearance,
    currentName: pokemon.name,
    unlocks: { ...unlocks, caught: new Set(caught), shinyUnlocked: new Set(shinyUnlocked) },
    favorites,
    source,
    taken: new Set(game.party.map(({ dex }) => dex)),
    onFavoritesChange: async (change) => (await requestPreferences(change)).favorites,
    onSourceChange: (source) => requestPreferences({ source }),
    onSelect: (pick) => choose({ ...pick, type: 'choose', target: pokemon.ref }),
    onTeach: async (opener) => {
      const saved = await openMoveEditor(pokemon, {
        load: (target, abort) => ask('trainer.moves', { target, terminalIds }, abort),
        submit: commit,
        signal,
        restoreFocus: () => opener.focus()
      })
      if (saved) {
        dialog.close()
      }
    },
    ...(boxed && {
      boxed: new Set(boxed),
      loadBox,
      onBringOut: (target) => choose({ type: 'bring-out', target, destination: pokemon.ref })
    })
  })
  return new Promise((resolve) => {
    const close = () => dialog.close()
    signal?.addEventListener('abort', close, { once: true })
    dialog.addEventListener(
      'close',
      () => {
        signal?.removeEventListener('abort', close)
        resolve()
      },
      { once: true }
    )
  })
}
