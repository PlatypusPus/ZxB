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
  const done = stage(info)
  const live = info?.status === 'auction_live' || info?.status === 'auction_paused'
  const chip = live ? 'AUCTION LIVE' : done || (info?.registration_open ? 'SIGN-UPS OPEN' : info ? 'SIGN-UPS CLOSED' : '…')
  const cta = live ? ['/projector', 'Watch live'] : user ? ['/profile', 'My profile'] : done ? ['/scoreboard', 'Scoreboard'] : ['/signup', 'Sign up']
  return (
    <header className={'nav' + (scrolled ? ' scrolled' : '') + (open ? ' open' : '')}>
      <div className="nav-inner wrap">
        <a href="/" className="brand" aria-label="ZenithXBeans home"><Logo /></a>
        <nav id="nav-links" aria-label="Main">
          {LINKS.filter(([href]) => !(done && href === '/draft')).map(([href, label]) => (
            <a key={href} href={href} aria-current={href === here ? 'page' : undefined} onClick={() => setOpen(false)}>{label}</a>
          ))}
          <a href={cta[0]} className="btn nav-mobile-cta">{cta[1]}</a>
        </nav>
        <div className="nav-right">
          <span className={'chip' + (live || done || info?.registration_open ? ' hot' : '')}><span className={'live-dot' + (live || done || info?.registration_open ? ' on' : '')} />{chip}</span>
          <a href={cta[0]} className="btn nav-cta">{cta[1]}</a>
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
// After the auction: which part of the tournament is on, from the dates in Settings.
export const stage = info => info?.status === 'completed' ? 'GROUP STAGE' : null   // ponytail: add PLAYOFFS once they're scheduled

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
// Where each group finish goes (Auction Cup playoffs format, 19 Nov).
export const QUALIFY = [['1st & 2nd', 'Upper bracket', 'ub'], ['3rd & 4th', 'Play-in', 'pi'], ['5th & 6th', 'Eliminated', 'out']]
export const qualify = rank => QUALIFY[Math.min(Math.floor(rank / 2), 2)]

const Match = ({ title, a, b }) => (
  <div className="br-match"><span className="mono muted">{title}</span><span>{a}</span><span>{b}</span></div>
)

// Every date comes from Admin -> Settings; playoff dates are TBA until they're scheduled.
export function Schedule({ info, done }) {
  const auction = parseDay(info?.event_date), g1 = parseDay(info?.group_start), g2 = parseDay(info?.group_end)
  const tba = ['TBA', 'DATE'], size = info?.teams ? info.teams / 2 : 6
  const rows = [
    !done && [...dayCell(auction), 'Auction', 'Captains bid on registered players. Unsold players go again at half price.', ''],
    [...spanCell(g1, g2), 'Group stage', `${info?.teams ?? 12} teams in 2 groups of ${size}, single round robin.`, 'BO1'],
    [...tba, 'Play-in', 'A3 vs B4 and B3 vs A4, single elimination. Winners go to the lower bracket.', 'BO3'],
    [...tba, 'Upper semifinals', 'A1 vs B2 and B1 vs A2.', 'BO3'],
    [...tba, 'Lower round 1', 'Play-in winners vs the upper semifinal losers.', 'BO3'],
    [...tba, 'Upper final + lower final', '', 'BO3'],
    [...tba, 'Grand final', '', 'BO5'],
  ].filter(Boolean)
  return (
    <>
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
          <h3 id="seeds-h">From each group</h3>
          <ol>{QUALIFY.map(([place, where, k]) => <li key={k} className={'q-' + k}><b className="digits">{place}</b> {where}</li>)}</ol>
          <p className="muted">The playoffs are a 6-team double elimination: 4 teams start in the upper bracket, 2 come in from the play-in.</p>
        </section>
      </div>
      <section className="bracket" aria-label="Playoff bracket" data-build>
        <p className="br-label mono">UPPER BRACKET</p>
        <div className="br-col"><Match title="UB 1 · BO3" a="A1" b="B2" /><Match title="UB 2 · BO3" a="B1" b="A2" /></div>
        <div className="br-col"><Match title="Upper final · BO3" a="Winner UB 1" b="Winner UB 2" /></div>
        <p className="br-label mono">PLAY-IN → LOWER BRACKET</p>
        <div className="br-col"><Match title="Play-in 1 · BO3" a="A3" b="B4" /><Match title="Play-in 2 · BO3" a="B3" b="A4" /></div>
        <div className="br-col"><Match title="LB 1 · BO3" a="Play-in winner 1" b="Loser UB 1" /><Match title="LB 2 · BO3" a="Play-in winner 2" b="Loser UB 2" /></div>
        <div className="br-col"><Match title="Lower final · BO3" a="Winner LB 1" b="Winner LB 2" /></div>
        <div className="br-gf"><Match title="Grand final · BO5" a="Upper final winner" b="Lower final winner" /></div>
      </section>
    </>
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
