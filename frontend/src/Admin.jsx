import { useEffect, useState } from 'react'
import { api } from './api.js'
import { useAuction, useCountdown } from './live.js'
import { MatchSummary, MatchTable } from './Scoreboard.jsx'
import { MapCard } from './Veto.jsx'
import { Bracket, after, seedsFrom } from './Layout.jsx'

const TABS = ['Queue', 'Teams', 'Live', 'Veto', 'Scoreboard', 'Bracket', 'Settings', 'Email', 'Payments', 'Audit']
const PATH = { leader: 'Captain', auction: 'Auction player', sub: 'Sub (free)' }

export default function Admin() {
  const [token, setToken] = useState(sessionStorage.getItem('zxb-admin'))
  const [tab, setTab] = useState(new URLSearchParams(location.search).get('tab') || 'Queue')
  const teamId = +(location.pathname.match(/^\/admin\/team\/(\d+)/)?.[1] || 0)
  const logout = () => { sessionStorage.removeItem('zxb-admin'); setToken(null) }
  if (!token) return <Login onToken={t => { sessionStorage.setItem('zxb-admin', t); setToken(t) }} />
  const call = (path, opts = {}) => api(path, { ...opts, token }).catch(e => { if (e.status === 401) logout(); throw e })
  return (
    <main className="admin">
      <header className="admin-bar">
        <strong className="admin-brand">ZXB <span>Admin</span></strong>
        {teamId ? <a className="btn ghost" href="/admin?tab=Teams">← All teams</a>
          : <nav role="tablist">{TABS.map(t => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</nav>}
        <button className="btn ghost" onClick={logout}>Log out</button>
      </header>
      {teamId > 0 && <TeamPage call={call} id={teamId} />}
      {!teamId && tab === 'Queue' && <Queue call={call} token={token} />}
      {!teamId && tab === 'Teams' && <Teams call={call} />}
      {!teamId && tab === 'Live' && <Live call={call} token={token} />}
      {!teamId && tab === 'Veto' && <VetoAdmin call={call} />}
      {!teamId && tab === 'Scoreboard' && <ScoreboardAdmin call={call} />}
      {!teamId && tab === 'Bracket' && <BracketAdmin call={call} />}
      {!teamId && tab === 'Settings' && <Settings call={call} />}
      {!teamId && tab === 'Email' && <Announce call={call} />}
      {!teamId && tab === 'Payments' && <Payments token={token} />}
      {!teamId && tab === 'Audit' && <Audit call={call} />}
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
        <button className="btn ghost" onClick={async () => {
          const res = await fetch('/api/v1/admin/players.csv', { headers: { Authorization: `Bearer ${token}` } })
          Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: 'players.csv' }).click()
        }}>Export players.csv</button>
      </div>
      {flash && <p className="flash" role="status">{flash}</p>}
      <AddPlayer call={call} done={msg => { setFlash(msg); load() }} />
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
                    {['auction', 'sub'].includes(r.path) && !['withdrawn', 'rejected'].includes(r.status) &&
                      <button className="btn ghost" onClick={() => act(`/admin/players/${r.id}/switch-path`, null, r)}>{r.path === 'sub' ? 'Switch to auction player' : 'Switch to sub'}</button>}
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

function AddPlayer({ call, done }) {
  const [info, setInfo] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { api('/public').then(setInfo).catch(() => {}) }, [])
  const submit = async e => {
    e.preventDefault()
    const f = Object.fromEntries(new FormData(e.target))
    try {
      await call('/admin/players', { method: 'POST', body: f })
      e.target.reset(); setErr(''); done(`${f.display_name} added as ${PATH[f.path].toLowerCase()}, approved.`)
    } catch (x) { setErr(x.message) }
  }
  return (
    <form className="toolbar" onSubmit={submit} aria-label="Add a player">
      <strong>Add player</strong>
      <input name="display_name" placeholder="Name" maxLength={32} required aria-label="Name" />
      <input name="riot_id" placeholder="Riot ID (name#tag)" required aria-label="Riot ID" />
      <select name="rank" required aria-label="Rank" defaultValue=""><option value="" disabled>Rank</option>
        {info?.ranks.map((r, i) => <option key={r} value={i + 1}>{r}</option>)}</select>
      <select name="role" required aria-label="Role" defaultValue=""><option value="" disabled>Role</option>
        {info?.roles.map(r => <option key={r}>{r}</option>)}</select>
      <select name="path" aria-label="Pool"><option value="auction">Auction player</option><option value="sub">Sub (free)</option></select>
      <button className="btn">Add</button>
      {err && <span className="err" role="alert">{err}</span>}
    </form>
  )
}

// One team on its own page: everyone on it, fix their details (a wrong Riot ID is common), or swap out someone who backed out.
function TeamPage({ call, id }) {
  const [data, setData] = useState(null)
  const [flash, setFlash] = useState('')
  const [open, setOpen] = useState(null)   // { id, mode: 'edit' | 'swap' }
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const load = () => call('/admin/rosters').then(setData).catch(e => setFlash(e.message))
  useEffect(() => { load() }, [])
  if (!data) return <section>{flash ? <p className="err">{flash}</p> : <p className="muted">Loading…</p>}</section>
  const team = data.teams[id]
  if (!team) return <section><p className="err">This team isn't approved yet, or doesn't exist.</p></section>

  const send = async (path, body, ok) => {
    setBusy(true); setFlash('')
    try { setFlash(ok(await call(path, { method: 'POST', body }))); setOpen(null); await load() }
    catch (e) { setFlash(e.message) } finally { setBusy(false) }
  }
  const edit = p => { setOpen({ id: p.id, mode: 'edit' }); setForm({ display_name: p.display_name, riot_id: p.riot_id, rank: p.tier, role: p.role }) }
  const swap = p => { setOpen({ id: p.id, mode: 'swap' }); setForm({ in: '' }) }
  const free = data.free || []
  const pick = free.find(f => f.id === +form.in)
  const opt = f => <option key={f.id} value={f.id}>{f.display_name} · {f.role} · {f.rank}</option>

  const row = (p, captain) => {
    const mode = open?.id === p.id && open.mode
    return (
      <li key={p.id} className={'tp-row' + (mode ? ' on' : '')}>
        <div className="tp-who">
          <strong>{p.display_name}</strong>
          {captain ? <span className="tag ghost">Captain</span> : <span className="mono amber">{p.price} CR</span>}
          <span className="muted small"><a href={p.tracker_url} target="_blank" rel="noreferrer">{p.riot_id}</a> · {p.role} · {p.rank}{p.discord ? ` · ${p.discord}` : ''}</span>
        </div>
        {!mode && <div className="tp-acts">
          <button className="btn ghost" onClick={() => edit(p)}>Edit details</button>
          {!captain && <button className="btn ghost" onClick={() => swap(p)}>Swap out</button>}
        </div>}
        {mode === 'edit' && (
          <form className="tp-form" onSubmit={e => { e.preventDefault(); send(`/admin/players/${p.id}/edit`, { ...form, rank: +form.rank }, x => `Saved ${x.display_name} (${x.riot_id}).`) }}>
            <label>Name<input value={form.display_name} maxLength={32} required onChange={e => setForm({ ...form, display_name: e.target.value })} /></label>
            <label>Riot ID<input value={form.riot_id} required pattern="[^#]{3,16}#[A-Za-z0-9]{3,5}" title="name#tag, for example Kairo#ZXB" onChange={e => setForm({ ...form, riot_id: e.target.value })} /></label>
            <label>Rank<select value={form.rank} onChange={e => setForm({ ...form, rank: e.target.value })}>{data.ranks.map((r, i) => <option key={r} value={i + 1}>{r}</option>)}</select></label>
            <label>Role<select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>{data.roles.map(r => <option key={r}>{r}</option>)}</select></label>
            {form.riot_id !== p.riot_id && <p className="muted small tp-note">The new Riot ID is looked up again on the next scoreboard search.</p>}
            <div className="tp-acts"><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button><button type="button" className="btn ghost" onClick={() => setOpen(null)}>Cancel</button></div>
          </form>
        )}
        {mode === 'swap' && (
          <div className="tp-form">
            <label className="tp-wide">Who replaces {p.display_name}?<select value={form.in} onChange={e => setForm({ in: e.target.value })}>
              <option value="">Choose a free player or sub</option>
              <optgroup label="Unsold auction players">{free.filter(f => f.path !== 'sub').map(opt)}</optgroup>
              {free.some(f => f.path === 'sub') && <optgroup label="Subs">{free.filter(f => f.path === 'sub').map(opt)}</optgroup>}
            </select></label>
            {pick && <p className="tp-note">{pick.display_name} ({pick.riot_id}) takes {p.display_name}'s spot at {p.price} CR, so {team.name}'s credits don't change. {p.display_name} goes back to the free list.</p>}
            {!free.length && <p className="muted small tp-note">Nobody is free. Add a sub from the Queue tab first.</p>}
            <div className="tp-acts">
              <button className="btn" disabled={!pick || busy} onClick={() => send(`/admin/teams/${id}/swap`, { out_player_id: p.id, in_player_id: pick.id }, x => `${x.in} replaces ${x.out}. Price and credits are unchanged.`)}>{busy ? 'Swapping…' : 'Confirm swap'}</button>
              <button className="btn ghost" onClick={() => setOpen(null)}>Cancel</button>
            </div>
          </div>
        )}
      </li>
    )
  }

  return (
    <section className="tp">
      <header className="tp-head">
        <img className="logo" src={team.logo_url} alt="" />
        <div>
          <h1 className="display">{team.name} <span className="mono amber">[{team.tag}]</span></h1>
          <p className="muted">{team.players.length + 1} {team.players.length ? 'players' : 'player'} · {team.players.reduce((n, p) => n + p.price, 0)} CR spent</p>
          <label className="tp-group">Group <select value={team.group || ''} disabled={busy} onChange={e => send(`/admin/teams/${id}/group`, { group: e.target.value }, x => x.group ? `${team.name} is in Group ${x.group}.` : `${team.name} has no group.`)}>
            <option value="">Not set</option><option value="A">Group A</option><option value="B">Group B</option>
          </select></label>
        </div>
      </header>
      {flash && <p className="flash" role="status">{flash}</p>}
      <ul className="tp-list">
        {row(team.captain, true)}
        {team.players.map(p => row(p))}
      </ul>
      {!team.players.length && <p className="muted">No players bought yet.</p>}
    </section>
  )
}

function Teams({ call }) {
  const [rows, setRows] = useState([])
  const [flash, setFlash] = useState('')
  const [rosters, setRosters] = useState({ teams: {} })
  const load = () => {
    call('/admin/queue').then(r => setRows(r.filter(x => x.team)))
    call('/admin/rosters').then(setRosters).catch(() => {})
  }
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
            {(r.team.profile_status !== 'approved' || r.status !== 'approved') && <button className="btn" onClick={() => post(`/admin/teams/${r.team.id}/approve-profile`, x =>
              x.status === 'waitlisted' ? `All captain slots are full, so ${r.display_name} is waitlisted` :
              `${r.team.name} approved with captain ${r.display_name}.${x.leader_code ? ` Their captain link (shown once): ${location.origin}/leader/${x.leader_code}` : ''}`)}>Approve team and captain</button>}
            {r.status === 'approved' && rosters.auction_status !== 'completed' && <button className="btn ghost" onClick={() => post(`/admin/teams/${r.team.id}/new-code`, x => `New captain link for ${r.team.name} (old one revoked): ${location.origin}/leader/${x.leader_code}`)}>New captain link</button>}
            {rosters.teams[r.team.id] && <a className="btn" href={`/admin/team/${r.team.id}`}>Manage team ({rosters.teams[r.team.id].players.length + 1} players)</a>}
          </article>
        ))}
      </div>
    </section>
  )
}

// Settings form, grouped the way an organiser thinks about the event. Keys match the API's settings object.
const STATUS = { draft: 'Draft (hidden)', registration_open: 'Open for sign-ups', registration_closed: 'Closed' }
const SCHED = ['group_start', 'group_end', 'playoffs_start']   // the backend keeps these editable after the auction
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
      if (s.locked && !SCHED.includes(f.k)) continue   // after the auction only the dates can change
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
      <fieldset className="field" disabled={s.locked && !SCHED.includes(f.k)} key={f.k}><label htmlFor={id}>{f.label}</label>
        {f.unit ? <div className={'unit' + (f.unit === '₹' ? ' pre' : '')}>{input}<span aria-hidden="true">{f.unit}</span></div> : input}
        {f.hint && <p className="hint">{f.hint}</p>}{errP}</fieldset>)
  }

  return (
    <form className="settings" onSubmit={save}>
      {s.locked && <p className="hint settings-lock">{s.status === 'completed' ? 'The auction is over' : 'The auction has started'}, so teams, budgets and prices are locked. You can still change the group stage and playoff dates.</p>}
      {SECTIONS.map((sec, i) => (
        <fieldset className="set-card" disabled={s.locked && !sec.fields.some(x => SCHED.includes(x.k))} key={sec.title}>
          <legend>{sec.title}</legend>{sec.note && <p className="hint">{sec.note}</p>}
          <div className="set-grid">
            {i === 0 && <>
              <div className="field wide"><label htmlFor="s-name">Tournament name</label>
                <input id="s-name" disabled={s.locked} value={s.name} onChange={e => { setS({ ...s, name: e.target.value }); setMsg('') }} /></div>
              <div className="field"><label htmlFor="s-status">Sign-ups</label>
                <select id="s-status" disabled={s.locked} value={s.status} onChange={e => { setS({ ...s, status: e.target.value }); setMsg('') }}>
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
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
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
        {(running || st === 'completed') && <button className="btn danger" onClick={() =>
          confirm('Reset the auction? Every bid and sale is wiped and all teams go back to full credits. This cannot be undone.') && act('reset')}>Reset auction</button>}
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

const VETO_STATUS = { coin: 'Waiting for the coin toss', ban: 'Banning maps', side: 'Picking a side', done: 'Finished' }

// Pair two teams for a map veto. Their captains do the rest from /veto/<id>, signed in with their accounts.
function VetoAdmin({ call }) {
  const [data, setData] = useState(null)
  const [flash, setFlash] = useState('')
  const [form, setForm] = useState({ a: '', b: '', pool: null })
  const [sure, setSure] = useState(null)
  const [stand, setStand] = useState({})   // veto id -> picked player id for a stand-in link
  const load = () => call('/admin/vetoes').then(setData).catch(e => setFlash(e.message))
  useEffect(() => { load() }, [])
  // ponytail: refresh every 5 s so the list follows the captains' moves
  useEffect(() => { const t = setInterval(load, 5000); return () => clearInterval(t) }, [])
  if (!data) return <section>{flash ? <p className="err">{flash}</p> : <p className="muted">Loading…</p>}</section>

  const pool = form.pool ?? data.last_pool
  const team = id => data.teams.find(t => t.id === +id)
  const url = path => location.origin + path
  const copy = (text, done) => navigator.clipboard?.writeText(text).then(() => setFlash(done), () => setFlash(text))
  // Ready to paste into WhatsApp or Discord: each captain finds their own team's link.
  const both = v => `Map veto: ${v.team_a?.name} vs ${v.team_b?.name}\n\n${v.team_a?.name} captain:\n${url(v.links[v.team_a?.id])}\n\n${v.team_b?.name} captain:\n${url(v.links[v.team_b?.id])}\n\nOpen only your team's link. No sign-in needed.`
  const post = async (path, body, ok) => {
    setFlash('')
    try { const r = await call(path, { method: 'POST', body }); setFlash(ok(r)); setSure(null); load() } catch (e) { setFlash(e.message) }
  }
  const create = e => {
    e.preventDefault()
    post('/admin/vetoes', { team_a: +form.a, team_b: +form.b, pool }, r => {
      setForm({ a: '', b: '', pool })
      copy(both(r), 'Veto ready. Both captain links are copied, paste them to the captains.')
      return 'Veto ready. Use Copy both links below to send it to the captains.'
    })
  }

  return (
    <section>
      <form className="card" onSubmit={create}>
        <h3>New map veto</h3>
        <p className="muted">Team A's captain calls the coin toss. The winner bans first, then the captains take turns banning until one map is left. The team that didn't make the last ban picks its starting side. You get one link per captain to send them, no sign-in needed.</p>
        <div className="sb-picks">
          {[['a', 'Team A (calls the toss)'], ['b', 'Team B']].map(([k, label]) => (
            <label key={k} className="sb-pick">{label}<select value={form[k]} required onChange={e => setForm({ ...form, [k]: e.target.value })}>
              <option value="">Choose a team</option>
              {data.teams.map(t => <option key={t.id} value={t.id} disabled={String(t.id) === form[k === 'a' ? 'b' : 'a']}>{t.group ? `[${t.group}] ` : ''}{t.name}</option>)}
            </select></label>
          ))}
        </div>
        <p className="vt-pool-h"><strong>Map pool</strong> <span className="muted small">{pool.length} selected · tap a map to add or remove it</span></p>
        <ul className="vt-maps">{data.maps.map((m, i) => {
          const on = pool.includes(m)
          return <li key={m}><MapCard map={m} i={i} state={on ? 'in' : 'off'} tag={on ? 'IN POOL' : ''} pressed={on}
            onClick={() => setForm(f => { const cur = f.pool ?? data.last_pool; return { ...f, pool: cur.includes(m) ? cur.filter(x => x !== m) : data.maps.filter(x => x === m || cur.includes(x)) } })} /></li>
        })}</ul>
        <div className="actions"><button className="btn" disabled={!form.a || !form.b || pool.length < 2}>Start veto</button></div>
      </form>
      {flash && <p className="flash" role="status">{flash}</p>}

      <h3 className="display sb-admin-h">Vetoes</h3>
      {!data.vetoes.length && <p className="muted">No vetoes yet.</p>}
      <ul className="vt-list">{data.vetoes.map(v => (
        <li key={v.id}>
          <span><strong>{v.team_a?.name} vs {v.team_b?.name}</strong><br />
            <span className="muted small">{VETO_STATUS[v.status]}{v.map ? ` · ${v.map}` : ''}{v.side ? ` · ${data.teams.find(t => t.id === v.side_team_id)?.tag} on ${v.side}` : ''}{[v.team_a, v.team_b].filter(t => t?.delegate).map(t => ` · ${t.delegate} vetoes for ${t.tag}`).join('')}</span></span>
          <span className="tp-acts">
            <a className="btn ghost" href={`/veto/${v.id}`} target="_blank" rel="noreferrer">Watch</a>
            {v.status !== 'done' && <>
              <button className="btn" onClick={() => copy(both(v), 'Both captain links copied. Paste them to the captains.')}>Copy both links</button>
              {[v.team_a, v.team_b].map(t => t && <button key={t.id} className="btn ghost" onClick={() => copy(url(v.links[t.id]), `${t.name} captain's link copied.`)}>{t.tag} link</button>)}
            </>}
            {v.status !== 'coin' && <button className="btn ghost" onClick={() => post(`/admin/vetoes/${v.id}/reset`, {}, () => 'Veto restarted from the coin toss.')}>Restart</button>}
            {v.status !== 'done' && <select aria-label="Give the veto link to someone else on the team" value={stand[v.id] || ''}
              onChange={e => setStand({ ...stand, [v.id]: e.target.value })}>
              <option value="">Captain away? Give the link to…</option>
              {[v.team_a, v.team_b].map(t => t && <optgroup key={t.id} label={t.name}>
                {team(t.id)?.players.map(p => <option key={p.id} value={`${t.id}:${p.id}`}>{p.display_name}{p.captain ? ' (captain)' : ''}</option>)}
              </optgroup>)}
            </select>}
            {stand[v.id] && <button className="btn" onClick={() => {
              const [t, p] = stand[v.id].split(':')
              post(`/admin/vetoes/${v.id}/link`, { team_id: +t, player_id: +p }, r => {
                navigator.clipboard?.writeText(r.link)
                setStand({ ...stand, [v.id]: '' })
                return `Link for ${r.delegate} copied: ${r.link} . Anyone with it vetoes for ${team(t)?.name}; making a new one cancels the old one.`
              })
            }}>Make link</button>}
            {sure === v.id
              ? <><button className="btn danger" onClick={() => post(`/admin/vetoes/${v.id}/delete`, {}, () => 'Veto deleted.')}>Delete for good</button><button className="btn ghost" onClick={() => setSure(null)}>Keep</button></>
              : <button className="btn ghost" onClick={() => setSure(v.id)}>Delete</button>}
          </span>
        </li>
      ))}</ul>
    </section>
  )
}

const MAPS = ['Abyss', 'Ascent', 'Bind', 'Breeze', 'Corrode', 'Fracture', 'Haven', 'Icebox', 'Lotus', 'Pearl', 'Split', 'Summit', 'Sunset']

// Pick two teams (fix the lineup if someone was subbed), find their custom game in Henrik, import it, then publish.
function ScoreboardAdmin({ call }) {
  const [data, setData] = useState(null)
  const [flash, setFlash] = useState('')
  const [pick, setPick] = useState({ a: '', b: '', map: '' })
  const [lineup, setLineup] = useState({ a: [], b: [] })   // player ids per side
  const [found, setFound] = useState(null)
  const [busy, setBusy] = useState('')
  const [sure, setSure] = useState(null)
  const [vetoes, setVetoes] = useState([])
  const load = () => call('/admin/scoreboard').then(setData).catch(e => setFlash(e.message))
  useEffect(() => { load(); call('/admin/vetoes').then(r => setVetoes(r.vetoes.filter(v => v.status === 'done'))).catch(() => {}) }, [])
  if (!data) return <section>{flash ? <p className="flash">{flash}</p> : <p className="muted">Loading…</p>}</section>

  const team = id => data.teams.find(t => t.id === +id)
  const person = id => data.players.find(p => p.id === id) || data.teams.flatMap(t => t.players).find(p => p.id === id)
  const choose = (side, id) => {
    setPick({ ...pick, [side]: id }); setFound(null)
    setLineup({ ...lineup, [side]: team(id)?.players.map(p => p.id) || [] })
  }
  const used = new Set([...lineup.a, ...lineup.b])
  const body = () => ({ team_a: +pick.a, team_b: +pick.b, players_a: lineup.a, players_b: lineup.b, map: pick.map })
  const run = async (label, fn) => {
    setBusy(label); setFlash('')
    try { await fn() } catch (e) { setFlash(e.message) } finally { setBusy('') }
  }
  const search = () => run('search', async () => setFound(await call('/admin/scoreboard/search', { method: 'POST', body: body() })))
  const importIt = id => run(id, async () => {
    const r = await call('/admin/scoreboard/import', { method: 'POST', body: { ...body(), match_id: id } })
    setFlash(`Imported ${r.map || 'map'} ${r.rounds_a}–${r.rounds_b}. Check the scoreboard below, then publish it.`)
    setFound(null); load()
  })
  const act = (m, what) => run(m.id + what, async () => {
    await call(`/admin/scoreboard/matches/${m.id}/${what}`, { method: 'POST', body: {} })
    setSure(null); load()
  })
  const linkTo = (puuid, player_id) => run('link', async () => {
    const r = await call('/admin/scoreboard/link', { method: 'POST', body: { puuid, player_id } })
    setFlash(`${player_id ? 'Linked' : 'Unlinked'}: ${r.rows} match ${r.rows === 1 ? 'row' : 'rows'} updated.`); load()
  })

  const side = s => (
    <div className="card sb-pick" key={s}>
      <label>{s === 'a' ? 'Team A' : 'Team B'} <select value={pick[s]} onChange={e => choose(s, e.target.value)}>
        <option value="">Choose a team</option>
        {data.teams.map(t => <option key={t.id} value={t.id} disabled={String(t.id) === pick[s === 'a' ? 'b' : 'a']}>{t.name} [{t.tag}]</option>)}
      </select></label>
      {pick[s] && <>
        <p className="mono muted">LINEUP · {lineup[s].length} {lineup[s].length === 1 ? 'PLAYER' : 'PLAYERS'}</p>
        <ul className="sb-chips">{lineup[s].map(id => {
          const p = person(id)
          return <li key={id}>{p?.display_name} <span className="muted small">{p?.riot_id}</span>
            <button className="btn ghost" aria-label={`Remove ${p?.display_name}`} onClick={() => setLineup({ ...lineup, [s]: lineup[s].filter(x => x !== id) })}>×</button></li>
        })}</ul>
        <label>Add a stand-in <select value="" onChange={e => e.target.value && setLineup({ ...lineup, [s]: [...lineup[s], +e.target.value] })}>
          <option value="">Choose a player or sub</option>
          {data.players.filter(p => !used.has(p.id)).map(p => <option key={p.id} value={p.id}>{p.display_name} · {p.riot_id} · {p.path === 'sub' ? 'sub' : p.role}</option>)}
        </select></label>
      </>}
    </div>
  )

  return (
    <section>
      {!data.configured && <p className="err" role="alert">The Henrik API key isn't set on the server (HENRIKDEV_API_KEY), so searches will fail.</p>}
      <p>Pick the two teams that played. If someone was subbed, remove them and add the stand-in. The search reads the players' recent custom games and only shows matches that players from both teams were in.</p>
      {vetoes.length > 0 && <label className="sb-from">Start from a finished veto <select value="" onChange={e => {
        const v = vetoes.find(x => x.id === +e.target.value)
        if (!v) return
        const ids = s => team(s)?.players.map(p => p.id) || []
        setPick({ a: String(v.team_a.id), b: String(v.team_b.id), map: v.map }); setFound(null)
        setLineup({ a: ids(v.team_a.id), b: ids(v.team_b.id) })
      }}>
        <option value="">Choose a veto</option>
        {vetoes.map(v => <option key={v.id} value={v.id}>{v.team_a?.name} vs {v.team_b?.name} · {v.map}</option>)}
      </select></label>}
      <div className="sb-picks">{side('a')}{side('b')}</div>
      <div className="toolbar">
        <label>Map <select value={pick.map} onChange={e => { setPick({ ...pick, map: e.target.value }); setFound(null) }}>
          <option value="">Any map</option>{MAPS.map(m => <option key={m}>{m}</option>)}</select></label>
        <button className="btn" disabled={!pick.a || !pick.b || !lineup.a.length || !lineup.b.length || !!busy} onClick={search}>
          {busy === 'search' ? 'Searching Henrik… (about 15 s)' : 'Find match'}</button>
      </div>
      {flash && <p className="flash" role="status">{flash}</p>}
      {found && <div className="card">
        {found.missing?.length > 0 && <p className="err">These Riot IDs weren't found, so they were skipped: {found.missing.join(', ')}</p>}
        {found.note && <p className="err">{found.note}</p>}
        <p className="mono muted">{found.candidates.length} MATCH{found.candidates.length === 1 ? '' : 'ES'} FOUND · {found.calls} HISTORY LOOKUPS</p>
        {found.candidates.length === 0 && <p>No custom game with players from both teams in their last 10 customs{pick.map ? ` on ${pick.map}` : ''}. Check the lineups and try again after the match has finished.</p>}
        <ul className="sb-found">{found.candidates.map(c => (
          <li key={c.match_id}>
            <span><strong>{c.map || 'Unknown map'}</strong> · {c.started_at ? new Date(c.started_at).toLocaleString('en-IN') : 'time unknown'}
              <br /><span className="muted small">Seen from {c.a_hits} {team(pick.a)?.tag} and {c.b_hits} {team(pick.b)?.tag} players · {c.match_id}</span></span>
            {c.imported === 'published' ? <span className="tag ghost">Published</span>
              : <button className="btn" disabled={!!busy} onClick={() => importIt(c.match_id)}>{busy === c.match_id ? 'Importing…' : c.imported ? 'Re-import' : 'Import'}</button>}
          </li>
        ))}</ul>
      </div>}

      <h3 className="display sb-admin-h">Accounts to link</h3>
      <p>Riot accounts from imported matches that aren't anyone's signed-up account: a stand-in from another team, or a player on an alt. Link one to a player and it's treated as theirs, now and in future imports. Only maps a captain or bought player plays for their own team count on the player leaderboard, so linking matters for alts, not stand-ins.</p>
      {data.unlinked.length === 0 && <p className="muted">Every account in the imported matches belongs to a player.</p>}
      <ul className="sb-found">{data.unlinked.map(u => (
        <li key={u.puuid}>
          <span><strong>{u.riot_id}</strong><br /><span className="muted small">{u.games} {u.games === 1 ? 'map' : 'maps'} · played for {u.teams.join(', ') || '?'}</span></span>
          <select aria-label={`Link ${u.riot_id} to a player`} value="" disabled={!!busy} onChange={e => e.target.value && linkTo(u.puuid, +e.target.value)}>
            <option value="">Link to a player…</option>
            {data.players.map(p => <option key={p.id} value={p.id}>{p.display_name} · {p.riot_id}</option>)}
          </select>
        </li>
      ))}</ul>
      {data.aliases.length > 0 && <details className="card">
        <summary>{data.aliases.length} linked {data.aliases.length === 1 ? 'account' : 'accounts'}</summary>
        <ul className="sb-found">{data.aliases.map(a => (
          <li key={a.puuid}><span><strong>{a.riot_id}</strong> → {a.display_name}</span>
            <button className="btn ghost" disabled={!!busy} onClick={() => linkTo(a.puuid, null)}>Unlink</button></li>
        ))}</ul>
      </details>}

      <h3 className="display sb-admin-h">Imported matches</h3>
      {data.matches.length === 0 && <p className="muted">Nothing imported yet.</p>}
      {data.matches.map(m => (
        <details className="card sb-game" key={m.id}>
          <summary><MatchSummary m={m} /> <span className={'tag' + (m.status === 'published' ? '' : ' ghost')}>{m.status === 'published' ? 'Published' : 'Not public yet'}</span></summary>
          <div className="toolbar sb-acts">
            {m.status === 'published'
              ? <button className="btn ghost" disabled={!!busy} onClick={() => act(m, 'unpublish')}>Unpublish</button>
              : <button className="btn" disabled={!!busy} onClick={() => act(m, 'publish')}>Publish</button>}
            {sure === m.id
              ? <><button className="btn danger" onClick={() => act(m, 'delete')}>Delete for good</button><button className="btn ghost" onClick={() => setSure(null)}>Keep</button></>
              : <button className="btn ghost" onClick={() => setSure(m.id)}>Delete</button>}
            <a className="btn ghost" href="/scoreboard" target="_blank" rel="noreferrer">Open public page</a>
          </div>
          <MatchTable match={m} />
        </details>
      ))}
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

// Playoff results: click the team that won. Changing a result clears every later result that depended on it.
function BracketAdmin({ call }) {
  const [seeds, setSeeds] = useState(null), [results, setResults] = useState({}), [err, setErr] = useState('')
  useEffect(() => {
    api('/scoreboard').then(d => setSeeds(seedsFrom(d.standings))).catch(e => setErr(e.message))
    api('/public').then(d => setResults(d.bracket || {})).catch(e => setErr(e.message))
  }, [])
  const pick = async (k, side) => {
    const next = { ...results }
    after(k).forEach(x => delete next[x])
    if (side) next[k] = side; else delete next[k]
    setErr('')
    try { setResults((await call('/admin/bracket', { method: 'PUT', body: { results: next } })).bracket) } catch (e) { setErr(e.message) }
  }
  if (!seeds) return <p className="muted">{err || 'Loading…'}</p>
  return (
    <section>
      <p className="muted">Click the team that won a match. It moves on (and the loser drops) on the public bracket straight away.
        Click the winner again to clear it. Changing a result clears the later results that depended on it.</p>
      {err && <p className="err" role="alert">{err}</p>}
      <Bracket seeds={seeds} results={results} onPick={pick} />
    </section>
  )
}

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
