import { useEffect, useState } from 'react'
import { api, STATUS_TEXT } from './api.js'
import { PlayerCard, TeamCard } from './Cards.jsx'
import { CheckEmail, ProfileFields, SignIn } from './Signup.jsx'

const EDITABLE = ['display_name', 'riot_id', 'current_rank', 'peak_rank', 'role', 'playstyle', 'quote', 'discord', 'phone']

// /profile: sign in with the same account you signed up with. No link to save.
export function Profile() {
  const [auth, setAuth] = useState(null)
  const load = () => api('/auth/me').then(setAuth).catch(() => setAuth({ providers: [], user: null }))
  useEffect(() => { load() }, [])
  const signOut = async () => { await api('/auth/logout', { method: 'POST' }); load() }
  if (!auth) return <main className="wrap narrow" aria-busy="true" />
  if (!auth.user) return <SignIn providers={auth.providers} onDone={load} heading="Your profile"
    lede="Sign in with the same Google account or email you signed up with to see your status and edit your sign-up." />
  if (auth.user.verified === false) return <CheckEmail user={auth.user} onSignOut={signOut} onCheck={load} />
  return <Status src="/me/signup" who={auth.user} onSignOut={signOut} />
}

export default function Status({ src, who, onSignOut }) {
  const [me, setMe] = useState(null)
  const [info, setInfo] = useState(null)
  const [edit, setEdit] = useState(null)
  const [errors, setErrors] = useState({})
  const [msg, setMsg] = useState(''), [missing, setMissing] = useState(false)
  useEffect(() => {
    api(src).then(setMe).catch(e => { setMsg(e.message); setMissing(e.status === 404) })
    api('/public').then(setInfo).catch(() => {})
  }, [src])

  const startEdit = () => setEdit(Object.fromEntries(EDITABLE.map(k => [k, k.endsWith('rank') ? me[k + '_tier'] : me[k]])))
  const save = async e => {
    e.preventDefault()
    try {
      const body = { ...edit, current_rank: +edit.current_rank, peak_rank: +edit.peak_rank }
      setMe(await api(src, { method: 'PATCH', body }))
      setEdit(null); setErrors({}); setMsg('Saved.')
    } catch (err) { setErrors(err.errors); setMsg(err.message) }
  }

  const account = who && <p className="signed-in">Signed in as <strong>{who.name}</strong>{who.email && ` (${who.email})`}. <button type="button" className="btn ghost" onClick={onSignOut}>Sign out</button></p>
  if (!me) return (
    <main className="wrap narrow profile">
      <h1 className="display">Your profile</h1>
      {account}
      {missing && who
        ? <><p className="lede">You haven’t signed up with this account yet.</p><div className="actions"><a className="btn" href="/signup">Sign up now</a></div></>
        : <p className={msg ? 'err' : 'muted'}>{msg || 'Loading…'}</p>}
    </main>
  )
  const [title, text] = me.path === 'sub' && me.status === 'verified' ? ['In the sub pool', 'Free entry, no payment needed. Next we check your rank on tracker.gg.'] : STATUS_TEXT[me.status] || [me.status, '']
  return (
    <main className="wrap narrow profile">
      <a href="/" className="btn ghost">← Home</a>
      <h1 className="display">Your profile</h1>
      {account}
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
