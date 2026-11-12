import { useEffect, useState } from 'react'
import { api } from './api.js'
import { Footer, Nav, Schedule, SlotMeter, Ticker, parseDay } from './Layout.jsx'

const FAQ = [
  ['What is ZenithXBeans?', 'A community that runs Valorant tournaments for players, by players.'],
  ['How does the bidding work?', 'Captains call their bids out loud in the room and an organiser records each one. The screen shows only the player up and the timer. Every bid resets the timer, and when it runs out the player goes to the highest bid.'],
  ['How are captains chosen?', 'Anyone can sign up as a captain. The organisers review every captain sign-up and accept one per team slot. Captains who aren’t picked move into the auction player pool.'],
  ['Who can enter?', 'Anyone who plays the game. Each tournament page lists its entry fee, format and rules.'],
  ['When do I pay?', 'Not at sign-up. The entry fee is collected later to confirm your spot, and the whole prize pool is made up of entry fees.'],
  ['How do I hear about the next tournament?', 'New events are announced first on Instagram (@shankssays, @whoshanks, @ttvpeachysmolbean), Twitch (peachysmolbean) and YouTube (@ShanksSays, @peachysmolbeanlive), then listed here.'],
]

// "15 Nov 2026" -> a big day number over the month. Anything else shows TBA.
function EventDate({ date }) {
  const [d, m] = (date || '').split(' ')
  const ok = /^\d{1,2}$/.test(d || '')
  return <span className="event-when"><b className="digits">{ok ? d : 'TBA'}</b><span className="mono">{ok ? m?.toUpperCase() : 'DATE'}</span></span>
}

// Whole days from today until the auction; null if the date can't be read.
function daysUntil(date) {
  const a = parseDay(date)
  if (!a) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.round((a.date - today) / 864e5)
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
  const days = daysUntil(info?.event_date), auction = parseDay(info?.event_date)

  return (
    <>
      <Nav info={info} />
      <main>
        <section className="hero hero-brand wrap">
          <h1 className="hero-logo">
            <img className="zen" src="/zen.webp" width="1200" height="405" alt="Zenith" fetchpriority="high" />
            <span className="x" aria-label="x">×</span>
            <img className="beans" src="/beans.webp" width="982" height="558" alt="Beans" fetchpriority="high" />
          </h1>
          <div className="hero-deck">
            <div className="hero-pitch">
              <h2 className="display">Valorant <span className="pink">Auction</span></h2>
              <p>{info?.teams ?? 10} captains, {info?.credits_per_team ?? 1000} credits each. Every player goes under the hammer live{auction ? `, on ${auction.weekday} ${auction.day} ${auction.mon[0] + auction.mon.slice(1).toLowerCase()}` : ''}, then the teams fight it out. Tournament dates TBA.</p>
              {open !== false && <div className="actions">
                <a className="btn" href="/signup?path=leader">Be a captain</a>
                <a className="btn ghost" href="/signup?path=auction">Get auctioned</a>
                <a className="btn ghost" href="/signup?path=sub">Sub pool · Free</a>
              </div>}
            </div>
            <aside className="hero-count" aria-label="Key dates">
              {days != null && days >= 0 && <p className="hero-days">
                <b className="digits">{String(days).padStart(2, '0')}</b>
                <span className="mono">{days === 0 ? 'AUCTION IS TODAY' : `${days === 1 ? 'DAY' : 'DAYS'} TO THE AUCTION`}</span>
              </p>}
              <ol className="hero-dates">
                <li><b className="digits">{auction?.day || 'TBA'}</b><span className="mono muted">{auction ? `${auction.mon} · ${auction.weekday.slice(0, 3).toUpperCase()}` : 'DATE'}</span><span>Auction</span></li>
                <li><b className="digits">TBA</b><span className="mono muted">DATES</span><span>Group stage</span></li>
                <li><b className="digits">TBA</b><span className="mono muted">DATES</span><span>Grand final</span></li>
              </ol>
              <p className="mono"><span className="amber">{info?.leader_slots_left ?? '–'}</span> OF {info?.teams ?? 10} CAPTAIN SLOTS OPEN</p>
            </aside>
          </div>
        </section>

        <Ticker text={`ZenithXBeans · community tournaments · ${name} · ${open === false ? 'sign-ups closed' : 'sign-ups open'} · `} />

        <section className="wrap" id="featured" data-section>
          <h2 className="display" data-decode>Featured tournament</h2>
          <article className="card auction-card" data-build>
            <header className="auction-head">
              <p className="tags"><span className={'tag' + (open === false ? ' ghost' : '')}>{open === false ? 'SIGN-UPS CLOSED' : 'SIGN-UPS OPEN'}</span><span className="tag ghost">VALORANT</span><span className="tag ghost">AUCTION {info?.event_date || 'DATE TBA'}</span><span className="tag ghost">TOURNAMENT DATES TBA</span></p>
              <h3 className="display">{name}</h3>
              <p className="auction-sub">Captains build their rosters by buying players in a live auction. Everyone who signs up and is approved gets a team.</p>
            </header>

            <div className="auction-paths">
              <section className="path">
                <h4 className="display">Captains</h4>
                <p>Name your team, pick a tag and logo. You get <strong className="amber">{info?.credits_per_team ?? 1000} credits</strong> to buy at least {info?.min_players ?? 4} players. You're never auctioned.</p>
                <ul className="path-list">
                  <li><span>Budget</span><b className="digits">{info?.credits_per_team ?? 1000}</b></li>
                  <li><span>Players to buy</span><b className="digits">{info?.min_players ?? 4}+</b></li>
                  <li><span>Bidding</span><b>Called out in the room</b></li>
                  <li><span>Unspent credits</span><b>Lost at the end</b></li>
                </ul>
                <SlotMeter info={info} />
                {open !== false && <a className="btn" href="/signup?path=leader">Sign up as a captain</a>}
              </section>
              <section className="path">
                <h4 className="display">Players</h4>
                <p>Make your player card and go under the hammer. Your <strong className="amber">starting price depends on your rank group</strong>, and captains bid up from there.</p>
                <RankLadder bands={info?.band_base_price} />
                {open !== false && <a className="btn" href="/signup?path=auction">Sign up as a player</a>}
              </section>
              <section className="path sub">
                <div>
                  <h4 className="display">Sub pool <span className="tag">FREE</span></h4>
                  <p>Not auctioned, no entry fee. When a team is a player short, organisers call a sub in from this pool. If that team wins the tournament, you get the missing teammate's share of the prize for the matches you played.</p>
                </div>
                {open !== false && <a className="btn ghost" href="/signup?path=sub">Join the sub pool</a>}
              </section>
            </div>

            <dl className="auction-facts">
              <div><dt className="mono muted">ENTRY</dt><dd>₹{info?.fee ?? 300}</dd></div>
              <div><dt className="mono muted">TEAMS</dt><dd>{info?.teams ?? 10}</dd></div>
              <div><dt className="mono muted">AUCTION</dt><dd>{auction ? `${auction.weekday.slice(0, 3)} ${auction.day} ${auction.mon}` : 'TBA'}</dd></div>
              <div><dt className="mono muted">TOURNAMENT</dt><dd>TBA</dd></div>
            </dl>
            <div className="actions"><a className="btn ghost" href="/draft">Full format and rules</a><a className="btn ghost" href="/refund-policy">Refund policy</a></div>
          </article>
        </section>

        <section className="wrap" id="schedule" data-section>
          <h2 className="display" data-decode>Schedule</h2>
          <Schedule date={info?.event_date} teams={info?.teams} />
        </section>

        <section className="wrap" data-section>
          <h2 className="display" data-decode>How it works</h2>
          <div className="grid3">
            {[['01', 'Sign up', 'Pick a tournament and fill your player card. The entry fee is collected later to confirm your spot.'],
              ['02', 'Get verified', 'Organisers check your rank on tracker.gg and confirm your spot once the fee is paid.'],
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
                  <span className="event-meta mono muted">VALORANT · AUCTION DAY · {info?.teams ?? 10} TEAMS · ₹{info?.fee ?? 300} ENTRY</span>
                </span>
                <span className="event-status">
                  <span className={'tag' + (open === false ? ' ghost' : '')}>{open === false ? 'SIGN-UPS CLOSED' : 'SIGN-UPS OPEN'}</span>
                  {open !== false && info && <span className="mono muted">{info.leader_slots_left} OF {info.teams} CAPTAIN SLOTS LEFT</span>}
                </span>
                <svg className="event-go" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" /></svg>
              </a>
            </li>
          </ol>
          <p className="events-note muted">More tournaments are announced on Instagram first, then listed here.</p>
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
