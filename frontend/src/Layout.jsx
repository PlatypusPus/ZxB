import { useEffect, useState } from 'react'
import { api } from './api.js'

const RIOT_NOTICE = "ZenithXBeans' tournaments aren't endorsed by Riot Games and don't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc."

// The Zen x Beans lockup, used as the home link.
export function Logo() {
  return (
    <span className="brand-logo" aria-hidden="true">
      <img className="zen" src="/zen.webp" width="1200" height="405" alt="" />
      <span className="x">×</span>
      <img className="beans" src="/beans.webp" width="982" height="558" alt="" />
    </span>
  )
}

const LINKS = [['/', 'Home'], ['/#tournaments', 'Tournaments'], ['/draft', 'Valorant Auction'], ['/scoreboard', 'Scoreboard']]

export function Nav({ info }) {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [user, setUser] = useState(null)
  useEffect(() => { api('/auth/me').then(a => setUser(a.user)).catch(() => {}) }, [])
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
        <a href="/" className="brand" aria-label="ZenithXBeans home"><Logo /></a>
        <nav id="nav-links" aria-label="Main">
          {LINKS.map(([href, label]) => (
            <a key={href} href={href} aria-current={href === here ? 'page' : undefined} onClick={() => setOpen(false)}>{label}</a>
          ))}
          <a href={user ? '/profile' : '/signup'} className="btn nav-mobile-cta">{user ? 'My profile' : 'Sign up'}</a>
        </nav>
        <div className="nav-right">
          <span className={'chip' + (live || info?.registration_open ? ' hot' : '')}><span className={'live-dot' + (live || info?.registration_open ? ' on' : '')} />{chip}</span>
          <a href={live ? '/projector' : user ? '/profile' : '/signup'} className="btn nav-cta">{live ? 'Watch live' : user ? 'My profile' : 'Sign up'}</a>
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
// ponytail: fixed schedule for this event; move into settings when there is a second tournament.
// "15 Nov 2026" -> { day: '15', mon: 'NOV', weekday: 'Sunday', date }, or null if it can't be read.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
export function parseDay(text) {
  const [d, m, y] = (text || '').split(' '), mi = MONTHS.indexOf((m || '').slice(0, 3).toLowerCase())
  if (!/^\d{1,2}$/.test(d || '') || mi < 0 || !/^\d{4}$/.test(y || '')) return null
  const date = new Date(+y, mi, +d)
  return { day: d, mon: MONTHS[mi].toUpperCase(), weekday: date.toLocaleDateString('en-GB', { weekday: 'long' }), date }
}

// Date cell for a "15 Nov 2026" setting: big day number plus "NOV · SUN", or TBA.
export const dayCell = a => a ? [a.day, `${a.mon} · ${a.weekday.slice(0, 3).toUpperCase()}`] : ['TBA', 'DATE']
// A span of two settings: "15–21" over "NOV" (or "15 NOV–2 DEC" style when months differ).
export function spanCell(from, to) {
  if (!from || !to) return dayCell(from || to)
  return from.mon === to.mon ? [`${from.day}–${to.day}`, from.mon] : [`${from.day}–${to.day}`, `${from.mon}–${to.mon}`]
}
const SEEDS = ['Group A winner', 'Group B winner', 'Group A runner-up', 'Group B runner-up', 'Group A 3rd', 'Group B 3rd']

// Every date comes from Admin -> Settings; anything not set shows TBA.
export function Schedule({ info }) {
  const auction = parseDay(info?.event_date), g1 = parseDay(info?.group_start), g2 = parseDay(info?.group_end)
  const po = parseDay(info?.playoffs_start), tba = ['TBA', 'DATE']
  const rows = [
    [...dayCell(auction), 'Auction', 'Captains bid on registered players. Unsold players go again at half price.', ''],
    [...spanCell(g1, g2), 'Group stage', `${info?.teams ? info.teams + ' teams' : 'Teams'} split into 2 groups, single round robin.`, 'BO1'],
    [...dayCell(g2), 'Playoff scheduling', 'Organisers agree playoff match times with the qualified teams that night.', ''],
    [...dayCell(po), 'Upper bracket round 1', 'Playoffs begin. Top 3 from each group qualify.', 'BO3'],
    [...tba, 'Lower bracket round 1', '', 'BO3'],
    [...tba, 'Upper semifinals + lower round 2', 'Seeds 1 and 2 join here.', 'BO3'],
    [...tba, 'Upper final + lower final', '', 'BO3'],
    [...tba, 'Grand final', '', 'BO5'],
  ]
  return (
    <div className="schedule">
      <ol className="sched" aria-label="Schedule">
        {rows.map(([d, label, h, p, fmt]) => (
          <li key={h} data-build>
            <span className="sched-date"><b className="digits">{d}</b><span className="mono muted">{label}</span></span>
            <span><strong>{h}</strong>{p && <span className="muted"> {p}</span>}</span>
            {fmt && <span className="tag ghost">{fmt}</span>}
          </li>
        ))}
      </ol>
      <section className="seeds" aria-labelledby="seeds-h">
        <h3 id="seeds-h">Playoff seeding</h3>
        <ol>{SEEDS.map((s, i) => <li key={s}><b className="digits">{i + 1}</b> {s}</li>)}</ol>
        <p className="muted">Seeds 1 and 2 get byes to the upper semifinals. Seeds 5 and 6 start in the lower bracket.</p>
      </section>
    </div>
  )
}

export function SlotMeter({ info, teams = [] }) {
  const total = info?.teams ?? 10, left = info?.leader_slots_left ?? total
  return (
    <div className="meter">
      <p className="mono muted">TEAM SLOTS</p>
      <div className="meter-tiles" role="img" aria-label={`${left} of ${total} team slots open`}>
        {Array.from({ length: total }, (_, i) => teams[i]
          ? <span key={i} className="logo-tile" title={teams[i].name}><img src={teams[i].logo_url} alt="" /></span>
          : <span key={i} className={i < total - left ? 'taken' : ''} />)}
      </div>
      <p className="mono"><span className="amber">{left}</span> OF {total} OPEN</p>
    </div>
  )
}

// Discord has no public link by username, so each contact copies the username to paste into Discord's search.
const CONTACTS = ['shanks_87', 'mystic_mc']

function Contacts() {
  const [copied, setCopied] = useState('')
  const copy = u => navigator.clipboard?.writeText(u).then(() => { setCopied(u); setTimeout(() => setCopied(''), 1600) })
  return (
    <ul className="contacts">
      {CONTACTS.map(u => (
        <li key={u}>
          <span className="contact-name">@{u}</span>
          <button type="button" className="btn ghost" onClick={() => copy(u)} aria-label={`Copy Discord username ${u}`}>{copied === u ? 'Copied ✓' : 'Copy'}</button>
        </li>
      ))}
    </ul>
  )
}

export function Footer() {
  return (
    <footer className="wrap footer" data-section>
      <div className="grid3">
        <div><a href="/" className="brand" aria-label="ZenithXBeans home"><Logo /></a><p className="muted">Community Valorant tournaments.</p></div>
        <div><p><strong>Policies</strong></p><div className="actions"><a className="btn ghost" href="/terms">Terms</a><a className="btn ghost" href="/refund-policy">Refund policy</a><a className="btn ghost" href="/privacy">Privacy</a></div></div>
        <div><p><strong>Contact on Discord</strong></p><Contacts /></div>
      </div>
      <p className="muted small">{RIOT_NOTICE}</p>
      <div className="made-by"><span className="muted small">Made by</span><a className="made-by-link" href="https://shov.in" target="_blank" rel="noreferrer">shov.in ↗</a></div>
    </footer>
  )
}
