import { useEffect, useState } from 'react'
import { api } from './api.js'
import { useAuction, useCountdown } from './live.js'

const TABS = ['Queue', 'Teams', 'Live', 'Settings', 'Email', 'Payments', 'Audit']
const PATH = { leader: 'Captain', auction: 'Auction player', sub: 'Sub (free)' }

export default function Admin() {
  const [token, setToken] = useState(sessionStorage.getItem('zxb-admin'))
  const [tab, setTab] = useState('Queue')
  const logout = () => { sessionStorage.removeItem('zxb-admin'); setToken(null) }
  if (!token) return <Login onToken={t => { sessionStorage.setItem('zxb-admin', t); setToken(t) }} />
  const call = (path, opts = {}) => api(path, { ...opts, token }).catch(e => { if (e.status === 401) logout(); throw e })
  return (
    <main className="admin">
      <header className="admin-bar">
        <strong className="admin-brand">ZXB <span>Admin</span></strong>
        <nav role="tablist">{TABS.map(t => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</nav>
        <button className="btn ghost" onClick={logout}>Log out</button>
      </header>
      {tab === 'Queue' && <Queue call={call} token={token} />}
      {tab === 'Teams' && <Teams call={call} />}
      {tab === 'Live' && <Live call={call} token={token} />}
      {tab === 'Settings' && <Settings call={call} />}
      {tab === 'Email' && <Announce call={call} />}
      {tab === 'Payments' && <Payments token={token} />}
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
  const [pathF, setPathF] = useState('')
  const shown = rows.filter(r => !pathF || r.path === pathF)
  const [note, setNote] = useState({})
  const [flash, setFlash] = useState('')
  const [sure, setSure] = useState(null)   // id waiting for a second click on Delete
  const load = () => call(`/admin/queue${filter ? `?status=${filter}` : ''}`).then(setRows).catch(e => setFlash(e.message))
  useEffect(() => { load() }, [filter])

  const act = async (path, body, row) => {
    try {
      const r = await call(path, { method: 'POST', body: body || {} })
      const mail = r.emailed === true ? ' Emailed them.' : r.emailed === false ? ' No email sent (no email on file or SMTP not set up).' : ''
      setFlash(r.leader_code
        ? `${row.display_name} approved as captain.${mail} Their captain link (shown once): ${location.origin}/leader/${r.leader_code}`
        : `${row.display_name}: ${r.deleted ? "deleted" : r.status || r.payment_status}.${mail}`)
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
        <label>Path <select value={pathF} onChange={e => setPathF(e.target.value)}>
          {['', 'leader', 'auction', 'sub'].map(p => <option key={p} value={p}>{PATH[p] || 'all'}</option>)}
        </select></label>
        <span className="muted">{shown.length} sign-ups</span>
      </div>
      {flash && <p className="flash" role="status">{flash}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Player</th><th>Rank</th><th>Path</th><th>Payment</th><th>Screenshot</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {shown.map(r => {
              const pay = r.payment
              return (
                <tr key={r.id}>
                  <td><strong>{r.display_name}</strong><br /><a href={r.tracker_url} target="_blank" rel="noreferrer" className="mono">{r.riot_id} ↗</a><br /><span className="muted small">{r.phone} · {r.discord}{r.signed_in_with && <><br />via {r.signed_in_with}</>}
                    <br />{r.follows === 'followed' ? 'Socials: followed all' : r.follows ? `Socials: skipped (opened ${r.follows.split(':')[1]})` : 'Socials: not asked'}</span></td>
                  <td>{r.current_rank}<br /><span className="muted">peak {r.peak_rank}</span><br />{r.role}</td>
                  <td>{PATH[r.path] || r.path}{r.team && <><br /><span className="muted">{r.team.name} [{r.team.tag}]</span></>}</td>
                  <td className="mono">{pay.status === 'due' ? <>Fee due<br />₹{pay.amount} · not paid yet</> : <>{pay.utr}<br />₹{pay.amount} · {pay.status}</>}</td>
                  <td>{pay.screenshot ? <Shot name={pay.screenshot} token={token} /> : <span className="muted">{pay.status === 'due' ? 'Pays later' : 'Free sub'}</span>}</td>
                  <td>{r.status}{r.reject_reason && <><br /><span className="muted small">{r.reject_reason}</span></>}</td>
                  <td><div className="acts">
                    <input placeholder="Reason / note" aria-label={`Reason for ${r.display_name}`} value={note[r.id] || ''} onChange={e => setNote({ ...note, [r.id]: e.target.value })} />
                    {pay.status === 'due' && <button className="btn" onClick={() => act(`/admin/payments/${pay.id}/verify`, null, r)}>Mark fee paid</button>}
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
                    {sure === r.id
                      ? <><button className="btn danger" onClick={() => { setSure(null); act(`/admin/players/${r.id}/delete`, null, r) }}>Delete for good</button>
                          <button className="btn ghost" onClick={() => setSure(null)}>Keep</button></>
                      : <button className="btn ghost" onClick={() => setSure(r.id)}>Delete</button>}
                  </div></td>
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
            <p className="muted">Captain {r.display_name} · {r.status}</p>
            <p>Profile: {r.team.profile_status}</p>
            {r.team.profile_status !== 'approved' && <button className="btn" onClick={() => post(`/admin/teams/${r.team.id}/approve-profile`, () => `${r.team.name} approved`)}>Approve name and logo</button>}
            {r.status === 'approved' && <button className="btn ghost" onClick={() => post(`/admin/teams/${r.team.id}/new-code`, x => `New captain link for ${r.team.name} (old one revoked): ${location.origin}/leader/${x.leader_code}`)}>New captain link</button>}
          </article>
        ))}
      </div>
    </section>
  )
}

// Settings form, grouped the way an organiser thinks about the event. Keys match the API's settings object.
const STATUS = { draft: 'Draft (hidden)', registration_open: 'Open for sign-ups', registration_closed: 'Closed' }
const SECTIONS = [
  { title: 'Event', note: 'What players see on the site.', fields: [
    { k: 'event_date', label: 'Auction date', kind: 'text', hint: 'Shown on the site, e.g. 15 Nov 2026' },
    { k: 'group_start', label: 'Group stage starts', kind: 'text', hint: 'e.g. 15 Nov 2026. Leave empty for TBA' },
    { k: 'group_end', label: 'Group stage ends', kind: 'text', hint: 'e.g. 21 Nov 2026. Playoff times are agreed that night' },
    { k: 'playoffs_start', label: 'Playoffs start', kind: 'text', hint: 'e.g. 23 Nov 2026. Later rounds show TBA' },
    { k: 'registration_opens_at', label: 'Registration opens', kind: 'time', hint: 'Optional, India time' },
    { k: 'registration_closes_at', label: 'Registration closes', kind: 'time', hint: 'Optional, India time' },
  ] },
  { title: 'Payment', note: 'Where players send the entry fee. Paid sign-ups stay blocked until the UPI ID is set.', fields: [
    { k: 'fee', label: 'Entry fee', kind: 'num', unit: '₹' },
    { k: 'upi_id', label: 'UPI ID', kind: 'text', hint: 'e.g. zenithxbeans@okaxis' },
    { k: 'upi_name', label: 'Name on the UPI account', kind: 'text' },
    { k: 'upi_qr', kind: 'qr' },
  ] },
  { title: 'Teams and budget', fields: [
    { k: 'teams', label: 'Teams', kind: 'num', hint: 'One captain per team' },
    { k: 'credits_per_team', label: 'Credits per team', kind: 'num', unit: 'credits' },
    { k: 'min_players', label: 'Players each team must buy', kind: 'num' },
    { k: 'max_players', label: 'Most players a team can buy', kind: 'num', optional: true,
      hint: 'Set after registration closes: approved players ÷ teams, rounded up' },
  ] },
  { title: 'Bidding', note: 'Bids are called out in the room and recorded in the Live tab.', fields: [
    { k: 'bid_increment', label: 'Bid step', kind: 'num', unit: 'credits' },
    { k: 'bid_increment_high', label: 'Bigger bid step', kind: 'num', unit: 'credits' },
    { k: 'bid_increment_from', label: 'Use the bigger step from', kind: 'num', unit: 'credits', hint: '0 = never' },
    { k: 'bid_timer', label: 'Time per player', kind: 'num', unit: 'sec', hint: '0 = the auctioneer closes each player' },
    { k: 'bid_reset', label: 'Each bid tops the timer up to', kind: 'num', unit: 'sec' },
  ] },
  { title: 'Starting prices', fields: [
    { k: 'base_price_mode', label: 'Starting price', kind: 'pick', opts: { band: 'By rank group', flat: 'Same for everyone' } },
    { k: 'flat_base_price', label: 'Starting price for everyone', kind: 'num', unit: 'credits', when: c => c.base_price_mode === 'flat' },
    { k: 'band_base_price', kind: 'bands', when: c => c.base_price_mode !== 'flat' },
    { k: 'round2_discount', label: 'Round 2 discount for unsold players', kind: 'num', unit: '%' },
    { k: 'lot_order', label: 'Order players come up', kind: 'pick', opts: { rank_band: 'Highest rank first', random: 'Random' } },
  ] },
  { title: 'Role limits', fields: [{ k: 'role_caps', label: 'Role limits', kind: 'caps' }] },
]
const ALL = SECTIONS.flatMap(x => x.fields)
const LABEL = Object.fromEntries(ALL.map(f => [f.k, f.label || f.k]))
const capsText = o => Object.entries(o || {}).map(([k, v]) => `${k}:${v}`).join(', ')
const parseCaps = s => Object.fromEntries(s.split(',').map(x => x.split(':').map(y => y.trim()))
  .filter(([k, v]) => k && v && !isNaN(+v)).map(([k, v]) => [k, +v]))
// datetime-local has no timezone; the event runs on India time.
const toLocal = iso => (iso || '').slice(0, 16)
const toIso = local => local ? `${local}:00+05:30` : null

function Settings({ call }) {
  const [s, setS] = useState(null)
  const [caps, setCaps] = useState('')
  const [msg, setMsg] = useState('')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  useEffect(() => { call('/admin/settings').then(r => { setS(r); setCaps(capsText(r.settings.role_caps)) }) }, [])
  if (!s) return <p className="muted">Loading…</p>
  const cfg = s.settings
  const touch = k => { setErrors(e => ({ ...e, [k]: undefined })); setMsg('') }
  const setK = (k, v) => { setS({ ...s, settings: { ...cfg, [k]: v } }); touch(k) }

  const save = async e => {
    e.preventDefault()
    const out = {}
    for (const f of ALL) {
      const v = cfg[f.k]
      if (f.kind === 'num') { if (v === '' || v == null) { if (f.optional) out[f.k] = null } else out[f.k] = +v }
      else if (f.kind === 'qr') continue   // saved by its own upload button
      else if (f.kind === 'caps') out[f.k] = parseCaps(caps)
      else if (f.kind === 'text' || f.kind === 'time') out[f.k] = v || null
      else out[f.k] = v
    }
    setBusy(true)
    try {
      setS({ ...s, ...(await call('/admin/settings', { method: 'PUT', body: { name: s.name, status: s.status, settings: out } })) })
      setErrors({}); setMsg('Saved')
    } catch (err) {
      setErrors(err.errors || {})
      setMsg(err.errors && Object.keys(err.errors).length ? `Check ${Object.keys(err.errors).map(k => LABEL[k] || k).join(', ')}` : err.message)
    } finally { setBusy(false) }
  }

  const field = f => {
    if (f.when && !f.when(cfg)) return null
    const id = 's-' + f.k, err = errors[f.k]
    const errP = err && <p className="err">{err}</p>
    if (f.kind === 'bands') return (
      <div className="field wide" key={f.k}><span className="label">Starting price per rank group</span>
        {cfg.band_base_price
          ? <div className="bands">{Object.entries(cfg.band_base_price).sort((x, y) => y[1] - x[1]).map(([b, v]) => (
              <label key={b}><span>{b}</span>
                <input type="number" min="0" inputMode="numeric" value={v}
                  onChange={e => setK('band_base_price', { ...cfg.band_base_price, [b]: +e.target.value })} /></label>))}</div>
          : <button type="button" className="btn ghost" onClick={async () => setK('band_base_price', (await api('/public')).band_base_price)}>Edit rank group prices</button>}
        {errP}</div>)
    if (f.kind === 'qr') return <QrField key={f.k} call={call} name={cfg.upi_qr}
      onChange={n => setS(p => ({ ...p, settings: { ...p.settings, upi_qr: n } }))} />
    if (f.kind === 'caps') return (
      <div className="field wide" key={f.k}><label htmlFor={id}>Most players per role on a team</label>
        <input id={id} value={caps} placeholder="Duelist:2, Sentinel:2" onChange={e => { setCaps(e.target.value); touch(f.k) }} />
        <p className="hint">Captain included. Leave empty for no limits.</p>{errP}</div>)
    const input = f.kind === 'pick'
      ? <select id={id} value={cfg[f.k]} onChange={e => setK(f.k, e.target.value)}>
          {Object.entries(f.opts).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      : f.kind === 'time'
        ? <input id={id} type="datetime-local" value={toLocal(cfg[f.k])} aria-invalid={!!err} onChange={e => setK(f.k, toIso(e.target.value))} />
        : <input id={id} type={f.kind === 'num' ? 'number' : 'text'} min={f.kind === 'num' ? 0 : undefined}
            inputMode={f.kind === 'num' ? 'numeric' : undefined} value={cfg[f.k] ?? ''} aria-invalid={!!err}
            onChange={e => setK(f.k, e.target.value)} />
    return (
      <div className="field" key={f.k}><label htmlFor={id}>{f.label}</label>
        {f.unit ? <div className={'unit' + (f.unit === '₹' ? ' pre' : '')}>{input}<span aria-hidden="true">{f.unit}</span></div> : input}
        {f.hint && <p className="hint">{f.hint}</p>}{errP}</div>)
  }

  return (
    <form className="settings" onSubmit={save}>
      {s.locked && <p className="err settings-lock">Locked: the auction has started, so budgets and prices can’t change.</p>}
      {SECTIONS.map((sec, i) => (
        <fieldset className="set-card" disabled={s.locked} key={sec.title}>
          <legend>{sec.title}</legend>{sec.note && <p className="hint">{sec.note}</p>}
          <div className="set-grid">
            {i === 0 && <>
              <div className="field wide"><label htmlFor="s-name">Tournament name</label>
                <input id="s-name" value={s.name} onChange={e => { setS({ ...s, name: e.target.value }); setMsg('') }} /></div>
              <div className="field"><label htmlFor="s-status">Sign-ups</label>
                <select id="s-status" value={s.status} onChange={e => { setS({ ...s, status: e.target.value }); setMsg('') }}>
                  {Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  {!STATUS[s.status] && <option value={s.status}>{s.status.replaceAll('_', ' ')}</option>}
                </select></div>
            </>}
            {sec.fields.map(field)}
          </div>
        </fieldset>
      ))}
      <div className="settings-save">
        <p className={msg === 'Saved' ? 'ok' : msg ? 'err' : 'hint'} role="status">{msg || 'Changes apply as soon as you save.'}</p>
        <button className="btn" disabled={s.locked || busy}>{busy ? 'Saving…' : 'Save settings'}</button>
      </div>
    </form>
  )
}

// Upload saves straight away (separate from the Save button) so the image never sits half-saved.
function QrField({ call, name, onChange }) {
  const [msg, setMsg] = useState(''), [busy, setBusy] = useState(false)
  const run = async (opts, done) => {
    setBusy(true); setMsg('')
    try { onChange((await call('/admin/settings/upi-qr', opts)).upi_qr); setMsg(done) }
    catch (err) { setMsg(err.errors?.upi_qr || err.message) }
    finally { setBusy(false) }
  }
  const upload = e => {
    const file = e.target.files[0]; e.target.value = ''
    if (!file) return
    const form = new FormData(); form.append('qr', file)
    run({ method: 'PUT', form }, 'QR code updated')
  }
  return (
    <div className="field wide qr-field">
      <span className="label">UPI QR code</span>
      <div className="qr-row">
        {name ? <img src={`/media/${name}`} alt="Current UPI QR code" className="qr-preview" />
          : <div className="qr-preview qr-empty">No QR yet</div>}
        <div className="qr-actions">
          <label className="btn ghost">{name ? 'Replace QR image' : 'Upload QR image'}
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy} onChange={upload} /></label>
          {name && <button type="button" className="btn ghost" disabled={busy} onClick={() => run({ method: 'DELETE' }, 'QR code removed')}>Remove</button>}
          <p className={msg && !msg.startsWith('QR') ? 'err' : 'hint'} role="status">
            {busy ? 'Uploading…' : msg || 'PNG, JPG or WebP, up to 2 MB. Shown on the payment step and saved straight away.'}</p>
        </div>
      </div>
    </div>
  )
}

const AUDIENCE = { all: 'Everyone signed up', captains: 'Captains', players: 'Auction players', subs: 'Sub pool', approved: 'Approved only' }

// Announcements go to each live sign-up's email. Two-step send instead of a browser confirm dialog.
function Announce({ call }) {
  const [f, setF] = useState({ audience: 'all', subject: '', message: '' })
  const [who, setWho] = useState(null), [armed, setArmed] = useState(false)
  const [msg, setMsg] = useState(''), [errors, setErrors] = useState({}), [busy, setBusy] = useState(false)
  useEffect(() => { call(`/admin/announce/recipients?audience=${f.audience}`).then(setWho).catch(() => setWho(null)) }, [f.audience])
  const put = (k, v) => { setF(o => ({ ...o, [k]: v })); setErrors(e => ({ ...e, [k]: undefined })); setArmed(false); setMsg('') }
  const send = async () => {
    setBusy(true)
    try {
      const r = await call('/admin/announce', { method: 'POST', body: f })
      setMsg(`Sending to ${r.queued} ${r.queued === 1 ? 'person' : 'people'}. It can take a minute.`)
      setF(o => ({ ...o, subject: '', message: '' }))
    } catch (e) { setErrors(e.errors || {}); setMsg(Object.keys(e.errors || {}).length ? 'Fix the fields above.' : e.message) }
    finally { setBusy(false); setArmed(false) }
  }
  const n = who?.count ?? 0
  return (
    <form className="announce set-card" onSubmit={e => { e.preventDefault(); setArmed(true) }}>
      <legend>Email participants</legend>
      <p className="hint">Sent from the site's email to each person's sign-in address, with the ZenithXBeans header. Rejected and withdrawn sign-ups are skipped.</p>
      {who && !who.smtp && <p className="err">Email isn't set up on the server yet. Add the SMTP settings to .env first.</p>}
      <div className="field"><label htmlFor="a-aud">Send to</label>
        <select id="a-aud" value={f.audience} onChange={e => put('audience', e.target.value)}>
          {Object.entries(AUDIENCE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <p className="hint">{who ? `${n} ${n === 1 ? 'person' : 'people'} with an email on file` : 'Counting…'}</p></div>
      <div className="field"><label htmlFor="a-sub">Subject</label>
        <input id="a-sub" value={f.subject} maxLength={120} aria-invalid={!!errors.subject} onChange={e => put('subject', e.target.value)} placeholder="Auction starts at 7 pm" />
        {errors.subject && <p className="err">{errors.subject}</p>}</div>
      <div className="field"><label htmlFor="a-msg">Message</label>
        <textarea id="a-msg" rows="9" value={f.message} maxLength={5000} aria-invalid={!!errors.message} onChange={e => put('message', e.target.value)}
          placeholder={'Everyone starts with "Hi <name>," automatically.\n\nLeave a blank line between paragraphs.'} />
        {errors.message && <p className="err">{errors.message}</p>}</div>
      {msg && <p role="status" className={msg.startsWith('Sending') ? 'ok' : 'err'}>{msg}</p>}
      {armed
        ? <div className="announce-confirm"><p>Send “{f.subject || 'no subject'}” to <strong>{n}</strong> {n === 1 ? 'person' : 'people'}? This can’t be undone.</p>
            <div className="actions"><button type="button" className="btn" disabled={busy || !n} onClick={send}>{busy ? 'Sending…' : 'Send now'}</button>
              <button type="button" className="btn ghost" onClick={() => setArmed(false)}>Cancel</button></div></div>
        : <button className="btn" disabled={!who?.smtp || !n}>Review and send</button>}
    </form>
  )
}

function Live({ call, token }) {
  const { snap, online } = useAuction()
  const [msg, setMsg] = useState('')
  const left = useCountdown(snap?.lot)
  const [amt, setAmt] = useState('')   // the amount being called in the room; defaults to the next step
  useEffect(() => setAmt(snap?.lot ? String(snap.lot.next_amount) : ''), [snap?.lot?.id, snap?.lot?.next_amount])
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
        <a className="btn ghost" href="/projector" target="_blank" rel="noreferrer">Open projector</a>
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
      {lot && <div className="toolbar bid-entry">
        <label>Bid called <input type="number" inputMode="numeric" min={lot.next_amount} step="1" value={amt} onChange={e => setAmt(e.target.value)} /></label>
        <span className="muted">Next step is {lot.next_amount}. Type a higher number for a jump bid, then press the captain's team below. Each bid resets the timer.</span>
      </div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Team</th><th>Credits left</th><th>Players</th><th>Max bid</th><th>Record a called bid</th></tr></thead>
          <tbody>{snap.teams.map(t => (
            <tr key={t.id}>
              <td><strong>{t.name}</strong> <span className="mono amber">[{t.tag}]</span><br /><span className="muted small">{t.leader}</span></td>
              <td className="mono">{t.credits_left}</td>
              <td className="mono">{t.bought}/{snap.settings.max_players ?? '?'}</td>
              <td className="mono">{lot ? t.max_bid : '—'}</td>
              <td>{lot && <button className="btn ghost" disabled={!!t.blocked} title={t.blocked || ''}
                onClick={() => act('proxy-bid', { team_id: t.id, lot_id: lot.id, amount: +amt || lot.next_amount })}>
                {t.blocked || `${t.tag} bids ${+amt || lot.next_amount}`}</button>}</td>
            </tr>
          ))}</tbody>
        </table>
        {!snap.teams.length && <p className="muted empty-row">No teams yet. Approve captains in the Queue tab and their teams show up here.</p>}
      </div>
      {snap.recent.length > 0 && <p className="muted small">Last sales: {snap.recent.map(r => `${r.player} → ${r.team} ${r.price}`).join(' · ')}</p>}
    </section>
  )
}

function Payments({ token }) {
  const download = async () => {
    const res = await fetch('/api/v1/admin/payments.csv', { headers: { Authorization: `Bearer ${token}` } })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: 'payments.csv' })
    a.click()
  }
  return <section className="narrow"><p>Every payment with its UTR and status, plus totals for verified and refunded money.</p><button className="btn" onClick={download}>Download payments.csv</button></section>
}

// Nested payloads (settings changes) flatten to "changes.fee: 300" so they read as a list, not a JSON blob.
const flat = (o, pre = '') => Object.entries(o || {}).reduce((acc, [k, v]) =>
  v && typeof v === 'object' && !Array.isArray(v) ? { ...acc, ...flat(v, `${pre}${k}.`) }
    : { ...acc, [pre + k]: v == null ? '—' : String(v) }, {})

function Audit({ call }) {
  const [rows, setRows] = useState([])
  useEffect(() => { call('/admin/audit').then(setRows) }, [])
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
      <tbody>{rows.map(a => <tr key={a.id}>
        <td className="audit-when">{new Date(a.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
        <td>{a.actor}</td><td><code className="audit-act">{a.action}</code></td>
        <td><dl className="audit-data">{Object.entries(flat(a.payload)).map(([k, v]) => <div key={k}><dt>{k.replaceAll('_', ' ')}</dt><dd>{v}</dd></div>)}</dl></td>
      </tr>)}</tbody>
    </table></div>
  )
}
