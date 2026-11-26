import { AUTO_BAIT, BAIT, BALLS } from './encounters/rules/trainer.js'
import { DEFAULTS, loadSettings } from './encounters/rules/settings.js'

export const WORLD_SETTINGS_KEY = 'world.settings'

export async function readHerdSettings(storage, legacy) {
  const raw = await storage.get(WORLD_SETTINGS_KEY)
  const { trainer, legendsOpen } = loadSettings(legacy)
  return {
    ...loadSettings({ trainer, legendsOpen, ...raw, v: 1, cryRare: raw?.cryRare === true }),
    ...captureSettings(raw)
  }
}

export const defaultHerdSettings = { ...DEFAULTS, cryRare: false }

export function captureSettings(raw) {
  const ball = BALLS.includes(raw?.ball) ? raw.ball : null
  const bait = raw?.bait === AUTO_BAIT || Object.hasOwn(BAIT, raw?.bait) ? raw.bait : null
  return { ball, bait }
}
