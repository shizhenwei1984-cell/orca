const soundURL = (name) => new URL(`./sounds/${name}.mp3`, import.meta.url).href
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
  const playing = new Set()
  const timers = new Set()
  const motion = view.matchMedia('(prefers-reduced-motion: reduce)')
  let key
  let enabled = false
  let generation = 0
  let cryAt = -Infinity
  let soundMount

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

  function play(src, volume = 0.38) {
    if (!src || !enabled) {
      return
    }
    const audio = new view.Audio(src)
    audio.volume = volume
    playing.add(audio)
    const cleanup = () => playing.delete(audio)
    audio.addEventListener('ended', cleanup, { once: true })
    audio.addEventListener('error', cleanup, { once: true })
    void audio.play().catch(cleanup)
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
    const when = (stamp, fn) => {
      const wait = Math.max(0, stamp - wallTime)
      if (!wait) {
        fn(stamp >= wallTime - 250)
        return
      }
      const timer = view.setTimeout(() => {
        timers.delete(timer)
        fn(true)
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
    const { hit } = result
    const raidTurns = hit && [
      { ...hit, side: 'own', move: hit.name, damage: hit.dmg, targetHp: result.hp },
      ...(hit.back
        ? [
            {
              ...hit.back,
              side: 'opponent',
              move: hit.back.name,
              damage: hit.back.dmg,
              targetHp: Math.max(0, (result.ownBefore ?? 1) - hit.back.dmg)
            }
          ]
        : [])
    ]
    const turns = raidTurns ?? result.turns
    const exchange = result.kind === 'exchange' || result.kind === 'wild-fainted'
    const start = result.at + (exchange && result.entry?.length ? 900 : 0)
    const spacing = exchange ? 1100 : 1050
    for (const [i, turn] of turns.entries()) {
      const attacker = sides[turn.side]
      const target = turn.side === 'own' ? other : yours
      const dir = turn.side === 'own' ? 1 : -1
      const attackAt = start + i * spacing
      when(attackAt, (fresh) => {
        message.textContent = turn.move ?? turn.notes?.[0] ?? ''
        if (!fresh || !turn.move) {
          return
        }
        play(soundURL(turn.physical ? 'whoosh' : 'zap'), 0.25)
        animate(
          attacker.face,
          [
            { transform: 'none' },
            {
              transform: `translateX(${dir * (turn.physical ? 22 : 5)}px) scale(1.08)`,
              offset: 0.64
            },
            { transform: 'none' }
          ],
          620
        )
        if (!turn.physical && turn.damage != null && !(reducedMotion?.() ?? motion.matches)) {
          const shot = projectile(
            fx,
            turn.side,
            '✦',
            [{ left: `${50 - 25 * dir}%` }, { left: `${50 + 25 * dir}%` }],
            470
          )
          shot.getAnimations()[0]?.finished.then(
            () => shot.remove(),
            () => shot.remove()
          )
        }
      })
      when(attackAt + 475, (fresh) => {
        const recoil = turn.ownHp != null && turn.ownHp < attacker.meter.value
        if (turn.targetHp != null) {
          target.meter.value = turn.targetHp
        }
        if (turn.ownHp != null) {
          attacker.meter.value = turn.ownHp
        }
        if (!fresh || !turn.move) {
          return
        }
        if (recoil) {
          animate(attacker.face, [{ transform: 'scale(0.86)' }, { transform: 'none' }], 320)
        }
        if (turn.damage > 0 && !turn.miss) {
          play(soundURL(turn.targetHp <= 0 ? 'faint' : turn.crit ? 'bighit' : 'hit'))
          animate(
            target.face,
            [
              { transform: `translateX(${dir * 14}px)`, opacity: 0.42 },
              { transform: 'none', opacity: 1 }
            ],
            450
          )
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
        for (const audio of playing) {
          audio.pause()
        }
        playing.clear()
      }
    },
    clear,
    reset() {
      for (const audio of playing) {
        audio.pause()
      }
      playing.clear()
      clear()
    },
    destroy() {
      this.sound(false)
      clear()
    }
  }
}
