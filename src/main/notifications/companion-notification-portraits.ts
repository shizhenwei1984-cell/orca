import { nativeImage, type NativeImage } from 'electron'
import { COMPANION_PORTRAIT_SIZE } from '../../shared/plugins/frames/plugin-workspace-view'
import type { NotificationDispatchRequest } from '../../shared/notifications/notification-settings-types'

const byPanel = new Map<string, (request: NotificationDispatchRequest) => NativeImage | undefined>()

export function setCompanionPortraitSource(
  panelId: string,
  lookup?: (request: NotificationDispatchRequest) => NativeImage | undefined
) {
  if (lookup) {
    byPanel.set(panelId, lookup)
  } else {
    byPanel.delete(panelId)
  }
}

export function notificationCompanionPortrait(request: NotificationDispatchRequest) {
  if (
    (request.source !== 'terminal-bell' && request.source !== 'agent-task-complete') ||
    request.surface === 'agent-session' ||
    !request.worktreeId ||
    !request.workspaceExecutionHostId ||
    !request.paneKey ||
    !request.terminalPtyId ||
    !request.terminalIncarnationId
  ) {
    return undefined
  }
  for (const lookup of byPanel.values()) {
    const icon = lookup(request)
    if (icon) {
      return icon
    }
  }
  return undefined
}

export function companionPortraitFromPixels(value: string): NativeImage | undefined {
  const pixels = Buffer.from(value, 'base64')
  if (pixels.length !== COMPANION_PORTRAIT_SIZE ** 2 * 4) {
    return undefined
  }
  // Electron bitmap input is premultiplied BGRA. Pixel bytes require no image parser or network.
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset]!
    const alpha = pixels[offset + 3]! / 255
    pixels[offset] = Math.round(pixels[offset + 2]! * alpha)
    pixels[offset + 1] = Math.round(pixels[offset + 1]! * alpha)
    pixels[offset + 2] = Math.round(red * alpha)
  }
  const icon = nativeImage.createFromBitmap(pixels, {
    width: COMPANION_PORTRAIT_SIZE,
    height: COMPANION_PORTRAIT_SIZE
  })
  return icon.isEmpty() ? undefined : icon
}
