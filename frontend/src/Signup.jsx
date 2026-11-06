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
      {text('discord', 'Discord username', { required: true, autoComplete: 'off' })}
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
  const [v, setV] = useState({ ...EMPTY, ...saved.v })
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

  const set = (k, val) => { setV(o => ({ ...o, [k]: val })); setErrors(e => ({ ...e, [k]: undefined })) }
  const setFile = (k, f) => {
    setErrors(e => ({ ...e, [k]: f && f.size > MAX ? 'Image must be 2 MB or smaller' : undefined }))
    setFiles(o => ({ ...o, [k]: f && f.size <= MAX ? { f, url: URL.createObjectURL(f) } : undefined }))
  }
  const ranks = info?.ranks || []
  const leaderOpen = (info?.leader_slots_left ?? 0) > 0
  const preview = { ...v, current_rank: ranks[v.current_rank - 1], peak_rank: ranks[v.peak_rank - 1], photo_url: files.photo?.url }

  const required = [['display_name', 'riot_id', 'current_rank', 'peak_rank', 'role', 'playstyle', 'discord', 'phone'],
    v.path === 'leader' ? ['team_name', 'team_tag'] : [], ['utr']]
  const next = () => {
    const e = Object.fromEntries(required[step].filter(k => !String(v[k]).trim()).map(k => [k, 'Required']))
    if (step === 1 && v.path === 'leader' && !files.logo) e.logo = 'Upload your team logo'
    setErrors(e)
    if (Object.keys(e).length) return focusFirst(e)
    setStep(step + 1); scrollTo(0, 0)
    requestAnimationFrame(() => document.querySelector('.signup-form h1')?.focus())
  }

  const submit = async ev => {
    ev.preventDefault()
    if (step < 2) return next()
    const e = {}
    if (!/^\d{12}$/.test(v.utr.replace(/\s/g, ''))) e.utr = 'Enter the 12-digit UTR from your UPI app'
    if (!files.screenshot) e.screenshot = 'Upload the payment screenshot'
    if (!v.terms) e.terms = 'Tick this to continue'
    if (Object.keys(e).length) { setErrors(e); return focusFirst(e) }
    const form = new FormData()
    Object.entries(v).forEach(([k, val]) => form.append(k, val))
    Object.entries(files).forEach(([k, o]) => o && form.append(k, o.f))
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
        <p>Status: <strong>{done.status === 'waitlisted' ? 'Waitlisted (leader slots full)' : 'Payment submitted'}</strong>. An organiser will verify your payment and rank.</p>
        <div className="card">
          <p><strong>Save your edit link.</strong> It's the only way to check your status or change your sign-up.</p>
          <p className="mono break">{link}</p>
          <button className="btn" onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true))}>{copied ? 'Copied ✓' : 'Copy link'}</button>{' '}
          <a className="btn ghost" href={link}>Open status page</a>
        </div>
      </main>
    )
  }
  if (info && !info.registration_open) return <main className="wrap narrow"><h1 className="display">Registration is closed</h1><a href="/">Back to home</a></main>

  const upi = `upi://pay?pa=${encodeURIComponent(info?.upi_id || '')}&pn=${encodeURIComponent(info?.upi_name || 'ZenithXBeans')}&am=${info?.fee ?? 300}&cu=INR&tn=ZXB%20signup`
  return (
    <main className="wrap signup">
      <form onSubmit={submit} noValidate className="signup-form">
        <a href="/" className="mono muted">← {info?.name || 'Home'}</a>
        <h1 className="display" tabIndex={-1}>Sign up</h1>
        {already && <p className="note">You've already signed up on this device. <a href={`/status/${already}`}>Check your status</a> instead of paying twice.</p>}
        <ol className="steps mono" aria-label="Progress">
          {['Profile', 'Path', 'Payment'].map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined} className={i <= step ? 'on' : ''}>{i + 1}. {s}</li>)}
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
              <strong>Auction player</strong><span className="muted">Leaders bid for you live.</span>
            </label>
            {leaderOpen && (
              <label className={'card choice' + (v.path === 'leader' ? ' on' : '')}>
                <input type="radio" name="path" checked={v.path === 'leader'} onChange={() => set('path', 'leader')} />
                <strong>Team leader</strong><span className="muted">{info.leader_slots_left} slots left. Create your team; you're never auctioned.</span>
              </label>
            )}
          </fieldset>
          {!leaderOpen && <p className="muted">All leader slots are taken, so you can sign up as an auction player.</p>}
          {v.path === 'leader' && <>
            <Field label="Team name" name="team_name" err={errors.team_name} required maxLength={24} value={v.team_name} onChange={e => set('team_name', e.target.value)} />
            <Field label="Team tag" name="team_tag" err={errors.team_tag} required maxLength={4} hint="2 to 4 letters" value={v.team_tag} onChange={e => set('team_tag', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
            <Field label="Team logo" name="logo" err={errors.logo} hint="PNG or JPG, square, max 2 MB. An organiser approves it before it shows publicly.">
              {id => <input id={id} type="file" accept="image/png,image/jpeg,image/webp" onChange={e => setFile('logo', e.target.files[0])} />}
            </Field>
          </>}
        </>}

        {step === 2 && <>
          <section className="card pay" aria-labelledby="pay-h">
            <h2 id="pay-h" className="pay-amount"><span className="digits">₹{info?.fee ?? 300}</span> <span>by UPI</span></h2>
            <ol className="pay-steps">
              <li>
                <strong>Pay exactly ₹{info?.fee ?? 300}</strong> to <strong>{info?.upi_name || 'ZenithXBeans'}</strong>
                {info?.upi_id ? <> at <code>{info.upi_id}</code></> : <span className="err"> (the UPI ID isn't published yet, so you can't pay today)</span>}
                {info?.upi_id && <img src="/upi-qr.png" alt={`UPI QR code for ${info.upi_id}`} className="qr" onError={e => (e.currentTarget.hidden = true)} />}
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
          <div className="field">
            <label className="check">
              <input id="f-terms" type="checkbox" checked={v.terms} onChange={e => set('terms', e.target.checked)} aria-describedby={errors.terms ? 'terms-e' : undefined} />
              <span>I accept the rulebook, refund policy and privacy notice, and agree to my rank being checked on tracker.gg.</span>
            </label>
            {errors.terms && <p className="err" id="terms-e">{errors.terms}</p>}
          </div>
        </>}

        <div className="actions">
          {step > 0 && <button type="button" className="btn ghost" onClick={() => setStep(step - 1)}>Back</button>}
          <button className="btn" disabled={busy || (step === 2 && !info?.upi_id)}>{step < 2 ? 'Next' : busy ? 'Submitting…' : 'Submit sign-up'}</button>
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
