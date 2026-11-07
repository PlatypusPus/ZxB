import { useEffect, useState } from 'react'
import { api } from './api.js'
import { Footer, Nav } from './Layout.jsx'

const UPDATED = '7 November 2026'

function Refund({ fee }) {
  return <>
    <h1 className="display">Refund policy</h1>
    <p className="lede">Entry fees are not refunded. If you can't play, you can hand your place to someone else.</p>

    <h2>No refunds</h2>
    <p>Once you have signed up and paid the ₹{fee} entry, the fee is not refunded. This covers withdrawing, missing matches, being unsold in the auction, your team being knocked out, and sign-ups rejected because the rank or details didn't check out.</p>
    <p>The sub pool is free, so there is nothing to refund.</p>

    <h2>Swap your place instead</h2>
    <p>If you can't play, you can swap yourself out for someone else:</p>
    <ol>
      <li>Message the organisers on the ZenithXBeans Discord with your Riot ID and the Riot ID of the person taking your place.</li>
      <li>They fill in their own player card. Their rank is checked on tracker.gg like everyone else's.</li>
      <li>Once an organiser approves the swap, your paid entry moves to them. Any arrangement between you and them about the fee is between the two of you.</li>
    </ol>
    <p>A captain who swaps out hands over the team: name, tag, logo, credits and any players already bought. Swaps aren't possible once the grand final has started.</p>

    <h2>Questions</h2>
    <p>Ask an organiser on the ZenithXBeans Discord before you pay if anything here is unclear.</p>
  </>
}

function Privacy() {
  return <>
    <h1 className="display">Privacy</h1>
    <p className="lede">What we collect when you sign up, who can see it, and why.</p>

    <h2>What we collect</h2>
    <ul>
      <li><strong>Your sign-in:</strong> when you sign in with Discord or Google, we keep your account ID and name, your Discord username, and for Google your email. We never see your password.</li>
      <li><strong>Your player card:</strong> display name, Riot ID, current and peak rank, role, playstyle, quote and photo.</li>
      <li><strong>Contact details:</strong> Discord username and phone number.</li>
      <li><strong>Team leaders:</strong> team name, tag and logo.</li>
      <li><strong>Paid entries:</strong> the 12-digit UTR and a screenshot of the payment.</li>
    </ul>

    <h2>What is public</h2>
    <p>Your player card is shown on the site, on the auction projector and on the stream: display name, Riot ID, ranks, role, playstyle, quote and photo. So are team names, tags and logos once approved, and who bought whom for how much.</p>

    <h2>What stays private</h2>
    <p>Your phone number, Discord username, sign-in email, UTR and payment screenshot are only visible to the organisers. They are never shown on public pages.</p>

    <h2>Why we use it</h2>
    <ul>
      <li>To check your payment against the bank statement.</li>
      <li>To check your rank on tracker.gg.</li>
      <li>To contact you about the auction and your matches. Captains get their team link this way.</li>
    </ul>
    <p>We don't sell your details or share them with anyone outside the organising team.</p>

    <h2>Records we keep</h2>
    <p>Payment decisions, bids and sales are kept in an audit log, so the auction and the money can be checked later.</p>

    <h2>Removing your details</h2>
    <p>Ask an organiser on the ZenithXBeans Discord to remove your details. Payment records needed for the event's accounts are kept.</p>
  </>
}

export default function Policy({ kind }) {
  const [info, setInfo] = useState(null)
  useEffect(() => { api('/public').then(setInfo).catch(() => {}) }, [])
  return (
    <>
      <Nav info={info} />
      <main className="wrap narrow policy">
        {kind === 'refund' ? <Refund fee={info?.fee ?? 300} /> : <Privacy />}
        <p className="muted small">Last updated {UPDATED}.</p>
        <div className="actions">
          <a className="btn" href="/signup">Sign up</a>
          <a className="btn ghost" href={kind === 'refund' ? '/privacy' : '/refund-policy'}>{kind === 'refund' ? 'Privacy' : 'Refund policy'}</a>
        </div>
      </main>
      <Footer />
    </>
  )
}
