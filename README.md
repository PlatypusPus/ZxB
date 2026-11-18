# ZenithXBeans Valorant Auction

Community tournament site + the first event, a live Valorant player auction.

- Phase 1: sign-up (profile, leader/player path, ₹300 UPI proof), status link, admin verification, team approvals, payments ledger
- Phase 2: auction settings (Admin → Settings), reserve rule, pre-start checks, settings lock
- Phase 3: auction engine (lots, server timer, row-locked bids, sold/unsold, pause, undo, round 2, final assignment, proxy bids)
- Phase 4: live screens over one WebSocket: `/projector` (big screen), `/leader/<code>` (phones), Admin → Live

## Run locally

Needs Docker running, Node, and [uv](https://docs.astral.sh/uv/).

```sh
npm run dev         # Postgres + API (:8010) + site (:5180) together; Ctrl+C stops both
npm test            # quick: backend tests (no bot simulations) + frontend build, ~25 s
npm run test:full   # everything, including three full 52-player bot auctions, ~2 min
```

First run creates `.env` with a dev admin login: `admin@zenithxbeans.local` / `devadmin`.
For a real password: `cd backend && uv run --python 3.12 python -m app.main hash 'your-password'` and put it in `.env`.

`.env` (never commit): `SECRET_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`.
Set the UPI ID, upload the UPI QR image, and set dates and status in Admin → Settings.

## Dress rehearsal with dummy data

```sh
docker compose exec db psql -U postgres -c "create database zxb_demo"
cd backend
export DATABASE_URL=postgresql+asyncpg://postgres:devpassword@127.0.0.1:5440/zxb_demo UPLOAD_DIR=uploads-demo
uv run --python 3.12 python -m scripts.seed_demo            # 8 teams, 24 players; leader links /leader/demo-leader-1..8
uv run --python 3.12 --env-file ../.env uvicorn app.main:app --port 8010
```
Then Admin → Live → Start auction, open `/projector` on the TV and a leader link on a phone.
Auctioneer keys on the Live tab: N next, S sold, U unsold, P pause/resume.

Never run `vite dev` on the VPS (CVE-2026-39363). Production serves `frontend/dist` and `uploads/public`; `uploads/private` (payment screenshots) is only served through the admin API.

## Sign-in for registration (Google or email)

Registering requires an account, one live sign-up per account: either Google, or an email and password. Email
accounts must click a verification link before they can register. Either way the email is where results go.

- **Google:** console.cloud.google.com, APIs & Services, Credentials, Create OAuth client ID (Web application).
  Add the redirect `https://zxb.shov.in/api/v1/auth/google/callback`. Configure the consent screen and publish it.
- **Email (SMTP):** set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `SMTP_FROM` (see `.env.example`).
  With Gmail, turn on 2-step verification and create an app password. Without SMTP, email accounts can't verify,
  approvals send no email, and the admin Email tab is disabled.

After editing the server `.env`, run `pm2 restart zxb --update-env`. For local testing, `AUTH_DEV=1` adds a fake
"Dev login" button and prints verification links to the server log. Never set it in production.
