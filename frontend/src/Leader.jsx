import { useEffect, useState } from 'react'
import { api } from './api.js'
import { PlayerCard } from './Cards.jsx'
import { TimerTiles } from './Projector.jsx'
import { useAuction, useCountdown } from './live.js'

// A captain's private page: edit the team profile before the auction, then bid for the team from this phone.
export default function Leader({ code }) {
  const [me, setMe] = useState(null)
  const [err, setErr] = useState('')
  const [date, setDate] = useState('')
  const live = useAuction()   // flips this page to bidding the moment the organiser starts the auction
  useEffect(() => {
    api('/leader/me', { leader: code }).then(setMe).catch(e => setErr(e.message))
    api('/public').then(i => setDate(i.event_date)).catch(() => {})
  }, [code])

  if (err) return <main className="wrap narrow"><h1 className="display">Captain link</h1><p className="err">{err}</p>
    <p>Check you opened the exact link the organisers sent you. If it still fails, message them on WhatsApp or Discord for a new one.</p></main>
  if (!me) return <main className="wrap narrow"><p className="mono muted">CONNECTING…</p></main>
  const started = !me.editable || ['auction_live', 'auction_paused', 'completed'].includes(live.snap?.status)
  return started ? <BidPanel me={me} code={code} {...live} /> : <TeamEditor me={me} setMe={setMe} code={code} date={date} />
}

function BidPanel({ me, code, snap, online }) {
  const lot = snap?.lot
  const left = useCountdown(lot)
  const [custom, setCustom] = useState(''), [msg, setMsg] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { setCustom(''); setMsg('') }, [lot?.id])
  const mine = snap?.teams.find(t => t.id === me.team_id)
  const bid = async amount => {
    setBusy(true); setMsg('')
    try { await api('/leader/bid', { method: 'POST', body: { lot_id: lot.id, amount }, leader: code }); setCustom('') }
    catch (e) { setMsg(e.message) }
    finally { setBusy(false) }
  }
  const top = lot?.highest, leading = top?.team_id === me.team_id
  const leader = top && snap.teams.find(t => t.id === top.team_id)
  const quick = lot ? [0, 1, 2].map(i => lot.next_amount + i * (lot.step || 0)).filter((a, i, all) => all.indexOf(a) === i) : []
  const live = snap?.status === 'auction_live'
  const n = Number(custom)
  return (
    <main className="wrap narrow captain">
      <header className="captain-head">
        <img src={me.logo_url} alt="" />
        <div><h1 className="display">{me.name}</h1>
          <p className="mono amber">[{me.tag}]{mine && ` · ${mine.credits_left} CR LEFT · MAX BID ${mine.max_bid} · ${mine.bought} BOUGHT`}</p></div>
      </header>
      {!online && <p className="mono muted">RECONNECTING…</p>}
      {!snap ? <p className="mono muted">CONNECTING…</p>
        : snap.status === 'completed' ? <p>The auction is over.</p>
        : !lot ? <p className="mono muted">{snap.status === 'auction_paused' ? 'PAUSED' : 'WAITING FOR THE NEXT PLAYER…'}</p>
        : <section className="card">
            <PlayerCard p={lot.player} small />
            <TimerTiles left={left} total={snap.settings.bid_timer || 1} />
            <p className="mono">{top ? <>HIGHEST {top.amount} CR · {leading ? 'YOU' : leader?.tag}</> : <>BASE {lot.base_price} CR · NO BIDS YET</>}</p>
            {!live ? <p className="mono amber">PAUSED</p>
              : leading ? <p className="mono amber">YOU'RE THE HIGHEST BIDDER</p>
              : mine?.blocked && mine.blocked !== 'Over max bid' ? <p className="err">{mine.blocked}</p>
              : <>
                  <div className="bid-quick">{quick.map((a, i) => <button key={a} className={'btn' + (i ? ' ghost' : '')} disabled={busy || a > mine?.max_bid} onClick={() => bid(a)}>
                    <small>{i ? `+${a - lot.next_amount}` : 'Next bid'}</small>{a}</button>)}</div>
                  <form className="bid-custom" onSubmit={e => { e.preventDefault(); bid(n) }}>
                    <label htmlFor="cb" className="mono muted">CUSTOM AMOUNT · {lot.next_amount} TO {mine?.max_bid}</label>
                    <div>
                      <input id="cb" type="number" inputMode="numeric" min={lot.next_amount} max={mine?.max_bid} placeholder={String(lot.next_amount)}
                             value={custom} onChange={e => setCustom(e.target.value)} />
                      <button className="btn" disabled={busy || !n || n < lot.next_amount || n > mine?.max_bid}>Bid {n >= lot.next_amount ? n : ''}</button>
                    </div>
                  </form>
                </>}
            {msg && <p className="err" role="status">{msg}</p>}
          </section>}
    </main>
  )
}

function TeamEditor({ me, setMe, code, date }) {
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
    <main className="wrap narrow captain">
      <header className="captain-head">
        <img src={me.logo_url} alt="" />
        <div><h1 className="display">{me.name}</h1><p className="mono amber">[{me.tag}] · PROFILE {me.profile_status.toUpperCase()}</p></div>
      </header>
      <p>The auction is{date ? ` on ${date}` : ' coming up'}. Keep this page open: once it starts you bid for your team right here.</p>
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
