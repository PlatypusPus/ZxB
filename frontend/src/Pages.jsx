// Small standalone screens: email verified, and page not found.
export function Verified() {
  const failed = new URLSearchParams(location.search).has('error')
  return (
    <main className="wrap narrow signin">
      <p className="mono amber">{failed ? 'LINK DIDN’T WORK' : 'EMAIL VERIFIED'}</p>
      <h1 className="display">{failed ? 'Link expired' : 'You’re verified'}</h1>
      <p className="lede">{failed
        ? 'This verification link has expired or isn’t valid. Log in on the sign-up page to get a new one.'
        : 'Your email is confirmed. Your selection result and event announcements will arrive there.'}</p>
      <div className="actions"><a className="btn" href="/signup">{failed ? 'Get a new link' : 'Continue sign-up'}</a>
        <a className="btn ghost" href="/">Home</a></div>
    </main>
  )
}

export function NotFound() {
  return (
    <main className="wrap narrow signin notfound">
      <p className="mono amber">ERROR 404</p>
      <h1 className="display">Page not found</h1>
      <p className="lede">This page doesn’t exist, or the link has a typo.</p>
      <div className="actions"><a className="btn" href="/">Go home</a><a className="btn ghost" href="/draft">Valorant Auction</a></div>
    </main>
  )
}
