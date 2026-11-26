const quietPetErrors = new Set(['Friendship is already full.', 'This Pokémon was petted recently.'])

export function mountWorldCare(orca, status, onSaved) {
  const client = Array.from(crypto.getRandomValues(new Uint8Array(18)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
  let sequence = 0
  let sending

  return async (action, agent, scope, terminalIds) => {
    if (scope.aborted || sending === scope || !agent.ref) {
      return
    }
    sending = scope
    status.textContent = ''
    const payload = {
      client,
      sequence: ++sequence,
      terminalIds,
      action: { ...action, target: agent.ref, worldTerminalId: agent.id }
    }
    const send = () => orca.plugin.request('trainer.command', payload, { signal: scope })
    try {
      let result
      try {
        result = await send()
      } catch (error) {
        if (scope.aborted) {
          throw error
        }
        result = await send()
      }
      if (!scope.aborted && result.ok) {
        status.textContent =
          action.type === 'pet' ? `Petted ${agent.species}.` : `Fed ${agent.species}.`
        onSaved(action)
      } else if (!scope.aborted && !quietPetErrors.has(result.message)) {
        status.textContent = result.message
      }
    } catch {
      if (!scope.aborted) {
        status.textContent = 'Could not save Pokémon care. Try again.'
      }
    } finally {
      if (sending === scope) {
        sending = undefined
      }
    }
  }
}

export function mountWorldCries(orca, settings) {
  let active
  let lastAt = -Infinity
  return async (preference, dex, scope) => {
    if (!settings()[preference] || !dex || scope.aborted || Date.now() - lastAt < 2000) {
      return
    }
    lastAt = Date.now()
    try {
      const source = await orca.plugin.request('encounter.cry', { dex }, { signal: scope })
      if (!source || scope.aborted || !settings()[preference]) {
        return
      }
      active?.pause()
      const audio = new Audio(source)
      active = audio
      audio.volume = preference === 'cryRare' ? 0.24 : 0.38
      const stop = () => audio.pause()
      scope.addEventListener('abort', stop, { once: true })
      const cleanup = () => {
        scope.removeEventListener('abort', stop)
        if (active === audio) {
          active = undefined
        }
      }
      audio.addEventListener('ended', cleanup, { once: true })
      audio.addEventListener('pause', cleanup, { once: true })
      await audio.play().catch(cleanup)
    } catch {
      // Audio may be unavailable until the panel receives a gesture.
    }
  }
}
