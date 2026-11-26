// SPDX-License-Identifier: Apache-2.0
// Adapted for Orca from Pokémon Sidebar’s companion menu. See NOTICE.
import { openCompanionPicker } from '../panel/catalog/companion-picker.mjs'

const { plugin } = window.orca
const client = Array.from(crypto.getRandomValues(new Uint8Array(18)), (byte) =>
  byte.toString(16).padStart(2, '0')
).join('')
let sequence = 0

export async function choosePokemon(row, onSaved) {
  const terminalIds = [row.terminalId]
  const game = await plugin.request('trainer.game', { terminalIds })
  const current = game.party.find((member) => member.terminalId === row.terminalId)
  if (current?.ref.id !== row.pokemon.ref.id || current?.ref.slot !== row.pokemon.ref.slot) {
    throw new Error('This Pokémon changed. Refresh the sidebar and try again.')
  }
  await openCompanionPicker(current, game, async (action) => {
    const payload = { client, sequence: ++sequence, terminalIds, action }
    const send = () => plugin.request('trainer.command', payload)
    const result = await send().catch(send)
    if (!result.ok) {
      throw new Error(result.message)
    }
    onSaved()
  })
}
