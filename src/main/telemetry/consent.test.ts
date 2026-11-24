import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../shared/settings/global-settings-types'
import { getDefaultPersistedState, getDefaultSettings } from '../../shared/orca-profiles/constants'
import { LoadedCohortMigrationOperations } from '../persistence/loading-store/profile-loading/loaded-cohort-migrations'
import { resolveConsent, telemetryAtLaunch, telemetryWithOptIn } from './consent'

const ENV = [
  'DO_NOT_TRACK',
  'ORCA_TELEMETRY_DISABLED',
  'CI',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'CIRCLECI',
  'TRAVIS',
  'BUILDKITE',
  'JENKINS_URL',
  'TEAMCITY_VERSION'
]
const settings = (telemetry: GlobalSettings['telemetry']): GlobalSettings => ({
  ...getDefaultSettings('/home'),
  telemetry
})
// Local noon keeps the local calendar day stable in any time zone.
const noon = (day: number) => new Date(2026, 10, day, 12)

afterEach(() => vi.unstubAllEnvs())

it('loads fresh and upgraded profiles with sharing off until the user opts in', () => {
  for (const name of ENV) {
    vi.stubEnv(name, '')
  }
  const cohorts = new LoadedCohortMigrationOperations({ loadNeedsSave: false })
  const profile = getDefaultPersistedState('/home')
  const fresh = cohorts.migrateTelemetry(profile, false)
  const upgraded = cohorts.migrateTelemetry(profile, true)
  const unresolved = {
    ...upgraded,
    settings: settings({ optedIn: null, installId: 'old', existedBeforeTelemetryRelease: true })
  }

  for (const loaded of [fresh, upgraded, cohorts.migrateTelemetry(unresolved, true)]) {
    expect(loaded.settings.telemetry?.optedIn).toBe(false)
    expect(resolveConsent(loaded.settings).effective).toBe('disabled')
    const optedIn = telemetryWithOptIn(loaded.settings, true)
    const optedInProfile = { ...loaded, settings: settings(optedIn) }
    const reloaded = cohorts.migrateTelemetry(optedInProfile, true)
    expect(reloaded.settings.telemetry?.optedIn).toBe(true)
    expect(resolveConsent(reloaded.settings).effective).toBe('enabled')
  }
})

describe('sharing resumed day', () => {
  it('stamps the day sharing is on again after any launch or toggle saw it off', () => {
    for (const name of ENV) {
      vi.stubEnv(name, '')
    }
    let t: GlobalSettings['telemetry'] = {
      optedIn: true,
      installId: 'i',
      existedBeforeTelemetryRelease: false
    }
    // After an upgrade, earlier launches may have had sharing off, so the first launch stamps.
    t = telemetryAtLaunch(settings(t), noon(19)) ?? t
    expect(t.sharingResumedDay).toBe('2026-11-19')
    expect(telemetryAtLaunch(settings(t), noon(19))).toBeNull()

    vi.stubEnv('DO_NOT_TRACK', '1')
    t = telemetryAtLaunch(settings(t), noon(20)) ?? t
    // Toggling on while the env var still blocks sharing leaves the next clean launch to stamp.
    t = telemetryWithOptIn(settings({ ...t, optedIn: false }), true, noon(21))
    vi.stubEnv('DO_NOT_TRACK', '')
    t = telemetryAtLaunch(settings(t), noon(23)) ?? t
    expect(t.sharingResumedDay).toBe('2026-11-23')
    expect(telemetryAtLaunch(settings(t), noon(24))).toBeNull()

    t = telemetryWithOptIn(settings(t), false, noon(25))
    t = telemetryWithOptIn(settings(t), true, noon(26))
    expect(t.sharingResumedDay).toBe('2026-11-26')
  })
})
