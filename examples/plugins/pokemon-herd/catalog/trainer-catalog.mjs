import { DEFAULTS, loadSettings } from '../encounters/rules/settings.js'
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

export function catalogUnlocks(save, settings = loadSettings(save.settings)) {
  const { trainer, legendsOpen } = settings
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

export function validateChoice(save, pokemon, action, settings) {
  const { dex, form, gender, mega, megaKind, shiny } = action
  const entry = entryOf({ dex, form })
  const same = dex === pokemon.dex && form === (pokemon.form ?? undefined) && !action.fresh
  if (!entry || (!same && !canChoose(entry, asUnlocks(catalogUnlocks(save, settings))))) {
    throw new Error('That Pokémon is unavailable.')
  }
  const megas = megaForms(entry)
  if (
    (gender !== undefined && !genderChoices(dex).includes(gender)) ||
    (mega !== undefined && !['on', 'off', 'auto'].includes(mega)) ||
    (mega === 'on' && !megas.length) ||
    (megaKind !== undefined && !megas.some(({ kind }) => kind === megaKind)) ||
    (action.fresh !== undefined && typeof action.fresh !== 'boolean') ||
    (shiny !== undefined && typeof shiny !== 'boolean') ||
    (shiny === true &&
      (!entry.shiny || (!save.dex.shiny.includes(dex) && !(same && pokemon.shiny))))
  ) {
    throw new Error('That appearance is unavailable.')
  }
  return { same, gender, mega, megaKind, shiny }
}

export function initialCatalogPick(save, { source, favorites }, rnd, settings) {
  const unlocks = asUnlocks(catalogUnlocks(save, settings))
  if (source === 'starters' && !unlocks.trainer) {
    return undefined
  }
  const choices = searchEntries('', {
    keys: source === 'favorites' && !unlocks.trainer ? new Set(favorites) : undefined,
    available: (entry) => canChoose(entry, unlocks)
  })
  const entry = choices[Math.floor(rnd() * choices.length)]
  return entry && appearanceOf({ dex: entry.dex, form: entry.form })
}

export function registerCatalogPreferences(orca, { hasSave, selectionSettings }) {
  let current
  let tail = read().catch((error) => orca.log(error.message))

  async function read() {
    if (!current) {
      const [stored, existingSave] = await Promise.all([orca.storage.get(PREFERENCES), hasSave()])
      const source = SOURCES.includes(stored?.source)
        ? stored.source
        : existingSave
          ? 'starters'
          : DEFAULTS.newFrom
      const next = { source, favorites: favoriteKeys(stored?.favorites) }
      if (stored?.source !== source) {
        await orca.storage.set(PREFERENCES, next)
      }
      current = next
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
    return input == null && selectionSettings
      ? result.then(async (stored) => ({ ...stored, ...(await selectionSettings()) }))
      : result
  })
  return () => tail.then(read)
}
