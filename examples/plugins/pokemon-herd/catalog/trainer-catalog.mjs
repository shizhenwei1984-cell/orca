import { loadSettings } from '../encounters/rules/settings.js'
import {
  canChoose,
  entryOf,
  favoriteKeys,
  genderChoices,
  megaForms,
  searchEntries
} from './dex.mjs'

const PREFERENCES = 'catalog.preferences'
const SOURCES = ['starters', 'any', 'favorites']

export function catalogUnlocks(save) {
  const { trainer, legendsOpen } = loadSettings(save.settings)
  return { trainer, legendsOpen, caught: save.dex.caught, shinyUnlocked: save.dex.shiny }
}

function asUnlocks({ caught, shinyUnlocked, ...settings }) {
  return { ...settings, caught: new Set(caught), shinyUnlocked: new Set(shinyUnlocked) }
}

export function appearanceOf({ dex, form, gender, shiny, mega, megaKind }) {
  return {
    dex,
    ...(form ? { form } : {}),
    ...(gender ? { gender } : {}),
    ...(shiny ? { shiny } : {}),
    ...(mega ? { mega } : {}),
    ...(megaKind !== undefined ? { megaKind } : {})
  }
}

export function validateChoice(save, pokemon, action) {
  const { dex, form, gender, mega, megaKind, shiny } = action
  const entry = entryOf({ dex, form })
  if (!entry || !canChoose(entry, asUnlocks(catalogUnlocks(save)))) {
    throw new Error('That Pokémon is unavailable.')
  }
  const same = dex === pokemon.dex && form === (pokemon.form ?? undefined) && !action.fresh
  const megas = megaForms(entry)
  if (
    (gender !== undefined && !genderChoices(dex).includes(gender)) ||
    (mega !== undefined && !['on', 'off', 'auto'].includes(mega)) ||
    (megaKind !== undefined && !megas.some(({ kind }) => kind === megaKind)) ||
    (shiny !== undefined && typeof shiny !== 'boolean') ||
    (shiny === true &&
      (!entry.shiny || (!save.dex.shiny.includes(dex) && !(same && pokemon.shiny))))
  ) {
    throw new Error('That appearance is unavailable.')
  }
  return { same, gender, mega, megaKind, shiny }
}

export function initialCatalogPick(save, { source, favorites }, rnd) {
  if (source === 'starters') {
    return undefined
  }
  const unlocks = asUnlocks(catalogUnlocks(save))
  const choices = searchEntries('', {
    keys: source === 'favorites' ? new Set(favorites) : undefined,
    available: (entry) => canChoose(entry, unlocks)
  })
  const entry = choices[Math.floor(rnd() * choices.length)]
  return entry && appearanceOf({ dex: entry.dex, form: entry.form })
}

export function registerCatalogPreferences(orca) {
  let current
  let tail = Promise.resolve()

  async function read() {
    if (!current) {
      const stored = await orca.storage.get(PREFERENCES)
      current ??= {
        source: SOURCES.includes(stored?.source) ? stored.source : 'starters',
        favorites: favoriteKeys(stored?.favorites)
      }
    }
    return current
  }

  orca.panels.handle(PREFERENCES, (input) => {
    const result = tail.then(async () => {
      const stored = await read()
      if (input == null) {
        return stored
      }
      const { source, key, favorite } = input
      let next
      if (SOURCES.includes(source) && key === undefined) {
        next = { ...stored, source }
      } else if (
        source === undefined &&
        favoriteKeys([key]).length &&
        typeof favorite === 'boolean'
      ) {
        next = {
          ...stored,
          favorites: favorite
            ? favoriteKeys([...stored.favorites, key])
            : stored.favorites.filter((saved) => saved !== key)
        }
      } else {
        throw new Error('Invalid catalog preference')
      }
      try {
        await orca.storage.set(PREFERENCES, next)
        current = next
      } catch (error) {
        current = undefined
        throw error
      }
      return next
    })
    tail = result.catch(() => {})
    return result
  })
  return () => tail.then(read)
}
