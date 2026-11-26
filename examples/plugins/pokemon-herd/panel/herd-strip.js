export function mountHerdStrip(orca, world, signal) {
  if (!orca.panel?.setPreferredHeight) {
    return
  }
  document.body.classList.add('herd-strip')
  const toolbar = document.querySelector('.toolbar')
  let preferredHeight = 0
  const settings = document.querySelector('#herd-settings')
  const expanded =
    '.trainer-dialog[open], .catalog-picker[open], #herd-settings:not([hidden]), #encounters:not([hidden]), #herd:not([hidden])'
  const updateHeight = () => {
    const padding = Number.parseFloat(getComputedStyle(document.body).paddingBottom)
    document.body.style.setProperty(
      '--herd-settings-top',
      `${toolbar.offsetHeight + padding + 4}px`
    )
    const height = document.querySelector(expanded) ? 480 : document.body.offsetHeight
    if (height > 0 && height !== preferredHeight) {
      preferredHeight = height
      orca.panel.setPreferredHeight(height)
    }
  }
  const observer = new ResizeObserver(updateHeight)
  observer.observe(document.body)
  const settingsObserver = new MutationObserver(updateHeight)
  for (const element of [settings, world, document.querySelector('#encounters')]) {
    settingsObserver.observe(element, { attributeFilter: ['hidden'] })
  }
  document.addEventListener(
    'toggle',
    (event) => {
      if (event.target instanceof HTMLDialogElement) {
        updateHeight()
      }
    },
    { capture: true, signal }
  )
  signal.addEventListener(
    'abort',
    () => {
      observer.disconnect()
      settingsObserver.disconnect()
    },
    { once: true }
  )
  return true
}
