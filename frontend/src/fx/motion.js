// Scroll motion for the public pages. Loaded lazily after first paint.
// Hooks (plain data attributes, so React components stay dumb):
//   data-build     card assembles from matrix tiles on enter, breaks back into the grid on scroll up
//   data-decode    text decodes left to right through random glyphs
//   data-count     number rolls up in dot-matrix digits
//   data-section   a diagonal wave of lit tiles crosses the screen as it comes in
//   data-pin       (desktop) section pins for one screen while its cards build one after another
//   data-ticker    LED ticker drawn by the matrix, speeds up with scroll
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import { createMatrix } from './matrix.js'
import { decode } from './decode.js'

const root = document.documentElement

// Images sharpen in blocky steps: 16 px mosaic, then 8, 4, 2, then the real image.
function mosaic(img) {
  const run = () => {
    const w = img.clientWidth, h = img.clientHeight, parent = img.offsetParent
    if (!w || !h || !parent) return
    const c = document.createElement('canvas'), x = c.getContext('2d')
    const tiny = document.createElement('canvas'), tx = tiny.getContext('2d')
    c.width = w; c.height = h; c.setAttribute('aria-hidden', 'true')
    c.style.cssText = `position:absolute;left:${img.offsetLeft}px;top:${img.offsetTop}px;width:${w}px;height:${h}px;image-rendering:pixelated`
    parent.appendChild(c)
    const steps = [16, 8, 4, 2]
    const step = () => {
      const b = steps.shift()
      if (!b) return c.remove()
      tiny.width = Math.ceil(w / b); tiny.height = Math.ceil(h / b)
      tx.drawImage(img, 0, 0, tiny.width, tiny.height)
      x.imageSmoothingEnabled = false
      x.clearRect(0, 0, w, h); x.drawImage(tiny, 0, 0, w, h)
      setTimeout(step, 60)
    }
    try { step() } catch { c.remove() }
  }
  img.complete ? run() : img.addEventListener('load', run, { once: true })
}

function countUp(el) {
  const node = el.firstChild
  const m = node?.nodeValue?.match(/^(\D*)(\d+)(.*)$/s)
  if (!m) return
  const st = { v: 0 }
  gsap.to(st, { v: +m[2], duration: 0.9, ease: 'power2.out', onUpdate: () => { node.nodeValue = m[1] + Math.round(st.v) + m[3] } })
}

export function startMotion() {
  gsap.registerPlugin(ScrollTrigger)
  const lenis = new Lenis({ anchors: true, lerp: 0.12 })   // wheel/trackpad only; touch keeps native scrolling
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.lagSmoothing(0)

  let m = null
  if (root.classList.contains('fx')) {
    const canvas = document.createElement('canvas')
    canvas.className = 'matrix'; canvas.setAttribute('aria-hidden', 'true')
    document.body.prepend(canvas)
    try { m = createMatrix(canvas) } catch (e) { console.warn('[matrix]', e) }
    if (m) {
      root.classList.add('gl')
      canvas.addEventListener('webglcontextlost', () => root.classList.remove('gl', 'fx'))
      addEventListener('resize', m.resize)
    } else { canvas.remove(); root.classList.remove('fx') }   // static grid tier, everything visible
  }

  gsap.ticker.add((time, dms) => {
    lenis.raf(time * 1000)
    if (!m) return
    const max = root.scrollHeight - innerHeight
    m.state.rise = 0.18 + 0.82 * Math.min(1, max > 0 ? scrollY / (max * 0.8) : 0)
    m.state.tickSpeed = Math.min(80, Math.abs(lenis.velocity) * 2)
    m.render(time, dms / 1000, scrollY)
  })
  if (m && matchMedia('(pointer: fine)').matches) {
    addEventListener('pointermove', e => { m.state.mouse = [e.clientX, e.clientY]; m.state.glow = 1 }, { passive: true })
  }

  const built = el => {
    el.classList.add('built')
    el.querySelectorAll('h1, h2, h3, .mono, [data-decode]').forEach(x => decode(x, 750))
    el.querySelectorAll('img').forEach(mosaic)
  }
  const track = el => {
    if (!el._fx) { el._fx = { el, p: 0 }; m?.state.cards.push(el._fx) }
    return el._fx
  }
  const build = (el, delay) => {
    const st = track(el)
    gsap.to(st, { p: 1, duration: 0.3 + Math.random() * 0.15, delay, ease: 'power1.in', overwrite: true, onComplete: () => built(el) })
  }
  const breakDown = el => {
    el.classList.remove('built')
    gsap.to(track(el), { p: 0, duration: 0.3, ease: 'power1.out', overwrite: true })
  }

  const desktop = matchMedia('(min-width: 900px)').matches
  const seen = new WeakSet()
  function scan() {
    const fresh = sel => [...document.querySelectorAll(sel)].filter(el => !seen.has(el) && seen.add(el))

    if (m) {
      if (desktop) for (const sec of document.querySelectorAll('[data-pin]')) {
        const kids = [...sec.querySelectorAll('[data-build]')]
        if (sec._pinned || !kids.length) continue
        sec._pinned = true
        kids.forEach(k => { seen.add(k); track(k) })
        ScrollTrigger.create({
          trigger: sec, pin: true, start: 'top top', end: '+=' + innerHeight, scrub: true,
          onUpdate: s => kids.forEach((k, i) => {
            const p = gsap.utils.clamp(0, 1, (s.progress * (kids.length + 1) - i) * 1.5)
            const st = track(k), was = st.p
            st.p = p
            if (p >= 1 && was < 1) built(k)
            if (p < 1 && was >= 1) k.classList.remove('built')
          }),
        })
      }
      const cards = fresh('[data-build]')
      if (cards.length) ScrollTrigger.batch(cards, {
        start: 'top 92%',
        onEnter: b => b.forEach((el, i) => build(el, i * 0.08)),
        onLeaveBack: b => b.forEach(breakDown),
      })
      for (const sec of fresh('[data-section]')) ScrollTrigger.create({
        trigger: sec, start: 'top 75%',
        onEnter: () => gsap.fromTo(m.state, { wave: 0.001 }, { wave: 0.999, duration: 1.2, ease: 'power1.inOut', overwrite: true }),
      })
      const t = document.querySelector('[data-ticker]')
      if (t && m.state.ticker !== t) {
        m.state.ticker = t
        document.fonts.load('8px Silkscreen').finally(() => m.setTickerText(t.dataset.ticker.toUpperCase()))
      }
    }
    for (const el of fresh('[data-decode]')) ScrollTrigger.create({ trigger: el, start: 'top 90%', onEnter: () => decode(el, el.closest('h1') ? 1400 : 1000) })
    for (const el of fresh('[data-count]')) ScrollTrigger.create({ trigger: el, start: 'top 95%', once: true, onEnter: () => countUp(el) })
    ScrollTrigger.refresh()
  }

  let pending
  new MutationObserver(() => { clearTimeout(pending); pending = setTimeout(scan, 80) })
    .observe(document.getElementById('root'), { childList: true, subtree: true })
  scan()
}
