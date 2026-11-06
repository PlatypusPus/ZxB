// Text decodes left to right: unrevealed characters cycle through random glyphs, then lock.
// Glyphs re-roll every ~80 ms (not every frame) so it reads as a calm terminal, not static.
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$*'

export function decode(el, duration = 1000) {
  if (!el || el._decoding || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const nodes = []
  while (walker.nextNode()) {
    const n = walker.currentNode
    if (n.nodeValue.trim()) nodes.push({ n, text: n.nodeValue, last: undefined })
  }
  if (!nodes.length) return
  const total = nodes.reduce((s, x) => s + x.text.length, 0)
  const hadLabel = el.hasAttribute('aria-label')
  if (!hadLabel) el.setAttribute('aria-label', el.textContent)   // screen readers keep the real text
  el._decoding = true
  const t0 = performance.now()
  let lastRoll = 0
  const draw = p => {
    let shown = Math.floor(p * total)
    for (const x of nodes) {
      if (x.last !== undefined && x.n.nodeValue !== x.last) continue   // React re-rendered it; leave it alone
      const keep = Math.max(0, Math.min(x.text.length, shown))
      shown -= x.text.length
      x.last = x.n.nodeValue = x.text.slice(0, keep) +
        [...x.text.slice(keep)].map(ch => ch === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0]).join('')
    }
  }
  const frame = now => {
    const p = Math.min(1, (now - t0) / duration)
    const eased = p * p * (3 - 2 * p)   // slow start and finish, so the first and last letters linger
    if (now - lastRoll > 80) { lastRoll = now; draw(eased) }
    if (p < 1) return requestAnimationFrame(frame)
    for (const x of nodes) if (x.n.nodeValue === x.last) x.n.nodeValue = x.text
    if (!hadLabel) el.removeAttribute('aria-label')
    el._decoding = false
  }
  draw(0)
  requestAnimationFrame(frame)
}
