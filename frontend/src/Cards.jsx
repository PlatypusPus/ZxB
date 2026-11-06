const ROLE_ICON = { Duelist: '⚔', Initiator: '◎', Controller: '☁', Sentinel: '⛨', Flex: '✦' }

export function PlayerCard({ p, small, big }) {
  return (
    <article className={'pcard' + (small ? ' small' : '') + (big ? ' big' : '')}>
      <div className="pcard-photo">
        {p.photo_url ? <img src={p.photo_url} alt="" /> : <span aria-hidden="true">{(p.display_name || '?')[0]}</span>}
      </div>
      <div className="pcard-body">
        <h3>{p.display_name || 'Your name'}</h3>
        <p className="mono muted">{p.riot_id || 'name#tag'}</p>
        <p className="tags">
          <span className="tag">{p.current_rank || 'Rank'}</span>
          <span className="tag ghost">Peak {p.peak_rank || '—'}</span>
          <span className="tag ghost"><span aria-hidden="true">{ROLE_ICON[p.role]} </span>{p.role || 'Role'}</span>
        </p>
        {!small && <p>{p.playstyle || 'Your playstyle in one line'}</p>}
        {!small && p.quote && <p className="quote">“{p.quote}”</p>}
        {!small && p.base_price != null && <p className="mono amber">BASE {p.base_price} CR</p>}
      </div>
    </article>
  )
}

export function TeamCard({ t }) {
  return (
    <article className="tcard" data-build>
      <header>
        {t.logo_url ? <img src={t.logo_url} alt="" /> : <span className="logo-ph" aria-hidden="true" />}
        <div>
          <h3>{t.name || 'Team name'}</h3>
          <p className="mono amber">[{t.tag || 'TAG'}]</p>
        </div>
      </header>
      {t.leader && <PlayerCard p={t.leader} small />}
      {t.roster?.length > 0 && (
        <ol className="mini-roster">
          {t.roster.map(p => <li key={p.id}><span>{p.display_name}</span><span className="muted">{p.role}</span><span className="mono amber">{p.price}</span></li>)}
        </ol>
      )}
    </article>
  )
}
