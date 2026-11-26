import { openCatalogPicker } from './picker.mjs'

export async function openCompanionPicker(pokemon, game, onChoose, opener) {
  const request = (change) => window.orca.plugin.request('catalog.preferences', change)
  const { source, favorites } = await request(null)
  if (!opener.isConnected) {
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
  return new Promise((resolve) => dialog.addEventListener('close', resolve, { once: true }))
}
