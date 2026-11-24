import type * as ProcessHost from '@orca/process-host'
import type * as ReleaseReadiness from '../releases/updater-release-readiness'
import { EventEmitter } from 'node:events'
import { app, powerMonitor } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { UpdaterSetup } from './updater-setup'

const { runProcess, requestGitHubReleaseHead, nativeDownload, nativeInstall } = vi.hoisted(() => ({
  runProcess: vi.fn(),
  requestGitHubReleaseHead: vi.fn(),
  nativeDownload: vi.fn(async () => []),
  nativeInstall: vi.fn()
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    app: Object.assign(new EventEmitter(), {
      isPackaged: true,
      getVersion: () => '1.4.273-personal.gabc123'
    }),
    autoUpdater: new EventEmitter(),
    powerMonitor: new EventEmitter()
  }
})
vi.mock('@orca/process-host', async (importOriginal) => ({
  ...(await importOriginal<typeof ProcessHost>()),
  runProcess
}))
vi.mock('../releases/updater-release-readiness', async (importOriginal) => ({
  ...(await importOriginal<typeof ReleaseReadiness>()),
  requestGitHubReleaseHead
}))
vi.mock('../releases/updater-changelog', () => ({ fetchChangelog: async () => null }))
vi.mock('../electron-updater-loader', () => {
  const nativeUpdater = Object.assign(new EventEmitter(), {
    setFeedURL: () => {},
    checkForUpdates: async () => {
      nativeUpdater.emit('checking-for-update')
      nativeUpdater.emit('update-available', { version: '1.4.273' })
    },
    downloadUpdate: nativeDownload,
    quitAndInstall: nativeInstall
  })
  return { loadElectronAutoUpdater: () => nativeUpdater }
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.clearAllMocks()
  app.removeAllListeners()
  powerMonitor.removeAllListeners()
})

function latestTag(tag: string): void {
  requestGitHubReleaseHead.mockResolvedValue({
    statusCode: 302,
    redirectUrl: `https://github.com/stablyai/orca/releases/tag/${tag}`
  })
}

it.runIf(process.platform === 'linux')('offers only a strictly newer stable base', async () => {
  vi.useFakeTimers({ now: 0 })
  const updater = new UpdaterSetup()
  updater.setupAutoUpdater(null, { getLastUpdateCheckAt: () => Date.now() })
  for (const tag of ['v1.4.272', 'v1.4.273']) {
    latestTag(tag)
    updater.checkForUpdatesFromMenu({ includePrerelease: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(updater.getUpdateStatus()).toEqual({ state: 'not-available', userInitiated: true })
  }
  latestTag('v1.4.274-rc.1')
  updater.checkForUpdatesFromMenu()
  await vi.advanceTimersByTimeAsync(0)
  expect(updater.getUpdateStatus().state).not.toBe('available')

  latestTag('v1.4.274')
  updater.checkForUpdates()
  await vi.advanceTimersByTimeAsync(0)
  expect(updater.getUpdateStatus()).toMatchObject({ state: 'available', version: '1.4.274' })
})

it.runIf(process.platform === 'linux')(
  'starts a detached source build through Download and rejects remote binary installs',
  async () => {
    vi.useFakeTimers({ now: 0 })
    const updater = new UpdaterSetup()
    latestTag('v1.4.274')
    updater.setupAutoUpdater(null, { getAutomaticUpdates: () => true })
    await vi.advanceTimersByTimeAsync(0)
    expect(updater.getUpdateStatus()).toMatchObject({ state: 'available', version: '1.4.274' })
    updater.applyAutomaticUpdatesSetting()
    updater.downloadUpdate(true)
    expect(runProcess).not.toHaveBeenCalled()

    runProcess.mockResolvedValueOnce({ code: 1, stderr: 'Failed to connect to bus' })
    updater.downloadUpdate()
    await vi.advanceTimersByTimeAsync(0)
    expect(updater.getUpdateStatus()).toMatchObject({
      state: 'error',
      failurePhase: 'download',
      retryable: true,
      version: '1.4.274'
    })

    runProcess.mockResolvedValueOnce({ code: 0 })
    updater.downloadUpdate()
    updater.downloadUpdate()
    await vi.advanceTimersByTimeAsync(0)
    expect(runProcess).toHaveBeenCalledTimes(2)
    expect(runProcess).toHaveBeenLastCalledWith(
      expect.objectContaining({
        program: 'systemd-run',
        args: [
          '--user',
          '--unit=orca-personal-update',
          '--collect',
          '--property=Type=exec',
          '--',
          expect.stringMatching(/\/\.local\/bin\/orca-personal-update$/)
        ]
      })
    )
    expect(updater.getUpdateStatus()).toMatchObject({
      state: 'available',
      version: '1.4.274',
      personalUpdate: 'started'
    })
    expect(updater.getRemoteServerUpdateSupport()).toMatchObject({
      automatic: false,
      reason: 'manual-service-update-required'
    })
    expect(() => updater.downloadRemoteServerUpdate('runtime')).toThrow(
      'remote_update_manual_required'
    )
    expect(() => updater.installRemoteServerUpdate('runtime')).toThrow(
      'remote_update_manual_required'
    )
    updater.quitAndInstall()
    await vi.advanceTimersByTimeAsync(100)
    expect(nativeDownload).not.toHaveBeenCalled()
    expect(nativeInstall).not.toHaveBeenCalled()
  }
)
