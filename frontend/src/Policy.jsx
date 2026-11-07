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
      <li>Message shanks_87 or mystic_mc on Discord with your Riot ID and the Riot ID of the person taking your place.</li>
      <li>They fill in their own player card. Their rank is checked on tracker.gg like everyone else's.</li>
      <li>Once an organiser approves the swap, your paid entry moves to them. Any arrangement between you and them about the fee is between the two of you.</li>
    </ol>
    <p>A captain who swaps out hands over the team: name, tag, logo, credits and any players already bought. Swaps aren't possible once the grand final has started.</p>

    <h2>Questions</h2>
    <p>Ask shanks_87 or mystic_mc on Discord before you pay if anything here is unclear.</p>
  </>
}

function Terms({ fee }) {
  return <>
    <h1 className="display">Terms of service</h1>
    <p className="lede">These terms cover using zxb.shov.in and taking part in tournaments run by ZenithXBeans. By making an account or signing up, you agree to them.</p>

    <h2>Who runs this</h2>
    <p>ZenithXBeans is a community group that runs Valorant tournaments, contactable through shanks_87 or mystic_mc on Discord. Our tournaments aren't affiliated with or endorsed by Riot Games.</p>

    <h2>Your account</h2>
    <ul>
      <li>You can sign in with Google or make an account with your email and a password. Email accounts must be verified before you can register.</li>
      <li>One person, one account, one sign-up per event. Keep your password, your edit link and any captain link private: anyone who has them can act as you.</li>
      <li>Give accurate details. Your name, Riot ID and rank are checked, and false details can get your sign-up rejected.</li>
    </ul>

    <h2>Signing up and paying</h2>
    <ul>
      <li>Auction players and captains pay a ₹{fee} entry fee by UPI. The sub pool is free.</li>
      <li>Organisers verify every payment and rank before approving a sign-up, and decide who becomes a captain. Captain places are limited.</li>
      <li>Fees aren't refunded, but you can swap your place with another player. See the <a href="/refund-policy">refund policy</a>.</li>
    </ul>

    <h2>The auction and matches</h2>
    <ul>
      <li>Captains bid for players live, in the room, with the credits they're given. The organisers record every bid; their record is final.</li>
      <li>Schedules, formats and rules are announced on the site and our Instagram accounts, and can change if needed. We'll tell participants by email when they do.</li>
      <li>Play fair. Cheating, account sharing, smurfing, abuse or harassment of other players can get you removed from the event without a refund.</li>
    </ul>

    <h2>Prizes</h2>
    <p>Any prizes are announced before the event and paid to the winning team as announced. A sub who plays for a winning team receives the prize share of the teammate they replaced, for the matches they played. Organisers settle any disputes about prizes.</p>

    <h2>Your content</h2>
    <p>You let us show your display name, Riot ID, rank, role, playstyle, quote, photo, and your team's name, tag and logo on the site, the auction screen and our social media for the event. Don't upload anything you don't have the right to use or that's offensive; we may remove it.</p>

    <h2>Emails</h2>
    <p>We email you about your account, your sign-up result and the event, including announcements from the organisers. We don't sell your details. See the <a href="/privacy">privacy notice</a>.</p>

    <h2>Limits</h2>
    <p>The site and events are run by volunteers and provided as they are. We aren't responsible for problems caused by Riot Games' servers, your internet, your UPI app or things outside our control. Nothing here limits rights you have under Indian law.</p>

    <h2>Changes</h2>
    <p>We may update these terms. The date below shows the latest version. Big changes are emailed to participants.</p>
  </>
}

function Privacy() {
  return <>
    <h1 className="display">Privacy</h1>
    <p className="lede">What we collect when you sign up, who can see it, and why.</p>

    <h2>What we collect</h2>
    <ul>
      <li><strong>Your sign-in:</strong> your name and email. With Google we also keep your Google account ID and never see your Google password; with an email account your password is stored only as a salted hash. We email your sign-up result to this address.</li>
      <li><strong>Your player card:</strong> display name, Riot ID, current and peak rank, role, playstyle, quote and photo.</li>
      <li><strong>Contact details:</strong> phone number, and your Discord username if you give it.</li>
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
    <p>Ask shanks_87 or mystic_mc on Discord to remove your details. Payment records needed for the event's accounts are kept.</p>
  </>
}

export default function Policy({ kind }) {
  const [info, setInfo] = useState(null)
  useEffect(() => { api('/public').then(setInfo).catch(() => {}) }, [])
  return (
    <>
      <Nav info={info} />
      <main className="wrap narrow policy">
        {kind === 'refund' ? <Refund fee={info?.fee ?? 300} /> : kind === 'terms' ? <Terms fee={info?.fee ?? 300} /> : <Privacy />}
        <p className="muted small">Last updated {UPDATED}.</p>
        <div className="actions">
          <a className="btn" href="/signup">Sign up</a>
          {kind !== 'terms' && <a className="btn ghost" href="/terms">Terms of service</a>}
          {kind !== 'refund' && <a className="btn ghost" href="/refund-policy">Refund policy</a>}
          {kind !== 'privacy' && <a className="btn ghost" href="/privacy">Privacy</a>}
        </div>
      </main>
      <Footer />
    </>
  )
}
