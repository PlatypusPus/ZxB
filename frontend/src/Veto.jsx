import { useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { Footer, Nav } from './Layout.jsx'

const FLIP_MS = 1600
// A stand-in's link: /veto/<id>?k=<key> makes moves for that team without an account.
const key = new URLSearchParams(location.search).get('k')
const q = key ? `?k=${encodeURIComponent(key)}` : ''
const Logo = ({ team }) => team?.logo_url ? <img className="vt-logo" src={team.logo_url} alt="" /> : null

// A map tile with its preview. state: in | off (admin pool), gone (banned), picked, sel (about to be banned).
export function MapCard({ map, state = '', tag = '', i = 0, pressed, disabled, onClick }) {
  return (
    <button type="button" className={'mapcard ' + state} style={{ '--i': i }} disabled={disabled} onClick={onClick}
      aria-pressed={pressed} aria-label={`${map}${tag ? `, ${tag.toLowerCase()}` : ''}`}>
      <img src={`/maps/${map.toLowerCase()}.webp`} alt="" loading="lazy" width="640" height="360" />
      <span className="mapcard-name display">{map}</span>
      {tag && <span className="mapcard-tag mono">{tag}</span>}
    </button>
  )
}

// The coin: spins when the toss happens while you're watching, otherwise just shows the face it landed on.
function Coin({ face, spin }) {
  return (
    <div className={'coin ' + (face || 'heads') + (spin ? ' spin' : '')} aria-hidden="true">
      <span className="coin-face heads">H</span>
      <span className="coin-face tails">T</span>
    </div>
  )
}

export default function Veto({ id }) {
  const [info, setInfo] = useState(null)
  const [v, setV] = useState(null)
  const [err, setErr] = useState('')
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [spin, setSpin] = useState(false)
  const [revealed, setRevealed] = useState(true)
  const seen = useRef(undefined)   // coin value at the last update; undefined until the first load

  const take = s => {
    if (seen.current === null && s.coin) {   // the toss happened while this page was open: play it
      setSpin(true); setRevealed(false)
      setTimeout(() => { setSpin(false); setRevealed(true) }, FLIP_MS)
    }
    seen.current = s.coin
    setV(s)
  }
  const load = () => api(`/vetoes/${id}${q}`).then(take).catch(e => setErr(e.message))
  useEffect(() => { api('/public').then(setInfo).catch(() => {}); load() }, [id])
  // ponytail: polls every 1.5 s while live; switch to the WebSocket hub if many people watch at once
  useEffect(() => {
    if (!v || v.status === 'done') return
    const t = setInterval(load, 1500)
    return () => clearInterval(t)
  }, [v?.status])

  const send = async (action, value) => {
    setBusy(true); setErr('')
    try { take(await api(`/vetoes/${id}/${action}${q}`, { method: 'POST', body: { value } })); setPick('') }
    catch (e) { setErr(e.message); load() } finally { setBusy(false) }
  }

  if (!v) return <><Nav info={info} /><main className="wrap veto"><p className={err ? 'err' : 'muted'}>{err || 'Loading…'}</p></main><Footer /></>

  const team = tid => tid === v.team_a?.id ? v.team_a : v.team_b
  const mine = v.you && v.turn === v.you
  const winner = team(v.first_team_id)
  const banBy = Object.fromEntries(v.bans.map((b, i) => [b.map, { ...b, n: i + 1 }]))
  const opposite = { attack: 'defense', defense: 'attack' }
  const otherTeam = tid => tid === v.team_a?.id ? v.team_b : v.team_a
  const sideMap = v.map || v.bans[v.bans.length - 1]?.map   // the map whose side is being picked
  const verb = v.step === 'pick' ? 'pick' : 'ban'
  const order = { ban: 'BAN', pick: 'PICK' }

  const headline = !revealed ? 'Flipping…'
    : v.status === 'coin' ? (mine ? 'Call the coin toss' : `${v.team_a?.captain} (${v.team_a?.tag}) calls the toss`)
    : v.status === 'ban' ? (mine ? `Your ${verb}` : `${team(v.turn)?.name} is ${verb === 'pick' ? 'picking a map' : 'banning'}`)
    : v.status === 'side' ? (mine ? `Pick your starting side on ${sideMap}` : `${team(v.turn)?.name} is picking a side on ${sideMap}`)
    : v.maps.map(m => m.map).join(' · ')

  return (
    <>
      <Nav info={info} />
      <main className="wrap veto">
        <p className="mono amber">MAP VETO · BO{v.bo}</p>
        <header className="vt-teams">
          {[v.team_a, v.team_b].map(t => (
            <div key={t?.id} className={'vt-team' + (v.turn === t?.id && revealed ? ' on' : '')}>
              <Logo team={t} />
              <div><strong>{t?.name}</strong><span className="muted small">{t?.delegate ? `Vetoing: ${t.delegate}` : `Captain ${t?.captain}`}{v.you === t?.id ? ' · you' : ''}</span></div>
            </div>
          ))}
        </header>

        <h1 className="display vt-head" aria-live="polite">{headline}</h1>
        {err && <p className="err" role="alert">{err}</p>}
        {key && !v.you && <p className="err">This veto link has been replaced. Ask the organiser for the new one.</p>}

        {(v.status === 'coin' || v.coin) && (
          <section className="vt-coin">
            <Coin face={v.coin} spin={spin} />
            <div>
              {v.status === 'coin' && (mine
                ? <div className="actions"><button className="btn" disabled={busy} onClick={() => send('call', 'heads')}>Heads</button><button className="btn ghost" disabled={busy} onClick={() => send('call', 'tails')}>Tails</button></div>
                : <p className="muted">The winner of the toss bans first.</p>)}
              {v.coin && revealed && <p>{v.team_a?.tag} called {v.call}. It landed <strong className="amber">{v.coin}</strong>, so {winner?.name} bans first.</p>}
            </div>
          </section>
        )}

        {v.status !== 'coin' && revealed && (
          <section aria-label="Map pool">
            <ul className="vt-maps">
              {v.pool.map((m, i) => {
                const ban = banBy[m], live = v.status === 'ban' && mine && !ban
                return (
                  <li key={m}>
                    <MapCard map={m} i={i} pressed={pick === m} disabled={!live || busy} onClick={() => setPick(m)}
                      state={ban?.kind === 'pick' || m === v.map ? 'picked' : ban ? 'gone' : pick === m ? 'sel' : ''}
                      tag={ban ? `${order[ban.kind || 'ban']} ${ban.n} · ${team(ban.team_id)?.tag}` : m === v.map ? (v.bo === 3 ? 'DECIDER' : 'PLAYING') : pick === m ? `${order[verb]}?` : ''} />
                  </li>
                )
              })}
            </ul>
            {v.status === 'ban' && mine && <div className="actions vt-confirm">
              <button className="btn" disabled={!pick || busy} onClick={() => send(verb, pick)}>{pick ? `${verb === 'pick' ? 'Pick' : 'Ban'} ${pick}` : `Choose a map to ${verb}`}</button>
              <span className="muted small">{verb === 'pick' ? `${otherTeam(v.you)?.name} picks the side on it.` : 'The last map standing is played.'}</span>
            </div>}
            {v.status === 'side' && mine && <div className="actions vt-confirm">
              <button className="btn" disabled={busy} onClick={() => send('side', 'attack')}>Attack</button>
              <button className="btn" disabled={busy} onClick={() => send('side', 'defense')}>Defense</button>
            </div>}
            {v.status === 'done' && <ol className="vt-result">{v.maps.map(m => (
              <li key={m.map}><strong>{m.map}</strong>{v.bo === 3 && <span className="muted"> ({m.picked_by ? `${team(m.picked_by)?.tag} pick` : 'decider'})</span>}. {team(m.side_team_id)?.name} starts on <strong className="amber">{m.side}</strong>, {otherTeam(m.side_team_id)?.name} on {opposite[m.side]}.</li>
            ))}</ol>}
          </section>
        )}

        {v.status !== 'coin' && revealed && (
          <section aria-label="Veto order">
            <ol className="vt-steps">
              {v.steps.map((s, i) => {
                const b = v.bans[i], now = i === v.bans.length && v.status === 'ban'
                return <li key={i} className={(b ? 'did ' : '') + (now ? 'now ' : '') + s.kind}>
                  <span className="mono">{i + 1} · {order[s.kind]}</span>
                  <strong>{team(s.team_id)?.tag}</strong>
                  <span>{b ? b.map : now ? `${s.kind === 'pick' ? 'picking' : 'banning'}…` : ''}</span>
                  {b?.kind === 'pick' && <span className="muted small">{b.side ? `${team(b.side_team_id)?.tag} ${b.side}` : `${otherTeam(b.team_id)?.tag} picks side…`}</span>}
                </li>
              })}
              <li className={'decider' + (v.map ? ' did' : '')}>
                <span className="mono">{v.bo === 3 ? 'DECIDER' : 'MAP'}</span>
                <strong>{v.map || 'Last map left'}</strong>
                {v.map && <span className="muted small">{v.side ? `${team(v.side_team_id)?.tag} ${v.side}` : `${team(v.side_team_id)?.tag} picks side…`}</span>}
              </li>
            </ol>
          </section>
        )}

        {!v.you && !key && v.status !== 'done' && <p className="muted small vt-note">You're watching. Captains: open the link the organiser sent you to make your moves.</p>}
      </main>
      <Footer />
    </>
  )
}
