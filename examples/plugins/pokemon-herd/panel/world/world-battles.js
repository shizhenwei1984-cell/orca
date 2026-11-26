import { battleSoundURL, createBattleAudio } from '../encounters/battle-audio.js'
import { mountBattleEffects } from '../encounters/battle-effects.js'
import {
  battleSounds,
  battleTimeline,
  EFFECT_TAIL,
  oppositeSide
} from '../encounters/battle-timeline.js'

export function mountWorldBattles(root, signal) {
  const effects = mountBattleEffects(root, 'pokemon-world__battle')
  const audio = createBattleAudio(root, signal)
  const sounded = new WeakMap()
  const shifted = new Set()
  let battle = null
  let recentSpar

  function update(value) {
    if (!value) {
      battle = null
    } else if (value.result.at !== battle?.at || value.opponent !== battle.opponent) {
      battle = { ...value, at: value.result.at, beats: battleTimeline(value.result) }
      if (value.spar) {
        recentSpar = battle
      }
    }
  }

  function paint(actors, now, reduced, sound) {
    for (const sprite of shifted) {
      sprite.style.translate = ''
      sprite.style.opacity = ''
    }
    shifted.clear()
    if (root.ownerDocument.hidden) {
      effects.clear()
      return
    }
    const active = ({ beats }) =>
      beats.some(({ at, land }) => now >= at && now < land + EFFECT_TAIL)
    if (!sound) {
      audio.stop()
    }
    const scripted = actors.flatMap((actor) => {
      const spar = actor.react?.spar
      if (!spar || !active(spar)) {
        return []
      }
      const overlaps = (game) =>
        game &&
        game.at >= spar.beats[0].at - 1000 &&
        game.at <= spar.beats.at(-1).land &&
        [game.own, game.opponent].includes(spar.own) &&
        [game.own, game.opponent].includes(spar.opponent)
      return overlaps(recentSpar) ? [] : [spar]
    })
    const games = battle && active(battle) ? [...scripted, battle] : scripted
    if (!games.length) {
      effects.clear()
      return
    }
    if (!effects.begin()) {
      return
    }
    const byId = new Map(actors.map((actor) => [actor.entity.id, actor]))
    function position(actor) {
      return {
        ...actor.battlePosition,
        shift(dx, dy, opacity = 1) {
          actor.sprite.style.translate = `${dx}px ${dy}px`
          actor.sprite.style.opacity = opacity
          shifted.add(actor.sprite)
        }
      }
    }
    for (const game of games) {
      const own = byId.get(game.own)
      const opponent = byId.get(game.opponent)
      if (!own || !opponent) {
        continue
      }
      const sides = { own: position(own), opponent: position(opponent) }
      for (const beat of game.beats) {
        const side = beat.turn.side
        effects.draw(beat, now, sides[side], sides[oppositeSide(side)], { reduced, labels: true })
        if (game !== battle && now >= beat.at && now < beat.land + 250) {
          const last = sounded.get(beat) ?? -Infinity
          for (const [at, name] of battleSounds(beat)) {
            if (sound && at > last && now >= at && now - at < 100) {
              audio.play(battleSoundURL(name), 0.3)
            }
          }
          sounded.set(beat, now)
        }
      }
      if (game.spar && now >= game.beats.at(-1).land + 720) {
        const winner = sides[game.result.winner === 'a' ? 'own' : 'opponent']
        effects.label(['Won the spar'], winner.x, winner.top - 11)
      }
    }
  }

  return { paint, update }
}
