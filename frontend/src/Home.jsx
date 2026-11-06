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

export default function Home() {
  const [info, setInfo] = useState(null)
  useEffect(() => { api('/public').then(setInfo).catch(() => {}) }, [])
  const open = info?.registration_open
  const name = info?.name || 'ZenithXBeans Valorant Draft'

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
          <p className="lede featured-lede">Community tournaments with verified entries, fair formats and a public ledger. First up: a live player auction.</p>
          <article className="card featured" data-build>
            <div>
              <p className="tags"><span className="tag">{open === false ? 'SIGN-UPS CLOSED' : 'SIGN-UPS OPEN'}</span><span className="tag ghost">VALORANT</span></p>
              <h2 className="display">{name}</h2>
              <p>Eight leaders build their teams in a live auction with a fixed credit budget. Everyone who pays and is approved gets a team.</p>
              <SlotMeter info={info} />
              <div className="actions">
                <a className="btn" href="/draft">See the format</a>
                {open !== false && <a className="btn ghost" href="/signup">Sign up · ₹{info?.fee ?? 300}</a>}
              </div>
            </div>
            <dl className="facts">
              <div><dt className="mono muted">FORMAT</dt><dd>Player auction</dd></div>
              <div><dt className="mono muted">TEAMS</dt><dd>{info?.teams ?? 8} teams · 5 + subs</dd></div>
              <div><dt className="mono muted">ENTRY</dt><dd>₹{info?.fee ?? 300}</dd></div>
              <div><dt className="mono muted">DATE</dt><dd>{info?.event_date || 'TBA'}</dd></div>
            </dl>
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

        <section className="wrap" data-section>
          <h2 className="display" data-decode>Run in the open</h2>
          <div className="grid4">
            {[['Verified entries', 'Every UTR is checked against the statement. Duplicate UTRs are refused automatically.'],
              ['Public ledger', 'Where the money came from and where it went, exported and shared after each event.'],
              ['Audit log', 'Every payment decision, bid, sale and undo is recorded with its exact order.'],
              ['Fair formats', 'Rules are enforced by the software, not by whoever shouts loudest.']]
              .map(([h, p]) => <article className="card" data-build key={h}><h3>{h}</h3><p className="muted">{p}</p></article>)}
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
            <li data-build>
              <div className="event soon">
                <span className="event-when"><b className="digits">?</b><span className="mono">SOON</span></span>
                <span className="event-main">
                  <span className="event-title display">Next tournament</span>
                  <span className="event-meta mono muted">ANNOUNCED ON THE ZENITHXBEANS DISCORD FIRST</span>
                </span>
              </div>
            </li>
          </ol>
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
