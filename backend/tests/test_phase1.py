"""Phase 1 gate: sign-up, payment and verification (PRD TC-01..TC-13, TC-31, TC-33, TC-34)."""
import asyncio
import io
import shutil

import pytest
from PIL import Image

from app import core
from app.modules.signup import router as signup_mod

pytestmark = pytest.mark.anyio


def img(fmt="PNG", size=(64, 64), **kw):
    b = io.BytesIO()
    Image.new("RGB", size, (200, 30, 30)).save(b, fmt, **kw)
    return b.getvalue()


_n = iter(range(10**6))


async def signup(c, path="auction", files=None, **kw):
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
    return await c.post("/api/v1/signup", data=data, files=f)


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


async def test_duplicate_utr(c):  # TC-04
    assert (await signup(c, utr="123456789012")).status_code == 201
    r = await signup(c, utr="1234 5678 9012")
    assert r.status_code == 409 and "utr" in r.json()["detail"]["errors"]
    assert len(await queue(c)) == 1


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
    for _ in range(9):
        assert (await signup(c, path="leader")).status_code == 201
    rows = list((await queue(c)).values())
    for row in rows[:7]:
        assert (await verify_and_approve(c, row))["status"] == "approved"
    for row in rows[7:]:
        await c.post(f"/api/v1/admin/payments/{row['payment']['id']}/verify", headers=c.admin)
    results = await asyncio.gather(*(c.post(f"/api/v1/admin/players/{r['id']}/approve", headers=c.admin)
                                     for r in rows[7:]))
    assert sorted(r.json()["status"] for r in results) == ["approved", "waitlisted"]
    assert (await c.get("/api/v1/public")).json()["leader_slots_left"] == 0
    r = await signup(c, path="leader")  # 10th leader via a direct API call
    assert r.status_code == 201 and r.json()["status"] == "waitlisted"
    # a waitlisted, paid leader can switch to the auction pool
    waiting = {p["id"] for p in (await queue(c, status="waitlisted")).values()}
    wl = next(r for r in rows[7:] if r["id"] in waiting)
    sw = await c.post(f"/api/v1/admin/players/{wl['id']}/make-auction-player", headers=c.admin)
    assert sw.json() == {"status": "verified", "path": "auction"}


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
        r = await signup(c, files={"screenshot": bad})
        assert r.status_code in (413, 422), r.text
    assert len(await queue(c)) == 0 and not uploads()


async def test_exif_stripped(c):  # TC-13
    ex = Image.Exif()
    ex[0x010F] = "SnoopCam"
    ex.get_ifd(0x8825)[2] = (12.0, 58.0, 1.0)
    jpg = img("JPEG", size=(300, 200), exif=ex)
    assert Image.open(io.BytesIO(jpg)).getexif()
    r = await signup(c, files={"screenshot": ("pay.jpg", jpg, "image/jpeg"), "photo": ("me.jpg", jpg, "image/jpeg")})
    assert r.status_code == 201
    for f in uploads():
        im = Image.open(f)
        assert im.format == "WEBP" and not im.getexif() and "exif" not in im.info
    assert {f.parent.name for f in uploads()} == {"private", "public"}


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
    for secret in ("9876543210", row["payment"]["utr"], row["payment"]["screenshot"], row["discord"]):
        assert secret not in public  # ...but none of the private data
    shot = await c.get(f"/api/v1/admin/files/{row['payment']['screenshot']}", headers=c.admin)
    assert shot.status_code == 200 and (await c.get(f"/media/{row['payment']['screenshot']}")).status_code == 404


async def test_signup_rate_limit(c):  # TC-34
    signup_mod.SIGNUP_LIMIT = (2, 600)
    assert [(await signup(c)).status_code for _ in range(3)] == [201, 201, 429]
