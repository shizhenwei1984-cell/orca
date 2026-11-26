import { battleSoundURL, createBattleAudio } from '../encounters/battle-audio.js'
import { mountBattleEffects } from '../encounters/battle-effects.js'
import { battleActive, battleSprites, statusTag } from '../encounters/battle-sprites.js'
import { battleSounds, battleTimeline, oppositeSide } from '../encounters/battle-timeline.js'

export function mountWorldBattles(root, signal) {
  const effects = mountBattleEffects(root, 'pokemon-world__battle')
  const audio = createBattleAudio(root, signal)
  const sounded = new WeakMap()
  const shifted = new Set()
  let battle = null
  let statuses = new Map()
  let games = []
  let recentSpar

  function update(value) {
    statuses = value?.statuses ?? new Map()
    const game = value?.game
    if (!game) {
      battle = null
    } else if (game.result.at !== battle?.at || game.opponent !== battle.opponent) {
      battle = { ...game, at: game.result.at, beats: battleTimeline(game.result) }
      if (game.spar) {
        recentSpar = battle
      }
    }
  }

  function prepare(actors, now) {
    const active = ({ beats }) => battleActive(beats, now)
    const scripted = actors.flatMap((actor) => {
      actor.battleSprite = null
      actor.battleStatus = statuses.get(actor.entity.id)
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
    const queued = battle && active(battle) ? [...scripted, battle] : scripted
    if (!queued.length) {
      games = []
      return
    }
    const byId = new Map(actors.map((actor) => [actor.entity.id, actor]))
    games = queued.flatMap((game) => {
      const own = byId.get(game.own)
      const opponent = byId.get(game.opponent)
      if (!own || !opponent) {
        return []
      }
      if (game.result) {
        const poses = battleSprites(game.beats, game.result.statusBefore, now)
        const facing = own.x <= opponent.x ? 'r' : 'l'
        own.battleSprite = { ...poses.own, facing }
        opponent.battleSprite = { ...poses.opponent, facing: facing === 'r' ? 'l' : 'r' }
        if (game.result.statusBefore) {
          own.battleStatus = poses.own.status
          opponent.battleStatus = poses.opponent.status
        }
      }
      return [{ game, own, opponent }]
    })
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
    if (!sound) {
      audio.stop()
    }
    if (!games.length && !actors.some(({ battleStatus }) => battleStatus)) {
      effects.clear()
      return
    }
    if (!effects.begin()) {
      return
    }
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
    for (const { game, own, opponent } of games) {
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
    for (const { battlePosition, battleStatus, battleSprite } of actors) {
      if (!reduced && battleSprite?.aura) {
        effects.aura(battleSprite.aura, battlePosition)
      }
      const tag = statusTag(battleStatus)
      if (tag[0]) {
        effects.label(tag, battlePosition.x - 18, battlePosition.top + 7)
      }
    }
  }

  return { prepare, paint, update }
}
