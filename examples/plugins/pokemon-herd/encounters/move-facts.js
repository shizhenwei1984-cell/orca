// SPDX-License-Identifier: Apache-2.0
// Adapted from Pokémon Herd's move card. See NOTICE.
import { CRASH, HALF_COST, IGNORE_STAGES } from './rules/abilities.js'
import { MOVE_FLAGS } from './rules/ability-data.js'
import { MULTI_POWER } from './rules/more-moves.js'
import { RECHARGE, RECOIL, SELF_STAGES } from './rules/move-stages.js'
import {
  DRAIN,
  EXCLUSIVE,
  PRIORITY,
  STAB,
  TOP_MOVE,
  ULTIMATE,
  missOf,
  powerOf
} from './rules/moves.js'
import { SIDE_EFFECTS } from './rules/spar.js'

const statNames = { atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed' }
const ailments = {
  par: 'paralyze',
  brn: 'burn',
  psn: 'poison',
  frz: 'freeze',
  flinch: 'make it flinch'
}
const flags = { c: 'contact', p: 'punch', b: 'bite', s: 'sound', u: 'pulse' }
const percent = (ratio) => `${Math.round(ratio * 100)}%`
const statChanges = (stages) =>
  stages.map(([stat, change]) => `${statNames[stat]} ${change > 0 ? '+' : ''}${change}`).join(', ')

export function describeMove(move, { attack, specialAttack, types }) {
  const { name, type, status, inflict, physical } = move
  const kind = status ? 'Status' : physical ? 'Physical' : 'Special'
  const power = powerOf(name)
  const accuracy = status && !inflict ? null : Math.round((1 - missOf(name)) * 100)
  const sameType = !status && types.includes(type)
  const recommended = sameType && physical === attack >= specialAttack
  const exclusive = EXCLUSIVE[name]
  const rise = !status && !move.sig && !exclusive && TOP_MOVE[type] !== name ? TOP_MOVE[type] : null
  const details = []

  if (status) {
    details.push(
      inflict
        ? `Can ${ailments[inflict]} the target. Deals no damage.`
        : `Setup: ${statChanges(move.stages)}. Deals no damage. Changes last while it stays in.`
    )
  } else {
    const tags = Object.entries(flags)
      .filter(([flag]) => MOVE_FLAGS[name]?.includes(flag))
      .map(([, label]) => label)
    const [effect, chance] = SIDE_EFFECTS[name] ?? []
    const self = SELF_STAGES[name]
    const used = physical ? attack : specialAttack
    const other = physical ? specialAttack : attack
    const stat = physical ? 'Attack' : 'Sp. Atk'
    details.push(
      `Uses ${stat} ${used} (${used === other ? 'tied with' : used > other ? 'higher than' : 'lower than'} ${other})${sameType ? ` · Same-type attack bonus ×${STAB}` : ''}.`
    )

    if (MULTI_POWER[name]) {
      details.push('Power counts all hits.')
    }
    if (PRIORITY[name]) {
      details.push(`Priority +${PRIORITY[name]} (moves first).`)
    }
    if (tags.length) {
      details.push(`Move traits: ${tags.join(', ')}.`)
    }
    if (effect) {
      details.push(
        `${percent(chance)} chance to ${ailments[effect] ?? `lower the target’s ${statNames[effect]} by one stage`}.`
      )
    }
    if (DRAIN[name]) {
      details.push(`Heals ${percent(DRAIN[name])} of damage dealt.`)
    }
    if (self) {
      details.push(
        `${self[0] < 1 ? `${percent(self[0])} chance: ` : ''}User’s ${statChanges(self[1])}.`
      )
    }
    if (RECOIL[name]) {
      details.push(`Recoil: ${percent(RECOIL[name])} of damage dealt. Rock Head prevents it.`)
    }
    if (CRASH.has(name)) {
      details.push('A crash costs half the user’s health.')
    }
    if (IGNORE_STAGES.has(name)) {
      details.push('Ignores the target’s stat changes.')
    }
    if (name === 'Sucker Punch' || name === 'Thunderclap') {
      details.push('Fails unless the target is about to attack.')
    }
    if (HALF_COST.has(name)) {
      details.push('Costs half the user’s health.')
    }
    if (RECHARGE.includes(name)) {
      details.push('Must rest the next turn unless the move rises.')
    }
    if (name === 'Thunder' || name === 'Hurricane') {
      details.push('Never misses in rain. 50% accuracy in sun.')
    }
    if (name === 'Blizzard') {
      details.push('Never misses in snow.')
    }
    if (name === 'Solar Beam') {
      details.push('Half power in rain or snow.')
    }
    if (exclusive) {
      details.push('Exclusive move.')
      if (exclusive.seBoost) {
        details.push('A third stronger when super effective.')
      }
      if (exclusive.fickle) {
        details.push('1 in 3 chance to deal double damage.')
      }
      if (exclusive.sun) {
        details.push('Stronger in sun.')
      }
      if (exclusive.crit === 'always') {
        details.push('Always lands a critical hit.')
      }
      if (exclusive.crit === 'high') {
        details.push('High critical hit rate.')
      }
      if (exclusive.judgment) {
        details.push('Uses the type that hits the target hardest, with a same-type attack bonus.')
      }
      if (exclusive.flying) {
        details.push('Can hit Flying Pokémon.')
      }
    }
    if (rise) {
      details.push(
        `Can rise to ${rise} (power ${powerOf(rise)}, never misses) on a 1 in ${1 / ULTIMATE} roll.`
      )
    }
  }

  return { name, type, kind, power, accuracy, sameType, recommended, rise, details }
}
