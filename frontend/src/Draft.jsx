import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { PlayerCard, TeamCard } from './Cards.jsx'
import { Stamp, TimerTiles } from './Projector.jsx'
import { Count, Footer, Nav, Schedule, SlotMeter, Ticker } from './Layout.jsx'

const FAQ = [
  ['Who can sign up?', 'Anyone who plays Valorant. Pick captain or auction player and sign up for free today; the entry fee is collected later to confirm your spot. The sub pool is free.'],
  ['When do I pay?', 'Not at sign-up. The entry fee is collected later to confirm your spot, and we email everyone how and when to pay. The whole prize pool is made up of entry fees.'],
  ['What if I’m not picked as a captain?', 'You stay in: your sign-up moves into the auction player pool and captains bid for you on auction day.'],
  ['How is my rank checked?', 'We open your Riot ID on tracker.gg. If your current or peak rank does not match, your sign-up is rejected with the reason.'],
  ['Will I definitely get a team?', 'Yes. Everyone approved is placed on a team, either by auction or in the final draft round.'],
  ['Can I edit my sign-up?', 'Yes, from your edit link, until an organiser starts checking it or registration closes.'],
  ['Can I get a refund?', 'No. Once you have signed up and paid, the entry is not refunded. If you can’t play, you can swap your place to someone else through the organisers. See the refund policy.'],
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
      <figcaption className="muted">Example lot. On the day, captains call their bids out loud in the room and the screen shows the player up and the timer.</figcaption>
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
  const name = info?.name || 'ZenithXBeans Valorant Auction'
  const open = info?.registration_open

  return (
    <>
      <Nav info={info} />
      <main>
        <section className="hero hero-split wrap">
          <div className="hero-copy">
            <h1 className="display hero-title"><span data-decode>Valorant</span><span className="outline" data-decode>Auction</span></h1>
            <p className="lede">Lead a team or get drafted. {info?.teams ?? 10} captains spend {info?.credits_per_team ?? 1000} credits each in a live auction on {info?.event_date || 'a date to be announced'}.</p>
            <div className="actions">
              {open !== false ? <a className="btn big" href="/signup">Sign up</a> : <span className="tag">Registration is closed</span>}
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
              <div><dt className="mono muted">TEAMS</dt><dd>{info?.teams ?? 10} teams · 5 + subs</dd></div>
              <div><dt className="mono muted">ROSTER</dt><dd>Captain + {info?.min_players ?? 4} or more</dd></div>
              <div><dt className="mono muted">UNSOLD</dt><dd>Round 2 at half price</dd></div>
            </dl>
          </aside>
        </section>

        <Ticker text={`${name} · auction ${info?.event_date || 'date TBA'} · tournament dates TBA · ₹${info?.fee ?? 300} entry, paid later · `} />

        <section className="wrap" data-section>
          <h2 className="display" data-decode>How it works</h2>
          <div className="how">
            <AuctionDemo />
            <ol className="how-steps">
              <li><strong>Sign up</strong><span>Fill your profile, pick captain or player. The ₹{info?.fee ?? 300} entry is collected later to confirm your spot.</span></li>
              <li><strong>Get drafted</strong><span>{info?.teams ?? 10} captains call out bids on players in the room with {info?.credits_per_team ?? 1000} credits each. Every bid resets the clock.</span></li>
              <li><strong>Play</strong><span>Teams of 5 plus subs play it out. Rosters are public the moment the auction ends.</span></li>
            </ol>
          </div>
        </section>

        <section className="wrap split three" data-section>
          <article className="card panel" data-build>
            <p className="mono amber">PATH A · {info?.leader_slots_left ?? 10} OF {info?.teams ?? 10} SLOTS LEFT</p>
            <h2 className="display">Captain</h2>
            <p>Create your team: name, tag and logo. You're on your own team for free and never auctioned. You build the rest of the roster with credits.</p>
          </article>
          <article className="card panel" data-build>
            <p className="mono amber">PATH B</p>
            <h2 className="display">Auction player</h2>
            <p>Show your rank, role and playstyle on your card. Captains bid for you live. Base price depends on your rank.</p>
          </article>
          <article className="card panel" data-build>
            <p className="mono amber">PATH C · FREE</p>
            <h2 className="display">Sub pool</h2>
            <p>Not auctioned, no fee. You're called in when a team is a player short. If that team wins the tournament, you get the missing teammate's share of the prize for the matches you played.</p>
          </article>
        </section>

        <section className="wrap" data-section>
          <h2 className="display" data-decode>Format and rules</h2>
          <div className="grid3">
            <article className="card" data-build><h3>Credits</h3><p>Every team gets {info?.credits_per_team ?? 1000}. Unspent credits are lost.</p></article>
            <article className="card" data-build><h3>Rosters</h3><p>Captain plus at least {info?.min_players ?? 4} bought players. A captain can never bid what would leave them short.</p></article>
            <article className="card" data-build><h3>Base prices</h3><p className="small">{info ? Object.entries(info.band_base_price).sort((a, b) => a[1] - b[1]).map(([k, v]) => `${k} ${v}`).join(' · ') : '…'}</p></article>
          </div>
        </section>

        <section className="wrap" data-section>
          <h2 className="display" data-decode>Schedule</h2>
          <Schedule date={info?.event_date} teams={info?.teams} />
        </section>

        {teams.length > 0 && (
          <section className="wrap" data-section data-pin>
            <h2 className="display" data-decode>Teams</h2>
            <div className="grid4">{teams.map(t => <TeamCard key={t.id} t={t} />)}</div>
          </section>
        )}

        {pool.length > 0 && (
          <section className="wrap" data-section>
            <h2 className="display" data-decode>Player pool</h2>
            <ol className="seats">
              {pool.slice(0, 12).map((p, i) => (
                <li key={p.id} data-build>
                  <span className="mono amber">{String(i + 1).padStart(2, '0')}</span>
                  <span>{p.display_name}</span><span className="muted">{p.current_rank}</span>
                  <span className="muted">{p.role}</span><span className="tag">In pool</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="wrap" data-section>
          <h2 className="display" data-decode>Prize pool</h2>
          <p className="events-note muted">The entire prize pool is made up of entry fees. The split will be published here before the tournament starts.{!teams.length && ' Teams and the player pool show up on this page once organisers approve sign-ups.'}</p>
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
