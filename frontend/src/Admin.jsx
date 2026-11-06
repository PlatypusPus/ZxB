import { useEffect, useState } from 'react'
import { api } from './api.js'
import { useAuction, useCountdown } from './live.js'

const TABS = ['Queue', 'Teams', 'Live', 'Settings', 'Ledger', 'Audit']

export default function Admin() {
  const [token, setToken] = useState(sessionStorage.getItem('zxb-admin'))
  const [tab, setTab] = useState('Queue')
  const logout = () => { sessionStorage.removeItem('zxb-admin'); setToken(null) }
  if (!token) return <Login onToken={t => { sessionStorage.setItem('zxb-admin', t); setToken(t) }} />
  const call = (path, opts = {}) => api(path, { ...opts, token }).catch(e => { if (e.status === 401) logout(); throw e })
  return (
    <main className="admin">
      <header className="admin-bar">
        <strong className="mono">ZXB ADMIN</strong>
        <nav role="tablist">{TABS.map(t => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</nav>
        <button className="btn ghost" onClick={logout}>Log out</button>
      </header>
      {tab === 'Queue' && <Queue call={call} token={token} />}
      {tab === 'Teams' && <Teams call={call} />}
      {tab === 'Live' && <Live call={call} token={token} />}
      {tab === 'Settings' && <Settings call={call} />}
      {tab === 'Ledger' && <Ledger token={token} />}
      {tab === 'Audit' && <Audit call={call} />}
    </main>
  )
}

function Login({ onToken }) {
  const [msg, setMsg] = useState('')
  const submit = async e => {
    e.preventDefault()
    const f = new FormData(e.target)
    try { onToken((await api('/admin/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } })).token) }
    catch (err) { setMsg(err.message) }
  }
  return (
    <main className="wrap narrow">
      <h1 className="display">Admin login</h1>
      <form onSubmit={submit}>
        <div className="field"><label htmlFor="em">Email</label><input id="em" name="email" type="email" autoComplete="username" required /></div>
        <div className="field"><label htmlFor="pw">Password</label><input id="pw" name="password" type="password" autoComplete="current-password" required /></div>
        {msg && <p className="err" role="alert">{msg}</p>}
        <button className="btn">Log in</button>
      </form>
    </main>
  )
}

function Shot({ name, token }) {
  const [url, setUrl] = useState(null)
  const load = async () => {
    const res = await fetch(`/api/v1/admin/files/${name}`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) setUrl(URL.createObjectURL(await res.blob()))
  }
  useEffect(() => { load() }, [name])
  return url ? <a href={url} target="_blank" rel="noreferrer"><img className="thumb" src={url} alt="Payment screenshot" /></a> : <span className="muted">…</span>
}

function Queue({ call, token }) {
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('')
  const [note, setNote] = useState({})
  const [flash, setFlash] = useState('')
  const load = () => call(`/admin/queue${filter ? `?status=${filter}` : ''}`).then(setRows).catch(e => setFlash(e.message))
  useEffect(() => { load() }, [filter])

  const act = async (path, body, row) => {
    try {
      const r = await call(path, { method: 'POST', body: body || {} })
      setFlash(r.leader_code
        ? `${row.display_name} approved. Leader link, send it on WhatsApp now (shown once): ${location.origin}/leader/${r.leader_code}`
        : `${row.display_name}: ${r.status || r.payment_status}`)
      load()
    } catch (e) { setFlash(`${row.display_name}: ${e.message}`) }
  }
  const reason = r => (note[r.id] || '').trim()
  const needReason = (fn, r) => reason(r) ? fn() : setFlash(`Type a reason for ${r.display_name} first`)

  return (
    <section>
      <div className="toolbar">
        <label>Status <select value={filter} onChange={e => setFilter(e.target.value)}>
          {['', 'submitted', 'verified', 'approved', 'waitlisted', 'rejected', 'withdrawn'].map(s => <option key={s} value={s}>{s || 'all'}</option>)}
        </select></label>
        <span className="muted">{rows.length} sign-ups</span>
      </div>
      {flash && <p className="flash" role="status">{flash}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Player</th><th>Rank</th><th>Path</th><th>Payment</th><th>Screenshot</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map(r => {
              const pay = r.payment
              return (
                <tr key={r.id}>
                  <td><strong>{r.display_name}</strong><br /><a href={r.tracker_url} target="_blank" rel="noreferrer" className="mono">{r.riot_id} ↗</a><br /><span className="muted small">{r.phone} · {r.discord}</span></td>
                  <td>{r.current_rank}<br /><span className="muted">peak {r.peak_rank}</span><br />{r.role}</td>
                  <td>{r.path}{r.team && <><br /><span className="muted">{r.team.name} [{r.team.tag}]</span></>}</td>
                  <td className="mono">{pay.utr}<br />₹{pay.amount} · {pay.status}</td>
                  <td><Shot name={pay.screenshot} token={token} /></td>
                  <td>{r.status}{r.reject_reason && <><br /><span className="muted small">{r.reject_reason}</span></>}</td>
                  <td className="acts">
                    <input placeholder="Reason / note" aria-label={`Reason for ${r.display_name}`} value={note[r.id] || ''} onChange={e => setNote({ ...note, [r.id]: e.target.value })} />
                    {pay.status === 'submitted' && <>
                      <button className="btn" onClick={() => act(`/admin/payments/${pay.id}/verify`, null, r)}>Verify payment</button>
                      <button className="btn ghost" onClick={() => needReason(() => act(`/admin/payments/${pay.id}/reject`, { reason: reason(r) }, r), r)}>Reject payment</button>
                    </>}
                    {pay.status === 'verified' && ['verified', 'waitlisted'].includes(r.status) && <>
                      <button className="btn" onClick={() => act(`/admin/players/${r.id}/approve`, null, r)}>Approve</button>
                      <button className="btn ghost" onClick={() => needReason(() => act(`/admin/players/${r.id}/reject`, { reason: reason(r) }, r), r)}>Reject</button>
                    </>}
                    {r.path === 'leader' && !['approved', 'rejected', 'withdrawn'].includes(r.status) &&
                      <button className="btn ghost" onClick={() => act(`/admin/players/${r.id}/make-auction-player`, null, r)}>Switch to player</button>}
                    {!['withdrawn', 'rejected'].includes(r.status) &&
                      <button className="btn ghost" onClick={() => act(`/admin/players/${r.id}/withdraw`, null, r)}>Withdraw</button>}
                    {['verified', 'rejected'].includes(pay.status) && ['rejected', 'withdrawn', 'waitlisted'].includes(r.status) &&
                      <button className="btn ghost" onClick={() => act(`/admin/payments/${pay.id}/refund`, { note: reason(r) }, r)}>Mark refunded</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Teams({ call }) {
  const [rows, setRows] = useState([])
  const [flash, setFlash] = useState('')
  const load = () => call('/admin/queue').then(r => setRows(r.filter(x => x.team)))
  useEffect(() => { load() }, [])
  const post = async (path, ok) => {
    try { const r = await call(path, { method: 'POST', body: {} }); setFlash(ok(r)); load() } catch (e) { setFlash(e.message) }
  }
  return (
    <section>
      {flash && <p className="flash" role="status">{flash}</p>}
      <div className="grid4">
        {rows.map(r => (
          <article className="card" key={r.id}>
            <img className="logo" src={r.team.logo_url} alt={`${r.team.name} logo`} />
            <h3>{r.team.name} <span className="mono amber">[{r.team.tag}]</span></h3>
            <p className="muted">Leader {r.display_name} · {r.status}</p>
            <p>Profile: {r.team.profile_status}</p>
            {r.team.profile_status !== 'approved' && <button className="btn" onClick={() => post(`/admin/teams/${r.team.id}/approve-profile`, () => `${r.team.name} approved`)}>Approve name and logo</button>}
            {r.status === 'approved' && <button className="btn ghost" onClick={() => post(`/admin/teams/${r.team.id}/new-code`, x => `New leader link for ${r.team.name} (old one revoked): ${location.origin}/leader/${x.leader_code}`)}>New leader link</button>}
          </article>
        ))}
      </div>
    </section>
  )
}

const NUM = ['fee', 'teams', 'credits_per_team', 'min_players', 'max_players', 'bid_increment', 'bid_increment_high',
  'bid_increment_from', 'bid_timer', 'bid_reset', 'round2_discount', 'flat_base_price']
const TEXT = ['event_date', 'upi_id', 'upi_name', 'registration_opens_at', 'registration_closes_at']
const PICK = { base_price_mode: ['band', 'flat'], lot_order: ['rank_band', 'random'] }
const HELP = {
  max_players: 'Set after registration closes: at least approved players ÷ teams, rounded up',
  bid_increment_from: 'Bids at or above this use the high increment (0 = never)',
  bid_timer: 'Seconds per lot; 0 = auctioneer closes manually',
  bid_reset: 'Each bid tops the timer back up to this',
  round2_discount: 'Percent off base price for unsold players in round 2',
}
const capsText = o => Object.entries(o || {}).map(([k, v]) => `${k}:${v}`).join(', ')
const parseCaps = s => Object.fromEntries(s.split(',').map(x => x.split(':').map(y => y.trim()))
  .filter(([k, v]) => k && v).map(([k, v]) => [k, +v]))

function Settings({ call }) {
  const [s, setS] = useState(null)
  const [caps, setCaps] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => { call('/admin/settings').then(r => { setS(r); setCaps(capsText(r.settings.role_caps)) }) }, [])
  if (!s) return <p className="muted">Loading…</p>
  const save = async e => {
    e.preventDefault()
    const num = NUM.map(k => [k, s.settings[k] === '' || s.settings[k] == null ? null : +s.settings[k]])
      .filter(([k, v]) => v !== null || k === 'max_players')
    const settings = Object.fromEntries([
      ...num, ...TEXT.map(k => [k, s.settings[k] || null]), ...Object.keys(PICK).map(k => [k, s.settings[k]]),
      ['role_caps', parseCaps(caps)], ['band_base_price', s.settings.band_base_price],
    ])
    try {
      setS({ ...s, ...(await call('/admin/settings', { method: 'PUT', body: { name: s.name, status: s.status, settings } })) })
      setMsg('Saved.')
    } catch (err) { setMsg(Object.entries(err.errors).map(([k, v]) => `${k}: ${v}`).join(' · ') || err.message) }
  }
  const setK = (k, v) => setS({ ...s, settings: { ...s.settings, [k]: v } })
  const label = k => k.replaceAll('_', ' ')
  const bands = s.settings.band_base_price
  const statuses = ['draft', 'registration_open', 'registration_closed']
  return (
    <form className="settings" onSubmit={save}>
      {s.locked && <p className="err">Locked: the auction has started. Changing budgets mid-auction would lose the room's trust.</p>}
      <fieldset disabled={s.locked}>
        <legend className="mono amber">EVENT</legend>
        <div className="field"><label htmlFor="s-name">Tournament name</label>
          <input id="s-name" value={s.name} onChange={e => setS({ ...s, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="s-status">Status</label>
          <select id="s-status" value={s.status} onChange={e => setS({ ...s, status: e.target.value })}>
            {statuses.map(x => <option key={x}>{x}</option>)}
            {!statuses.includes(s.status) && <option>{s.status}</option>}
          </select></div>
        {TEXT.map(k => <div className="field" key={k}><label htmlFor={'s-' + k}>{label(k)}</label>
          <input id={'s-' + k} value={s.settings[k] || ''} placeholder={k.endsWith('_at') ? '2026-11-20T18:00+05:30' : ''}
            onChange={e => setK(k, e.target.value)} /></div>)}
      </fieldset>
      <fieldset disabled={s.locked}>
        <legend className="mono amber">AUCTION</legend>
        {NUM.map(k => <div className="field" key={k}><label htmlFor={'s-' + k}>{label(k)}</label>
          <input id={'s-' + k} type="number" min="0" value={s.settings[k] ?? ''} onChange={e => setK(k, e.target.value)} />
          {HELP[k] && <p className="hint">{HELP[k]}</p>}</div>)}
        {Object.entries(PICK).map(([k, opts]) => <div className="field" key={k}><label htmlFor={'s-' + k}>{label(k)}</label>
          <select id={'s-' + k} value={s.settings[k]} onChange={e => setK(k, e.target.value)}>
            {opts.map(o => <option key={o}>{o}</option>)}</select></div>)}
        <div className="field"><label htmlFor="s-caps">Role caps per team</label>
          <input id="s-caps" value={caps} placeholder="Duelist:2, Sentinel:2" onChange={e => setCaps(e.target.value)} />
          <p className="hint">Leader included. Leave empty for no caps.</p></div>
        <div className="field"><span className="label">Base price per rank band</span>
          {bands
            ? <div className="bands">{Object.entries(bands).map(([b, v]) => <label key={b}>{b}
                <input type="number" min="0" value={v} onChange={e => setK('band_base_price', { ...bands, [b]: +e.target.value })} /></label>)}</div>
            : <button type="button" className="btn ghost"
                onClick={async () => setK('band_base_price', (await api('/public')).band_base_price)}>Customise band prices</button>}
        </div>
      </fieldset>
      <p className="hint">The UPI QR image is served from frontend/public/upi-qr.png.</p>
      {msg && <p role="status">{msg}</p>}
      <button className="btn" disabled={s.locked}>Save settings</button>
    </form>
  )
}

function Live({ call, token }) {
  const { snap, online } = useAuction()
  const [msg, setMsg] = useState('')
  const left = useCountdown(snap?.lot)
  const act = async (name, body) => {
    try { await call('/admin/auction/' + name, { method: 'POST', body: body || {} }); setMsg('') }
    catch (e) { setMsg(e.message) }
  }
  useEffect(() => {   // auctioneer shortcuts: N next, S sold, U unsold, P pause/resume
    const onKey = e => {
      if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return
      const k = { n: 'next', s: 'sold', u: 'unsold' }[e.key.toLowerCase()]
      if (k) act(k)
      if (e.key.toLowerCase() === 'p') act(snap?.status === 'auction_paused' ? 'resume' : 'pause')
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [snap?.status])
  if (!snap) return <p className="muted">Connecting…</p>
  const lot = snap.lot, st = snap.status
  const running = st === 'auction_live' || st === 'auction_paused'
  const csv = async () => {
    const res = await fetch('/api/v1/admin/results.csv', { headers: { Authorization: `Bearer ${token}` } })
    Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: 'results.csv' }).click()
  }
  return (
    <section className="live">
      <div className="toolbar">
        <span className="tag">{online ? st.replace('auction_', '').replaceAll('_', ' ').toUpperCase() : 'RECONNECTING'}</span>
        <span className="muted">Round {snap.round} · {snap.pool.placed}/{snap.pool.total} placed · {snap.pool.queued} queued</span>
        <a href="/projector" target="_blank" rel="noreferrer">Open projector ↗</a>
        <button className="btn ghost" onClick={csv}>Download results.csv</button>
      </div>
      {msg && <p className="flash" role="alert">{msg}</p>}
      <div className="controls">
        {!running && st !== 'completed' && <button className="btn big" onClick={() => act('start')}>Start auction</button>}
        {running && <>
          <button className="btn" onClick={() => act('next')} disabled={!!lot}>Next player <kbd>N</kbd></button>
          <button className="btn" onClick={() => act('sold')} disabled={!lot}>Sold <kbd>S</kbd></button>
          <button className="btn ghost" onClick={() => act('unsold')} disabled={!lot}>Unsold <kbd>U</kbd></button>
          <button className="btn ghost" onClick={() => act(st === 'auction_paused' ? 'resume' : 'pause')}>
            {st === 'auction_paused' ? 'Resume' : 'Pause'} <kbd>P</kbd></button>
          <button className="btn ghost" onClick={() => act('undo')}>Undo last sale</button>
          <button className="btn ghost" onClick={() => act('assign-leftovers')} disabled={!!lot}>Final assignment and finish</button>
        </>}
      </div>
      {lot && (
        <div className="card lotbox">
          <div>
            <p className="mono amber">ROUND {lot.round} · BASE {lot.base_price}</p>
            <h2 className="display">{lot.player.display_name}</h2>
            <p className="muted">{lot.player.riot_id} · {lot.player.current_rank} · {lot.player.role}</p>
          </div>
          <div>
            <p className="mono muted">HIGHEST</p>
            <p className="digits big-num">{lot.highest ? `${lot.highest.amount} · ${snap.teams.find(t => t.id === lot.highest.team_id)?.tag}` : '—'}</p>
            <p className="mono">{left == null ? 'NO TIMER' : `${Math.ceil(left)} S LEFT`}{st === 'auction_paused' && ' · PAUSED'}</p>
          </div>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Team</th><th>Credits left</th><th>Players</th><th>Max bid</th><th>Proxy bid</th></tr></thead>
          <tbody>{snap.teams.map(t => (
            <tr key={t.id}>
              <td><strong>{t.name}</strong> <span className="mono amber">[{t.tag}]</span><br /><span className="muted small">{t.leader}</span></td>
              <td className="mono">{t.credits_left}</td>
              <td className="mono">{t.bought}/{snap.settings.max_players ?? '?'}</td>
              <td className="mono">{lot ? t.max_bid : '—'}</td>
              <td>{lot && <button className="btn ghost" disabled={!!t.blocked} title={t.blocked || ''}
                onClick={() => act('proxy-bid', { team_id: t.id, lot_id: lot.id, amount: lot.next_amount })}>
                {t.blocked || `Bid ${lot.next_amount}`}</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {snap.recent.length > 0 && <p className="muted small">Last sales: {snap.recent.map(r => `${r.player} → ${r.team} ${r.price}`).join(' · ')}</p>}
    </section>
  )
}

function Ledger({ token }) {
  const download = async () => {
    const res = await fetch('/api/v1/admin/payments.csv', { headers: { Authorization: `Bearer ${token}` } })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: 'payments.csv' })
    a.click()
  }
  return <section className="narrow"><p>Every payment with its UTR and status, plus totals for verified and refunded money.</p><button className="btn" onClick={download}>Download payments.csv</button></section>
}

function Audit({ call }) {
  const [rows, setRows] = useState([])
  useEffect(() => { call('/admin/audit').then(setRows) }, [])
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
      <tbody>{rows.map(a => <tr key={a.id}><td className="mono small">{new Date(a.at).toLocaleString()}</td><td>{a.actor}</td><td>{a.action}</td><td className="mono small">{JSON.stringify(a.payload)}</td></tr>)}</tbody>
    </table></div>
  )
}
