const GUIDE_SEEN = 'world.guide-seen'

export function bindHerdSettings(orca, signal) {
  const settings = document.querySelector('#herd-settings')
  const opener = document.querySelector('#show-settings')
  const pages = [...settings.querySelectorAll('nav button')].map((button) => ({
    button,
    content: document.getElementById(button.getAttribute('aria-controls'))
  }))
  const [guide, preferences] = pages
  let opening = 0
  let seen = orca.storage.get(GUIDE_SEEN).then(Boolean, () => false)

  function show(page) {
    for (const { button, content } of pages) {
      button.setAttribute('aria-pressed', String(content === page.content))
      content.hidden = content !== page.content
    }
    page.content.parentElement.scrollTop = 0
    if (page === guide) {
      seen = seen.then(
        (opened) =>
          opened ||
          orca.storage.set(GUIDE_SEEN, true).then(
            () => true,
            () => false
          )
      )
    }
  }

  for (const page of pages) {
    page.button.addEventListener(
      'click',
      () => {
        opening++
        show(page)
      },
      { signal }
    )
  }

  return async (open) => {
    const version = ++opening
    settings.hidden = !open
    opener.setAttribute('aria-expanded', String(open))
    if (!open) {
      opener.focus()
      return
    }
    const seenGuide = await seen
    if (!signal.aborted && version === opening) {
      const page = seenGuide ? preferences : guide
      show(page)
      page.button.focus()
    }
  }
}
