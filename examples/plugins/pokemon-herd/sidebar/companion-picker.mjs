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
  let pending
  await openCompanionPicker(current, game, {
    terminalIds,
    submit: async (action) => {
      if (pending && JSON.stringify(pending.action) !== JSON.stringify(action)) {
        throw new Error('Retry the pending trainer action first.')
      }
      pending ??= { client, sequence: ++sequence, terminalIds, action }
      const send = () => plugin.request('trainer.command', pending)
      const result = await send().catch(send)
      pending = undefined
      if (result.ok) {
        onSaved()
      }
      return result
    }
  })
}
