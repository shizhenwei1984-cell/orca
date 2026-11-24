import { homedir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import { app } from 'electron'
import { personalReleaseBase } from '../../../shared/app-lifecycle/identity/app-version'
import type { RemoteServerUpdateSupport } from '../../../shared/remote-runtime/host-catalog/remote-server-update'
import { updaterCodedMessage } from '../../../shared/updater/updater-failure-copy'
import type { UpdateCheckOptions } from '../../../shared/updater/update-status-types'
import { compareVersions } from '../releases/updater-fallback'
import {
  fetchLatestStableReleaseTag,
  normalizeTagToVersion
} from '../releases/updater-prerelease-feed'
import { UpdaterDownloadInstall } from './updater-download-install'
import {
  AUTO_UPDATE_CHECK_INTERVAL_MS,
  AUTO_UPDATE_RETRY_INTERVAL_MS,
  type UpdateInstallTrigger
} from './updater-state'

function personalLinuxBase(): string | undefined {
  if (process.platform === 'linux' && app.isPackaged) {
    return personalReleaseBase(app.getVersion())
  }
  return undefined
}

export abstract class UpdaterPersonalLinux extends UpdaterDownloadInstall {
  private personalCheckUserInitiated = false

  protected override runBackgroundUpdateCheck(nudgeId?: string | null): boolean {
    const base = personalLinuxBase()
    return base ? this.checkPersonalUpdate(base, false) : super.runBackgroundUpdateCheck(nudgeId)
  }

  private checkPersonalUpdate(base: string, userInitiated: boolean): boolean {
    if (this.currentStatus.state === 'checking') {
      if (userInitiated) {
        this.personalCheckUserInitiated = true
        this.sendStatus({ state: 'checking', userInitiated: true })
      }
      return false
    }
    if (
      this.currentStatus.state === 'available' &&
      (this.currentStatus.personalUpdate === 'starting' ||
        (!userInitiated && this.currentStatus.personalUpdate === 'started'))
    ) {
      return false
    }
    this.personalCheckUserInitiated = userInitiated
    this.clearAvailableUpdateContext()
    this.sendStatus({ state: 'checking', userInitiated })
    void fetchLatestStableReleaseTag({ requireManifest: false }).then((tag) => {
      if (!tag) {
        this.sendStatus({
          state: 'error',
          ...updaterCodedMessage('updateServerUnreachable'),
          userInitiated: this.personalCheckUserInitiated
        })
        this.scheduleAutomaticUpdateCheck(AUTO_UPDATE_RETRY_INTERVAL_MS)
        return
      }
      const version = normalizeTagToVersion(tag)
      this.recordCompletedUpdateCheck()
      this.scheduleAutomaticUpdateCheck(AUTO_UPDATE_CHECK_INTERVAL_MS)
      if (/^\d+\.\d+\.\d+$/.test(version) && compareVersions(version, base) > 0) {
        this.availableVersion = version
        this.sendStatus({ state: 'available', version, changelog: null, personalUpdate: 'ready' })
      } else {
        this.sendStatus({ state: 'not-available', userInitiated: this.personalCheckUserInitiated })
      }
    })
    return true
  }

  private async startPersonalUpdate(version: string): Promise<void> {
    const offer = { state: 'available', version, changelog: null } as const
    this.sendStatus({ ...offer, personalUpdate: 'starting' })
    try {
      const result = await runProcess({
        program: 'systemd-run',
        args: [
          '--user',
          '--unit=orca-personal-update',
          '--collect',
          '--property=Type=exec',
          '--',
          join(homedir(), '.local', 'bin', 'orca-personal-update')
        ],
        timeoutMs: 10_000
      })
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || 'systemd-run did not start the updater')
      }
      this.sendStatus({ ...offer, personalUpdate: 'started' })
    } catch (error) {
      this.sendStatus({
        state: 'error',
        failurePhase: 'download',
        message: `Could not start the personal updater: ${error instanceof Error ? error.message : String(error)}`,
        version,
        retryable: true
      })
    }
  }

  protected override checkForUpdatesFromMenu(options?: UpdateCheckOptions): void {
    const base = personalLinuxBase()
    if (base) {
      this.checkPersonalUpdate(base, true)
      return
    }
    super.checkForUpdatesFromMenu(options)
  }

  protected override downloadUpdate(automatic = false): void {
    if (personalLinuxBase()) {
      const status = this.currentStatus
      if (
        !automatic &&
        this.updateInstallMode === 'interactive' &&
        this.availableVersion &&
        ((status.state === 'available' && status.personalUpdate === 'ready') ||
          (status.state === 'error' && status.failurePhase === 'download'))
      ) {
        void this.startPersonalUpdate(this.availableVersion)
      }
      return
    }
    super.downloadUpdate(automatic)
  }

  protected override quitAndInstall(
    trigger: UpdateInstallTrigger = 'manual',
    isCurrentTeamRestart?: () => boolean
  ): void {
    if (!personalLinuxBase()) {
      super.quitAndInstall(trigger, isCurrentTeamRestart)
    }
  }

  protected override getRemoteServerUpdateSupport(): RemoteServerUpdateSupport {
    if (personalLinuxBase()) {
      return {
        installMode: this.updateInstallMode,
        automatic: false,
        reason: 'manual-service-update-required'
      }
    }
    return super.getRemoteServerUpdateSupport()
  }

  protected setupPersonalLinuxUpdater(): boolean {
    if (!personalLinuxBase()) {
      return false
    }
    const lastCheck = this._getLastUpdateCheckAt?.() ?? null
    const remaining =
      lastCheck === null ? 0 : AUTO_UPDATE_CHECK_INTERVAL_MS - (Date.now() - lastCheck)
    if (remaining > 0) {
      this.scheduleAutomaticUpdateCheck(remaining)
    } else {
      this.runBackgroundUpdateCheck()
    }
    return true
  }
}
