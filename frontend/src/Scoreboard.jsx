import { useEffect, useState } from 'react'
import { api } from './api.js'
import { Footer, Nav, QUALIFY, qualify } from './Layout.jsx'

// ⓘ button next to a section title. <details> needs no JS and works with keyboard and screen readers.
export function Info({ label, children }) {
  return (
    <details className="info">
      <summary aria-label={`What the ${label} columns mean`} title={`What the ${label} columns mean`}>i</summary>
      <div className="info-body">{children}</div>
    </details>
  )
}

const Head = ({ title, label, children }) => (
  <div className="sb-head"><h2 className="display">{title}</h2><Info label={label}>{children}</Info></div>
)

const Logo = ({ team }) => team?.logo_url ? <img className="sb-logo" src={team.logo_url} alt="" /> : null
const when = iso => iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''

const COLS = [['Player', ''], ['Agent', ''], ['K', 'Kills'], ['D', 'Deaths'], ['A', 'Assists'], ['ACS', 'Average combat score'],
  ['ADR', 'Average damage per round'], ['HS%', 'Headshot percentage'], ['FK', 'First kills'], ['FD', 'First deaths']]

export function MatchTable({ match }) {
  const side = team => match.players.filter(p => p.team_id === team.id)
  return [match.team_a, match.team_b].map(team => (
    <div className="table-wrap" key={team.id}>
      <table className="sb-table">
        <caption><Logo team={team} /> {team.name}</caption>
        <thead><tr>{COLS.map(([c, t]) => <th key={c} title={t || undefined} scope="col">{c}</th>)}</tr></thead>
        <tbody>{side(team).map(p => (
          <tr key={p.riot_id}>
            <td><strong>{p.display_name}</strong>{p.display_name === match.mvp && <span className="tag">MVP</span>}<br /><span className="muted small">{p.riot_id}</span></td>
            <td>{p.agent || '–'}</td><td>{p.kills}</td><td>{p.deaths}</td><td>{p.assists}</td>
            <td><strong>{p.acs}</strong></td><td>{p.adr}</td><td>{p.hs}%</td><td>{p.first_kills}</td><td>{p.first_deaths}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  ))
}

export function MatchSummary({ m }) {
  const aWon = m.rounds_a > m.rounds_b
  return (
    <span className="sb-match">
      <span className="mono muted">{m.map || 'Map'} · {when(m.started_at)}</span>
      <span className={'sb-side' + (aWon ? ' won' : '')}><Logo team={m.team_a} />{m.team_a.name}</span>
      <span className="digits sb-score">{m.rounds_a} – {m.rounds_b}</span>
      <span className={'sb-side' + (!aWon ? ' won' : '')}><Logo team={m.team_b} />{m.team_b.name}</span>
    </span>
  )
}

export default function Scoreboard() {
  const [info, setInfo] = useState(null)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    api('/public').then(setInfo).catch(() => {})
    api('/scoreboard').then(setData).catch(e => setErr(e.message))
  }, [])

  return (
    <>
      <Nav info={info} />
      <main className="wrap scoreboard">
        <p className="mono amber">GROUP STAGE</p>
        <h1 className="display">Scoreboard</h1>
        {err && <p className="err" role="alert">{err}</p>}
        {!data && !err && <p className="muted">Loading…</p>}
        {data && <>
          <section aria-labelledby="leaders">
            <Head title={<span id="leaders">Role leaders</span>} label="role leaders">
              <p>The best player in each role, using the role they signed up with.</p>
              <ul>
                <li>Players are compared only with others in the same role, on stats that matter for it (for example, first kills for Duelists, assists for Initiators).</li>
                <li>Small samples are evened out, so one huge map can't win it alone.</li>
                <li><b>First kills</b>: rounds where they got the first kill.</li>
                <li><b>Assists</b>: total assists.</li>
                <li><b>KAST</b>: share of rounds with a kill, assist or survival (estimated from totals).</li>
                <li><b>ACS</b>: average combat score per round.</li>
              </ul>
            </Head>
            {data.role_leaders.length ? <div className="sb-leaders">{data.role_leaders.map(l => (
              <article className="sb-leader" key={l.role}>
                {l.card_url ? <img className="sb-card" src={l.card_url} alt="" loading="lazy" /> : <div className="sb-card sb-card-ph" aria-hidden="true" />}
                <div className="sb-leader-body">
                  <p className="tag">Best {l.role}</p>
                  <h3 className="display">{l.display_name}</h3>
                  <p className="muted small">{l.riot_id}</p>
                  {l.team && <p className="sb-team"><Logo team={l.team} />{l.team.name}</p>}
                  <p className="sb-stat"><span className="mono muted">{l.stat_label}</span><span className="digits amber">{l.stat_value}</span></p>
                  <p className="mono muted">{l.games} {l.games === 1 ? 'MAP' : 'MAPS'}</p>
                </div>
              </article>
            ))}</div> : <p className="muted">Awards appear once matches are published.</p>}
          </section>

          <section aria-labelledby="standings">
            <Head title={<span id="standings">Team standings</span>} label="standings">
              <ul>
                <li><b>P</b>: maps played</li>
                <li><b>W</b>: wins</li>
                <li><b>L</b>: losses</li>
                <li><b>RW</b>: rounds won</li>
                <li><b>RL</b>: rounds lost</li>
                <li><b>RD</b>: round difference (RW − RL)</li>
                <li><b>Pts</b>: points. A win is 3, a loss by 3 rounds or fewer (including overtime) is 1, a bigger loss is 0.</li>
              </ul>
              <p>Ties are split by RD, then rounds won, then the result between the two teams.</p>
              <p>Teams are ranked within their group: {QUALIFY.map(([p, w]) => `${p} → ${w.toLowerCase()}`).join(', ')}.</p>
            </Head>
            {[...new Set(data.standings.map(t => t.group || ''))].map(g => {
              const rows = data.standings.filter(t => (t.group || '') === g)
              return <div className="table-wrap" key={g}>
              <table className="sb-table sb-standings">
                {g && <caption>Group {g}</caption>}
                <thead><tr>
                  <th scope="col">#</th><th scope="col">Team</th>
                  {[['P', 'Played'], ['W', 'Wins'], ['L', 'Losses'], ['RW', 'Rounds won'], ['RL', 'Rounds lost'], ['RD', 'Round difference'], ['Pts', 'Points']]
                    .map(([c, t]) => <th key={c} title={t} scope="col">{c}</th>)}
                </tr></thead>
                <tbody>{rows.map((t, i) => (
                  <tr key={t.id} className={g ? 'q-' + qualify(i)[2] : ''} title={g ? qualify(i)[1] : undefined}>
                    <td className="digits">{i + 1}</td>
                    <td><span className="sb-side"><Logo team={t} />{t.name} <span className="muted">[{t.tag}]</span></span></td>
                    <td>{t.p}</td><td>{t.w}</td><td>{t.l}</td><td>{t.rw}</td><td>{t.rl}</td>
                    <td>{t.rd > 0 ? `+${t.rd}` : t.rd}</td><td><strong className="amber">{t.pts}</strong></td>
                  </tr>
                ))}</tbody>
              </table>
              {g && <p className="sb-key mono muted">{QUALIFY.map(([p, w, k]) => <span key={k} className={'q-' + k}>{p} · {w}</span>)}</p>}
            </div>
            })}
          </section>

          <section aria-labelledby="matches">
            <Head title={<span id="matches">Matches</span>} label="match">
              <p>Every published map, newest first. Open one for the full scoreboard.</p>
              <ul>
                <li><b>K / D / A</b>: kills, deaths, assists</li>
                <li><b>ACS</b>: average combat score per round</li>
                <li><b>ADR</b>: average damage per round</li>
                <li><b>HS%</b>: share of hits that were headshots</li>
                <li><b>FK / FD</b>: first kills and first deaths (who opened each round)</li>
                <li><b>MVP</b>: highest ACS in the map</li>
              </ul>
            </Head>
            {data.matches.length ? data.matches.map(m => (
              <details className="card sb-game" key={m.id}>
                <summary><MatchSummary m={m} /></summary>
                <MatchTable match={m} />
              </details>
            )) : <p className="muted">No matches published yet.</p>}
          </section>
        </>}
      </main>
      <Footer />
    </>
  )
}
