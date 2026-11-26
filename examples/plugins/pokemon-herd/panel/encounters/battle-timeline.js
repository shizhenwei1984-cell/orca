import { COUNTER_LAND_MS } from '../../encounters/rules/events.js'
import { FLY, hitSound, launchSound, power } from './fx.js'

export const oppositeSide = (side) => (side === 'own' ? 'opponent' : 'own')
export const EFFECT_TAIL = 1450

export function battleTimeline(result) {
  const { hit } = result
  const raidTurn = (blow, side, targetHp) => ({
    ...blow,
    side,
    move: blow.name,
    damage: blow.dmg,
    effectiveness: blow.eff,
    targetHp
  })
  if (hit) {
    const land = result.at + 475
    const beats = [battleBeat(raidTurn(hit, 'own', result.hp), result.at, land - FLY, land)]
    if (hit.back) {
      const turn = raidTurn(
        hit.back,
        'opponent',
        Math.max(0, (result.ownBefore ?? 1) - hit.back.dmg)
      )
      const counter = result.at + COUNTER_LAND_MS
      beats.push(battleBeat(turn, counter - 475, counter - FLY, counter))
    }
    return beats
  }
  const exchange = result.kind === 'exchange' || result.kind === 'wild-fainted'
  const start = result.at + (exchange && result.entry?.length ? 900 : 0)
  const beats = result.turns.map((turn, index) => {
    const at = start + index * (exchange ? 1100 : 1050)
    return battleBeat(turn, at, at + 475 - FLY, at + 475)
  })
  const end = (beats.at(-1)?.land ?? start) + 750
  for (const [index, tick] of (result.end ?? []).entries()) {
    const at = end + index * 180
    beats.push(battleBeat(tick, at, at, at))
  }
  return beats
}

export function battleBeat(turn, at, launch, land) {
  const strike = !!turn.move && !turn.status && turn.damage != null
  const dash = strike && (turn.dash ?? turn.physical)
  const eff = turn.effectiveness ?? 1
  const faint = strike && !turn.miss && turn.damage > 0 && turn.targetHp <= 0
  const weight = faint
    ? 1
    : turn.crit || turn.ultimate
      ? Math.max(0.85, power(eff))
      : power(eff, !!turn.type)
  return { turn, at, launch, land, strike, dash, eff, faint, weight }
}

export function battleSounds(beat) {
  const { turn, at, launch, land, dash, faint, weight } = beat
  if (!beat.strike) {
    return []
  }
  const sounds = turn.type
    ? [
        [at, 'charge'],
        [launch, launchSound(turn.type, dash)]
      ]
    : []
  if (!turn.miss) {
    sounds.push([land, hitSound(weight)])
  }
  if (faint) {
    sounds.push([land + 90, 'faint'])
  }
  return sounds
}
