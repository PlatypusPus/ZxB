import { useEffect, useState } from 'react'
import { api } from './api.js'
import { Footer, Nav, groupFinal, qualify } from './Layout.jsx'

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

const STATS = [['rating', 'Rating', 'ACS adjusted for maps played: fewer maps pull it down'], ['acs', 'ACS', 'Average combat score per round'], ['kd', 'K/D', 'Kills per death'], ['adr', 'ADR', 'Average damage per round'],
  ['kills', 'K', 'Kills'], ['deaths', 'D', 'Deaths'], ['assists', 'A', 'Assists'], ['hs', 'HS%', 'Headshot percentage'], ['first_kills', 'FK', 'First kills']]
const ROLES = ['All', 'Duelist', 'Initiator', 'Controller', 'Sentinel', 'Flex']

// Rating = (combat score + K × B) ÷ (rounds + K): K rounds of below-average play (B) added to every record.
function RatingMaths({ r }) {
  const K = r.rounds, B = r.baseline
  const rate = (acs, maps) => Math.round((acs * maps * 24 + B * K) / (maps * 24 + K))   // 24 rounds ≈ one map
  return <>
    <h3 className="mono amber small">How Rating is worked out</h3>
    <p className="mono">Rating = (total combat score + {K} × {B}) ÷ (rounds played + {K})</p>
    <ul>
      <li><b>{B}</b> is the baseline: {Math.round(r.share * 100)}% of the league's average ACS. It updates as matches are published.</li>
      <li><b>{K} rounds</b> (about 3 maps) of baseline play are added to every player's record. ACS is combat score ÷ rounds; Rating is the same sum with those extra rounds mixed in.</li>
      <li>With few rounds the baseline dominates; with many it fades, and Rating gets close to ACS.</li>
    </ul>
    <p>Example, with maps of 24 rounds: 1 map at 350 ACS rates <b>{rate(350, 1)}</b>. 5 maps at 260 ACS rate <b>{rate(260, 5)}</b>. 5 maps at 350 ACS rate <b>{rate(350, 5)}</b>.</p>
  </>
}

function Leaderboard({ players }) {
  const [role, setRole] = useState('All')
  const [sort, setSort] = useState('rating')
  const dir = sort === 'deaths' ? 1 : -1      // fewest deaths first
  const rows = players.filter(p => role === 'All' || p.role === role)
    .sort((x, y) => dir * (x[sort] - y[sort]) || y.rating - x.rating)
  return (
    <>
      <div className="sb-filter" role="group" aria-label="Filter by role">
        {ROLES.map(r => <button key={r} type="button" className={'btn ghost' + (role === r ? ' on' : '')} aria-pressed={role === r} onClick={() => setRole(r)}>{r}</button>)}
      </div>
      <div className="table-wrap">
        <table className="sb-table sb-players">
          <thead><tr>
            <th scope="col">#</th><th scope="col">Player</th><th scope="col" title="Maps played">Maps</th>
            {STATS.map(([k, c, t]) => <th key={k} scope="col" title={t} aria-sort={sort === k ? (k === 'deaths' ? 'ascending' : 'descending') : undefined}>
              <button type="button" className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{c}</button></th>)}
          </tr></thead>
          <tbody>{rows.map((p, i) => (
            <tr key={p.id}>
              <td className="digits">{i + 1}</td>
              <td><span className="sb-side"><Logo team={p.team} /><span><strong>{p.display_name}</strong><br /><span className="muted small">{p.team?.tag ? `${p.team.tag} · ` : ''}{p.role}</span></span></span></td>
              <td>{p.games}</td><td><strong className={sort === 'rating' ? 'amber' : ''}>{p.rating}</strong></td><td>{p.acs}</td><td>{p.kd.toFixed(2)}</td><td>{p.adr}</td>
              <td>{p.kills}</td><td>{p.deaths}</td><td>{p.assists}</td><td>{p.hs}%</td><td>{p.first_kills}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
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
          <section aria-labelledby="standings">
            <Head title={<span id="standings">Team standings</span>} label="standings">
              <ul>
                <li><b>P</b>: maps played</li>
                <li><b>W</b>: wins</li>
                <li><b>L</b>: losses</li>
                <li><b>RD</b>: round difference (rounds won minus rounds lost)</li>
                <li><b>Pts</b>: points. A win is 3, a loss by 3 rounds or fewer (including overtime) is 1, a bigger loss is 0.</li>
              </ul>
              <p>Ties are split by RD, then rounds won, then the result between the two teams. Teams yet to play are listed last.</p>
              <p>When a group finishes, 1st and 2nd go to the upper bracket, 3rd and 4th to the lower bracket, and 5th and 6th are out.</p>
            </Head>
            {[...new Set(data.standings.map(t => t.group || ''))].map(g => {
              const rows = data.standings.filter(t => (t.group || '') === g)
              const final = g && groupFinal(rows)   // no "eliminated" until the group is over
              return <div className="table-wrap" key={g}>
              <table className="sb-table sb-standings">
                {g && <caption>Group {g}</caption>}
                <thead><tr>
                  <th scope="col">#</th><th scope="col">Team</th>
                  {[['P', 'Played'], ['W', 'Wins'], ['L', 'Losses'], ['RD', 'Round difference'], ['Pts', 'Points']]
                    .map(([c, t]) => <th key={c} title={t} scope="col">{c}</th>)}
                </tr></thead>
                <tbody>{rows.map((t, i) => (
                  <tr key={t.id} className={(final ? 'q-' + qualify(i)[2] : '') + (t.p ? '' : ' sb-unranked')} title={final ? qualify(i)[1] : undefined}>
                    <td className="digits">{t.p ? i + 1 : '–'}</td>
                    <td><span className="sb-side"><Logo team={t} />{t.name} <span className="muted">[{t.tag}]</span></span></td>
                    <td>{t.p}</td><td>{t.w}</td><td>{t.l}</td>
                    <td>{t.rd > 0 ? `+${t.rd}` : t.rd}</td><td><strong className="amber">{t.pts}</strong></td>
                  </tr>
                ))}</tbody>
              </table>
              {g && !final && <p className="sb-key mono muted">{rows.reduce((n, t) => n + t.p, 0) / 2} of {rows.length * (rows.length - 1) / 2} matches played. Qualification is set when the group ends.</p>}
              {final && <p className="sb-key mono muted">{[['ub', '1st & 2nd · Upper bracket'], ['lb', '3rd & 4th · Lower bracket'], ['out', '5th & 6th · Out']].map(([k, w]) => <span key={k} className={'q-' + k}>{w}</span>)}</p>}
            </div>
            })}
          </section>

          <section aria-labelledby="leaders">
            <Head title={<span id="leaders">Player leaderboard</span>} label="leaderboard">
              <p>Players are ranked by <b>Rating</b>, with K/D breaking ties. Pick a role to compare like with like, or tap a column to sort by it.</p>
              <ul>
                <li><b>Rating</b>: ACS with about three maps of below-average play mixed in, so one big game can't top the board. The fewer maps someone has played, the more it pulls them down</li>
                <li><b>ACS</b>: average combat score per round</li>
                <li><b>K/D</b>: kills per death</li>
                <li><b>ADR</b>: average damage per round</li>
                <li><b>K / D / A</b>: total kills, deaths, assists</li>
                <li><b>HS%</b>: share of hits that were headshots</li>
                <li><b>FK</b>: rounds where they got the first kill</li>
              </ul>
              <p>Everyone who has played a map is ranked. Roles are the ones players signed up with.</p>
              {data.rating && <RatingMaths r={data.rating} />}
            </Head>
            {data.players.length ? <>
              <div className="sb-leaders" tabIndex="0" role="region" aria-label="Top player in each role">{data.role_leaders.map(l => (
                <article className="sb-leader" key={l.role}>
                  {l.card_url
                    ? <img className="sb-card" src={l.card_url} alt="" loading="lazy" width="268" height="640" />
                    : <div className="sb-card sb-card-ph" aria-hidden="true">{l.team?.logo_url && <img src={l.team.logo_url} alt="" />}</div>}
                  <p className="sb-role">Top {l.role}</p>
                  <div className="sb-leader-name">
                    <h3 className="display">{l.display_name}</h3>
                    {l.team && <p className="sb-team"><Logo team={l.team} />{l.team.name}</p>}
                  </div>
                  <dl className="sb-leader-stats">
                    <div className="main"><dt>Rating</dt><dd>{l.rating}</dd></div>
                    <div><dt>ACS</dt><dd>{l.acs}</dd></div>
                    <div><dt>{l.games === 1 ? 'Map' : 'Maps'}</dt><dd>{l.games}</dd></div>
                  </dl>
                </article>
              ))}</div>
              <Leaderboard players={data.players} />
              <p className="sb-key mono muted">Auction players only, on maps for their own team. Stand-in games don't count.</p>
            </> : <p className="muted">The leaderboard fills in once matches are published.</p>}
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
