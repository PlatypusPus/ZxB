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
  const [veto, setVeto] = useState(null)
  useEffect(() => {
    api('/auth/me').then(a => {
      setUser(a.user)
      if (a.user) api('/vetoes/mine').then(r => setVeto(r.id)).catch(() => {})
    }).catch(() => {})
  }, [])
  useEffect(() => {
    const on = () => setScrolled(scrollY > 8)
    on(); addEventListener('scroll', on, { passive: true })
    return () => removeEventListener('scroll', on)
  }, [])
  const here = location.pathname.replace(/\/+$/, '') || '/'
  const done = stage(info)
  const live = info?.status === 'auction_live' || info?.status === 'auction_paused'
  const chip = live ? 'AUCTION LIVE' : done || (info?.registration_open ? 'SIGN-UPS OPEN' : info ? 'SIGN-UPS CLOSED' : '…')
  const cta = live ? ['/projector', 'Watch live'] : user ? ['/profile', 'My profile'] : done ? ['/profile', 'Sign in'] : ['/signup', 'Sign up']
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
          {veto ? <a className="btn ghost veto-btn" href={`/veto/${veto}`}><span className="live-dot on" />Map veto</a> : <span className={'chip' + (live || done || info?.registration_open ? ' hot' : '')}><span className={'live-dot' + (live || done || info?.registration_open ? ' on' : '')} />{chip}</span>}
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
export const stage = info => info?.status === 'completed' ? 'PLAYOFFS' : null

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
// Where each group finish goes (Auction Cup playoffs format, updated 27 Nov).
export const QUALIFY = [['1st & 2nd', 'Upper bracket', 'ub'], ['3rd & 4th', 'Lower bracket', 'lb'], ['5th & 6th', 'Eliminated', 'out']]
// A group is over when every team that has played has met all the others. A team with no matches while the rest
// finished (Bhadwa Yojna Centre, Group A) counts as withdrawn and ranks last.
export function groupFinal(rows) {
  const active = rows.filter(t => t.p > 0)
  return active.length >= rows.length - 1 && active.length > 1 && active.every(t => t.p >= active.length - 1)
}
export const qualify = rank => QUALIFY[Math.min(Math.floor(rank / 2), 2)]

// Bracket seeds ("A1" -> team) from each finished group; a group still playing leaves its slots empty.
export function seedsFrom(standings = []) {
  const seeds = {}
  for (const g of ['A', 'B']) {
    const rows = standings.filter(t => t.group === g)
    if (groupFinal(rows)) rows.forEach((t, i) => { seeds[g + (i + 1)] = t })
  }
  return seeds
}

// The playoffs, as data. A side is a group seed ("A1") or the winner/loser of another match ("W:ub1", "L:ub2").
// Results (Admin -> Bracket) are {key: 'a' | 'b'}; teams move on through the bracket from them.
// [key, title, best of, side a, side b, name used in "Winner …" placeholders]
export const MATCHES = [
  ['ub1', 'UB semi 1', 3, 'A1', 'B2', 'UB semi 1'], ['ub2', 'UB semi 2', 3, 'B1', 'A2', 'UB semi 2'],
  ['ubf', 'Upper final', 3, 'W:ub1', 'W:ub2', 'upper final'],
  ['q', 'Qualifier', 1, 'A4', 'B5', 'A4–B5'],
  ['lb1', 'LB round 1', 1, 'A3', 'B4', 'A3 match'], ['lb2', 'LB round 1', 1, 'B3', 'W:q', 'B3 match'],
  ['lb3', 'LB round 2', 3, 'W:lb1', 'L:ub2', 'LB round 2 (1)'], ['lb4', 'LB round 2', 3, 'W:lb2', 'L:ub1', 'LB round 2 (2)'],
  ['lbs', 'LB semifinal', 3, 'W:lb3', 'W:lb4', 'LB semifinal'],
  ['lbf', 'Lower final', 3, 'W:lbs', 'L:ubf', 'lower final'],
  ['gf', 'Grand final', 5, 'W:ubf', 'W:lbf', 'grand final'],
]
const BY_KEY = Object.fromEntries(MATCHES.map(m => [m[0], m]))

// The team in a side, or null while it isn't decided yet.
export function sideTeam(ref, seeds, results) {
  if (!ref.includes(':')) return seeds[ref] || null
  const [wl, k] = ref.split(':'), m = BY_KEY[k], won = results[k]
  if (!won) return null
  return sideTeam(m[(won === 'a') === (wl === 'W') ? 3 : 4], seeds, results)
}
const sideLabel = ref => ref.includes(':') ? `${ref[0] === 'W' ? 'Winner' : 'Loser'} ${BY_KEY[ref.slice(2)][5]}` : ref

// Every result that depends on match k (directly or further on), so changing k can clear them.
export function after(k) {
  const out = new Set(), walk = key => MATCHES.forEach(m => {
    if ((m[3].slice(2) === key || m[4].slice(2) === key) && !out.has(m[0])) { out.add(m[0]); walk(m[0]) }
  })
  walk(k)
  return out
}

// A decided side shows the logo and tag (full name on hover); a seed slot before the groups end shows "TBD",
// a later slot "Winner UB semi 1". onPick (admin only) makes each decided side a button that declares the winner.
function Slot({ ref_, team, state, onPick }) {
  const seed = !ref_.includes(':') && <span className="br-seed mono">{ref_}</span>
  const body = team ? <>{seed}<img src={team.logo_url} alt="" /><abbr className="br-tag" title={team.name}>{team.tag}</abbr></>
    : <>{seed}<span>{seed ? 'TBD' : sideLabel(ref_)}</span></>
  const cls = 'br-slot' + (team ? '' : ' br-tbd') + (state ? ' br-' + state : '')
  return onPick && team
    ? <button type="button" className={cls} onClick={onPick} aria-pressed={state === 'won'} title={state === 'won' ? 'Click again to clear' : `${team.name} won`}>{body}</button>
    : <span className={cls}>{body}</span>
}

function Match({ m: [k, title, bo, a, b], seeds, results, onPick }) {
  const won = results[k]
  return (
    <div className="br-match"><span className="mono muted br-title">{title} · BO{bo}</span>
      {[a, b].map((ref, i) => {
        const side = 'ab'[i]
        return <Slot key={side} ref_={ref} team={sideTeam(ref, seeds, results)} state={won && (won === side ? 'won' : 'lost')}
          onPick={onPick && (() => onPick(k, won === side ? null : side))} />
      })}</div>
  )
}

// 8-team double elimination: group 1st/2nd start in the upper bracket, 3rd/4th in the lower (A4 via a qualifier).
export function Bracket({ seeds = {}, results = {}, onPick }) {
  const col = (keys, cls = 'br-col') => <div className={cls}>{keys.map(k => <Match key={k} m={BY_KEY[k]} seeds={seeds} results={results} onPick={onPick} />)}</div>
  return (
    <section className={'bracket' + (onPick ? ' br-admin' : '')} aria-label="Playoff bracket" data-build>
      <p className="br-label mono">UPPER BRACKET</p>
      {col(['ub1', 'ub2'])}{col(['ubf'])}
      <p className="br-label mono">LOWER BRACKET</p>
      {col(['q'], 'br-col br-qual')}{col(['lb1', 'lb2'])}{col(['lb3', 'lb4'])}{col(['lbs'])}{col(['lbf'])}
      {col(['gf'], 'br-gf')}
    </section>
  )
}

// Every date comes from Admin -> Settings; playoff dates are TBA until they're scheduled.
export function Schedule({ info, done, bracket = true }) {
  const auction = parseDay(info?.event_date), g1 = parseDay(info?.group_start), g2 = parseDay(info?.group_end)
  const size = info?.teams ? info.teams / 2 : 6
  // During the group stage the playoffs have no dates yet: show their order instead of a row of TBAs.
  let step = 1
  const tba = () => done ? [String(++step).padStart(2, '0'), step === 2 ? 'AFTER GROUPS' : 'THEN'] : ['TBA', 'DATE']
  const rows = [
    !done && [...dayCell(auction), 'Auction', 'Captains bid on registered players. Unsold players go again at half price.', ''],
    [...spanCell(g1, g2), 'Group stage', `${info?.teams ?? 12} teams in 2 groups of ${size}, single round robin: each team plays ${size - 1} matches, ${size * (size - 1)} in all.`, 'BO1'],
    [...tba(), 'Qualifier', 'A4 vs B5 for the last lower bracket spot.', 'BO1'],
    [...tba(), 'Lower round 1', 'A3 vs B4, and B3 vs the qualifier winner. Losers are out.', 'BO1'],
    [...tba(), 'Upper semifinals', 'A1 vs B2 and B1 vs A2.', 'BO3'],
    [...tba(), 'Lower round 2', 'Lower round 1 winners vs the upper semifinal losers.', 'BO3'],
    [...tba(), 'Upper final + lower semifinal', '', 'BO3'],
    [...tba(), 'Lower final', 'Lower semifinal winner vs the upper final loser.', 'BO3'],
    [...tba(), 'Grand final', '', 'BO5'],
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
          <p className="muted">The playoffs are an 8-team double elimination: 4 teams start in the upper bracket, 4 in the lower.</p>
        </section>
      </div>
      {bracket && <Bracket />}
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
