export function mountHerdStrip(orca, world, signal) {
  if (!orca.panel?.setPreferredHeight) {
    return
  }
  document.body.classList.add('herd-strip')
  const toolbar = document.querySelector('.toolbar')
  const scene = world.firstElementChild
  const padding = Number.parseFloat(getComputedStyle(document.body).paddingBottom)
  let preferredHeight = 0
  const observer = new ResizeObserver(() => {
    document.body.style.setProperty(
      '--herd-settings-top',
      `${toolbar.offsetHeight + padding + 4}px`
    )
    if (!world.hidden) {
      const height = Math.ceil(scene.getBoundingClientRect().bottom + scrollY + padding)
      if (height !== preferredHeight) {
        preferredHeight = height
        orca.panel.setPreferredHeight(height)
      }
    }
  })
  observer.observe(toolbar)
  observer.observe(scene)
  signal.addEventListener('abort', () => observer.disconnect(), { once: true })
}
