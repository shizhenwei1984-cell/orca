// SPDX-License-Identifier: Apache-2.0
// Adapted for Orca from Pokémon Sidebar’s companion menu. See NOTICE.
import { openCatalogPicker } from '../panel/catalog/picker.mjs'

const { host, plugin } = window.orca
const favoritesKey = 'catalog.favorites'
let client
let sequence = 0

export async function choosePokemon(row, onSaved) {
  const terminalIds = [row.terminalId]
  const [game, favorites] = await Promise.all([
    plugin.request('trainer.game', { terminalIds }),
    host.call('storage.get', { key: favoritesKey }).then(({ value }) => value)
  ])
  const current = game.party.find((member) => member.terminalId === row.terminalId)
  if (current?.ref.id !== row.pokemon.ref.id || current?.ref.slot !== row.pokemon.ref.slot) {
    throw new Error('This Pokémon changed. Refresh the sidebar and try again.')
  }
  const unlocked = (flag) =>
    new Set(game.dex.species.filter((species) => species[flag]).map(({ dex }) => dex))
  client ??= Array.from(crypto.getRandomValues(new Uint8Array(18)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
  openCatalogPicker({
    current: row.pokemon.pick,
    favorites: Array.isArray(favorites) ? favorites : [],
    onFavoritesChange: (keys) => host.call('storage.set', { key: favoritesKey, value: keys }),
    unlocks: { caught: unlocked('caught'), shinyUnlocked: unlocked('shiny') },
    shinyOdds: game.charm.odds,
    onSelect: async (pick) => {
      const result = await plugin.request('trainer.command', {
        client,
        sequence: ++sequence,
        terminalIds,
        action: { ...pick, type: 'choose', target: current.ref }
      })
      if (!result.ok) {
        throw new Error(result.message)
      }
      onSaved()
    }
  })
}
