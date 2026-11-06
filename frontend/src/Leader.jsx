import { useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { PlayerCard } from './Cards.jsx'
import { useAuction, useCountdown, usePrevious } from './live.js'
import { Stamp, TimerTiles, useLotStage } from './Projector.jsx'

export default function Leader({ code }) {
  const [me, setMe] = useState(null)
  const [err, setErr] = useState('')
  const { snap, event, online } = useAuction()
  useEffect(() => { api('/leader/me', { leader: code }).then(setMe).catch(e => setErr(e.message)) }, [code])

  if (err) return <main className="wrap narrow"><h1 className="display">Leader link</h1><p className="err">{err}</p>
    <p>Check you opened the exact link the organisers sent you. If it still fails, message them on WhatsApp or Discord for a new one.</p>
    <p><a className="btn ghost" href="/projector">Watch the auction instead</a></p></main>
  if (!me || !snap) return <main className="wrap narrow"><p className="mono muted">CONNECTING…</p></main>
  const started = ['auction_live', 'auction_paused', 'completed'].includes(snap.status)
  return started ? <LeaderLive me={me} snap={snap} event={event} online={online} code={code} />
    : <TeamEditor me={me} setMe={setMe} code={code} snap={snap} />
}

function LeaderLive({ me, snap, event, online, code }) {
  const cardRef = useRef(), rosterRef = useRef()
  const { shown, stamp, gain } = useLotStage(snap, event, id => (id === me.team_id ? rosterRef.current : null), cardRef, me.team_id)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const team = snap.teams.find(t => t.id === me.team_id)
  const lot = snap.lot
  const left = useCountdown(lot)
  const leading = lot?.highest?.team_id === me.team_id
  const wasLeading = usePrevious(leading && lot?.id)
  useEffect(() => {   // buzz when someone outbids you
    if (wasLeading && lot && wasLeading === lot.id && !leading) navigator.vibrate?.(120)
  }, [leading])

  const reason = !online ? 'Reconnecting…' : snap.status === 'completed' ? 'The auction is over'
    : !lot ? 'Waiting for the next player' : snap.status === 'auction_paused' ? 'Paused by the auctioneer'
    : left === 0 ? 'Time is up' : team.blocked
  const bid = async () => {
    setBusy(true); setMsg('')
    try { await api('/leader/bid', { method: 'POST', body: { lot_id: lot.id, amount: lot.next_amount }, leader: code }); navigator.vibrate?.(30) }
    catch (e) { setMsg(e.message) }
    finally { setBusy(false) }
  }

  return (
    <main className="leader">
      <header className="leader-head">
        <img src={team.logo_url} alt="" />
        <div><h1 className="display">{team.name}</h1><p className="mono amber">[{team.tag}] · {online ? 'CONNECTED' : 'RECONNECTING'}</p></div>
      </header>
      <div className="leader-stats">
        <div><span className="digits">{team.credits_left}</span><span className="muted">credits left</span></div>
        <div><span className="digits">{lot ? Math.max(0, team.max_bid) : '—'}</span><span className="muted">your max bid</span></div>
        <div><span className="digits">{team.bought}/{snap.settings.max_players}</span><span className="muted">players</span></div>
      </div>

      <section className="leader-lot">
        {shown ? <div ref={cardRef}><PlayerCard p={shown.player} /></div>
          : <p className="card muted">{snap.status === 'completed' ? 'Rosters are final.' : 'Next player coming up…'}</p>}
        <Stamp stamp={stamp} />
        {lot && <>
          <p className="leader-price"><span className="mono muted">{lot.highest ? (leading ? 'YOU LEAD AT' : 'CURRENT BID') : 'OPENS AT'}</span>
            <span className="digits" key={lot.highest?.amount}>{lot.highest?.amount ?? lot.base_price}</span>
            {lot.highest && !leading && <span className="mono">{snap.teams.find(t => t.id === lot.highest.team_id)?.tag}</span>}
          </p>
          <TimerTiles left={left} total={snap.settings.bid_timer || 20} n={14} />
        </>}
      </section>

      {msg && <p className="err" role="alert">{msg}</p>}
      <button className={'bid-btn' + (leading ? ' leading' : '')} disabled={!!reason || busy} onClick={bid}>
        {reason || (busy ? `Sending ${lot.next_amount}…` : <>BID <span className="digits">{lot.next_amount}</span></>)}
      </button>

      <section className={'card roster' + (gain === me.team_id ? ' gain' : '')} ref={rosterRef}>
        <h2 className="mono amber">YOUR ROSTER</h2>
        <ol>
          {team.roster.map(p => <li key={p.id}><span>{p.display_name}</span><span className="muted">{p.role}</span><span className="mono">{p.price}</span></li>)}
          {!team.roster.length && <li className="muted">No players yet. You need at least {snap.settings.min_players}.</li>}
        </ol>
      </section>
    </main>
  )
}

function TeamEditor({ me, setMe, code, snap }) {
  const [name, setName] = useState(me.name), [tag, setTag] = useState(me.tag), [logo, setLogo] = useState(null)
  const [errors, setErrors] = useState({}), [msg, setMsg] = useState('')
  const save = async e => {
    e.preventDefault()
    const form = new FormData()
    form.append('name', name); form.append('tag', tag)
    if (logo) form.append('logo', logo)
    try { const r = await api('/leader/team', { method: 'PATCH', form, leader: code }); setMe({ ...me, ...r }); setMsg('Saved. An organiser will approve the changes.') }
    catch (err) { setErrors(err.errors); setMsg(err.message) }
  }
  return (
    <main className="wrap narrow leader">
      <header className="leader-head">
        <img src={me.logo_url} alt="" />
        <div><h1 className="display">{me.name}</h1><p className="mono amber">[{me.tag}] · PROFILE {me.profile_status.toUpperCase()}</p></div>
      </header>
      <p>The auction hasn't started. {snap.pool.total} players are in the pool. Keep this page: it's your bidding screen on the day.</p>
      {me.editable && (
        <form onSubmit={save} className="card">
          <h2 className="mono amber">EDIT YOUR TEAM</h2>
          <div className="field"><label htmlFor="tn">Team name</label><input id="tn" value={name} maxLength={24} onChange={e => setName(e.target.value)} />{errors.name && <p className="err">{errors.name}</p>}</div>
          <div className="field"><label htmlFor="tt">Tag</label><input id="tt" value={tag} maxLength={4} onChange={e => setTag(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />{errors.tag && <p className="err">{errors.tag}</p>}</div>
          <div className="field"><label htmlFor="tl">New logo (optional)</label><input id="tl" type="file" accept="image/png,image/jpeg,image/webp" onChange={e => setLogo(e.target.files[0])} />{errors.logo && <p className="err">{errors.logo}</p>}</div>
          {msg && <p role="status">{msg}</p>}
          <button className="btn">Save</button>
        </form>
      )}
    </main>
  )
}
