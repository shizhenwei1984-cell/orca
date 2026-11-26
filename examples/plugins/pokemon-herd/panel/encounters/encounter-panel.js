const text = (tag, value, className) => {
  const node = document.createElement(tag)
  if (className) {
    node.className = className
  }
  if (value != null) {
    node.textContent = value
  }
  return node
}

const seconds = (at, now) => Math.max(0, Math.ceil((at - now) / 1000))
const pct = (hp) => Math.max(0, Math.min(100, Math.round(hp * 100)))

function label(title, control) {
  const node = text('label', null, 'encounter-field')
  control.setAttribute('aria-label', title)
  node.append(text('span', title), control)
  return node
}

function options(values, selected) {
  const select = text('select')
  for (const [value, name] of values) {
    const option = text('option', name)
    option.value = value
    select.append(option)
  }
  if (Array.from(select.options).some((option) => option.value === selected)) {
    select.value = selected
  }
  return select
}

function health(pick, caption) {
  const row = text('div', null, 'encounter-health')
  const hp = pick.hp
  const name = caption || pick.name
  const bar = text('meter')
  bar.min = 0
  bar.max = 100
  bar.value = hp == null ? 0 : pct(hp)
  bar.setAttribute('aria-label', `${name} HP`)
  bar.dataset.low = String(hp == null || hp <= 0.2)
  row.append(text('span', name), bar, text('span', hp == null ? 'Resting' : `${pct(hp)}%`))
  return row
}

function reward(reward) {
  if (!reward) {
    return ''
  }
  if (reward.again) {
    return 'Floor reward already collected today.'
  }
  return [
    reward.money ? `₽${reward.money.toLocaleString()}` : '',
    ...reward.items.map(({ count, name }) => `${count} × ${name}`)
  ]
    .filter(Boolean)
    .join(' · ')
}

function resultLine(result) {
  const name = result.pick?.name
  const own = result.own?.name
  switch (result.kind) {
    case 'throwing':
      return `${result.ball} thrown${result.bait ? ` with ${result.bait}` : ''}…`
    case 'gift':
      return `${name} left a gift`
    case 'caught':
      return `${name} was caught and sent to the Box!`
    case 'broke-free':
      return `${name} broke free`
    case 'fled':
      return `${name} fled`
    case 'wild-fainted':
      return `${name} fainted`
    case 'departed':
      return `${result.trainer ?? name} left`
    case 'exchange':
      return result.fainted ? `${own} fainted` : `${own} vs. ${name}`
    case 'trainer-won':
      return result.floor ? `Floor ${result.floor} cleared` : `You defeated ${result.trainer}`
    case 'trainer-lost':
      return `${result.trainer} won the battle`
    case 'send-out':
      return `${result.trainer} sent out ${name}`
    case 'healed':
      return `${own} used ${result.item}`
    case 'tower-ended':
      return `${result.reason}. ${result.wins} floor${result.wins === 1 ? '' : 's'} cleared.`
    case 'raid-egg':
      return 'A raid egg appeared'
    case 'raid-hit':
      return `${own} struck the raid boss`
    case 'raid-won':
      return `${name} was defeated. Catch it while it’s here!`
    case 'spar':
      return `${result.winner === 'a' ? own : name} won the spar`
    default:
      return ''
  }
}

function turnLine(turn, names) {
  const details = [...turn.notes]
  if (turn.miss) {
    details.unshift('Missed')
  } else if (turn.damage != null) {
    if (turn.effectiveness === 0) {
      details.unshift('No effect')
    } else if (turn.effectiveness > 1) {
      details.unshift('Super effective')
    } else if (turn.effectiveness < 1) {
      details.unshift('Not very effective')
    }
    if (turn.damage > 0) {
      details.push(`${pct(turn.damage)}% HP`)
    }
  }
  if (turn.crit) {
    details.unshift('Critical hit')
  }
  const move = turn.move ? ` · ${turn.move}` : ''
  return `${names[turn.side]}${move}${details.length ? ` · ${details.join(' · ')}` : ''}`
}

function battleLog(result, now) {
  const header = resultLine(result)
  const region = text('section', null, 'encounter-result')
  region.append(text('strong', header))
  const paid = reward(result.reward)
  if (paid) {
    region.append(text('p', paid))
  }
  if (result.kind === 'throwing') {
    const ball = text('div', '◉', 'encounter-ball')
    ball.setAttribute('aria-hidden', 'true')
    ball.style.animationDelay = `${740 - (now - result.at)}ms`
    ball.style.animationIterationCount = result.shakes
    region.append(ball)
  } else if (result.shakes != null) {
    region.append(
      text('p', `${result.shakes} shake${result.shakes === 1 ? '' : 's'}`, 'encounter-muted')
    )
  }
  if (result.kind === 'spar') {
    region.append(
      health({ ...result.own, hp: result.hp.a }),
      health({ ...result.pick, hp: result.hp.b })
    )
    const suffix = result.money ? ` · ₽${result.money}` : ''
    region.append(
      text('p', `Today’s record ${result.record.join('–')}${suffix}`, 'encounter-muted')
    )
  }
  if (result.hit) {
    const { hit } = result
    const back = hit.back
    region.append(text('p', `${hit.name} · ${hit.miss ? 'Missed' : `${pct(hit.dmg)}% HP`}`))
    if (back) {
      region.append(text('p', `${back.name} · ${back.miss ? 'Missed' : `${pct(back.dmg)}% HP`}`))
    }
  }
  if (result.turns?.length) {
    const log = text('ol', null, 'encounter-turns')
    const names = { own: result.own.name, opponent: result.pick.name }
    for (const turn of [...(result.entry ?? []), ...result.turns, ...(result.end ?? [])]) {
      if (turn.move || turn.notes.length) {
        log.append(text('li', turnLine(turn, names)))
      }
    }
    region.append(log)
  }
  return region
}

// The host owns refreshes and persists actions through onAction. render accepts a structured snapshot.
export function mountEncounterPanel(root, { onAction, sprite }) {
  const sheet = text('link')
  sheet.rel = 'stylesheet'
  sheet.href = new URL('./encounters.css', import.meta.url).href
  const content = text('section', null, 'encounter-panel')
  const live = text('p', null, 'encounter-live')
  live.setAttribute('role', 'status')
  root.replaceChildren(sheet, live, content)
  let model
  let pending = false
  let error = ''
  let selected = ''
  let ballChoice
  let berryChoice
  let sparPartner
  let visitorId
  let lastResult

  function button(name, command, disabled = false, primary = false) {
    const node = text('button', name)
    node.type = 'button'
    node.disabled = pending || disabled
    node.className = primary ? 'encounter-primary' : ''
    node.setAttribute('data-encounter-control', JSON.stringify(command))
    node.addEventListener('click', async () => {
      if (pending) {
        return
      }
      pending = true
      error = ''
      draw()
      try {
        const response = await onAction(command)
        if (response?.error) {
          error = response.error
        }
      } catch {
        error = 'The encounter action could not be saved.'
      } finally {
        pending = false
        draw()
      }
    })
    return node
  }

  function portrait(pick) {
    const node = text('div', null, 'encounter-portrait')
    const asset = sprite?.(pick)
    if (asset) {
      const image = text('img')
      image.src = asset
      image.alt = ''
      image.addEventListener('error', () => image.remove(), { once: true })
      node.append(image)
    }
    const info = text('div')
    info.append(text('strong', pick.name))
    if (pick.tags.length) {
      info.append(text('p', pick.tags.join(' · '), 'encounter-muted'))
    }
    node.append(info)
    return node
  }

  function drawCapture(node, visitor) {
    const offer = visitor.catch
    const gift = visitor.canGift
    if (gift) {
      node.append(button('Collect gift', { type: 'gift', id: visitor.id }, false, true))
    }
    if (!offer) {
      return
    }
    const ball = options(
      [
        [
          '',
          offer.ball ? `Auto · ${offer.bag.find((item) => item.id === offer.ball)?.name}` : 'Auto'
        ],
        ...offer.bag.map((item) => [item.id, `${item.name} · ${item.count}`])
      ],
      ballChoice ?? offer.selectedBall ?? ''
    )
    const berry = options(
      [
        ['auto', 'Auto'],
        ['', 'None'],
        ...offer.berries.map((item) => [item.id, `${item.name} · ${item.count}`])
      ],
      berryChoice ?? offer.selectedBerry ?? ''
    )
    ball.setAttribute('data-encounter-control', 'ball')
    berry.setAttribute('data-encounter-control', 'berry')
    ball.addEventListener('change', () => {
      ballChoice = ball.value
      draw()
    })
    berry.addEventListener('change', () => {
      berryChoice = berry.value
      draw()
    })
    const choice = text('div', null, 'encounter-actions')
    choice.append(
      label('Ball', ball),
      label('Berry', berry),
      button(
        'Throw ball',
        { type: 'throw', id: visitor.id, ball: ball.value || null, bait: berry.value || null },
        !ball.value && !offer.ball,
        true
      )
    )
    node.append(choice)
    const chance = offer.chance[ball.value || offer.ball]?.[berry.value]
    if (chance != null) {
      node.append(text('p', `${pct(chance)}% catch chance`, 'encounter-muted'))
    }
    if (offer.remaining != null) {
      node.append(text('p', `${offer.remaining} throws left`, 'encounter-muted'))
    }
  }

  function draw() {
    if (!model) {
      return
    }
    const { now, visitor, party, raid, tower, outbreak, busy, result } = model
    const focused = document.activeElement?.getAttribute('data-encounter-control')
    if (visitorId !== visitor?.id) {
      visitorId = visitor?.id
      ballChoice = undefined
      berryChoice = undefined
    }
    const ready = party.filter((mon) => mon.able)
    const fighter = party.find((mon) => mon.fighter)
    const current = party.find((mon) => mon.slot === selected) ?? fighter ?? ready[0] ?? party[0]
    const body = text('div', null, 'encounter-stack')
    const title = visitor?.trainer
      ? `${visitor.trainer.title} ${visitor.trainer.name}`
      : visitor?.raid
        ? 'Catch the raid boss'
        : visitor
          ? 'Wild encounter'
          : 'Encounters'
    body.append(text('h2', title))

    if (outbreak) {
      body.append(
        text(
          'p',
          `${outbreak.name} outbreak · ${Math.ceil(seconds(outbreak.until, now) / 60)} min left`,
          'encounter-muted'
        )
      )
    }
    if (raid) {
      const hatching = raid.phase === 'egg'
      const headline = hatching
        ? `Raid egg · hatches in ${seconds(raid.deadline, now)} s`
        : raid.phase === 'battle'
          ? `Raid · ${Math.ceil(seconds(raid.deadline, now) / 60)} min left`
          : raid.phase === 'gone'
            ? 'The raid boss escaped'
            : 'The raid boss was defeated'
      body.append(text('p', headline))
      if (raid.phase === 'battle') {
        body.append(portrait(raid.pick), health(raid.pick))
      }
    }
    if (visitor) {
      body.append(portrait(visitor.pick), health(visitor.pick, 'Visitor HP'))
      if (visitor.trainer) {
        const { remaining, floor, lives, greet } = visitor.trainer
        const details = [
          floor && `Floor ${floor}`,
          `${remaining} Pokémon left`,
          lives && `${lives} lives left`
        ]
        body.append(text('p', details.filter(Boolean).join(' · '), 'encounter-muted'))
        if (greet) {
          body.append(text('p', greet))
        }
      }
      if (!busy) {
        drawCapture(body, visitor)
      }
    } else if (raid?.phase !== 'battle' && raid?.phase !== 'egg') {
      body.append(
        text(
          'p',
          model.callPending
            ? 'A visitor is on its way.'
            : model.nextVisit == null
              ? 'Encounters will appear here.'
              : `Next visitor in ${seconds(model.nextVisit, now)} s`,
          'encounter-muted'
        )
      )
    }

    if (current) {
      const select = options(
        party.map((mon) => [mon.slot, mon.able ? mon.name : `${mon.name} · unavailable`]),
        current.slot
      )
      select.setAttribute('data-encounter-control', 'fighter')
      select.addEventListener('change', () => {
        selected = select.value
        draw()
      })
      body.append(label('Your Pokémon', select), health(current))
      const actions = text('div', null, 'encounter-actions')
      if (visitor && !busy) {
        const command = { type: 'attack', slot: current.slot, id: visitor.id }
        const label = current.fighter ? 'Fight' : fighter ? 'Switch in' : 'Battle'
        actions.append(button(label, command, !current.able, !visitor.canGift && !visitor.catch))
        const showMoves = !fighter || current.fighter
        if (showMoves) {
          for (const move of current.moves) {
            actions.append(button(move.name, { ...command, move: move.name }, !current.able))
          }
        }
        if (fighter) {
          actions.append(button('Withdraw', { type: 'withdraw', id: visitor.id }))
        }
      }
      if (raid?.phase === 'battle') {
        const wait = seconds(current.cooldownUntil, now)
        actions.append(
          button(
            wait ? `Raid strike in ${wait} s` : 'Strike raid boss',
            { type: 'raid-hit', id: raid.id, slot: current.slot },
            busy || !current.able || wait > 0,
            !visitor
          )
        )
      }
      if (model.healing.length) {
        for (const item of model.healing) {
          actions.append(
            button(
              `Use ${item.name} · ${item.count}`,
              { type: 'heal', id: visitor?.id, slot: current.slot, item: item.id },
              busy
            )
          )
        }
      }
      body.append(actions)

      const sparringPartners = ready.filter((mon) => mon.slot !== current.slot)
      if (sparringPartners.length && !fighter && current.able && !busy) {
        const partner = options(
          sparringPartners.map((mon) => [mon.slot, mon.name]),
          sparPartner
        )
        const sparActions = text('div', null, 'encounter-actions')
        const sparButton = () =>
          button('Spar', { type: 'spar', slot: current.slot, opponent: partner.value })
        partner.setAttribute('data-encounter-control', 'spar')
        sparActions.append(label('Spar with', partner), sparButton())
        partner.addEventListener('change', () => {
          sparPartner = partner.value
          sparActions.lastChild.replaceWith(sparButton())
        })
        body.append(sparActions)
      }
    }

    const events = text('div', null, 'encounter-actions')
    if (tower.run) {
      const { wins, lives, benchHeals } = tower.run
      body.append(
        text(
          'p',
          `Battle Tower · ${wins} cleared · ${lives} lives · ${benchHeals} bench heals`,
          'encounter-muted'
        )
      )
      events.append(button('End climb', { type: 'tower-quit' }, busy))
    } else {
      events.append(
        button('Enter Battle Tower', { type: 'tower-start' }, busy || !model.canStartTower)
      )
      if (tower.best) {
        body.append(text('p', `Tower best · ${tower.best} floors`, 'encounter-muted'))
      }
    }
    for (const call of model.calls) {
      events.append(button(`Use ${call.name} · ${call.count}`, { type: 'call', item: call.id }))
    }
    body.append(events)
    if (error) {
      body.append(text('p', error, 'encounter-error'))
    }
    if (result) {
      body.append(battleLog(result, now))
    }
    const resultKey = result ? `${result.at}:${result.kind}` : null
    if (resultKey !== lastResult || error) {
      live.textContent = error || (result ? resultLine(result) : '')
      lastResult = resultKey
    }
    content.replaceChildren(body)
    if (focused) {
      Array.from(content.querySelectorAll('[data-encounter-control]'))
        .find((control) => control.getAttribute('data-encounter-control') === focused)
        ?.focus({ preventScroll: true })
    }
  }

  return {
    render(snapshot) {
      model = snapshot
      draw()
    },
    destroy() {
      root.replaceChildren()
    }
  }
}
