"""Phase 1 gate: sign-up, payment and verification (PRD TC-01..TC-13, TC-31, TC-33, TC-34)."""
import asyncio
import io
import shutil

import pytest
from PIL import Image

from app import core
from app.modules.auth import issue_identity
from app.modules.signup import router as signup_mod

pytestmark = pytest.mark.anyio


def img(fmt="PNG", size=(64, 64), **kw):
    b = io.BytesIO()
    Image.new("RGB", size, (200, 30, 30)).save(b, fmt, **kw)
    return b.getvalue()


_n = iter(range(10**6))


def signed_in(sub, provider="google"):
    """Cookie header for someone who signed in with Google or an email account."""
    return {"cookie": "zxb_id=" + issue_identity(provider, str(sub), f"Person {sub}", email=f"p{sub}@x.in")}


async def signup(c, path="auction", files=None, who=None, headers=None, **kw):
    i = next(_n)
    data = {"display_name": f"Player{i}", "riot_id": f"player{i}#ZXB", "current_rank": "10", "peak_rank": "12",
            "role": "Duelist", "playstyle": "Entry fragger", "discord": f"disc{i}", "phone": "+91 98765 43210",
            "path": path, "utr": f"{100000000000 + i}", "terms": "true"}
    if path == "leader":
        letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        data |= {"team_name": f"Team {i}", "team_tag": "T" + letters[i % 26] + letters[i // 26 % 26]}
    data |= kw
    f = {"screenshot": ("pay.png", img(), "image/png")}
    if path == "leader":
        f["logo"] = ("logo.png", img(), "image/png")
    f |= files or {}
    return await c.post("/api/v1/signup", data=data, files=f, headers=headers or signed_in(i if who is None else who))


async def queue(c, **params):
    rows = (await c.get("/api/v1/admin/queue", params=params, headers=c.admin)).json()
    return {p["riot_id"]: p for p in rows}


async def verify_and_approve(c, row):
    assert (await c.post(f"/api/v1/admin/payments/{row['payment']['id']}/verify", headers=c.admin)).status_code == 200
    return (await c.post(f"/api/v1/admin/players/{row['id']}/approve", headers=c.admin)).json()


def uploads():
    return [p for p in core.UPLOAD_DIR.rglob("*") if p.is_file()]


async def test_valid_signup_and_edit_link(c):  # TC-01
    r = await signup(c, riot_id="Shovn#SJEC")
    assert r.status_code == 201 and r.json()["status"] == "submitted"
    tok = r.json()["edit_token"]
    me = await c.get(f"/api/v1/signup/{tok}")
    assert me.json()["phone"] == "9876543210" and me.json()["editable"]
    bad = await c.patch(f"/api/v1/signup/{tok}", json={"quote": "gg ez", "peak_rank": 9})
    assert bad.status_code == 422 and "peak_rank" in bad.json()["detail"]["errors"]
    ok = await c.patch(f"/api/v1/signup/{tok}", json={"quote": "gg ez"})
    assert ok.json()["quote"] == "gg ez"


async def test_riot_id_case_insensitive(c):  # TC-02
    assert (await signup(c, riot_id="Shovn#SJEC")).status_code == 201
    r = await signup(c, riot_id="shovn#sjec")
    assert r.status_code == 409 and r.json()["detail"]["errors"]["riot_id"] == "Riot ID already registered"


async def test_peak_below_current(c):  # TC-03
    r = await signup(c, current_rank="12", peak_rank="10")
    assert r.status_code == 422 and "peak_rank" in r.json()["detail"]["errors"]


async def test_fee_is_due_until_marked_paid(c):  # the fee is collected after sign-up
    assert (await signup(c)).status_code == 201
    assert (await signup(c)).status_code == 201   # no UTR at sign-up, so nothing to clash
    row = next(iter((await queue(c)).values()))
    assert row["status"] == "submitted" and row["payment"]["status"] == "due" and row["payment"]["screenshot"] == ""
    assert (await c.post(f"/api/v1/admin/players/{row['id']}/approve", headers=c.admin)).status_code == 409
    r = await c.post(f"/api/v1/admin/payments/{row['payment']['id']}/verify", headers=c.admin)
    assert r.json() == {"payment_status": "verified", "status": "verified"}


async def test_terms_required(c):  # TC-05
    r = await signup(c, terms="false")
    assert r.status_code == 422 and "terms" in r.json()["detail"]["errors"]
    assert len(await queue(c)) == 0 and not uploads()


async def test_edit_after_close(c):  # TC-06
    tok = (await signup(c)).json()["edit_token"]
    await c.put("/api/v1/admin/settings", json={"status": "registration_closed"}, headers=c.admin)
    assert (await c.patch(f"/api/v1/signup/{tok}", json={"quote": "x"})).status_code == 403
    assert (await signup(c)).status_code == 403


async def test_leader_cap_race_and_waitlist(c):  # TC-07, TC-08
    for _ in range(11):  # 10 team slots + 1 too many
        assert (await signup(c, path="leader")).status_code == 201
    rows = list((await queue(c)).values())
    for row in rows[:9]:
        assert (await verify_and_approve(c, row))["status"] == "approved"
    for row in rows[9:]:
        await c.post(f"/api/v1/admin/payments/{row['payment']['id']}/verify", headers=c.admin)
    results = await asyncio.gather(*(c.post(f"/api/v1/admin/players/{r['id']}/approve", headers=c.admin)
                                     for r in rows[9:]))
    assert sorted(r.json()["status"] for r in results) == ["approved", "waitlisted"]
    assert (await c.get("/api/v1/public")).json()["leader_slots_left"] == 0
    r = await signup(c, path="leader")  # 12th leader via a direct API call
    assert r.status_code == 201 and r.json()["status"] == "waitlisted"
    # a waitlisted, paid leader can switch to the auction pool
    waiting = {p["id"] for p in (await queue(c, status="waitlisted")).values()}
    wl = next(r for r in rows[9:] if r["id"] in waiting)
    sw = await c.post(f"/api/v1/admin/players/{wl['id']}/make-auction-player", headers=c.admin)
    assert sw.json() | {"emailed": None} == {"status": "verified", "path": "auction", "emailed": None}


async def test_duplicate_team_name_and_tag(c):  # TC-09
    assert (await signup(c, path="leader", team_name="Night Owls", team_tag="NOWL")).status_code == 201
    r = await signup(c, path="leader", team_name="night owls", team_tag="ABCD")
    assert r.status_code == 409 and "team_name" in r.json()["detail"]["errors"]
    r = await signup(c, path="leader", team_name="Day Owls", team_tag="NOWL")
    assert r.status_code == 409 and "team_tag" in r.json()["detail"]["errors"]
    r = await signup(c, path="leader", team_tag="no")
    assert r.status_code == 422 and "team_tag" in r.json()["detail"]["errors"]


async def test_verify_then_reject_is_audited(c):  # TC-10
    await signup(c)
    row = next(iter((await queue(c)).values()))
    pid = row["payment"]["id"]
    assert (await c.post(f"/api/v1/admin/payments/{pid}/verify", headers=c.admin)).json()["status"] == "verified"
    r = await c.post(f"/api/v1/admin/payments/{pid}/reject", json={"reason": "UTR not on statement"}, headers=c.admin)
    assert r.json() == {"payment_status": "rejected", "status": "rejected"}
    actions = [a["action"] for a in (await c.get("/api/v1/admin/audit", headers=c.admin)).json()]
    assert actions[:3] == ["payment.rejected", "payment.verified", "signup.submitted"]


async def test_ledger_totals(c):  # TC-11
    for _ in range(3):
        await signup(c)
    rows = list((await queue(c)).values())
    for row in rows:
        await c.post(f"/api/v1/admin/payments/{row['payment']['id']}/verify", headers=c.admin)
    await c.post(f"/api/v1/admin/players/{rows[2]['id']}/withdraw", headers=c.admin)
    await c.post(f"/api/v1/admin/payments/{rows[2]['payment']['id']}/refund", json={}, headers=c.admin)
    csv = (await c.get("/api/v1/admin/payments.csv", headers=c.admin)).text
    assert "total_verified,600" in csv and "total_refunded,300" in csv


async def test_bad_uploads_refused(c):  # TC-12
    for bad in [("pay.png", b"MZ\x90\x00 not an image", "image/png"),
                ("pay.svg", b'<svg xmlns="http://www.w3.org/2000/svg"/>', "image/svg+xml"),
                ("pay.png", b"\x89PNG" + b"0" * (2 * 1024 * 1024), "image/png")]:
        r = await signup(c, files={"photo": bad})
        assert r.status_code in (413, 422), r.text
    assert len(await queue(c)) == 0 and not uploads()


async def test_exif_stripped(c):  # TC-13
    ex = Image.Exif()
    ex[0x010F] = "SnoopCam"
    ex.get_ifd(0x8825)[2] = (12.0, 58.0, 1.0)
    jpg = img("JPEG", size=(300, 200), exif=ex)
    assert Image.open(io.BytesIO(jpg)).getexif()
    r = await signup(c, files={"photo": ("me.jpg", jpg, "image/jpeg")})
    assert r.status_code == 201
    for f in uploads():
        im = Image.open(f)
        assert im.format == "WEBP" and not im.getexif() and "exif" not in im.info
    assert {f.parent.name for f in uploads()} == {"public"}


async def test_admin_auth_and_privacy(c):  # TC-31, TC-33
    await signup(c, path="leader")
    row = next(iter((await queue(c)).values()))
    await verify_and_approve(c, row)
    await c.post(f"/api/v1/admin/teams/{row['team']['id']}/approve-profile", headers=c.admin)
    assert (await c.get("/api/v1/admin/queue")).status_code == 401
    forged = {"Authorization": "Bearer 9999999999.forged"}
    assert (await c.get("/api/v1/admin/queue", headers=forged)).status_code == 401
    public = "".join([(await c.get(u)).text for u in ("/api/v1/teams", "/api/v1/players", "/api/v1/public")])
    assert "Player" in public  # the leader card is there...
    for secret in ("9876543210", row["discord"]):
        assert secret not in public  # ...but none of the private data


async def test_signup_rate_limit(c):  # TC-34
    signup_mod.SIGNUP_LIMIT = (2, 600)
    assert [(await signup(c)).status_code for _ in range(3)] == [201, 201, 429]


async def test_sub_pool_is_free_and_never_auctioned(c):
    data = {"display_name": "Subby", "riot_id": "subby#ZXB", "current_rank": "10", "peak_rank": "12", "role": "Flex",
            "playstyle": "Fills any role", "discord": "subby", "phone": "+91 98765 43210", "path": "sub", "terms": "true"}
    r = await c.post("/api/v1/signup", data=data, headers=signed_in("subby"))   # no UTR, no screenshot
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "verified"
    row = (await queue(c))["subby#ZXB"]
    assert row["payment"]["amount"] == 0 and row["payment"]["status"] == "verified"
    me = (await c.get(f"/api/v1/signup/{r.json()['edit_token']}")).json()
    assert me["editable"] is True
    ok = await c.post(f"/api/v1/admin/players/{row['id']}/approve", headers=c.admin)   # rank check still needed
    assert ok.json()["status"] == "approved"
    assert all(p["riot_id"] != "subby#ZXB" for p in (await c.get("/api/v1/players")).json())


async def test_signup_needs_login_and_one_per_account(c):
    data = {"display_name": "NoLogin", "riot_id": "nologin#ZXB", "current_rank": "10", "peak_rank": "12", "role": "Flex",
            "playstyle": "Anything", "discord": "x", "phone": "+91 98765 43210", "path": "sub", "terms": "true"}
    r = await c.post("/api/v1/signup", data=data)
    assert r.status_code == 401 and "Sign in" in r.json()["detail"]
    assert (await c.post("/api/v1/signup", data=data, headers={"cookie": "zxb_id=forged.value"})).status_code == 401
    assert (await c.post("/api/v1/signup", data=data | {"discord": ""}, headers=signed_in("acct1"))).status_code == 201
    row = (await queue(c))["nologin#ZXB"]
    assert row["discord"] == "" and row["signed_in_with"] == "Google pacct1@x.in"
    again = await c.post("/api/v1/signup", data=data | {"riot_id": "other#ZXB"}, headers=signed_in("acct1"))
    assert again.status_code == 409 and "already signed up" in again.json()["detail"]["errors"]["auth"]
    me = (await c.get("/api/v1/auth/me", headers=signed_in("acct1"))).json()
    assert me["user"]["provider"] == "google" and "discord" not in me["providers"]


async def test_email_account_register_login_and_result_email(c, monkeypatch):
    from app.modules.admin import router as admin_mod
    sent = []
    monkeypatch.setattr(admin_mod, "send_mail", lambda to, subject, body, html=None: sent.append((to, subject, body)) or True)
    reg = "/api/v1/auth/register"
    bad = (await c.post(reg, json={"name": "A", "email": "nope", "password": "short"})).json()["detail"]["errors"]
    assert set(bad) == {"name", "email", "password"}
    from app.modules import auth as auth_mod
    links = []
    monkeypatch.setattr(auth_mod, "send_mail", lambda to, subject, text, html=None: links.append(text.split("\n\n")[2]) or True)
    r = await c.post(reg, json={"name": "Cap Tain", "email": "Cap@Example.com", "password": "hunter2hunter2"})
    assert r.status_code == 201 and "zxb_id" in r.cookies and r.json()["emailed"]
    unverified = {"cookie": "zxb_id=" + r.cookies["zxb_id"]}
    assert (await c.get("/api/v1/auth/me", headers=unverified)).json()["user"]["verified"] is False
    assert (await signup(c, "sub", headers=unverified)).status_code == 403
    await signup(c, "sub", riot_id="follower#ZXB", follows="skipped:2")
    await signup(c, "sub", riot_id="junk#ZXB", follows="<script>")
    rows = await queue(c)
    assert rows["follower#ZXB"]["follows"] == "skipped:2" and rows["junk#ZXB"]["follows"] is None
    assert (await c.get("/api/v1/auth/verify?t=forged.sig")).headers["location"] == "/verified?error=1"
    v = await c.get(links[0].replace("http://127.0.0.1:5180", ""))
    assert v.status_code == 303 and v.headers["location"] == "/verified"
    assert (await c.post(reg, json={"name": "Cap", "email": "cap@example.com", "password": "another-pass"})).status_code == 409
    assert (await c.post("/api/v1/auth/login", json={"email": "cap@example.com", "password": "wrong-pass"})).status_code == 401
    r = await c.post("/api/v1/auth/login", json={"email": "CAP@example.com", "password": "hunter2hunter2"})
    cookie = {"cookie": "zxb_id=" + r.cookies["zxb_id"]}
    me = (await c.get("/api/v1/auth/me", headers=cookie)).json()["user"]
    assert me["email"] == "cap@example.com" and me["verified"] is True
    await signup(c, "leader", riot_id="captain#ZXB", headers=cookie)
    row = (await queue(c))["captain#ZXB"]
    out = await verify_and_approve(c, row)
    assert out["emailed"] is True
    to, subject, body = sent[-1]
    assert to == "cap@example.com" and "captain" in subject and f"/leader/{out['leader_code']}" in body


async def test_profile_by_account_replaces_edit_link(c):
    assert (await c.get("/api/v1/me/signup")).status_code == 401
    assert (await c.get("/api/v1/me/signup", headers=signed_in("nobody"))).status_code == 404
    await signup(c, "auction", who="prof", riot_id="prof#ZXB")
    me = (await c.get("/api/v1/me/signup", headers=signed_in("prof"))).json()
    assert me["riot_id"] == "prof#ZXB" and me["editable"] is True and "edit_token" not in me
    r = await c.patch("/api/v1/me/signup", json={"playstyle": "Lurker"}, headers=signed_in("prof"))
    assert r.status_code == 200 and r.json()["playstyle"] == "Lurker"
    assert (await c.patch("/api/v1/me/signup", json={"riot_id": "bad"}, headers=signed_in("prof"))).status_code == 422
    # someone else's account can't see it
    assert (await c.get("/api/v1/me/signup", headers=signed_in("prof", "email"))).status_code == 404


async def test_admin_uploads_and_removes_upi_qr(c):
    r = await c.put("/api/v1/admin/settings/upi-qr", files={"qr": ("qr.png", img(), "image/png")})
    assert r.status_code == 401
    r = await c.put("/api/v1/admin/settings/upi-qr", files={"qr": ("qr.txt", b"nope", "text/plain")}, headers=c.admin)
    assert r.status_code == 422
    r = await c.put("/api/v1/admin/settings/upi-qr", files={"qr": ("qr.png", img(), "image/png")}, headers=c.admin)
    url = r.json()["upi_qr_url"]
    assert (await c.get("/api/v1/public")).json()["upi_qr_url"] == url
    assert (await c.get(url)).status_code == 200
    assert (await c.delete("/api/v1/admin/settings/upi-qr", headers=c.admin)).json()["upi_qr_url"] is None
    assert (await c.get("/api/v1/public")).json()["upi_qr_url"] is None
    assert (await c.get(url)).status_code == 404



async def test_announcement_reaches_each_live_participant_once(c, monkeypatch):
    from app.modules.admin import router as admin_mod
    batches = []
    monkeypatch.setattr(admin_mod, "send_many", lambda msgs: batches.append(msgs) or len(msgs))
    await signup(c, "sub", who="same")
    await signup(c, "auction", who="other")
    body = {"subject": "Auction moved", "message": "The auction now starts at 7 pm.", "audience": "all"}
    monkeypatch.delenv("SMTP_HOST", raising=False)
    assert (await c.post("/api/v1/admin/announce", json=body, headers=c.admin)).status_code == 409
    monkeypatch.setenv("SMTP_HOST", "smtp.test")
    assert (await c.get("/api/v1/admin/announce/recipients?audience=subs", headers=c.admin)).json()["count"] == 1
    r = await c.post("/api/v1/admin/announce", json=body, headers=c.admin)
    assert r.json() == {"queued": 2}
    assert sorted(m[0] for m in batches[0]) == ["pother@x.in", "psame@x.in"] and "7 pm" in batches[0][0][2]


async def test_admin_delete_removes_signup_completely(c):
    from app.core import Session
    from sqlalchemy import select
    from app.models import Payment, Player, Team
    r = await signup(c, path="leader", riot_id="Gone#DEL")
    pid = r.json()["player_id"] if "player_id" in r.json() else None
    rows = (await c.get("/api/v1/admin/queue", headers=c.admin)).json()
    pid = pid or next(x["id"] for x in rows if x["riot_id"] == "Gone#DEL")
    assert (await c.post(f"/api/v1/admin/players/{pid}/delete", headers=c.admin)).json() == {"deleted": pid}
    async with Session() as db:
        assert await db.get(Player, pid) is None
        assert not (await db.scalars(select(Payment).where(Payment.player_id == pid))).first()
        assert not (await db.scalars(select(Team).where(Team.leader_player_id == pid))).first()
    assert (await c.post(f"/api/v1/admin/players/{pid}/delete", headers=c.admin)).status_code == 404
    assert (await c.post(f"/api/v1/admin/players/{pid}/delete")).status_code == 401


async def test_rejected_captain_becomes_auction_player(c):
    from sqlalchemy import select
    from app.core import Session
    from app.models import Team
    await signup(c, path="leader")
    row = next(iter((await queue(c)).values()))
    r = (await c.post(f"/api/v1/admin/players/{row['id']}/reject", json={"reason": "Too many captains"}, headers=c.admin)).json()
    assert r["path"] == "auction" and r["status"] == "submitted"
    async with Session() as db:
        assert not (await db.scalars(select(Team).where(Team.leader_player_id == row["id"]))).first()
    # Rejecting again, now as a player, rejects for real.
    r = (await c.post(f"/api/v1/admin/players/{row['id']}/reject", json={"reason": "Rank mismatch"}, headers=c.admin)).json()
    assert r["status"] == "rejected"


async def test_resend_waits_a_minute(c, monkeypatch):
    from app.modules import auth as auth_mod
    monkeypatch.setattr(auth_mod, "send_mail", lambda *a, **k: True)
    r = await c.post("/api/v1/auth/register", json={"name": "Slow Poke", "email": "slow@example.com", "password": "hunter2hunter2"})
    me = {"cookie": "zxb_id=" + r.cookies["zxb_id"]}
    assert (await c.post("/api/v1/auth/resend", headers=me)).status_code == 429   # the sign-up email was just sent


async def test_rate_limits_wrong_captain_codes_and_api_floods(c, monkeypatch):
    bad = {"Authorization": "Leader not-a-real-code"}
    codes = [(await c.get("/api/v1/leader/me", headers=bad)).status_code for _ in range(21)]
    assert codes[:20] == [401] * 20 and codes[20] == 429
    from app import main
    monkeypatch.setattr(main, "API_PER_MINUTE", 5)
    core._hits.clear()
    codes = [(await c.get("/api/v1/public")).status_code for _ in range(6)]
    assert codes[:5] == [200] * 5 and codes[5] == 429
    assert (await c.get("/api/v1/health")).status_code == 200   # never limited, for the uptime check
