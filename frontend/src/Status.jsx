import { useEffect, useState } from 'react'
import { api, STATUS_TEXT } from './api.js'
import { PlayerCard, TeamCard } from './Cards.jsx'
import { ProfileFields } from './Signup.jsx'

const EDITABLE = ['display_name', 'riot_id', 'current_rank', 'peak_rank', 'role', 'playstyle', 'quote', 'discord', 'phone']

export default function Status({ token }) {
  const [me, setMe] = useState(null)
  const [info, setInfo] = useState(null)
  const [edit, setEdit] = useState(null)
  const [errors, setErrors] = useState({})
  const [msg, setMsg] = useState('')
  useEffect(() => {
    api(`/signup/${encodeURIComponent(token)}`).then(setMe).catch(e => setMsg(e.message))
    api('/public').then(setInfo).catch(() => {})
  }, [token])

  const startEdit = () => setEdit(Object.fromEntries(EDITABLE.map(k => [k, k.endsWith('rank') ? me[k + '_tier'] : me[k]])))
  const save = async e => {
    e.preventDefault()
    try {
      const body = { ...edit, current_rank: +edit.current_rank, peak_rank: +edit.peak_rank }
      setMe(await api(`/signup/${encodeURIComponent(token)}`, { method: 'PATCH', body }))
      setEdit(null); setErrors({}); setMsg('Saved.')
    } catch (err) { setErrors(err.errors); setMsg(err.message) }
  }

  if (!me) return <main className="wrap narrow"><h1 className="display">Your sign-up</h1><p className={msg ? 'err' : 'muted'}>{msg || 'Loading…'}</p></main>
  const [title, text] = STATUS_TEXT[me.status] || [me.status, '']
  return (
    <main className="wrap narrow">
      <a href="/" className="mono muted">← Home</a>
      <h1 className="display">Your sign-up</h1>
      <div className="card">
        <p className="mono amber">STATUS</p>
        <h2>{title}</h2>
        <p>{text}</p>
        {me.reject_reason && <p className="err">Reason: {me.reject_reason}</p>}
        {me.team && <p className="muted">Team profile: {me.team.profile_status === 'approved' ? 'approved' : 'waiting for organiser approval'}</p>}
      </div>
      {msg && <p role="status">{msg}</p>}
      {edit ? (
        <form onSubmit={save} noValidate>
          <ProfileFields v={edit} set={(k, val) => setEdit(o => ({ ...o, [k]: val }))} errors={errors} info={info} />
          <div className="actions">
            <button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
            <button className="btn">Save changes</button>
          </div>
        </form>
      ) : (
        <>
          {me.team ? <TeamCard t={{ ...me.team, leader: me }} /> : <PlayerCard p={me} />}
          {me.editable && <p><button className="btn" onClick={startEdit}>Edit my sign-up</button></p>}
        </>
      )}
    </main>
  )
}
