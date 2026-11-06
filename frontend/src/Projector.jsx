import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PlayerCard } from './Cards.jsx'
import { blocks } from './fx/blocks.js'
import { decode } from './fx/decode.js'
import { useAuction, useCountdown } from './live.js'

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 'S'}`
const sleep = ms => new Promise(r => setTimeout(r, ms))

// Timer as a row of tiles that go dark as time runs out; the last 5 seconds blink red.
export function TimerTiles({ left, total, n = 20 }) {
  if (left == null) return <div className="timer off mono">NO TIMER · AUCTIONEER CLOSES</div>
  const lit = Math.ceil((Math.min(left, total) / total) * n)
  return (
    <div className={'timer' + (left <= 5 ? ' hot' : '')} role="timer" aria-label={`${Math.ceil(left)} seconds left`}>
      <div className="timer-tiles">{Array.from({ length: n }, (_, i) => <span key={i} className={i < lit ? 'on' : ''} />)}</div>
      <span className="digits">{String(Math.ceil(left)).padStart(2, '0')}</span>
    </div>
  )
}

export function Stamp({ stamp }) {
  const ref = useRef()
  useEffect(() => { decode(ref.current?.querySelector('strong'), 500) }, [stamp])
  if (!stamp) return null
  const sold = stamp.kind === 'sold' || stamp.kind === 'mine'
  return (
    <div className={'stamp ' + stamp.kind} ref={ref} role="status">
      <strong>{stamp.kind === 'mine' ? 'YOURS' : sold ? 'SOLD' : 'UNSOLD'}</strong>
      {sold && <span className="mono">{stamp.team?.tag ? `TO ${stamp.team.tag} · ` : ''}{stamp.price} CR</span>}
      {!sold && <span className="mono">BACK TO THE POOL</span>}
    </div>
  )
}

// Keeps the closing lot on screen while its exit plays: stamp, then the block break.
// `target(teamId)` returns the element sold tiles should fly into.
export function useLotStage(snap, event, target, cardRef, mineId) {
  const [shown, setShown] = useState(null)
  const [stamp, setStamp] = useState(null)
  const [gain, setGain] = useState(null)
  const busy = useRef(false), latest = useRef(snap)
  latest.current = snap

  useEffect(() => {
    if (!snap) return
    if (event?.event === 'lot.closed' && shown && shown.id === event.lot_id && !busy.current) {
      busy.current = true
      const lc = snap.last_closed
      const team = snap.teams.find(t => t.id === lc.team_id)
      ;(async () => {
        setStamp({ kind: lc.result !== 'sold' ? 'unsold' : lc.team_id === mineId ? 'mine' : 'sold', team, price: lc.price })
        await sleep(1300)
        const to = lc.result === 'sold' && target(lc.team_id)
        setStamp(null)
        await blocks(cardRef.current, to ? { mode: 'stream', to } : { mode: 'sink' })
        if (to) { setGain(lc.team_id); setTimeout(() => setGain(null), 900) }
        busy.current = false
        setShown(latest.current.lot)
      })()
      return
    }
    if (!busy.current) setShown(snap.lot)
  }, [snap, event])

  // A new lot: hide the card, let tiles rise out of the grid into its shape, then show it.
  const shownId = shown?.id
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!shownId || !el) return
    el.style.visibility = 'hidden'
    blocks(el, { mode: 'assemble' }).then(() => { el.style.visibility = 'visible' })
  }, [shownId])

  return { shown, stamp, gain }
}

export default function Projector() {
  const { snap, event, online } = useAuction()
  const cardRef = useRef(), slots = useRef({})
  const { shown, stamp, gain } = useLotStage(snap, event, id => slots.current[id], cardRef)
  const left = useCountdown(shown)   // the lot on screen, which outlives the live lot during its exit
  if (!snap) return <main className="proj"><p className="mono muted proj-wait">CONNECTING…</p></main>

  const lot = shown
  const top = lot?.highest
  const leader = top && snap.teams.find(t => t.id === top.team_id)
  const st = snap.status
  const started = ['auction_live', 'auction_paused', 'completed'].includes(st)

  return (
    <main className="proj">
      <header className="proj-head">
        <span className="brand mono">ZENITHXBEANS</span>
        <span className="mono">{snap.name.toUpperCase()}</span>
        <span className="mono">
          {started && st !== 'completed' && <>ROUND {snap.round === 2 ? '2 · DISCOUNT' : snap.round} · {snap.pool.placed}/{snap.pool.total} PLACED · </>}
          <span className={'live-dot ' + (st === 'auction_live' && online ? 'on' : '')} />
          {!online ? 'RECONNECTING' : st === 'auction_live' ? 'LIVE' : st === 'auction_paused' ? 'PAUSED' : st === 'completed' ? 'FINAL' : 'SOON'}
        </span>
      </header>

      {st === 'completed' ? <FinalRosters snap={snap} /> : (
        <section className="proj-stage">
          <div className="proj-card">
            {lot ? <div ref={cardRef}><PlayerCard p={lot.player} big /></div>
              : <div className="proj-empty"><h1 className="display">{started ? 'Next player coming up' : 'The auction starts soon'}</h1>
                  {!started && snap.settings.event_date && <p className="proj-date digits">{snap.settings.event_date}</p>}
                  <p className="mono muted">{plural(snap.pool.total, 'PLAYER')} · {plural(snap.teams.length, 'TEAM')} · {snap.settings.credits_per_team} CREDITS EACH</p></div>}
            <Stamp stamp={stamp} />
          </div>
          {lot && (
            <div className="proj-bid">
              <p className="mono muted">{top ? 'CURRENT BID' : 'OPENING BID'}</p>
              <p className="price digits" key={top?.amount ?? 'base'}>{top?.amount ?? lot.base_price}</p>
              <div className="lead">
                {leader ? <><img src={leader.logo_url} alt="" /><span className="display">{leader.name}</span></>
                  : <span className="muted">No bids yet · next bid {lot.next_amount}</span>}
              </div>
              <TimerTiles left={left} total={snap.settings.bid_timer || 20} />
              {st === 'auction_paused' && <p className="tag">PAUSED</p>}
            </div>
          )}
        </section>
      )}

      <section className="proj-teams" aria-label="Teams">
        {snap.teams.map(t => (
          <div key={t.id} ref={el => (slots.current[t.id] = el)}
            className={'slot' + (top?.team_id === t.id ? ' leading' : '') + (gain === t.id ? ' gain' : '')}>
            <img src={t.logo_url} alt="" />
            <div>
              <p className="mono">{t.tag}</p>
              <p className="digits">{t.credits_left}</p>
              <p className="pips" aria-label={`${t.bought} of ${snap.settings.max_players} players`}>
                {Array.from({ length: snap.settings.max_players || 7 }, (_, i) => <span key={i} className={i < t.bought ? 'on' : ''} />)}
              </p>
            </div>
          </div>
        ))}
      </section>

      <footer className="proj-foot mono">
        <span>{snap.recent.length ? snap.recent.map(r => `${r.player} → ${r.team} ${r.price}`).join('   ·   ') : 'NO SALES YET'}</span>
        <span className="muted">HOSTED BY ZENITHXBEANS</span>
      </footer>
    </main>
  )
}

function FinalRosters({ snap }) {
  return (
    <section className="proj-final">
      {snap.teams.map(t => (
        <article className="card" key={t.id}>
          <header><img src={t.logo_url} alt="" /><div><h3>{t.name}</h3><p className="mono amber">[{t.tag}] · {t.credits_left} CR LEFT</p></div></header>
          <ol>
            <li><span>{t.leader}</span><span className="mono muted">LEADER</span></li>
            {t.roster.map(p => <li key={p.id}><span>{p.display_name}</span><span className="mono">{p.price}</span></li>)}
          </ol>
        </article>
      ))}
    </section>
  )
}
