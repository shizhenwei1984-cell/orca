import { RESIDUE_FADE, RESIDUE_FROM, RESIDUE_MS, residueOf } from './fx.js'

const particles = {
  burn: [
    [-10, 4, 230],
    [9, -6, 270],
    [0, -14, 310]
  ],
  shock: [
    [-14, -10, 110],
    [13, -4, 130],
    [-11, 8, 150],
    [12, 10, 170]
  ],
  freeze: [
    [-9, -8, 300],
    [10, 2, 390],
    [-3, 10, 480]
  ],
  poison: [
    [-10, 0, 520],
    [6, 4, 640],
    [12, -6, 580],
    [-4, -10, 700]
  ],
  dizzy: [
    [0, 0, 600],
    [0, 0, 700],
    [0, 0, 800]
  ],
  drip: [
    [-8, 0, 420],
    [4, 0, 520],
    [11, 0, 470]
  ],
  leaf: [
    [-12, 0, 700],
    [3, 0, 820],
    [12, 0, 760]
  ],
  dust: [
    [-14, 0, 700],
    [0, 2, 700],
    [14, 0, 700]
  ],
  sparkle: [
    [-12, -8, 260],
    [11, -2, 330],
    [-6, 9, 400],
    [8, 12, 470]
  ]
}
const oscillate = (time, period) => (1 - Math.cos((time / period) * Math.PI * 2)) / 2

export function drawResidue(shape, type, style, x, y, ground, elapsed, duration = RESIDUE_MS) {
  const time = elapsed - RESIDUE_FROM
  const kind = residueOf(type)
  if (!kind || time < 0 || time >= duration) {
    return
  }
  const fade = Math.min(1, (duration - time) / RESIDUE_FADE)
  if (kind === 'freeze') {
    shape(x, y, 34, Math.max(12, 2 * (ground - y) - 6), '#bfefff', fade * 0.32, true)
  }
  for (const [index, [dx, dy, period]] of particles[kind].entries()) {
    const phase = oscillate(time, period)
    const color = index % 2 ? style.mid : style.core
    switch (kind) {
      case 'burn':
        shape(
          x + dx,
          y + dy - 8 * oscillate(time, 2 * period),
          5,
          8,
          color,
          fade * (0.25 + 0.75 * phase),
          true
        )
        break
      case 'shock':
        shape(x + dx, y + dy, 8, 2, style.mid, fade * phase)
        break
      case 'freeze':
      case 'sparkle':
        shape(x + dx, y + dy, 3, 3, style.hot, fade * phase)
        break
      case 'poison':
        shape(x + dx, y + dy - 12 * phase, 4, 4, color, fade * 0.85, true)
        break
      case 'dizzy':
        shape(
          x - 14 + 24 * phase,
          2 * y - ground - 8 + 10 * oscillate(time, period / 2),
          4,
          4,
          color,
          fade,
          true
        )
        break
      case 'drip':
        shape(x + dx, y + phase * (ground - y - 4), 3, 4, style.mid, fade * 0.9, true)
        break
      case 'leaf':
        shape(
          x + dx - 3 + 6 * oscillate(time, period / 2),
          2 * y - ground + 4 + phase * (2 * (ground - y) - 10),
          6,
          3,
          color,
          fade
        )
        break
      case 'dust': {
        const spread = Math.min(1, time / period)
        shape(
          x + dx,
          ground - 4 + dy,
          4 + 12 * spread,
          3 + 8 * spread,
          '#b8ad9a',
          0.7 * (1 - spread),
          true
        )
        break
      }
    }
  }
}
