import { createRoot } from 'react-dom/client'
import './styles.css'
import Home from './Home.jsx'
import Draft from './Draft.jsx'
import Signup from './Signup.jsx'
import Status from './Status.jsx'
import Admin from './Admin.jsx'
import Projector from './Projector.jsx'
import Leader from './Leader.jsx'

// ponytail: seven routes, so a pathname switch instead of a router library.
const path = location.pathname.replace(/\/+$/, '') || '/'
const page = path === '/draft' ? <Draft />
  : path.startsWith('/signup') ? <Signup />
  : path.startsWith('/status/') ? <Status token={decodeURIComponent(path.slice(8))} />
  : path.startsWith('/admin') ? <Admin />
  : path === '/projector' ? <Projector />
  : path.startsWith('/leader/') ? <Leader code={decodeURIComponent(path.slice(8))} />
  : <Home />

createRoot(document.getElementById('root')).render(page)

const showcase = path === '/' || path === '/draft'
const still = matchMedia('(prefers-reduced-motion: reduce)').matches

// Static tier band (CSS): climbs with scroll. The WebGL matrix replaces it when it boots.
const band = document.querySelector('.band')
const liveScreen = path === '/projector' || path.startsWith('/leader/')
if (liveScreen) band.classList.add('top')   // live screens: static grid, lit band fixed at the top
else if (!showcase) band.remove()
else {
  const rise = () => {
    const max = document.documentElement.scrollHeight - innerHeight
    const p = still || max <= 0 ? 0.5 : Math.min(1, scrollY / (max * 0.8))
    band.style.setProperty('--rise', (18 + p * 82).toFixed(1) + 'vh')
  }
  addEventListener('scroll', rise, { passive: true }); addEventListener('resize', rise); rise()
}

// Smooth scroll + matrix only on the showcase pages: forms never animate while someone types.
if (showcase && !still) {
  const boot = () => import('./fx/motion.js').then(m => m.startMotion())
    .catch(e => { console.warn('[fx]', e); document.documentElement.classList.remove('fx') })
  window.requestIdleCallback ? requestIdleCallback(boot, { timeout: 600 }) : setTimeout(boot, 200)
}
