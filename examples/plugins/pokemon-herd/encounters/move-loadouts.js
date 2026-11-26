import { entryOf, megaForms } from '../catalog/dex.mjs'
import { chosenOf, learnableOf, movesetOf } from './rules/moves.js'
import { describeMove } from './move-facts.js'
import { fighterKey, statsFull, typesOf } from './rules/trainer.js'

const megaSlot = (key) => {
  const kind = /^\d+m([XY]?)$/.exec(String(key))?.[1]
  return kind === undefined ? null : kind || 'M'
}

export function chosenMoves(pick, key) {
  const slot = megaSlot(key)
  return (slot ? pick.megaMoves?.[slot] : pick.moves) ?? null
}

export function moveForms(pick) {
  const base = fighterKey(pick.dex, { form: pick.form })
  const entry = entryOf({ dex: pick.dex, ...(pick.form && { form: pick.form }) })
  const megas = entry ? megaForms(entry) : []
  return [
    { key: String(base), name: pick.form && entry ? entry.name : 'Base' },
    ...megas.flatMap(({ kind }) => {
      const key = fighterKey(pick.dex, { mega: kind })
      return key === base ? [] : [{ key: String(key), name: kind ? `Mega ${kind}` : 'Mega' }]
    })
  ]
}

export function moveEditorForms(pick) {
  return moveForms(pick).map((form) => {
    const { key } = form
    const [, attack, , specialAttack] = statsFull(key)
    const stats = { attack, specialAttack, types: typesOf(key) }
    const names = chosenMoves(pick, key)
    const selected = chosenOf(key, names) ?? movesetOf(key)
    const learnable = new Map(learnableOf(key).map((move) => [move.name, move]))
    const options = new Map(selected.map((move) => [move.name, move]))
    for (const [name, move] of learnable) {
      options.set(name, move)
    }
    return {
      ...form,
      stats,
      selected: [...new Set(selected.map(({ name }) => name))],
      custom: !!names,
      options: [...options.values()].map((move) => ({
        ...describeMove(move, stats),
        learnable: learnable.has(move.name)
      }))
    }
  })
}

export function withMoveLoadout(pokemon, key, moves, revision) {
  const { moves: oldMoves, megaMoves, ...rest } = pokemon
  const slot = megaSlot(key)
  const base = slot ? oldMoves : moves
  const megas = { ...megaMoves }
  if (slot && moves) {
    megas[slot] = moves
  } else if (slot) {
    delete megas[slot]
  }
  return {
    ...rest,
    movesRevision: revision,
    ...(base && { moves: base }),
    ...(Object.keys(megas).length && { megaMoves: megas })
  }
}
