import { openCatalogPicker } from './picker.mjs'

export async function openCompanionPicker(pokemon, game, onChoose, isCurrent, signal) {
  const request = (change) => window.orca.plugin.request('catalog.preferences', change, { signal })
  const { source, favorites } = await request(null)
  if (signal?.aborted || (isCurrent && !isCurrent())) {
    return
  }
  const { caught, shinyUnlocked, ...unlocks } = game.catalog
  const dialog = openCatalogPicker({
    current: pokemon.appearance,
    unlocks: { ...unlocks, caught: new Set(caught), shinyUnlocked: new Set(shinyUnlocked) },
    favorites,
    source,
    taken: new Set(game.party.map(({ dex }) => dex)),
    onFavoritesChange: async (_keys, change) => (await request(change)).favorites,
    onSourceChange: (source) => request({ source }),
    onSelect: (pick) => onChoose({ ...pick, type: 'choose', target: pokemon.ref })
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
