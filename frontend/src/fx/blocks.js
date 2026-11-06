// Block break animations for the live screens, on one throwaway 2D canvas.
//   stream:   card breaks into tiles that fly across the screen and rebuild in a team's slot (sold)
//   sink:     card breaks apart and the tiles sink back into the grid (unsold)
//   assemble: tiles rise out of the grid and lock into the card's shape (new lot)
const CARD = '#17171c', GRID = '#141418'
const MIX = [[CARD, 62], ['#1d1d23', 12], ['#2a2a31', 8], ['#f4f1ea', 7], ['#ff3d8b', 7], ['#ffb547', 4]]
const pick = () => { let r = Math.random() * 100; for (const [c, w] of MIX) if ((r -= w) < 0) return c; return CARD }
const ease = k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))
const lerpColor = (a, b, k) => { const x = hex(a), y = hex(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * k))})` }

export function blocks(el, { mode, to = null, tile = 24 } = {}) {
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve()
  const R = el.getBoundingClientRect(), T = to?.getBoundingClientRect()
  const dpr = Math.min(devicePixelRatio || 1, 2)
  const c = document.createElement('canvas')
  c.setAttribute('aria-hidden', 'true')
  c.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:60;pointer-events:none'
  c.width = innerWidth * dpr; c.height = innerHeight * dpr
  document.body.appendChild(c)
  const x = c.getContext('2d')
  x.scale(dpr, dpr)

  const cols = Math.ceil(R.width / tile), rows = Math.ceil(R.height / tile)
  const tiles = []
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
    const sx = R.left + q * tile, sy = R.top + r * tile, color = pick()
    const t = { sx, sy, color, size: tile - 1 }
    if (mode === 'stream') {
      Object.assign(t, {
        tx: T.left + Math.random() * (T.width - 6), ty: T.top + Math.random() * (T.height - 6), endSize: 5,
        lift: 120 + Math.random() * 260, delay: (q + r) * 14 + Math.random() * 120, dur: 650 + Math.random() * 300,
      })
    } else if (mode === 'sink') {
      Object.assign(t, {
        tx: sx + (Math.random() - 0.5) * 80, ty: sy + innerHeight * 0.35 + Math.random() * 220, endSize: tile * 0.5,
        lift: -20 - Math.random() * 40, delay: r * 22 + Math.random() * 180, dur: 600 + Math.random() * 350, toColor: GRID,
      })
    } else {   // assemble: start low in the grid, end exactly on the card
      Object.assign(t, {
        tx: sx, ty: sy, sx: sx + (Math.random() - 0.5) * 160, sy: innerHeight + Math.random() * 200, endSize: tile - 1,
        startSize: tile * 0.4, lift: 80 + Math.random() * 160, delay: (rows - r) * 16 + Math.random() * 140,
        dur: 520 + Math.random() * 260, fromColor: GRID,
      })
    }
    tiles.push(t)
  }

  if (mode !== 'assemble') el.style.visibility = 'hidden'
  const t0 = performance.now()
  return new Promise(done => {
    const frame = now => {
      x.clearRect(0, 0, innerWidth, innerHeight)
      let live = false
      for (const t of tiles) {
        const k = Math.max(0, Math.min(1, (now - t0 - t.delay) / t.dur))
        if (k < 1) live = true
        const e = ease(k)
        const px = t.sx + (t.tx - t.sx) * e
        const py = t.sy + (t.ty - t.sy) * e - Math.sin(Math.PI * e) * t.lift   // arc
        const size = (t.startSize ?? t.size) + (t.endSize - (t.startSize ?? t.size)) * e
        x.fillStyle = t.toColor ? lerpColor(t.color, t.toColor, e) : t.fromColor ? lerpColor(t.fromColor, t.color, e) : t.color
        if (mode === 'assemble' && k === 0) continue
        x.fillRect(px, py, size, size)
      }
      if (live) return requestAnimationFrame(frame)
      c.remove()
      done()
    }
    requestAnimationFrame(frame)
  })
}
