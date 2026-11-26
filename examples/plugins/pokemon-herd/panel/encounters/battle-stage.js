import { battleSoundURL as soundURL, createBattleAudio } from './battle-audio.js'
import { battleOutcome, mountBattleEffects } from './battle-effects.js'
import { battleSounds, battleTimeline, EFFECT_TAIL, oppositeSide } from './battle-timeline.js'

const trainerURL = (name, pose) => new URL(`./trainers/${name}${pose}.png`, import.meta.url).href
const trainerClasses = new Set([
  'ace',
  'birdkeeper',
  'blackbelt',
  'bugcatcher',
  'engineer',
  'hiker',
  'kindler',
  'psychic',
  'punk',
  'rival',
  'swimmer'
])

export function mountBattleStage(root, { sprite, cry, reducedMotion }) {
  const document = root.ownerDocument
  const view = document.defaultView
  const lifetime = new AbortController()
  const audio = createBattleAudio(root, lifetime.signal)
  const timers = new Set()
  const motion = view.matchMedia('(prefers-reduced-motion: reduce)')
  let key
  let enabled = false
  let generation = 0
  let cryAt = -Infinity
  let soundMount
  let request

  function element(tag, className, text) {
    const el = document.createElement(tag)
    if (className) {
      el.className = className
    }
    if (text != null) {
      el.textContent = text
    }
    return el
  }

  function play(src, volume) {
    if (enabled) {
      audio.play(src, volume)
    }
  }

  function announceCry(pick, volume) {
    if (!enabled || !pick || Date.now() - cryAt < 2000) {
      return
    }
    cryAt = Date.now()
    const active = generation
    Promise.resolve()
      .then(() => cry?.(pick.dex))
      .then((src) => {
        if (active === generation) {
          play(src, volume)
        }
      })
      .catch(() => {})
  }

  function animate(el, frames, duration) {
    if (!(reducedMotion?.() ?? motion.matches)) {
      el.animate(frames, { duration, easing: 'ease-out' })
    }
  }

  function portrait(pick, hp = 1) {
    const figure = element('div', 'encounter-stage-fighter')
    const face = element('div', 'encounter-stage-sprite', pick?.name?.slice(0, 1))
    const meter = element('meter', 'encounter-stage-hp')
    meter.min = 0
    meter.max = 1
    meter.value = hp
    meter.setAttribute('aria-label', `${pick?.name ?? 'Opponent'} HP`)
    const caption = element('span', null, pick?.name)
    figure.append(face, caption, meter)
    if (pick) {
      const image = element('img')
      image.alt = ''
      image.addEventListener('load', () => face.replaceChildren(image), { once: true })
      Promise.resolve()
        .then(() => sprite?.(pick))
        .then((url) => {
          if (url) {
            image.src = url
          }
        })
        .catch(() => {})
    }
    return { figure, face, meter }
  }

  function projectile(layer, side, name, frames, duration) {
    const fx = element('span', `encounter-projectile encounter-projectile-${side}`, name)
    layer.append(fx)
    fx.animate(frames, { duration, easing: 'ease-out', fill: 'both' })
    return fx
  }

  function clear() {
    generation++
    view.cancelAnimationFrame(request)
    audio.stop()
    key = undefined
    for (const timer of timers) {
      view.clearTimeout(timer)
    }
    timers.clear()
    root.replaceChildren()
    root.hidden = true
    delete root.dataset.outcome
  }

  function render(model, wallTime) {
    const visitor = model?.visitor
    const result = model?.result
    const showThrow = result?.shakes != null && model.now < result.revealAt + 1100
    const showFight =
      result && (result.turns?.length || result.hit) && model.now < result.at + 18000
    const showArrival = visitor && model.now - visitor.appearedAt < 3200
    const sendOut = result?.kind === 'send-out' && model.now - result.at < 1900
    const sceneKey =
      showThrow || showFight || sendOut ? `result:${result.at}` : showArrival ? visitor.id : null
    if (!sceneKey) {
      if (key) {
        clear()
      }
      return
    }
    if (sceneKey === key) {
      return
    }
    clear()
    key = sceneKey
    root.hidden = false
    const scene = element('div', 'encounter-stage-scene')
    const message = element('p', 'encounter-stage-call')
    const fx = element('div', 'encounter-stage-effects')
    fx.setAttribute('aria-hidden', 'true')
    const origin = view.performance.now()
    const sceneTime = () => wallTime + view.performance.now() - origin
    const when = (stamp, fn) => {
      const wait = Math.max(0, stamp - wallTime)
      if (!wait) {
        fn(stamp >= wallTime - 250)
        return
      }
      const timer = view.setTimeout(() => {
        timers.delete(timer)
        fn(stamp >= sceneTime() - 250)
      }, wait)
      timers.add(timer)
    }

    const previousHp = result?.hit ? Math.min(1, result.hp + result.hit.dmg) : 1
    const yours = portrait(showFight ? result.own : null, result?.ownBefore ?? 1)
    const other = portrait(
      showFight || showThrow || sendOut ? result.pick : visitor.pick,
      result?.opponentBefore ?? (showFight ? previousHp : (visitor?.pick.hp ?? 1))
    )
    if (!showFight) {
      yours.figure.hidden = true
    }
    scene.append(yours.figure, other.figure, fx)
    root.append(scene, message)

    if (showThrow) {
      const begin = result.at
      const reduced = reducedMotion?.() ?? motion.matches
      let ball
      message.textContent = result.bait ? `${result.ball} · ${result.bait}` : result.ball
      when(begin, (fresh) => {
        if (fresh) {
          play(soundURL('throw'))
        }
        if (reduced) {
          return
        }
        ball = projectile(
          fx,
          'own',
          '◉',
          [
            { left: '14%', top: '65%' },
            { left: '46%', top: '4%', offset: 0.48 },
            { left: '74%', top: '55%' }
          ],
          Math.max(1, 740 - (wallTime - begin))
        )
      })
      when(begin + 740, (fresh) => {
        if (fresh) {
          play(soundURL('absorb'))
        }
        if (!reduced) {
          other.face.style.visibility = 'hidden'
        }
      })
      for (let i = 0; i < result.shakes; i++) {
        when(begin + 740 + i * 700, (fresh) => {
          if (fresh) {
            play(soundURL('shake'))
            if (ball) {
              animate(
                ball,
                [
                  { transform: 'rotate(-25deg) translateX(-4px)' },
                  { transform: 'rotate(25deg) translateX(4px)' },
                  { transform: 'none' }
                ],
                440
              )
            }
          }
        })
      }
      when(result.revealAt, () => {
        other.face.style.visibility = ''
      })
      return
    }

    if (!showFight) {
      const at = sendOut ? result.at : visitor.appearedAt
      const trainer = visitor?.trainer
      if (trainerClasses.has(trainer?.cls)) {
        const art = element('img', 'encounter-stage-trainer')
        art.alt = ''
        other.figure.hidden = true
        scene.append(art)
        when(at, () => {
          art.src = trainerURL(trainer.cls, '-walk1')
        })
        when(at + 300, () => {
          art.src = trainerURL(trainer.cls, '-walk2')
        })
        when(at + 650, () => {
          art.src = trainerURL(trainer.cls, '-throw')
          animate(art, [{ transform: 'translateX(12px)' }, { transform: 'none' }], 380)
        })
        when(at + 1050, (fresh) => {
          art.remove()
          other.figure.hidden = false
          if (fresh) {
            announceCry(sendOut ? result.pick : visitor.pick, 0.22)
          }
        })
      } else {
        when(at, (fresh) => {
          if (fresh) {
            announceCry(sendOut ? result.pick : visitor.pick, 0.22)
          }
        })
      }
      return
    }

    const sides = { own: yours, opponent: other }
    const beats = battleTimeline(result)
    const effects = mountBattleEffects(fx, 'encounter-battle-canvas')
    function draw() {
      const now = sceneTime()
      const reduced = reducedMotion?.() ?? motion.matches
      const active = now < beats.at(-1).land + EFFECT_TAIL
      if (document.hidden || !active || reduced) {
        effects.clear()
      }
      const visible = active && !reduced && !document.hidden && effects.begin()
      const positions = {}
      for (const [side, { face, meter }] of Object.entries(sides)) {
        face.style.translate = ''
        face.style.opacity =
          !reduced && meter.value <= 0 && now >= beats.at(-1).land + 690 ? '0' : ''
        if (!visible) {
          continue
        }
        positions[side] = {
          x: face.offsetLeft + face.offsetWidth / 2,
          y: face.offsetTop + face.offsetHeight / 2,
          ground: face.offsetTop + face.offsetHeight,
          top: face.offsetTop,
          shift(dx, dy, opacity = 1) {
            face.style.translate = `${dx}px ${dy}px`
            face.style.opacity = opacity
          }
        }
      }
      if (active) {
        if (visible) {
          for (const beat of beats) {
            const side = beat.turn.side
            effects.draw(beat, now, positions[side], positions[oppositeSide(side)], { reduced })
          }
        }
        request = view.requestAnimationFrame(draw)
      }
    }
    draw()

    for (const beat of beats) {
      const { turn, at, land } = beat
      const attacker = sides[turn.side]
      const target = sides[oppositeSide(turn.side)]
      for (const [stamp, sound] of battleSounds(beat)) {
        when(stamp, (fresh) => {
          if (fresh) {
            play(soundURL(sound), 0.3)
          }
        })
      }
      when(at, () => {
        message.textContent = turn.move
          ? `${turn.move}${turn.boosted ? ` ${turn.boosted}` : ''}`
          : (turn.notes?.[0] ?? '')
        message.toggleAttribute('data-signature', !!turn.ultimate)
      })
      when(land, (fresh) => {
        const recoil = turn.ownHp != null && turn.ownHp < attacker.meter.value
        if (turn.targetHp != null) {
          target.meter.value = turn.targetHp
        }
        if (turn.ownHp != null) {
          attacker.meter.value = turn.ownHp
        }
        const outcome = battleOutcome(beat)
        const damage =
          beat.strike && !turn.miss && turn.damage > 0
            ? `${Math.min(100, Math.max(1, Math.round(turn.damage * 100)))}% damage`
            : null
        message.textContent =
          [turn.move, outcome?.[0] ?? damage].filter(Boolean).join(' · ') || message.textContent
        if (fresh && recoil) {
          animate(attacker.face, [{ transform: 'scale(0.86)' }, { transform: 'none' }], 320)
        }
      })
    }
  }

  return {
    render(model, wallTime) {
      render(model, wallTime)
      const { result } = model ?? {}
      if (result?.shakes != null && result.outcome) {
        root.dataset.outcome = result.outcome
        root
          .querySelector('.encounter-stage-call')
          ?.replaceChildren(
            result.outcome === 'caught'
              ? 'Caught!'
              : result.outcome === 'fled'
                ? 'It fled!'
                : 'It broke free!'
          )
        if (soundMount !== result.at && wallTime < result.revealAt + 1800) {
          play(soundURL(result.outcome === 'caught' ? 'gotcha' : 'break'))
        }
        soundMount = result.at
      }
    },
    sound(value, preview = false) {
      enabled = value
      if (value && preview) {
        play(soundURL('whoosh'))
      }
      if (!value) {
        audio.stop()
      }
    },
    clear,
    reset: clear,
    destroy() {
      lifetime.abort()
      clear()
    }
  }
}
