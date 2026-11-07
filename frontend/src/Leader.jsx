import { useEffect, useState } from 'react'
import { api } from './api.js'

// A captain's private page: edit the team profile before the auction. Bidding itself is live in the room.
export default function Leader({ code }) {
  const [me, setMe] = useState(null)
  const [err, setErr] = useState('')
  const [date, setDate] = useState('')
  useEffect(() => {
    api('/leader/me', { leader: code }).then(setMe).catch(e => setErr(e.message))
    api('/public').then(i => setDate(i.event_date)).catch(() => {})
  }, [code])

  if (err) return <main className="wrap narrow"><h1 className="display">Captain link</h1><p className="err">{err}</p>
    <p>Check you opened the exact link the organisers sent you. If it still fails, message them on WhatsApp or Discord for a new one.</p>
    <p><a className="btn ghost" href="/projector">Open the auction screen</a></p></main>
  if (!me) return <main className="wrap narrow"><p className="mono muted">CONNECTING…</p></main>
  return <TeamEditor me={me} setMe={setMe} code={code} date={date} />
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
      <p>{me.editable
        ? <>Bidding happens live in the room{date ? ` on ${date}` : ''}. Call your bids out loud and an organiser records them; the screen shows the player up and the timer.</>
        : <>The auction has started, so team profiles are locked. Call your bids out loud in the room and an organiser records them.</>}</p>
      <a className="btn ghost" href="/projector">Open the auction screen</a>
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
