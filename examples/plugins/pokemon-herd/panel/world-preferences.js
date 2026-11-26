import { captureSettings, WORLD_SETTINGS_KEY } from '../world-settings.mjs'

export function bindWorldPreferences(orca, signal, apply) {
  const form = document.querySelector('#world-settings')
  const status = document.querySelector('#settings-status')
  const preview = document.querySelector('#preview-sound')
  const save = form.querySelector('[type="submit"]')
  const controls = [...form.querySelectorAll('select, input')]
  let audio
  let current = { ...values(), ...captureSettings() }

  function values() {
    return Object.fromEntries(
      controls.map((control) => [
        control.name,
        control.type === 'checkbox'
          ? control.checked
          : control.name === 'rows' || control.name === 'scale'
            ? Number(control.value)
            : control.value
      ])
    )
  }

  function update(settings) {
    current = settings
    apply(settings)
  }

  function arm(event) {
    if (!signal.aborted && window.AudioContext && event.isTrusted) {
      audio ??= new AudioContext()
      if (audio.state === 'suspended') {
        void audio.resume().catch(() => {})
      }
    }
  }

  function play(kind) {
    if (signal.aborted || audio?.state !== 'running') {
      return
    }
    const frequencies = kind === 'spar' ? [392, 330] : [523, 659]
    for (const [index, frequency] of frequencies.entries()) {
      const start = audio.currentTime + index * 0.07
      const note = audio.createOscillator()
      const level = audio.createGain()
      note.frequency.value = frequency
      level.gain.setValueAtTime(0.001, start)
      level.gain.exponentialRampToValueAtTime(0.045, start + 0.015)
      level.gain.exponentialRampToValueAtTime(0.001, start + 0.1)
      note.connect(level).connect(audio.destination)
      note.start(start)
      note.stop(start + 0.1)
    }
  }

  preview.addEventListener(
    'click',
    (event) => {
      if (event.isTrusted) {
        arm(event)
        void audio
          ?.resume()
          .then(() => play('pet'))
          .catch(() => {})
      }
    },
    { signal }
  )

  const inputs = [...controls, save]
  function busy(value) {
    for (const input of inputs) {
      input.disabled = value
    }
  }

  async function load() {
    busy(true)
    try {
      const [stored, battleSounds, catalog] = await Promise.all([
        orca.storage.get(WORLD_SETTINGS_KEY),
        orca.storage.get('battle.sounds'),
        orca.plugin.request('catalog.preferences', null, { signal })
      ])
      if (signal.aborted) {
        return
      }
      for (const control of controls) {
        const value =
          control.name === 'battleSounds'
            ? (stored?.battleSounds ?? battleSounds)
            : control.name === 'visitors' && stored?.visitors === false
              ? 'off'
              : (stored?.[control.name] ?? catalog?.[control.name])
        if (control.type === 'checkbox') {
          if (typeof value === 'boolean') {
            control.checked = value
          }
        } else if ([...control.options].some((option) => option.value === String(value))) {
          control.value = String(value)
        }
      }
      update({ ...values(), ...captureSettings(stored) })
    } catch {
      status.textContent = 'Could not load saved settings.'
    } finally {
      busy(false)
    }
  }

  async function persist(next, patch) {
    busy(true)
    status.textContent = ''
    try {
      await orca.storage.set(WORLD_SETTINGS_KEY, next)
      if (!signal.aborted) {
        for (const control of controls) {
          if (Object.hasOwn(patch, control.name)) {
            if (control.type === 'checkbox') {
              control.checked = next[control.name]
            } else {
              control.value = String(next[control.name])
            }
          }
        }
        update(next)
        status.textContent = 'Settings saved.'
      }
    } catch (error) {
      status.textContent = 'Could not save settings. Try again.'
      throw error
    } finally {
      busy(false)
    }
  }

  form.addEventListener(
    'submit',
    (event) => {
      event.preventDefault()
      void persist({ ...current, ...values() }, {}).catch(() => {})
    },
    { signal }
  )

  signal.addEventListener(
    'abort',
    () => {
      if (audio) {
        void audio.close().catch(() => {})
      }
    },
    { once: true }
  )

  void load()
  return {
    get: () => current,
    async patch(patch) {
      if (save.disabled) {
        throw new Error('Settings are still loading.')
      }
      return persist({ ...current, ...patch }, patch)
    },
    arm(event) {
      if (current.sound) {
        arm(event)
      }
    },
    play(kind) {
      if (current.sound) {
        play(kind)
      }
    }
  }
}
