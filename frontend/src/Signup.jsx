import { useEffect, useState } from 'react'
import { api } from './api.js'
import { PlayerCard, TeamCard } from './Cards.jsx'

const MAX = 2 * 1024 * 1024
const STEP_OF = { team_name: 1, team_tag: 1, logo: 1, path: 1, utr: 2, screenshot: 2, terms: 2 } // rest are step 0

export function Field({ label, name, err, hint, children, ...input }) {
  const id = 'f-' + name
  return (
    <div className="field">
      <label htmlFor={id}>{label}{input.required && <span className="amber"> *</span>}</label>
      {children ? children(id) : <input id={id} name={name} aria-invalid={!!err} aria-describedby={err ? id + '-e' : undefined} {...input} />}
      {hint && !err && <p className="hint">{hint}</p>}
      {err && <p className="err" id={id + '-e'}>{err}</p>}
    </div>
  )
}

export function ProfileFields({ v, set, errors, info }) {
  const ranks = info?.ranks || []
  const pick = (name, label, opts) => (
    <Field label={label} name={name} err={errors[name]} required>
      {id => (
        <select id={id} value={v[name]} onChange={e => set(name, e.target.value)} aria-invalid={!!errors[name]}>
          <option value="">Choose…</option>
          {opts.map((o, i) => <option key={o} value={name.endsWith('rank') ? i + 1 : o}>{o}</option>)}
        </select>
      )}
    </Field>
  )
  const text = (name, label, props = {}) => (
    <Field label={label} name={name} err={errors[name]} value={v[name]} onChange={e => set(name, e.target.value)} {...props} />
  )
  return (
    <>
      {text('display_name', 'Display name', { required: true, maxLength: 32, autoComplete: 'nickname', hint: 'Shown on the projector' })}
      {text('riot_id', 'Riot ID', { required: true, placeholder: 'name#tag', autoComplete: 'off' })}
      <div className="row2">{pick('current_rank', 'Current rank', ranks)}{pick('peak_rank', 'Peak rank', ranks)}</div>
      {pick('role', 'Primary role', info?.roles || [])}
      {text('playstyle', 'Playstyle one-liner', { required: true, maxLength: 80, placeholder: 'Aggressive entry, loves Jett' })}
      {text('quote', 'Quote (optional)', { maxLength: 80, hint: 'Shown in italics on your auction card' })}
      {text('discord', 'Discord username (optional)', { maxLength: 37, autoComplete: 'off' })}
      {text('phone', 'Phone (WhatsApp)', { required: true, type: 'tel', autoComplete: 'tel-national', inputMode: 'numeric', placeholder: '98765 43210', hint: 'Never shown publicly' })}
    </>
  )
}

const EMPTY = { display_name: '', riot_id: '', current_rank: '', peak_rank: '', role: '', playstyle: '', quote: '',
  discord: '', phone: '', path: 'auction', team_name: '', team_tag: '', utr: '', terms: false }

// Answers survive a trip to the UPI app (mobile browsers often discard a backgrounded tab). Files can't be stored.
const DRAFT = 'zxb-signup-draft'
const saved = (() => { try { return JSON.parse(sessionStorage.getItem(DRAFT)) || {} } catch { return {} } })()
const focusFirst = e => requestAnimationFrame(() => {
  const k = Object.keys(e)[0]
  const el = k && document.getElementById('f-' + k)
  if (el) { el.focus(); el.scrollIntoView({ block: 'center' }) }
})

export default function Signup() {
  const [info, setInfo] = useState(null)
  const [v, setV] = useState({ ...EMPTY, path: ['leader', 'sub'].includes(new URLSearchParams(location.search).get('path')) ? new URLSearchParams(location.search).get('path') : 'auction', ...saved.v })
  const [files, setFiles] = useState({})
  const [errors, setErrors] = useState({})
  const [step, setStep] = useState(saved.step || 0)
  const [copied, setCopied] = useState(false)
  const already = localStorage.getItem('zxb-edit')
  useEffect(() => { sessionStorage.setItem(DRAFT, JSON.stringify({ v, step })) }, [v, step])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState(null)
  useEffect(() => { api('/public').then(setInfo).catch(e => setMsg(e.message)) }, [])
  const [auth, setAuth] = useState(null)   // { providers, user } from the Google or email sign-in
  const loadAuth = () => api('/auth/me').then(a => {
      setAuth(a)
      if (a.user && !v.display_name) set('display_name', a.user.name.slice(0, 32))
    }).catch(() => setAuth({ providers: [], user: null }))
  useEffect(() => { loadAuth() }, [])
  const loginError = new URLSearchParams(location.search).get('login_error')
  const signOut = async () => { await api('/auth/logout', { method: 'POST' }); setAuth(a => ({ ...a, user: null })) }

  const set = (k, val) => { setV(o => ({ ...o, [k]: val })); setErrors(e => ({ ...e, [k]: undefined })) }
  const setFile = (k, f) => {
    setErrors(e => ({ ...e, [k]: f && f.size > MAX ? 'Image must be 2 MB or smaller' : undefined }))
    setFiles(o => ({ ...o, [k]: f && f.size <= MAX ? { f, url: URL.createObjectURL(f) } : undefined }))
  }
  const ranks = info?.ranks || []
  const leaderOpen = (info?.leader_slots_left ?? 0) > 0
  const preview = { ...v, current_rank: ranks[v.current_rank - 1], peak_rank: ranks[v.peak_rank - 1], photo_url: files.photo?.url }

  const required = [['display_name', 'riot_id', 'current_rank', 'peak_rank', 'role', 'playstyle', 'phone'],
    v.path === 'leader' ? ['team_name', 'team_tag'] : [], ['utr']]
  const next = () => {
    const e = Object.fromEntries(required[step].filter(k => !String(v[k]).trim()).map(k => [k, 'Required']))
    if (step === 1 && v.path === 'leader' && !files.logo) e.logo = 'Upload your team logo'
    setErrors(e)
    if (Object.keys(e).length) return focusFirst(e)
    setStep(step + 1); scrollTo(0, 0)
    requestAnimationFrame(() => document.querySelector('.signup-form h1')?.focus())
  }

  const free = v.path === 'sub'
  const submit = async ev => {
    ev.preventDefault()
    if (step < 2) return next()
    const e = {}
    if (!free && !/^\d{12}$/.test(v.utr.replace(/\s/g, ''))) e.utr = 'Enter the 12-digit UTR from your UPI app'
    if (!free && !files.screenshot) e.screenshot = 'Upload the payment screenshot'
    if (!v.terms) e.terms = 'Tick this to continue'
    if (Object.keys(e).length) { setErrors(e); return focusFirst(e) }
    const form = new FormData()
    Object.entries(v).forEach(([k, val]) => !(free && k === 'utr') && form.append(k, val))
    Object.entries(files).forEach(([k, o]) => o && !(free && k === 'screenshot') && (k !== 'logo' || v.path === 'leader') && form.append(k, o.f))
    setBusy(true); setMsg('')
    try {
      const r = await api('/signup', { method: 'POST', form })
      localStorage.setItem('zxb-edit', r.edit_token)
      sessionStorage.removeItem(DRAFT)
      setDone(r)
    } catch (err) {
      setErrors(err.errors || {}); setMsg(err.message)
      if (err.errors) focusFirst(err.errors)
      const steps = Object.keys(err.errors || {}).map(k => STEP_OF[k] ?? 0)
      if (steps.length) setStep(Math.min(...steps))
    } finally { setBusy(false) }
  }

  if (done) {
    const link = `${location.origin}/status/${done.edit_token}`
    return (
      <main className="wrap narrow">
        <h1 className="display">You're signed up</h1>
        <p>Status: <strong>{done.status === 'waitlisted' ? 'Waitlisted (captain slots full)' : free ? 'In the sub pool' : 'Payment submitted'}</strong>. {free ? 'An organiser will check your rank.' : 'An organiser will verify your payment and rank.'}</p>
        <div className="card">
          <p><strong>Save your edit link.</strong> It's the only way to check your status or change your sign-up.</p>
          <p className="mono break">{link}</p>
          <button className="btn" onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true))}>{copied ? 'Copied ✓' : 'Copy link'}</button>{' '}
          <a className="btn ghost" href={link}>Open status page</a>
        </div>
      </main>
    )
  }
  if (info && !info.registration_open) return <main className="wrap narrow"><h1 className="display">Registration is closed</h1><a className="btn" href="/">Back to home</a></main>
  if (auth?.user && auth.user.verified === false) return <CheckEmail user={auth.user} info={info} onSignOut={signOut} onCheck={loadAuth} />
  if (auth && !auth.user) return <SignIn providers={auth.providers} error={loginError} info={info} path={v.path} onDone={loadAuth} />

  const upi = `upi://pay?pa=${encodeURIComponent(info?.upi_id || '')}&pn=${encodeURIComponent(info?.upi_name || 'ZenithXBeans')}&am=${info?.fee ?? 300}&cu=INR&tn=ZXB%20signup`
  return (
    <main className="wrap signup">
      <form onSubmit={submit} noValidate className="signup-form">
        <a href="/" className="btn ghost">← {info?.name || 'Home'}</a>
        <h1 className="display" tabIndex={-1}>Sign up</h1>
        {auth?.user && <p className="signed-in">Signed in as <strong>{auth.user.name}</strong> with {auth.user.provider === 'google' ? 'Google' : auth.user.provider === 'email' ? 'your email' : 'a dev login'}{auth.user.email && ` (${auth.user.email})`}. Your result is emailed there. <button type="button" className="btn ghost" onClick={signOut}>Sign out</button></p>}
        {errors.auth && <p className="err" role="alert">{errors.auth}</p>}
        {already && <p className="note">You've already signed up on this device. Check your status instead of paying twice. <a className="btn ghost" href={`/status/${already}`}>Check my status</a></p>}
        <ol className="steps mono" aria-label="Progress">
          {['Profile', 'Path', free ? 'Confirm' : 'Payment'].map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined} className={i <= step ? 'on' : ''}>{i + 1}. {s}</li>)}
        </ol>
        {msg && <p className="err" role="alert">{msg}</p>}

        {step === 0 && <>
          <ProfileFields v={v} set={set} errors={errors} info={info} />
          <Field label="Profile photo (optional)" name="photo" err={errors.photo} hint="Square crop, max 2 MB">
            {id => <input id={id} type="file" accept="image/png,image/jpeg,image/webp" onChange={e => setFile('photo', e.target.files[0])} />}
          </Field>
        </>}

        {step === 1 && <>
          <fieldset className="paths">
            <legend>How do you want to play?</legend>
            <label className={'card choice' + (v.path === 'auction' ? ' on' : '')}>
              <input type="radio" name="path" checked={v.path === 'auction'} onChange={() => set('path', 'auction')} />
              <strong>Auction player</strong><span className="muted">Captains bid for you live.</span>
            </label>
            <label className={'card choice' + (v.path === 'sub' ? ' on' : '')}>
              <input type="radio" name="path" checked={v.path === 'sub'} onChange={() => set('path', 'sub')} />
              <strong>Sub pool · free</strong><span className="muted">Not auctioned. Fill in when a team is a player short.</span>
            </label>
            {leaderOpen && (
              <label className={'card choice' + (v.path === 'leader' ? ' on' : '')}>
                <input type="radio" name="path" checked={v.path === 'leader'} onChange={() => set('path', 'leader')} />
                <strong>Captain</strong><span className="muted">{info.leader_slots_left} slots left. Create your team; you're never auctioned.</span>
              </label>
            )}
          </fieldset>
          {!leaderOpen && <p className="muted">All captain slots are taken, so you can sign up as an auction player.</p>}
          {v.path === 'leader' && <>
            <Field label="Team name" name="team_name" err={errors.team_name} required maxLength={24} value={v.team_name} onChange={e => set('team_name', e.target.value)} />
            <Field label="Team tag" name="team_tag" err={errors.team_tag} required maxLength={4} hint="2 to 4 letters" value={v.team_tag} onChange={e => set('team_tag', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
            <Field label="Team logo" name="logo" err={errors.logo} hint="PNG or JPG, square, max 2 MB. An organiser approves it before it shows publicly.">
              {id => <input id={id} type="file" accept="image/png,image/jpeg,image/webp" onChange={e => setFile('logo', e.target.files[0])} />}
            </Field>
          </>}
        </>}

        {step === 2 && free && <section className="card pay">
          <h2 className="pay-amount"><span className="digits">₹0</span> <span>Sub pool</span></h2>
          <p>No payment. You aren't auctioned. When a team is a player short, organisers call a sub in from this pool.</p>
          <p>If the team you sub for wins the tournament, you get the prize share of the teammate you replaced, for the matches you played.</p>
        </section>}
        {step === 2 && <>
          {!free && <>
          <section className="card pay" aria-labelledby="pay-h">
            <h2 id="pay-h" className="pay-amount"><span className="digits">₹{info?.fee ?? 300}</span> <span>by UPI</span></h2>
            <ol className="pay-steps">
              <li>
                <strong>Pay exactly ₹{info?.fee ?? 300}</strong> to <strong>{info?.upi_name || 'ZenithXBeans'}</strong>
                {info?.upi_id ? <> at <code>{info.upi_id}</code></> : <span className="err"> (the UPI ID isn't published yet, so you can't pay today)</span>}
                {info?.upi_id && info.upi_qr_url && <img src={info.upi_qr_url} alt={`UPI QR code for ${info.upi_id}`} className="qr" />}
                {info?.upi_id && <a className="btn ghost mobile-only" href={upi}>Open my UPI app</a>}
              </li>
              <li><strong>Copy the 12-digit UTR</strong> from the payment details. Apps also call it UPI reference or transaction ID.</li>
              <li><strong>Paste it below</strong> with a screenshot of the payment. We check it against the bank statement.</li>
            </ol>
          </section>
          <Field label="UTR (12 digits)" name="utr" err={errors.utr} required inputMode="numeric" maxLength={14} autoComplete="off" value={v.utr} onChange={e => set('utr', e.target.value.replace(/[^\d ]/g, ''))} />
          <Field label="Payment screenshot" name="screenshot" required err={errors.screenshot} hint="Max 2 MB. Only organisers can see it.">
            {id => <input id={id} type="file" accept="image/png,image/jpeg,image/webp" onChange={e => setFile('screenshot', e.target.files[0])} />}
          </Field>
          </>}
          <div className="field">
            <label className="check">
              <input id="f-terms" type="checkbox" checked={v.terms} onChange={e => set('terms', e.target.checked)} aria-describedby={errors.terms ? 'terms-e' : undefined} />
              <span>I accept the rules, the <a href="/refund-policy" target="_blank">refund policy</a> (no refunds, swaps allowed) and the <a href="/privacy" target="_blank">privacy notice</a>, and agree to my rank being checked on tracker.gg.</span>
            </label>
            {errors.terms && <p className="err" id="terms-e">{errors.terms}</p>}
          </div>
        </>}

        <div className="actions">
          {step > 0 && <button type="button" className="btn ghost" onClick={() => setStep(step - 1)}>Back</button>}
          <button className="btn" disabled={busy || (step === 2 && !free && !info?.upi_id)}>{step < 2 ? 'Next' : busy ? 'Submitting…' : 'Submit sign-up'}</button>
        </div>
      </form>

      <aside className="preview" aria-label="Card preview">
        <h2 className="mono muted">Your card on the projector</h2>
        {v.path === 'leader' && step >= 1
          ? <TeamCard t={{ name: v.team_name, tag: v.team_tag, logo_url: files.logo?.url, leader: preview }} />
          : <PlayerCard p={preview} />}
      </aside>
    </main>
  )
}

const PROVIDER_LABEL = { google: 'Continue with Google', dev: 'Dev login (local only)' }

// Registration needs an account first: one sign-up per account, and an email to send the result to.
function SignIn({ providers, error, info, path, onDone }) {
  const what = path === 'leader' ? 'as a captain' : path === 'sub' ? 'for the sub pool' : 'as an auction player'
  const [mode, setMode] = useState('register')
  const [f, setF] = useState({ name: '', email: '', password: '' })
  const [errs, setErrs] = useState({}), [msg, setMsg] = useState(error || ''), [busy, setBusy] = useState(false)
  const put = (k, val) => { setF(o => ({ ...o, [k]: val })); setErrs(e => ({ ...e, [k]: undefined })) }
  const submit = async e => {
    e.preventDefault()
    setBusy(true); setMsg('')
    try {
      await api(`/auth/${mode}`, { method: 'POST', body: mode === 'login' ? { email: f.email, password: f.password } : f })
      await onDone()
    } catch (err) { setErrs(err.errors || {}); setMsg(Object.keys(err.errors || {}).length ? '' : err.message) }
    finally { setBusy(false) }
  }
  const input = (k, label, props) => (
    <Field label={label} name={'acct-' + k} err={errs[k]} value={f[k]} onChange={e => put(k, e.target.value)} required {...props} />
  )
  return (
    <main className="wrap narrow signin">
      <a href="/" className="btn ghost">← {info?.name || 'Home'}</a>
      <h1 className="display">Sign in to register</h1>
      <p className="lede">You're signing up {what}. Make an account first so each person registers once. We email your result, like whether you're selected as a captain, to this address.</p>
      {msg && <p className="err" role="alert">{msg}</p>}
      <div className="signin-options">
        {providers.map(p => <a key={p} className={'btn signin-' + p} href={`/api/v1/auth/${p}/start`}>{PROVIDER_LABEL[p] || p}</a>)}
      </div>
      {providers.length > 0 && <p className="signin-or muted">or use your email</p>}
      <form className="signin-form" onSubmit={submit} noValidate>
        <div className="signin-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'on' : ''} onClick={() => { setMode('register'); setErrs({}); setMsg('') }}>Create account</button>
          <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setErrs({}); setMsg('') }}>Log in</button>
        </div>
        {mode === 'register' && input('name', 'Your name', { autoComplete: 'name', maxLength: 64 })}
        {input('email', 'Email', { type: 'email', autoComplete: 'email', maxLength: 254 })}
        {input('password', 'Password', { type: 'password', autoComplete: mode === 'login' ? 'current-password' : 'new-password', minLength: 8, maxLength: 128, hint: mode === 'register' ? 'At least 8 characters' : undefined })}
        <button className="btn" disabled={busy}>{busy ? 'One moment…' : mode === 'login' ? 'Log in' : 'Create account'}</button>
      </form>
      <p className="muted small">We keep your name and email, and never see your Google password. See the <a href="/privacy">privacy notice</a>.</p>
    </main>
  )
}

// Email accounts must click the link we send before they can register.
function CheckEmail({ user, info, onSignOut, onCheck }) {
  const [msg, setMsg] = useState(''), [busy, setBusy] = useState(false)
  const resend = async () => {
    setBusy(true); setMsg('')
    try {
      const r = await api('/auth/resend', { method: 'POST' })
      if (r.verified) return onCheck()
      setMsg(r.emailed ? 'Sent again. Check your inbox and spam folder.' : 'We couldn’t send the email just now. Try again in a few minutes.')
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  return (
    <main className="wrap narrow signin">
      <a href="/" className="btn ghost">← {info?.name || 'Home'}</a>
      <h1 className="display">Check your email</h1>
      <p className="lede">We sent a link to <strong>{user.email}</strong>. Open it to verify your email, then you can finish signing up. Already clicked it?</p>
      {msg && <p role="status">{msg}</p>}
      <div className="actions">
        <button type="button" className="btn" onClick={onCheck}>I’ve verified, continue</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={resend}>Send the link again</button>
        <button type="button" className="btn ghost" onClick={onSignOut}>Use a different email</button>
      </div>
    </main>
  )
}
