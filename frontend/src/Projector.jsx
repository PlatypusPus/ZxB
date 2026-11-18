import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PlayerCard } from './Cards.jsx'
import { useAuction, useCountdown } from './live.js'
import { gsap } from 'gsap'

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
  if (!stamp) return null
  const sold = stamp.kind === 'sold' || stamp.kind === 'mine'
  return (
    <div className={'stamp ' + stamp.kind} role="status">
      <strong>{stamp.kind === 'mine' ? 'YOURS' : sold ? 'SOLD' : 'UNSOLD'}</strong>
      {sold && <span className="mono">{stamp.team?.tag ? `TO ${stamp.team.tag} · ` : ''}{stamp.price} CR</span>}
      {!sold && <span className="mono">BACK TO THE POOL</span>}
    </div>
  )
}

// ---------- The projector: one player and a clock, with a staged reveal and a staged result.
// Per lot: a rank slate wipes across, the card slides up, then the details land.
// Live: each recorded bid pulses the card. Close: SOLD slams in with a screen kick and the card flies into the
// "sold to" banner; or the card greys out under UNSOLD and drops away.
const BAND = { Iron: '#7a7a85', Bronze: '#b57a45', Silver: '#c3c8d2', Gold: '#f0bd4f', Platinum: '#41c2b8',
  Diamond: '#b484f7', Ascendant: '#34c47a', Immortal: '#e8445f', Radiant: '#fff0b8' }
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

function useStage(snap, event, cardRef, bannerRef, mainRef) {
  const [shown, setShown] = useState(null)       // the lot on screen; outlives the live lot while its exit plays
  const [verdict, setVerdict] = useState(null)   // { sold, team, price } during the exit
  const [slate, setSlate] = useState(null)
  const busy = useRef(false), latest = useRef(snap)
  latest.current = snap

  useEffect(() => {
    if (!snap) return
    if (event?.event === 'lot.closed' && shown && shown.id === event.lot_id && !busy.current) {
      busy.current = true
      const lc = snap.last_closed, sold = lc.result === 'sold'
      ;(async () => {
        setVerdict({ sold, team: snap.teams.find(t => t.id === lc.team_id), price: lc.price })
        await sleep(sold ? 2600 : 1700)
        const el = cardRef.current, to = sold && bannerRef.current
        if (el && !still()) {
          if (to) {
            const a = el.getBoundingClientRect(), b = to.getBoundingClientRect()
            await gsap.to(el, { x: b.left + b.width / 2 - (a.left + a.width / 2), y: b.top + b.height / 2 - (a.top + a.height / 2),
              scale: 0.12, opacity: 0, duration: 0.6, ease: 'power3.in' })
            gsap.fromTo(to, { scale: 1.06 }, { scale: 1, duration: 0.5, ease: 'expo.out' })
          } else await gsap.to(el, { y: 90, opacity: 0, duration: 0.5, ease: 'power2.in' })
        }
        await sleep(sold ? 900 : 200)
        setVerdict(null)
        busy.current = false
        setShown(latest.current.lot)
      })()
      return
    }
    if (!busy.current) setShown(snap.lot)
  }, [snap, event])

  // New lot: slate, then the card builds itself, then the details land.
  const shownId = shown?.id
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    gsap.set(el, { clearProps: 'transform,opacity,visibility' })
    if (!shownId || still()) return
    el.style.visibility = 'hidden'
    let off = false
    ;(async () => {
      const band = shown.player.current_rank?.split(' ')[0]
      const pool = latest.current.pool
      setSlate({ band, color: BAND[band] || '#ffb547', n: Math.min(pool.placed + 1, pool.total), total: pool.total, round: shown.round })
      await sleep(1250)
      setSlate(null)
      if (off) return
      el.style.visibility = 'visible'
      gsap.fromTo(el, { y: 70, opacity: 0, scale: 0.94 }, { y: 0, opacity: 1, scale: 1, duration: 0.6, ease: 'expo.out' })
      gsap.from(el.querySelector('h3'), { y: 30, opacity: 0, duration: 0.5, delay: 0.15, ease: 'expo.out' })
      gsap.from(el.querySelectorAll('.tags .tag, .pcard-body > p'), { y: 14, opacity: 0, duration: 0.4, stagger: 0.07, ease: 'power3.out' })
      gsap.from(mainRef.current?.querySelectorAll('.timer-tiles span') || [], { scaleY: 0, duration: 0.3, stagger: 0.02, ease: 'power2.out' })
    })()
    return () => { off = true; el.style.visibility = 'visible' }
  }, [shownId])

  return { shown, verdict, slate }
}

function Slate({ slate }) {
  const ref = useRef()
  useLayoutEffect(() => {
    const tl = gsap.timeline()
    tl.fromTo(ref.current, { scaleX: 0, transformOrigin: 'left center' }, { scaleX: 1, duration: 0.35, ease: 'power4.out' })
      .from(ref.current.children, { x: -60, opacity: 0, duration: 0.35, stagger: 0.08, ease: 'power3.out' }, '-=0.1')
      .to(ref.current, { scaleX: 0, transformOrigin: 'right center', duration: 0.35, ease: 'power4.in' }, '+=0.45')
    return () => tl.kill()
  }, [slate])
  return (
    <div className="slate" ref={ref} style={{ '--band': slate.color }} aria-hidden="true">
      <span className="slate-lot">{slate.round > 1 ? 'ROUND 2 · ' : ''}LOT {String(slate.n).padStart(2, '0')} / {slate.total}</span>
      <strong>{slate.band}</strong>
    </div>
  )
}

function Verdict({ verdict, mainRef }) {
  const ref = useRef()
  useLayoutEffect(() => {
    if (still()) return
    const tl = gsap.timeline()
    tl.fromTo(ref.current.querySelector('strong'), { scale: 2.6, rotate: -16, opacity: 0 }, { scale: 1, rotate: -6, opacity: 1, duration: 0.26, ease: 'power4.in' })
    if (verdict.sold) {
      tl.to(mainRef.current, { keyframes: { x: [-14, 11, -7, 4, 0] }, duration: 0.32, ease: 'none' })
        .fromTo(mainRef.current.querySelector('.proj-flash'), { opacity: 0.55 }, { opacity: 0, duration: 0.6 }, '<')
    }
    return () => { tl.kill(); gsap.set(mainRef.current, { x: 0 }) }
  }, [verdict])
  return <div className={'verdict' + (verdict.sold ? '' : ' unsold')} ref={ref} role="status"><strong>{verdict.sold ? 'SOLD' : 'UNSOLD'}</strong></div>
}

// A recorded bid: flash the card so the room sees it land.
function useBidPulse(shown, cardRef) {
  const amount = shown?.highest?.amount, id = shown?.id
  const prev = useRef({})
  useEffect(() => {
    const was = prev.current
    prev.current = { id, amount }
    if (!amount || was.id !== id || was.amount === amount || still() || !cardRef.current) return
    gsap.fromTo(cardRef.current, { boxShadow: '0 0 0 6px #ff3d8b, 0 0 60px 10px rgb(255 61 139 / .45)' },
      { boxShadow: '0 0 0 0px #ff3d8b, 0 0 0px 0px rgb(255 61 139 / 0)', duration: 0.8, ease: 'power2.out' })
  }, [id, amount])
}

// Bids are called out loud in the room; the screen shows the player up, the next bid amount and the clock.
export default function Projector() {
  const { snap, event } = useAuction()
  const cardRef = useRef(), bannerRef = useRef(), mainRef = useRef()
  const { shown, verdict, slate } = useStage(snap, event, cardRef, bannerRef, mainRef)
  useBidPulse(shown, cardRef)
  const left = useCountdown(shown)
  if (!snap) return <main className="proj"><p className="mono muted proj-wait">CONNECTING…</p></main>
  const st = snap.status
  const started = ['auction_live', 'auction_paused', 'completed'].includes(st)
  const band = shown?.player.current_rank?.split(' ')[0]
  const phase = verdict ? (verdict.sold ? 'sold' : 'unsold') : st === 'auction_paused' ? 'paused' : 'live'

  return (
    <main className={'proj proj-solo phase-' + phase} ref={mainRef} style={{ '--band': BAND[band] || '#ffb547' }}>
      <div className="proj-flash" aria-hidden="true" />
      {slate && <Slate slate={slate} />}
      {shown && (st !== 'completed' || verdict) ? <>
        <div className="proj-stage">
          <div ref={cardRef} className="proj-card"><PlayerCard p={shown.player} big /></div>
          {verdict && <Verdict verdict={verdict} mainRef={mainRef} />}
          {phase === 'paused' && <p className="proj-paused">PAUSED</p>}
        </div>
        {verdict?.sold
          ? <div className="sold-to" ref={bannerRef}>
              {verdict.team?.logo_url && <img src={verdict.team.logo_url} alt="" />}
              <div><span className="sold-label">SOLD TO</span><strong>{verdict.team?.name || 'a team'}</strong></div>
              <span className="digits">{verdict.price} CR</span>
            </div>
          : <>
              {!verdict && shown.next_amount != null &&
                <p className="proj-next"><span className="sold-label">NEXT BID</span><span className="digits">{shown.next_amount} CR</span></p>}
              <TimerTiles left={verdict ? 0 : left} total={snap.settings.bid_timer || 20} />
            </>}
      </> : (
        <div className="proj-empty">
          <h1 className="display">{st === 'completed' ? 'Auction complete' : started ? 'Next player coming up' : 'The auction starts soon'}</h1>
          {!started && snap.settings.event_date && <p className="proj-date digits">{snap.settings.event_date}</p>}
        </div>
      )}
    </main>
  )
}
