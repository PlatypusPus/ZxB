import { useEffect, useState } from 'react'
import { api } from './api.js'
import { PlayerCard, TeamCard } from './Cards.jsx'

const MAX = 2 * 1024 * 1024
const STEP_OF = { team_name: 1, team_tag: 1, logo: 1, path: 1, terms: 2 } // rest are step 0

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
  discord: '', phone: '', path: 'auction', team_name: '', team_tag: '', utr: '', terms: false, follows: '' }

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
  useEffect(() => { sessionStorage.setItem(DRAFT, JSON.stringify({ v, step })) }, [v, step])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState(null)
  useEffect(() => { api('/public').then(setInfo).catch(e => setMsg(e.message)) }, [])
  const [auth, setAuth] = useState(null)   // { providers, user } from the Google or email sign-in
  const loadAuth = () => api('/auth/me').then(async a => {
      // Already signed up with this account? Their profile is the place to check or edit it.
      if (a.user?.verified !== false && a.user && await api('/me/signup').then(() => true, () => false)) return location.replace('/profile')
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
    v.path === 'leader' ? ['team_name', 'team_tag'] : [], []]
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
    if (!v.terms) e.terms = 'Tick this to continue'
    if (Object.keys(e).length) { setErrors(e); return focusFirst(e) }
    const form = new FormData()
    Object.entries(v).forEach(([k, val]) => k !== 'utr' && form.append(k, val))
    Object.entries(files).forEach(([k, o]) => o && k !== 'screenshot' && (k !== 'logo' || v.path === 'leader') && form.append(k, o.f))
    setBusy(true); setMsg('')
    try {
      const r = await api('/signup', { method: 'POST', form })
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
    return (
      <main className="wrap narrow">
        <h1 className="display">You're signed up</h1>
        <p>Status: <strong>{done.status === 'waitlisted' ? 'Waitlisted (captain slots full)' : free ? 'In the sub pool' : 'Payment submitted'}</strong>. {free ? 'An organiser will check your rank.' : 'An organiser will verify your payment and rank.'}</p>
        <div className="card">
          <p><strong>Your profile has your status.</strong> Sign in any time with this same account to check it or edit your sign-up. We also email you when an organiser decides.</p>
          <a className="btn" href="/profile">Open my profile</a>
        </div>
      </main>
    )
  }
  // Wait for the sign-in check and event info, so the form never flashes before the sign-in or follow screen.
  if (!auth || (!info && !msg)) return <main className="wrap narrow" aria-busy="true" />
  if (info && !info.registration_open) return <main className="wrap narrow"><h1 className="display">Registration is closed</h1><a className="btn" href="/">Back to home</a></main>
  if (auth?.user && auth.user.verified === false) return <CheckEmail user={auth.user} info={info} onSignOut={signOut} onCheck={loadAuth} />
  if (auth && !auth.user) return <SignIn providers={auth.providers} error={loginError} info={info} path={v.path} onDone={loadAuth} />
  if (auth?.user && !v.follows) return <FollowGate info={info} onDone={x => { set('follows', x); scrollTo(0, 0) }} />

  return (
    <main className="wrap signup">
      <form onSubmit={submit} noValidate className="signup-form">
        <a href="/" className="btn ghost">← {info?.name || 'Home'}</a>
        <h1 className="display" tabIndex={-1}>Sign up</h1>
        {auth?.user && <p className="signed-in">Signed in as <strong>{auth.user.name}</strong> with {auth.user.provider === 'google' ? 'Google' : auth.user.provider === 'email' ? 'your email' : 'a dev login'}{auth.user.email && ` (${auth.user.email})`}. Your result is emailed there. <button type="button" className="btn ghost" onClick={signOut}>Sign out</button></p>}
        {errors.auth && <p className="err" role="alert">{errors.auth}</p>}
        <ol className="steps mono" aria-label="Progress">
          {['Profile', 'Path', 'Confirm'].map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined} className={i <= step ? 'on' : ''}>{i + 1}. {s}</li>)}
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
          {!free && <section className="card pay" aria-labelledby="pay-h">
            <h2 id="pay-h" className="pay-amount"><span className="digits">₹{info?.fee ?? 300}</span> <span>paid later</span></h2>
            <p><strong>You don’t pay anything today.</strong> The ₹{info?.fee ?? 300} entry fee is collected later to confirm your spot. We’ll email you how and when to pay.</p>
            <p>The whole prize pool is made up of entry fees, so every confirmed spot adds to it.</p>
          </section>}
          <div className="field">
            <label className="check">
              <input id="f-terms" type="checkbox" checked={v.terms} onChange={e => set('terms', e.target.checked)} aria-describedby={errors.terms ? 'terms-e' : undefined} />
              <span>I accept the <a href="/terms" target="_blank">terms of service</a>, the <a href="/refund-policy" target="_blank">refund policy</a> (no refunds, swaps allowed) and the <a href="/privacy" target="_blank">privacy notice</a>, and agree to my rank being checked on tracker.gg.</span>
            </label>
            {errors.terms && <p className="err" id="terms-e">{errors.terms}</p>}
          </div>
        </>}

        <div className="actions">
          {step > 0 && <button type="button" className="btn ghost" onClick={() => setStep(step - 1)}>Back</button>}
          <button className="btn" disabled={busy}>{step < 2 ? 'Next' : busy ? 'Submitting…' : 'Submit sign-up'}</button>
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
const IN_APP = [['Instagram', /Instagram/], ['WhatsApp', /WhatsApp/], ['Facebook', /FBAN|FBAV|FB_IAB/], ['Snapchat', /Snapchat/],
  ['LinkedIn', /LinkedInApp/], ['Telegram', /Telegram/], ['Discord', /Discord/], ['Line', /\bLine\//]]
const inAppBrowser = () => IN_APP.find(([, re]) => re.test(navigator.userAgent))?.[0]

export function SignIn({ providers, error, info, path, onDone, heading = 'Sign in to register', lede }) {
  const inApp = inAppBrowser()
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
      <h1 className="display">{heading}</h1>
      <p className="lede">{lede || `You're signing up ${what}. Make an account first so each person registers once. We email your result, like whether you're selected as a captain, to this address.`}</p>
      {msg && <p className="err" role="alert">{msg}</p>}
      {inApp && providers.includes('google') && <p className="follow-warn" role="note">
        <strong>Google sign-in doesn’t work inside the {inApp} app’s browser.</strong> Open this page in Chrome or Safari
        (tap ⋮ or ⋯, then “Open in browser”), or use your email below.
        {/Android/i.test(navigator.userAgent) && <><br /><a className="btn ghost" href={`intent://${location.host}${location.pathname}${location.search}#Intent;scheme=https;package=com.android.chrome;end`}>Open in Chrome</a></>}
      </p>}
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
      <p className="muted small">We keep your name and email, and never see your Google password. By continuing you agree to the <a href="/terms">terms of service</a> and <a href="/privacy">privacy notice</a>.</p>
    </main>
  )
}

// Email accounts must click the link we send before they can register.
export function CheckEmail({ user, info, onSignOut, onCheck }) {
  const [msg, setMsg] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {   // coming back from the mail app: check again without a tap
    const back = () => document.visibilityState === 'visible' && onCheck()
    document.addEventListener('visibilitychange', back)
    return () => document.removeEventListener('visibilitychange', back)
  }, [])
  const resend = async () => {
    setBusy(true); setMsg('')
    try {
      const r = await api('/auth/resend', { method: 'POST' })
      if (r.verified) return onCheck()
      setMsg('Sent again. It can take a minute; check Spam and Promotions too.')
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  return (
    <main className="wrap narrow signin">
      <a href="/" className="btn ghost">← {info?.name || 'Home'}</a>
      <h1 className="display">Check your email</h1>
      <p className="lede">We sent a link to <strong>{user.email}</strong>. Open it to verify your email, then you can finish signing up. It can take a minute to arrive; if it isn’t in your inbox, check <strong>Spam</strong> and <strong>Promotions</strong>.</p>
      <p className="muted">Typo in the email? Use a different email below, or sign in with Google instead.</p>
      {msg && <p role="status">{msg}</p>}
      <div className="actions">
        <button type="button" className="btn" onClick={onCheck}>I’ve verified, continue</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={resend}>Send the link again</button>
        <button type="button" className="btn ghost" onClick={onSignOut}>Use a different email</button>
      </div>
    </main>
  )
}

// Updates go out on these channels. Continue unlocks once every one is opened, with a small skip for people
// who can't. Not following forfeits the player's prize share (see the terms).
const FOLLOW = [
  ['Instagram', '@shankssays', 'https://www.instagram.com/shankssays/'],
  ['Instagram', '@whoshanks', 'https://www.instagram.com/whoshanks/'],
  ['Instagram', '@ttvpeachysmolbean', 'https://www.instagram.com/ttvpeachysmolbean/'],
  ['Twitch', 'peachysmolbean', 'https://www.twitch.tv/peachysmolbean'],
  ['YouTube', '@ShanksSays', 'https://www.youtube.com/@ShanksSays'],
  ['YouTube', '@peachysmolbeanlive', 'https://www.youtube.com/@peachysmolbeanlive'],
]

function FollowGate({ info, onDone }) {
  const [opened, setOpened] = useState([])
  const all = opened.length === FOLLOW.length
  return (
    <main className="wrap narrow signin follow">
      <a href="/" className="btn ghost">← {info?.name || 'Home'}</a>
      <p className="mono amber">REQUIRED BEFORE YOU SIGN UP</p>
      <h1 className="display">Follow to play</h1>
      <p className="lede">Auction times, match schedules, results and future tournaments are announced on these channels first. Follow all six to continue.</p>
      <p className="follow-warn"><strong>Players found not following any of these forfeit their share of the prize pool.</strong></p>
      <ol className="follow-list">
        {FOLLOW.map(([site, h, url]) => {
          const done = opened.includes(url)
          return (
            <li key={url} className={done ? 'on' : ''}>
              <span className="follow-handle"><span className="follow-site">{site}</span>{h}</span>
              <a className={'btn' + (done ? ' ghost' : '')} href={url} target="_blank" rel="noreferrer"
                onClick={() => setOpened(o => o.includes(url) ? o : [...o, url])}>{done ? 'Opened ✓' : site === 'Instagram' ? 'Follow' : 'Subscribe'}</a>
            </li>
          )
        })}
      </ol>
      <p className="muted small" role="status">{all ? 'All six opened. Thanks!' : `${opened.length} of ${FOLLOW.length} opened. Tap each one, then come back to this tab.`}</p>
      <button type="button" className="btn big" disabled={!all} onClick={() => onDone('followed')}>I’ve followed all six</button>
      <button type="button" className="skip" onClick={() => onDone(`skipped:${opened.length}`)}>Skip for now</button>
    </main>
  )
}
