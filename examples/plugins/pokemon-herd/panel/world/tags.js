const DEFAULTS = { charW: 6, pad: 18, minW: 54, maxW: 200, gap: 6, maxLines: Infinity }
const clamp = (x, max) => Math.min(Math.max(x, 0), max)

// Reserve the whole walk so a tag can follow its sprite without crossing a neighbour.
export function layoutTags(items, width, opt = {}) {
  const { charW, pad, minW: minW0, maxW, gap, maxLines } = { ...DEFAULTS, ...opt }
  const minW = Math.min(minW0, width)
  const lines = [] // per line: [{ left, right }]
  // On the first line, each tag keeps to its own share: up to halfway to the next Pokémon on
  // either side. A long name is cut in its own share rather than taking a short one's.
  const xs = items.map((it) => clamp(it.cx, width))
  const share = (it, cx) => {
    let lo = 0
    let hi = width
    items.forEach((o, k) => {
      if (o === it || xs[k] === cx) {
        return
      }
      if (xs[k] < cx) {
        lo = Math.max(lo, (xs[k] + cx) / 2 + gap / 2)
      } else {
        hi = Math.min(hi, (xs[k] + cx) / 2 - gap / 2)
      }
    })
    return { lo, hi }
  }
  const out = new Map()

  // Standing Pokémon first, so a walking one never bumps their tags to another line as it
  // passes; it finds a line that's clear along its way instead. Then by rank.
  // Among the standing ones, those already settled before the ones that just stopped, so an
  // arrival never bumps a neighbour either.
  const walking = (it) => (it.from !== undefined && it.from !== it.cx ? 1 : 0)
  const fresh = (it) => (it.settled ? 0 : 1)
  // Settled ones go by how long they've stood (`since`), oldest first, so a newcomer never
  // takes a neighbour's line on a later render either.
  const since = (it) => (it.settled ? (it.since ?? 0) : 0)
  const ordered = [...items].sort(
    (a, b) =>
      walking(a) - walking(b) ||
      fresh(a) - fresh(b) ||
      since(a) - since(b) ||
      a.rank - b.rank ||
      a.cx - b.cx
  )
  const wanted = (it) =>
    Math.min(
      width,
      Math.max(
        minW,
        Math.min(maxW + (it.extra ?? 0), it.text.length * charW + pad + (it.extra ?? 0))
      )
    )
  for (const it of ordered) {
    const want = wanted(it)
    const cx = clamp(it.cx, width)
    const from = clamp(it.from ?? it.cx, width)
    const current = clamp(it.x, width)
    const place = (minNow, sweepClear) => {
      const center = sweepClear ? cx : current
      for (let line = 0; line < maxLines; line++) {
        const taken = (lines[line] ??= [])
        // Its share, if that leaves room; Pokémon standing too close share nothing: plain lines.
        const spot =
          (sweepClear &&
            line === 0 &&
            fit(taken, center, want, minNow, width, gap, share(it, center))) ||
          fit(taken, center, want, minNow, width, gap)
        if (!spot) {
          continue
        }
        const start = sweepClear ? clamp(spot.left + from - cx, width - spot.w) : spot.left
        const left = sweepClear ? clamp(spot.left + current - cx, width - spot.w) : spot.left
        const sweep = {
          left: Math.min(start, left, spot.left),
          right: Math.max(start, left, spot.left) + spot.w
        }
        if (taken.some((t) => sweep.left < t.right + gap && sweep.right > t.left - gap)) {
          continue
        }
        taken.push(sweep)
        out.set(it.id, { ...spot, left, line })
        return true
      }
      return false
    }
    const x = it.extra ?? 0
    const least = (m) => Math.min(width, m + x)
    if (
      place(least(minW), true) ||
      place(least(Math.min(minW, 36)), true) ||
      place(least(Math.min(minW, 24)), true) ||
      place(least(Math.min(minW, 24)), false)
    ) {
      continue
    }
    // If neither line can keep every tag near its sprite, pack both lines without overlaps.
    const crowded = [...ordered].sort((a, b) => a.x - b.x)
    const lineCount = Math.min(maxLines, crowded.length)
    const columns = Math.ceil(crowded.length / lineCount)
    const cell = width / columns
    return new Map(
      crowded.map((item, i) => {
        const column = Math.floor(i / lineCount)
        const inset = Math.min(gap, cell / 4) / 2
        const w = Math.min(wanted(item), cell - inset * 2)
        const start = column * cell + inset
        const left = start + clamp(item.x - w / 2 - start, cell - inset * 2 - w)
        return [item.id, { left, w, line: i % lineCount }]
      })
    )
  }
  return out
}

// The widest tag (up to `want`, at least `minW`) under cx on a line, or null if none fits.
function fit(taken, cx, want, minW, width, gap, bounds) {
  // The free stretch around cx between its neighbours on this line (and its share, if given).
  let lo = bounds ? bounds.lo : 0
  let hi = bounds ? bounds.hi : width
  for (const t of taken) {
    if (cx > t.left - gap && cx < t.right + gap) {
      return null
    } // cx is under another tag
    if (t.right + gap <= cx) {
      lo = Math.max(lo, t.right + gap)
    } else {
      hi = Math.min(hi, t.left - gap)
    }
  }
  // Centred on its Pokémon...
  const wc = Math.min(want, 2 * Math.min(cx - lo, hi - cx))
  // ...or, against the strip's edge, shifted in so it still covers the Pokémon.
  const we = Math.min(want, hi - lo)
  if (
    we > wc &&
    we >= minW &&
    ((lo === 0 && cx - we / 2 < 0) || (hi === width && cx + we / 2 > width))
  ) {
    return { left: Math.min(Math.max(cx - we / 2, lo), hi - we), w: we }
  }
  return wc >= minW ? { left: cx - wc / 2, w: wc } : null
}
