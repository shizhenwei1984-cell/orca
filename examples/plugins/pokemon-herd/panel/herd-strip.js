export function mountHerdStrip(orca, world, signal) {
  if (!orca.panel?.setPreferredHeight) {
    return
  }
  document.body.classList.add('herd-strip')
  const toolbar = document.querySelector('.toolbar')
  const scene = world.firstElementChild
  const padding = Number.parseFloat(getComputedStyle(document.body).paddingBottom)
  let preferredHeight = 0
  let stripHeight = 0
  const trainerModal = '#trainer-game[open], .catalog-picker[open]'
  const updateHeight = () => {
    document.body.style.setProperty(
      '--herd-settings-top',
      `${toolbar.offsetHeight + padding + 4}px`
    )
    if (!world.hidden) {
      stripHeight = Math.ceil(scene.getBoundingClientRect().bottom + scrollY + padding)
    }
    const height = document.querySelector(trainerModal) ? 480 : stripHeight
    if (height > 0 && height !== preferredHeight) {
      preferredHeight = height
      orca.panel.setPreferredHeight(height)
    }
  }
  const observer = new ResizeObserver(updateHeight)
  observer.observe(toolbar)
  observer.observe(scene)
  document.addEventListener(
    'toggle',
    (event) => {
      if (event.target instanceof HTMLDialogElement) {
        updateHeight()
      }
    },
    { capture: true, signal }
  )
  signal.addEventListener('abort', () => observer.disconnect(), { once: true })
}
