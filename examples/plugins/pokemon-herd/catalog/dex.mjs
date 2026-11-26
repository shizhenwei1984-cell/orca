import catalog from './pokerdr-data.json' with { type: 'json' }

const { FEMALE_RATE, FEMALE_SHINY, FEMALE_SPRITE, MEGA, REGIONAL, SEASONAL, SPECIES, ENTRY_TYPES } =
  catalog
const legendary = new Set(catalog.LEGENDARY)
export const isLegendary = (dex) => legendary.has(dex)
export const TYPES = catalog.TYPES
export const REGIONS = [
  'Kanto',
  'Johto',
  'Hoenn',
  'Sinnoh',
  'Unova',
  'Kalos',
  'Alola',
  'Galar',
  'Hisui',
  'Paldea'
]
const REGION_ENDS = [151, 251, 386, 493, 649, 721, 809, 898, 905, Infinity]
const entries = new Map()
const STARTERS = [1, 4, 7]

/** @typedef {{ dex: number, form?: string }} EntryId */
/** @typedef {'m' | 'f'} Gender */
/** @typedef {'off' | 'on' | 'auto'} MegaMode */
/** @typedef {{ dex: number, form?: string, shiny?: boolean, gender?: Gender, mega?: MegaMode, megaKind?: '' | 'X' | 'Y' }} Pick */

/** @param {EntryId} entry */
export const entryKey = ({ dex, form }) => (form ? `${dex}-${form}` : String(dex))
export const dexNumber = (dex) => `#${String(dex).padStart(3, '0')}`
const fold = (value) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
const region = (dex) => REGIONS[REGION_ENDS.findIndex((end) => dex <= end)]

function addEntry(dex, name, shiny, form, label) {
  const formRegion = label?.split(' ')[0]
  const entry = {
    dex,
    ...(form ? { form } : {}),
    name: label ? `${name} (${label})` : name,
    region: REGIONS.includes(formRegion) ? formRegion : region(dex),
    types: Object.freeze(ENTRY_TYPES[`${dex}f${form}`] ?? ENTRY_TYPES[dex]),
    shiny: shiny === 1
  }
  entries.set(entryKey(entry), Object.freeze(entry))
}

const formsByDex = Map.groupBy(REGIONAL, ([dex]) => dex)
for (const [dex, name, shiny] of SPECIES) {
  addEntry(dex, name, shiny)
  for (const [, form, label, formShiny] of formsByDex.get(dex) ?? []) {
    addEntry(dex, name, formShiny, form, label)
  }
}

/** @param {EntryId | undefined | null} id */
export function entryOf(id) {
  if (
    !Number.isInteger(id?.dex) ||
    (id.form !== undefined && (typeof id.form !== 'string' || !/^\d{4}$/.test(id.form)))
  ) {
    return undefined
  }
  return entries.get(entryKey(id))
}

export function megaForms(entry) {
  return entry.form
    ? []
    : (MEGA[entry.dex] ?? []).map(([form, shiny, kind]) => ({
        form,
        shiny: shiny === 1,
        kind,
        types: ENTRY_TYPES[`${entry.dex}m${kind}`] ?? entry.types
      }))
}

export function genderChoices(dex) {
  const rate = FEMALE_RATE[dex] ?? 4
  if (rate < 0) {
    return []
  }
  return rate === 0 ? ['m'] : rate === 8 ? ['f'] : ['m', 'f']
}

export function rollGender(dex, random = Math.random) {
  const rate = FEMALE_RATE[dex] ?? 4
  return rate < 0 ? undefined : random() * 8 < rate ? 'f' : 'm'
}

export function favoriteKeys(keys) {
  return [...new Set(Array.isArray(keys) ? keys.filter((key) => entries.has(key)) : [])]
}

/** @typedef {{ caught?: ReadonlySet<number>, trainer?: boolean, legendsOpen?: boolean, available?: ReadonlySet<string>, shinyUnlocked?: ReadonlySet<number> }} Unlocks */

/** @param {EntryId} entry @param {Unlocks} unlocks */
export function canChoose(entry, unlocks = {}) {
  if (unlocks.available && !unlocks.available.has(entryKey(entry))) {
    return false
  }
  const caught = unlocks.caught?.has(entry.dex)
  if (!unlocks.legendsOpen && isLegendary(entry.dex) && !caught) {
    return false
  }
  return !unlocks.trainer || caught || STARTERS.includes(entry.dex)
}

export function searchEntries(query, { region, types = [], mega, legends, keys, available } = {}) {
  const search = fold(query.trim()).replace(/^#/, '')
  const terms = search.split(/\s+/).filter(Boolean)
  return [...entries.values()].filter((entry) => {
    if (
      (region && entry.region !== region) ||
      (mega && !megaForms(entry).length) ||
      (legends && !isLegendary(entry.dex)) ||
      (keys && !keys.has(entryKey(entry))) ||
      (available && !available(entry))
    ) {
      return false
    }
    const typeNames = entry.types.join(' ')
    if (!types.every((type) => entry.types.includes(type))) {
      return false
    }
    const name = fold(entry.name)
    return terms.every((term) =>
      /^\d+$/.test(term)
        ? entry.dex === Number(term) || dexNumber(entry.dex).slice(1).startsWith(term)
        : name.includes(term) || typeNames.includes(term)
    )
  })
}

/** @param {Pick} pick @param {{working?: boolean, season?: number}} context */
export function spriteVariants(pick, { working = false, season = 0 } = {}) {
  const entry = entryOf(pick)
  if (!entry) {
    return []
  }
  const megas = megaForms(entry)
  const active = pick.mega === 'on' || (pick.mega === 'auto' && working)
  const mega = active ? (megas.find(({ kind }) => kind === pick.megaKind) ?? megas[0]) : undefined
  const coat = !entry.form && season > 0 ? SEASONAL[entry.dex]?.[season - 1] : undefined
  const form = mega?.form ?? entry.form ?? coat?.[0]
  const shiny = pick.shiny === true && (mega?.shiny ?? (coat ? coat[1] === 1 : entry.shiny))
  const dex = String(entry.dex).padStart(4, '0')
  const variants = []
  for (const color of shiny ? [true, false] : [false]) {
    const female =
      !form && pick.gender === 'f' && (color ? FEMALE_SHINY : FEMALE_SPRITE).includes(entry.dex)
    if (female) {
      variants.push({ folder: `${dex}/0000/${color ? '0001' : '0000'}/0002`, shiny: color })
    }
    const folder = form ? `${dex}/${form}` : dex
    const shinyPath = form ? '/0001' : '/0000/0001'
    variants.push({ folder: color ? folder + shinyPath : folder, shiny: color })
  }
  return variants
}
