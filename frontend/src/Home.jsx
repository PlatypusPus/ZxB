import { useEffect, useState } from 'react'
import { api } from './api.js'
import { Footer, Nav, SlotMeter, Ticker } from './Layout.jsx'

const FAQ = [
  ['What is ZenithXBeans?', 'A community that runs tournaments for players, by players. Every event is community-funded and every rupee is accounted for in a public ledger.'],
  ['Who can enter?', 'Anyone who plays the game. Each tournament page lists its entry fee, format and rules.'],
  ['How are payments checked?', 'An organiser matches your UPI transaction ID (UTR) against the bank statement. Nobody is approved before that check.'],
  ['How do I hear about the next tournament?', 'New events are announced on the ZenithXBeans Discord first, then listed here.'],
]

// "22 Nov 2026" -> a big day number over the month. Anything else shows TBA.
function EventDate({ date }) {
  const [d, m] = (date || '').split(' ')
  const ok = /^\d{1,2}$/.test(d || '')
  return <span className="event-when"><b className="digits">{ok ? d : 'TBA'}</b><span className="mono">{ok ? m?.toUpperCase() : 'DATE'}</span></span>
}

// Rank groups and their starting credits, highest first. The organiser sets the numbers in Admin -> Settings.
function RankLadder({ bands }) {
  const rows = Object.entries(bands || {}).sort((a, b) => b[1] - a[1])
  const top = rows[0]?.[1] || 1
  return (
    <ol className="ladder" aria-label="Starting price by rank group">
      {rows.map(([rank, cr]) => (
        <li key={rank}>
          <span className="ladder-rank">{rank}</span>
          <span className="ladder-bar" aria-hidden="true"><span style={{ width: `${(cr / top) * 100}%` }} /></span>
          <span className="ladder-cr digits">{cr}</span>
        </li>
      ))}
    </ol>
  )
}

export default function Home() {
  const [info, setInfo] = useState(null)
  useEffect(() => { api('/public').then(setInfo).catch(() => {}) }, [])
  const open = info?.registration_open
  const name = info?.name || 'ZenithXBeans Valorant Auction'

  return (
    <>
      <Nav info={info} />
      <main>
        <section className="hero hero-brand wrap">
          <h1 className="wordmark display" aria-label="ZenithXBeans">
            {[...'ZENITHXBEANS'].map((c, i) => (
              <span key={i} className={'ch' + (i === 6 ? ' x' : i > 6 ? ' beans' : '')} aria-hidden="true" style={{ '--i': i }}><span>{c}</span></span>
            ))}
          </h1>
        </section>

        <Ticker text={`ZenithXBeans · community tournaments · ${name} · ${open === false ? 'sign-ups closed' : 'sign-ups open'} · `} />

        <section className="wrap" id="featured" data-section>
          <h2 className="display" data-decode>Featured tournament</h2>
          <article className="card auction-card" data-build>
            <header className="auction-head">
              <p className="tags"><span className={'tag' + (open === false ? ' ghost' : '')}>{open === false ? 'SIGN-UPS CLOSED' : 'SIGN-UPS OPEN'}</span><span className="tag ghost">VALORANT</span><span className="tag ghost">{info?.event_date || 'DATE TBA'}</span></p>
              <h3 className="display">{name}</h3>
              <p className="auction-sub">Team leaders build their rosters by buying players in a live auction. Everyone who signs up and is approved gets a team.</p>
            </header>

            <div className="auction-paths">
              <section className="path">
                <h4 className="display">Team leaders</h4>
                <p>Name your team, pick a tag and logo. You get <strong className="amber">{info?.credits_per_team ?? 1000} credits</strong> to buy at least {info?.min_players ?? 4} players. You're never auctioned.</p>
                <ul className="path-list">
                  <li><span>Budget</span><b className="digits">{info?.credits_per_team ?? 1000}</b></li>
                  <li><span>Players to buy</span><b className="digits">{info?.min_players ?? 4}+</b></li>
                  <li><span>Bid from</span><b>Your phone, live</b></li>
                  <li><span>Unspent credits</span><b>Lost at the end</b></li>
                </ul>
                <SlotMeter info={info} />
                {open !== false && <a className="btn" href="/signup?path=leader">Sign up as a leader</a>}
              </section>
              <section className="path">
                <h4 className="display">Players</h4>
                <p>Make your player card and go under the hammer. Your <strong className="amber">starting price depends on your rank group</strong>, and leaders bid up from there.</p>
                <RankLadder bands={info?.band_base_price} />
                {open !== false && <a className="btn" href="/signup?path=auction">Sign up as a player</a>}
              </section>
            </div>

            <dl className="auction-facts">
              <div><dt className="mono muted">ENTRY</dt><dd>₹{info?.fee ?? 300}</dd></div>
              <div><dt className="mono muted">TEAMS</dt><dd>{info?.teams ?? 8}</dd></div>
              <div><dt className="mono muted">CREDITS EACH</dt><dd>{info?.credits_per_team ?? 1000}</dd></div>
              <div><dt className="mono muted">UNSOLD</dt><dd>Round 2, half price</dd></div>
            </dl>
            <a className="auction-more" href="/draft">Full format and rules →</a>
          </article>
        </section>

        <section className="wrap" data-section>
          <h2 className="display" data-decode>How it works</h2>
          <div className="grid3">
            {[['01', 'Sign up', 'Pick a tournament, fill your player card and pay the entry by UPI.'],
              ['02', 'Get verified', 'Organisers check your payment against the bank statement and your rank on tracker.gg.'],
              ['03', 'Play', 'Get your team, play the bracket, and see the results posted publicly.']]
              .map(([n, h, p]) => <article className="card" data-build key={n}><p className="mono amber">{n}</p><h3>{h}</h3><p>{p}</p></article>)}
          </div>
        </section>

        <section className="wrap" id="tournaments" data-section>
          <h2 className="display" data-decode>Tournaments</h2>
          <ol className="events">
            <li data-build>
              <a className="event" href="/draft" aria-label={`${name}, ${open === false ? 'sign-ups closed' : 'sign-ups open'}`}>
                <EventDate date={info?.event_date} />
                <span className="event-main">
                  <span className="event-title display">{name}</span>
                  <span className="event-meta mono muted">VALORANT · PLAYER AUCTION · {info?.teams ?? 8} TEAMS · ₹{info?.fee ?? 300} ENTRY</span>
                </span>
                <span className="event-status">
                  <span className={'tag' + (open === false ? ' ghost' : '')}>{open === false ? 'SIGN-UPS CLOSED' : 'SIGN-UPS OPEN'}</span>
                  {open !== false && info && <span className="mono muted">{info.leader_slots_left} OF {info.teams} LEADER SLOTS LEFT</span>}
                </span>
                <svg className="event-go" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" /></svg>
              </a>
            </li>
          </ol>
          <p className="events-note muted">More tournaments are announced on the ZenithXBeans Discord first, then listed here.</p>
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
