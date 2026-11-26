import {
  features,
  overHead,
  palette,
  rainAt,
  rainbowArcs,
  rainbowFade,
  snowAt,
  sunAt,
  treeParts
} from './scene.js'

const ART = [
  'tree-spring',
  'tree-summer',
  'tree-autumn',
  'tree-winter',
  'pine',
  'pine-winter',
  'bush',
  'rock',
  'flowers-pink',
  'flowers-yellow',
  'fire',
  'embers'
]

export function createLandscape(canvas) {
  const c = canvas.getContext('2d')
  const art = new Map(
    ART.map((name) => {
      const image = new Image()
      image.src = new URL(`./scenery/${name}.png`, import.meta.url).href
      return [name, image]
    })
  )
  let sceneKey
  let rows

  function rect(x, y, w, h, color, alpha = 1) {
    c.fillStyle = color
    c.globalAlpha = alpha
    c.fillRect(x, y, w, h)
  }

  function oval(x, y, w, h, color, alpha = 1) {
    c.fillStyle = color
    c.globalAlpha = alpha
    c.beginPath()
    c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
    c.fill()
  }

  function picture(name, x, floor, h, alpha, night, centered = false) {
    const image = art.get(name)
    if (!image?.naturalWidth || alpha <= 0.02) {
      return false
    }
    const w = Math.round((h * image.naturalWidth) / image.naturalHeight)
    c.globalAlpha = alpha
    c.filter = night ? `brightness(${1 - night * 0.37}) saturate(${1 - night * 0.2})` : 'none'
    c.drawImage(image, Math.round(x - (centered ? w / 2 : 0)), floor - h, w, h)
    c.filter = 'none'
    return true
  }

  return ({
    width,
    rowHeight,
    ground,
    settings,
    light,
    now,
    hour,
    night,
    season,
    weather,
    stormAt,
    rainbow,
    camp,
    heads,
    reduced
  }) => {
    const height = settings.rows * rowHeight
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    c.clearRect(0, 0, width, height)
    c.imageSmoothingEnabled = false
    if (settings.background === 'plain') {
      return
    }
    const key = `${width}|${ground}|${settings.rows}`
    if (key !== sceneKey) {
      rows = Array.from({ length: settings.rows }, (_, row) => features(width, ground, row))
      sceneKey = key
    }
    const p = palette(night, light, season, settings.sky)
    const line = ground + 4
    const storm = weather === 'storm'
    const sec = reduced ? 0 : now / 1000
    for (const [row, f] of rows.entries()) {
      c.save()
      c.translate(0, row * rowHeight)
      c.beginPath()
      c.rect(0, 0, width, line + 6)
      c.clip()
      const fade = (x, y, w, h) => (overHead({ x, y, w, h }, heads[row]) ? 0.15 : 1)

      rect(0, 0, width, line + 6, p.sky)
      if (p.bands) {
        const h = Math.ceil(line / 4)
        p.bands.forEach((color, i) => rect(0, h * i, width, h, color))
        const sun = sunAt(hour)
        if (sun) {
          const x = Math.round(sun.x * Math.max(0, width - 16))
          const y = Math.round(4 + sun.y * Math.max(1, line - 34))
          const a = p.clouds * fade(x, y, 14, 14)
          oval(x - 3, y - 3, 20, 20, '#fff6c8', a * 0.35)
          oval(x, y, 14, 14, '#ffe27a', a)
        }
      }
      if (p.stars > 0.05) {
        for (const s of f.stars) {
          const size = s.bright ? 2 : 1
          rect(s.x, s.y, size, size, s.bright ? '#ffeebb' : '#cfd8ff', p.stars * p.starAlpha)
        }
        const { x, y } = f.moon
        oval(x, y, 10, 10, '#e9e5c8', p.stars * 0.85 * fade(x, y, 10, 10))
      }
      for (const { x, y, w } of f.clouds) {
        if (p.clouds <= 0.05 || y + 10 >= line - 24) {
          continue
        }
        const a = p.clouds * p.cloudAlpha * fade(x, y, w, 12)
        oval(x, y + 4, w, 8, '#ffffff', a)
        oval(x + w * 0.25, y, w * 0.45, 9, '#ffffff', a)
      }
      if (rainbow && p.clouds > 0.05) {
        const a = rainbowFade(now - rainbow.at) * p.clouds * 0.8
        const r = Math.round(Math.max(20, Math.min(line - 6, width * 0.12)))
        c.globalAlpha = a
        c.lineWidth = 2
        for (const arc of rainbowArcs(Math.round(rainbow.x * width), line, r)) {
          c.strokeStyle = arc.color
          c.beginPath()
          c.arc(arc.x + arc.size / 2, line, arc.size / 2, Math.PI, Math.PI * 2)
          c.stroke()
        }
      }
      for (const { cx, rx, ry } of f.hills) {
        oval(cx - rx, line - ry, rx * 2, ry * 2, p.hill)
      }
      for (const t of f.trees) {
        const names =
          t.kind === 'pine'
            ? ['pine', 'pine', 'pine', 'pine-winter']
            : ['tree-spring', 'tree-summer', 'tree-autumn', 'tree-winter']
        const h = Math.round(t.h * 1.15)
        const same = names[season.a] === names[season.b]
        const first = picture(names[season.a], t.x, line - 1, h, same ? 1 : 1 - season.t, night)
        const second = !same && picture(names[season.b], t.x, line - 1, h, season.t, night)
        if (!first && !second) {
          for (const [x, y, w, h, color, rounded] of treeParts(t, line - 3)) {
            if (w > 0) {
              ;(rounded ? oval : rect)(x, y, w, h, p[color])
            }
          }
        }
      }
      for (const k of f.rocks) {
        picture(k.kind, k.x, line + 1, Math.round((k.kind === 'bush' ? 12 : 10) * k.s), 1, night)
      }
      rect(0, line - 3, width, 7, p.grass)
      for (const u of f.tufts) {
        rect(u.x, line - 3 - u.h, 1, u.h, u.dark ? p.dark : p.grass)
      }
      if (p.flowers > 0.05) {
        f.flowers.forEach(({ x, pink }, i) => {
          rect(x, line - 4, 2, 2, pink ? '#f2a6c8' : '#f4e27a', p.flowers * (light ? 1 : 0.75))
          if (i % 6 === 3) {
            picture(pink ? 'flowers-pink' : 'flowers-yellow', x - 4, line + 1, 8, p.flowers, night)
          }
        })
      }
      rect(0, line + 4, width, 2, p.dark)
      if (camp && heads[row].length) {
        const x = Math.round(width / 2)
        const glow = c.createRadialGradient(x, ground - 6, 3, x, ground - 6, 40)
        glow.addColorStop(0, '#ffcb6680')
        glow.addColorStop(1, '#ff9b4400')
        rect(x - 40, ground - 46, 80, 55, glow, 0.85 + Math.sin(sec * 7) * 0.12)
        picture('fire', x, ground, 24 + Math.round(Math.sin(sec * 7) * 2), 1, 0, true)
        picture('embers', x, ground - 19 - (Math.floor(sec * 4) % 5), 13, 0.65, 0, true)
      }
      if (p.snow > 0.05 || p.leaves > 0.05) {
        const snowy = p.snow >= p.leaves
        snowAt(f.flakes, snowy ? sec : sec * 0.65, line - 2).forEach((s, i) => {
          if (snowy || i % 2 === 0) {
            rect(
              s.x,
              s.y,
              2,
              2,
              snowy ? '#ffffff' : i % 4 ? '#d9822b' : '#b0461f',
              (snowy ? p.snow : p.leaves) * (light ? 0.9 : 0.65)
            )
          }
        })
      }
      if (weather !== 'clear') {
        rect(0, 0, width, line + 6, '#0b1020', storm ? 0.32 : 0.18)
        for (const d of rainAt(f.drops, 0, line - 2, storm)) {
          rect(d.x, d.y, 1, storm ? 7 : 5, '#a9c3ff', light ? 0.6 : 0.4)
        }
        if (storm && !reduced && now - stormAt < 250) {
          rect(0, 0, width, line + 6, '#ffffff', 0.35)
        }
      }
      c.restore()
    }
  }
}
