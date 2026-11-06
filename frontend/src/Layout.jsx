import { useEffect, useState } from 'react'

const RIOT_NOTICE = "ZenithXBeans' tournaments aren't endorsed by Riot Games and don't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc."

// The mark: a Z drawn on a 5x5 tile grid, with one amber tile at the zenith.
const Z = ['11112', '00010', '00100', '01000', '11111']
export function Logo() {
  return (
    <span className="logo-mark" aria-hidden="true">
      {Z.join('').split('').map((v, i) => <span key={i} className={v === '1' ? 'on' : v === '2' ? 'top' : ''} />)}
    </span>
  )
}

const LINKS = [['/', 'Home'], ['/#tournaments', 'Tournaments'], ['/draft', 'Valorant Draft'], ['/projector', 'Live auction']]

export function Nav({ info }) {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(scrollY > 8)
    on(); addEventListener('scroll', on, { passive: true })
    return () => removeEventListener('scroll', on)
  }, [])
  const here = location.pathname.replace(/\/+$/, '') || '/'
  const live = info?.status === 'auction_live' || info?.status === 'auction_paused'
  const chip = live ? 'AUCTION LIVE' : info?.registration_open ? 'SIGN-UPS OPEN' : info ? 'SIGN-UPS CLOSED' : '…'
  return (
    <header className={'nav' + (scrolled ? ' scrolled' : '') + (open ? ' open' : '')}>
      <div className="nav-inner wrap">
        <a href="/" className="brand" aria-label="ZenithXBeans home"><Logo /><span className="mono">ZENITHXBEANS</span></a>
        <nav id="nav-links" aria-label="Main">
          {LINKS.map(([href, label]) => (
            <a key={href} href={href} aria-current={href === here ? 'page' : undefined} onClick={() => setOpen(false)}>{label}</a>
          ))}
          <a href="/signup" className="btn nav-mobile-cta">Sign up</a>
        </nav>
        <div className="nav-right">
          <span className={'chip' + (live || info?.registration_open ? ' hot' : '')}><span className={'live-dot' + (live || info?.registration_open ? ' on' : '')} />{chip}</span>
          <a href={live ? '/projector' : '/signup'} className="btn nav-cta">{live ? 'Watch live' : 'Sign up'}</a>
          <button className="nav-toggle" aria-expanded={open} aria-controls="nav-links" aria-label="Menu" onClick={() => setOpen(!open)}>
            <span /><span /><span />
          </button>
        </div>
      </div>
    </header>
  )
}

// The text stays in the HTML (static tier); the matrix redraws it as an LED band when WebGL runs.
export function Ticker({ text }) {
  return <div className="ticker" data-ticker={text.replace(/₹/g, 'RS ')} aria-hidden="true"><div>{text.repeat(8)}</div></div>
}

// Count-up hook: key on the value, so a changed number mounts a fresh element and rolls again.
export function Count({ value, prefix = '' }) {
  return value == null ? <span className="digits">—</span>
    : <span className="digits" data-count key={value}>{prefix}{value}</span>
}

// Leader slots as tiles: red = taken, outlined = still open.
export function SlotMeter({ info }) {
  const total = info?.teams ?? 8, left = info?.leader_slots_left ?? total
  return (
    <div className="meter">
      <p className="mono muted">LEADER SLOTS</p>
      <div className="meter-tiles" role="img" aria-label={`${left} of ${total} leader slots open`}>
        {Array.from({ length: total }, (_, i) => <span key={i} className={i < total - left ? 'taken' : ''} />)}
      </div>
      <p className="mono"><span className="amber">{left}</span> OF {total} OPEN</p>
    </div>
  )
}

export function Footer() {
  return (
    <footer className="wrap footer" data-section>
      <div className="grid3">
        <div><a href="/" className="brand"><Logo /><span className="mono">ZENITHXBEANS</span></a><p className="muted">Community tournaments, run in the open.</p></div>
        <div><p><strong>Refund policy</strong></p><p className="muted">Published before sign-ups open for each tournament.</p></div>
        <div><p><strong>Contact</strong></p><p className="muted">ZenithXBeans on Discord.</p></div>
      </div>
      <p className="muted small">{RIOT_NOTICE}</p>
    </footer>
  )
}
