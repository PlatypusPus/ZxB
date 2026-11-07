import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PlayerCard } from './Cards.jsx'
import { blocks } from './fx/blocks.js'
import { decode } from './fx/decode.js'
import { useAuction, useCountdown } from './live.js'

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

// Bids are called out loud in the room, so the screen only shows the player up and the clock.
export default function Projector() {
  const { snap, event } = useAuction()
  const cardRef = useRef()
  const { shown } = useLotStage(snap, event, () => null, cardRef)
  const left = useCountdown(shown)   // the lot on screen, which outlives the live lot during its exit
  if (!snap) return <main className="proj"><p className="mono muted proj-wait">CONNECTING…</p></main>
  const st = snap.status
  const started = ['auction_live', 'auction_paused', 'completed'].includes(st)

  return (
    <main className="proj proj-solo">
      {shown && st !== 'completed' ? <>
        <div ref={cardRef}><PlayerCard p={shown.player} big /></div>
        <TimerTiles left={left} total={snap.settings.bid_timer || 20} />
        {st === 'auction_paused' && <p className="tag">PAUSED</p>}
      </> : (
        <div className="proj-empty">
          <h1 className="display">{st === 'completed' ? 'Auction complete' : started ? 'Next player coming up' : 'The auction starts soon'}</h1>
          {!started && snap.settings.event_date && <p className="proj-date digits">{snap.settings.event_date}</p>}
        </div>
      )}
    </main>
  )
}
