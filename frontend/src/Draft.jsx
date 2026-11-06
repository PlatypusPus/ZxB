import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { PlayerCard, TeamCard } from './Cards.jsx'
import { Stamp, TimerTiles } from './Projector.jsx'
import { Count, Footer, Nav, SlotMeter, Ticker } from './Layout.jsx'

const FAQ = [
  ['Who can sign up?', 'Anyone who plays Valorant. Pay the ₹300 entry, pick team leader or auction player, and wait for verification.'],
  ['How is my payment checked?', 'An organiser matches your 12-digit UTR against the receiving account statement. A screenshot alone is not enough, so enter the UTR carefully.'],
  ['How is my rank checked?', 'We open your Riot ID on tracker.gg. If your current or peak rank does not match, your sign-up is rejected with the reason.'],
  ['Will I definitely get a team?', 'Yes. Everyone approved is placed on a team, either by auction or in the final draft round.'],
  ['Can I edit my sign-up?', 'Yes, from your edit link, until an organiser starts checking it or registration closes.'],
  ['What happens to my ₹300 if I am rejected?', 'See the refund policy below. It is published before sign-ups open.'],
]

// A scripted example lot for the "How it works" section: bids land, the timer resets, the hammer falls.
// Times are in demo seconds, which run at 2x real time. The last lot gets no bids, to show UNSOLD.
const DEMO = [
  { p: { display_name: 'Kairo', riot_id: 'Kairo#ZXB', current_rank: 'Immortal 2', peak_rank: 'Radiant', role: 'Duelist', playstyle: 'Entry with Jett, loud comms', quote: 'One tap, no cap' },
    base: 220, bids: [[2, 'NGT'], [5, 'AMB'], [7, 'NGT'], [11, 'RKT']] },
  { p: { display_name: 'Wren', riot_id: 'Wren#ZXB', current_rank: 'Diamond 3', peak_rank: 'Ascendant 1', role: 'Controller', playstyle: 'Smokes early, lurks late' },
    base: 120, bids: [[3, 'LOW'], [6, 'AMB']] },
  { p: { display_name: 'Pyre', riot_id: 'Pyre#ZXB', current_rank: 'Gold 1', peak_rank: 'Gold 3', role: 'Initiator', playstyle: 'Info first, then the trade' },
    base: 50, bids: [] },
]
const WINDOW = 10   // demo seconds without a bid before the lot closes

function AuctionDemo() {
  const ref = useRef()
  const [n, setN] = useState(0)
  const [t, setT] = useState(0)
  useEffect(() => {   // only tick while on screen
    let on = false
    const io = new IntersectionObserver(([e]) => { on = e.isIntersecting })
    io.observe(ref.current)
    const id = setInterval(() => on && setT(x => x + 0.2), 100)
    return () => { clearInterval(id); io.disconnect() }
  }, [])
  const lot = DEMO[n % DEMO.length]
  const made = lot.bids.filter(([at]) => at <= t)
  const last = made.at(-1)
  const price = last ? lot.base + 25 * (made.length - 1) : lot.base
  const since = t - (last ? last[0] : 0)
  const left = Math.max(0, WINDOW - since)
  const closed = left === 0
  useEffect(() => { if (closed && since > WINDOW + 6) { setN(n + 1); setT(0) } }, [t])
  const stamp = useMemo(() => closed ? { kind: last ? 'sold' : 'unsold', team: last && { tag: last[1] }, price } : null, [closed, n])

  return (
    <figure className="demo" ref={ref}>
      <div className="demo-stage">
        <PlayerCard p={{ ...lot.p, base_price: lot.base }} />
        <div className="demo-bid">
          <p className="mono muted">{last ? `${last[1]} LEADS` : 'OPENING BID'}</p>
          <p className="digits demo-price" key={price}>{price}</p>
          <TimerTiles left={left} total={WINDOW} n={12} />
        </div>
        <Stamp stamp={stamp} />
      </div>
      <figcaption className="muted">Example lot. On the day it runs live on the projector, and leaders bid from their phones.</figcaption>
    </figure>
  )
}

export default function Draft() {
  const [info, setInfo] = useState(null)
  const [teams, setTeams] = useState([])
  const [pool, setPool] = useState([])
  useEffect(() => {
    api('/public').then(setInfo).catch(() => {})
    api('/teams').then(setTeams).catch(() => {})
    api('/players').then(setPool).catch(() => {})
  }, [])
  const name = info?.name || 'ZenithXBeans Valorant Draft'
  const open = info?.registration_open

  return (
    <>
      <Nav info={info} />
      <main>
        <section className="hero hero-split wrap">
          <div className="hero-copy">
            <h1 className="display hero-title"><span data-decode>Valorant</span><span className="outline" data-decode>Draft</span></h1>
            <p className="lede">Lead a team or get drafted. Eight leaders spend {info?.credits_per_team ?? 1000} credits each in a live auction on {info?.event_date || 'a date to be announced'}.</p>
            <div className="actions">
              {open !== false ? <a className="btn big" href="/signup">Sign up · ₹{info?.fee ?? 300}</a> : <span className="tag">Registration is closed</span>}
              <a className="btn big ghost" href="/projector">Watch the auction</a>
            </div>
            <div className="hero-strip">
              <div><Count value={info?.fee} prefix="₹" /><span className="muted">entry</span></div>
              <div><Count value={info?.signups} /><span className="muted">signed up</span></div>
              <div><Count value={info?.credits_per_team} /><span className="muted">credits per team</span></div>
            </div>
          </div>
          <aside className="card hero-panel" data-build aria-label="At a glance">
            <p className="mono muted">AT A GLANCE</p>
            <SlotMeter info={info} />
            <dl className="facts">
              <div><dt className="mono muted">TEAMS</dt><dd>{info?.teams ?? 8} teams · 5 + subs</dd></div>
              <div><dt className="mono muted">ROSTER</dt><dd>Leader + {info?.min_players ?? 4} or more</dd></div>
              <div><dt className="mono muted">UNSOLD</dt><dd>Round 2 at half price</dd></div>
            </dl>
          </aside>
        </section>

        <Ticker text={`${name} · ${info?.event_date || 'date TBA'} · ₹${info?.fee ?? 300} entry · `} />

        <section className="wrap" data-section>
          <h2 className="display" data-decode>How it works</h2>
          <div className="how">
            <AuctionDemo />
            <ol className="how-steps">
              <li><strong>Sign up</strong><span>Fill your profile, pick leader or player, pay ₹{info?.fee ?? 300} by UPI and enter the UTR.</span></li>
              <li><strong>Get drafted</strong><span>{info?.teams ?? 8} leaders bid on players live with {info?.credits_per_team ?? 1000} credits each. Every bid resets the clock.</span></li>
              <li><strong>Play</strong><span>Teams of 5 plus subs play it out. Rosters are public the moment the auction ends.</span></li>
            </ol>
          </div>
        </section>

        <section className="wrap split" data-section>
          <article className="card panel" data-build>
            <p className="mono amber">PATH A · {info?.leader_slots_left ?? 8} OF {info?.teams ?? 8} SLOTS LEFT</p>
            <h2 className="display">Team leader</h2>
            <p>Create your team: name, tag and logo. You're on your own team for free and never auctioned. You build the rest of the roster with credits.</p>
          </article>
          <article className="card panel" data-build>
            <p className="mono amber">PATH B</p>
            <h2 className="display">Auction player</h2>
            <p>Show your rank, role and playstyle on your card. Leaders bid for you live. Base price depends on your rank.</p>
          </article>
        </section>

        <section className="wrap" data-section>
          <h2 className="display" data-decode>Format and rules</h2>
          <div className="grid3">
            <article className="card" data-build><h3>Credits</h3><p>Every team gets {info?.credits_per_team ?? 1000}. Unspent credits are lost.</p></article>
            <article className="card" data-build><h3>Rosters</h3><p>Leader plus at least {info?.min_players ?? 4} bought players. A leader can never bid what would leave them short.</p></article>
            <article className="card" data-build><h3>Base prices</h3><p className="small">{info ? Object.entries(info.band_base_price).sort((a, b) => a[1] - b[1]).map(([k, v]) => `${k} ${v}`).join(' · ') : '…'}</p></article>
          </div>
        </section>

        <section className="wrap teams" data-section data-pin>
          <h2 className="display" data-decode>Teams</h2>
          {teams.length ? <div className="grid4">{teams.map(t => <TeamCard key={t.id} t={t} />)}</div>
            : <p className="muted">Teams appear here once leaders are approved.</p>}
        </section>

        <section className="wrap" data-section>
          <h2 className="display" data-decode>Player pool</h2>
          {pool.length ? (
            <ol className="seats">
              {pool.slice(0, 12).map((p, i) => (
                <li key={p.id} data-build>
                  <span className="mono amber">{String(i + 1).padStart(2, '0')}</span>
                  <span>{p.display_name}</span><span className="muted">{p.current_rank}</span>
                  <span className="muted">{p.role}</span><span className="tag">In pool</span>
                </li>
              ))}
            </ol>
          ) : <p className="muted">Approved players show up here.</p>}
        </section>

        <section className="wrap" data-section>
          <h2 className="display" data-decode>Prize pool</h2>
          <p className="muted">The prize split and where the fees go will be published here before sign-ups close.</p>
        </section>

        <section className="wrap" data-section>
          <h2 className="display" data-decode>FAQ</h2>
          {FAQ.map(([q, a]) => <details className="card faq" data-build key={q}><summary>{q}</summary><p>{a}</p></details>)}
        </section>
      </main>
      <Footer />
    </>
  )
}
