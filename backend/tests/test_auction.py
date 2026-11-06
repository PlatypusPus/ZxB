"""Phases 2-4 gates: config, reserve rule, auction engine, realtime (PRD TC-14..TC-27, TC-31, TC-32)."""
import asyncio
import random

import pytest
from starlette.testclient import TestClient

from app import core
from app.core import sha256, utcnow
from app.main import app
from app.models import AuditLog, Lot, Payment, Player, Team
from app.modules.auction import service
from app.tournament import VALORANT, DEFAULT_SETTINGS, load
from sqlalchemy import select

pytestmark = pytest.mark.anyio
ROLES = VALORANT["roles"]
A = "/api/v1/admin/auction/"


async def seed(n_teams=8, n_players=52, tiers=None, rng=None):
    rng = rng or random.Random(1)
    async with core.Session() as db:
        for i in range(n_teams + n_players):
            leader = i < n_teams
            tier = (tiers[i - n_teams] if tiers and not leader else rng.randint(1, 25))
            p = Player(display_name=f"P{i}", riot_id=f"p{i}#T", riot_id_key=f"p{i}#t", current_rank_tier=tier,
                       peak_rank_tier=tier, role=ROLES[i % 5], playstyle="x", discord="d", phone="9000000000",
                       path="leader" if leader else "auction", status="approved", edit_token_hash=sha256(f"e{i}"),
                       terms_version="v1", terms_accepted_at=utcnow())
            db.add(p)
            await db.flush()
            db.add(Payment(player_id=p.id, amount=300, utr=f"{i:012d}", screenshot="x.webp", status="verified"))
            if leader:
                db.add(Team(leader_player_id=p.id, name=f"Team {i}", name_key=f"team {i}", tag="T" + chr(65 + i) * 2,
                            logo="l.webp", profile_status="approved", access_code_hash=sha256(f"code{i}")))
        await db.commit()


def lead(i):  # team ids are 1..n in a fresh database
    return {"Authorization": f"Leader code{i - 1}"}


async def configure(c, **s):
    r = await c.put("/api/v1/admin/settings", json={"settings": s}, headers=c.admin)
    assert r.status_code == 200, r.text


async def snap(c):
    return (await c.get("/api/v1/auction/snapshot")).json()


async def bid(c, team, amount=None, proxy=False):
    s = await snap(c)
    amount = amount if amount is not None else s["lot"]["next_amount"]
    core._hits.clear()   # tests aren't about the 5/s bid limit
    if proxy:
        return await c.post(A + "proxy-bid", json={"team_id": team, "lot_id": s["lot"]["id"], "amount": amount}, headers=c.admin)
    return await c.post("/api/v1/leader/bid", json={"lot_id": s["lot"]["id"], "amount": amount}, headers=lead(team))


def credits(s, team):
    return next(t for t in s["teams"] if t["id"] == team)["credits_left"]


# ---------- Phase 2: pure rules

def test_reserve_rule_property():  # TC-15 (stdlib random instead of Hypothesis: same idea, no new dependency)
    rng = random.Random(7)
    for _ in range(20_000):
        min_p, lowest = rng.randint(1, 6), rng.choice([0, 5, 10, 20, 50, 110, 220])
        bought = rng.randint(0, min_p + 2)
        needed = max(0, min_p - bought)
        remaining = rng.randint(max(0, needed * lowest), 3000)  # a team that followed the rule so far
        mb = service.max_bid(remaining, bought, min_p, lowest)
        if mb < 0:
            continue
        after = remaining - mb  # spend the maximum on this lot...
        assert after >= max(0, needed - 1) * lowest  # ...and the rest of the minimum roster is still affordable
        assert mb == remaining or after == max(0, needed - 1) * lowest  # and it isn't stricter than it needs to be


def test_base_price_every_tier():  # TC-14
    s = dict(DEFAULT_SETTINGS)
    expected = [10] * 3 + [20] * 3 + [30] * 3 + [50] * 3 + [70] * 3 + [100] * 3 + [130] * 3 + [170] * 3 + [220]
    for tier in range(1, 26):
        p = Player(current_rank_tier=tier)
        assert service.base_price(p, s, VALORANT, 1) == expected[tier - 1]
        assert service.base_price(p, s, VALORANT, 2) == expected[tier - 1] // 2
        assert service.base_price(p, s, VALORANT, 3) == 0
    assert service.base_price(Player(current_rank_tier=25), s | {"base_price_mode": "flat"}, VALORANT, 1) == 50
    assert service.increment(190, s) == 10 and service.increment(200, s) == 25


# ---------- Phase 3: engine

async def test_start_blocked_and_settings_lock(c):  # TC-16, TC-17
    await seed()
    r = await c.post(A + "start", headers=c.admin)
    assert r.status_code == 409 and "maximum players" in r.json()["detail"]
    await configure(c, max_players=5)
    r = await c.post(A + "start", headers=c.admin)
    assert r.status_code == 409 and "at least 7" in r.json()["detail"]
    await configure(c, max_players=7)
    assert (await c.post(A + "start", headers=c.admin)).status_code == 200
    r = await c.put("/api/v1/admin/settings", json={"settings": {"credits_per_team": 5000}}, headers=c.admin)
    assert r.status_code == 409


async def small(c, n_teams=2, tiers=(1, 1, 1, 1), **s):
    await seed(n_teams, len(tiers), tiers=list(tiers))
    await configure(c, **({"credits_per_team": 100, "min_players": 2, "max_players": 2, "bid_timer": 0} | s))
    assert (await c.post(A + "start", headers=c.admin)).status_code == 200


async def test_bid_rules(c):  # TC-18, TC-19, TC-21
    await small(c)
    await c.post(A + "next", headers=c.admin)
    # reserve: 100 credits, 2 needed, cheapest left 10 -> max bid 90
    assert {t["max_bid"] for t in (await snap(c))["teams"]} == {90}
    for amount in range(10, 100, 10):
        r = await bid(c, 1 if amount % 20 else 2, amount)
        assert r.status_code == 200, (amount, r.text)
    assert (await bid(c, 1)).json()["detail"] == "You're the highest bidder"     # TC-21 (team 1 bid exactly 90: TC-18)
    r = await bid(c, 2, 100)
    assert r.status_code == 409 and r.json()["detail"] == "Over max bid"        # TC-19
    assert (await bid(c, 2, 50)).json()["detail"].startswith("The price moved")  # stale amount
    s = (await c.post(A + "sold", headers=c.admin)).json()
    assert credits(s, 1) == 10 and credits(s, 2) == 100


async def test_concurrent_bids_one_winner(c):  # TC-20
    await seed()
    await configure(c, max_players=7, bid_timer=0)
    await c.post(A + "start", headers=c.admin)
    await c.post(A + "next", headers=c.admin)
    s = await snap(c)
    lot, amount = s["lot"]["id"], s["lot"]["next_amount"]
    reqs = [c.post("/api/v1/leader/bid", json={"lot_id": lot, "amount": amount}, headers=lead(t)) for t in range(1, 9) for _ in range(5)]
    reqs += [c.post(A + "proxy-bid", json={"team_id": t, "lot_id": lot, "amount": amount}, headers=c.admin)
             for t in (1, 2, 3, 4, 5, 6, 7, 8, 1, 2)]   # 40 leader taps + 10 proxy bids
    codes = [r.status_code for r in await asyncio.gather(*reqs)]
    assert len(codes) == 50 and codes.count(200) == 1 and set(codes) <= {200, 409}


async def test_timer_expiry(c):  # TC-22
    await small(c, bid_timer=1, bid_reset=1)
    await c.post(A + "next", headers=c.admin)
    assert (await bid(c, 1)).status_code == 200
    await asyncio.sleep(1.1)
    r = await bid(c, 2)
    assert r.status_code == 409 and r.json()["detail"] == "Time is up"
    async with core.Session() as db:
        lot = await service.close_lot(db, "timer", only_if_expired=True)
    assert lot.status == "sold" and credits(await snap(c), 1) == 90


async def test_undo_after_next_lot_opened(c):  # TC-23
    await small(c)
    await c.post(A + "next", headers=c.admin)
    sold_player = (await snap(c))["lot"]["player"]["id"]
    await bid(c, 1)
    await c.post(A + "sold", headers=c.admin)
    await c.post(A + "next", headers=c.admin)
    open_before = (await snap(c))["lot"]["id"]
    s = (await c.post(A + "undo", headers=c.admin)).json()
    assert credits(s, 1) == 100 and s["lot"]["id"] == open_before
    async with core.Session() as db:
        back = await db.scalar(select(Lot).where(Lot.player_id == sold_player, Lot.status == "queued"))
    assert back is not None


async def test_round_two_half_price(c):  # TC-24
    await small(c, tiers=(13, 13, 13, 13))  # Platinum, base 70
    for _ in range(4):
        await c.post(A + "next", headers=c.admin)
        await c.post(A + "unsold", headers=c.admin)
    s = (await c.post(A + "next", headers=c.admin)).json()
    assert s["round"] == 2 and s["lot"]["base_price"] == 35


async def test_restart_mid_lot(c):  # TC-26
    await small(c, bid_timer=20)
    await c.post(A + "next", headers=c.admin)
    await bid(c, 1)
    async with core.Session() as db:
        await service.recover_after_restart(db)
    s = await snap(c)
    assert s["status"] == "auction_paused" and s["lot"]["highest"] == {"amount": 10, "team_id": 1}
    assert s["lot"]["timer_end"] is None and s["lot"]["paused_remaining"] >= 10
    assert (await bid(c, 2)).json()["detail"] == "The auction is paused"
    s = (await c.post(A + "resume", headers=c.admin)).json()
    assert s["lot"]["timer_end"] > s["server_now"]


@pytest.mark.slow
@pytest.mark.parametrize("seed_n", [3, 11, 29])
async def test_simulated_auction(c, seed_n):  # TC-25, TC-27: 8 bots, 52 players, random bidding
    rng = random.Random(seed_n)
    await seed(rng=rng)
    await configure(c, max_players=7, bid_timer=0)
    assert (await c.post(A + "start", headers=c.admin)).status_code == 200
    while (await c.post(A + "next", headers=c.admin)).status_code == 200:
        for _ in range(rng.randint(0, 8)):
            s = await snap(c)
            free = [t["id"] for t in s["teams"] if not t["blocked"]]
            if not free:
                break
            r = await bid(c, rng.choice(free), proxy=rng.random() < 0.2)
            assert r.status_code == 200, r.text
        result = (await c.post(A + ("unsold" if rng.random() < 0.1 else "sold"), headers=c.admin)).json()
        assert all(t["credits_left"] >= 0 for t in result["teams"])
        if rng.random() < 0.05:
            await c.post(A + "undo", headers=c.admin)
    r = await c.post(A + "assign-leftovers", headers=c.admin)
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["status"] == "completed" and s["pool"]["placed"] == 52
    for t in s["teams"]:
        assert 4 <= t["bought"] <= 7
        assert t["credits_left"] == 1000 - sum(p["price"] for p in t["roster"]) >= 0
    assert len((await c.get("/api/v1/results")).json()) == 8
    async with core.Session() as db:
        proxies = await db.scalars(select(AuditLog).where(AuditLog.action == "bid.accepted", AuditLog.actor == "admin_proxy"))
        assert all(a.payload["amount"] > 0 for a in proxies)


# ---------- auth + realtime

async def test_leader_auth_and_revoke(c):  # TC-31, TC-32
    await small(c)
    assert (await c.get("/api/v1/admin/queue", headers=lead(1))).status_code == 401
    assert (await c.get("/api/v1/leader/me", headers=lead(1))).json()["team_id"] == 1
    new = (await c.post("/api/v1/admin/teams/1/new-code", headers=c.admin)).json()["leader_code"]
    assert (await c.get("/api/v1/leader/me", headers=lead(1))).status_code == 401
    assert (await c.get("/api/v1/leader/me", headers={"Authorization": f"Leader {new}"})).status_code == 200


async def test_leader_edits_locked_after_start(c):
    await seed(2, 4, tiers=[1, 1, 1, 1])
    r = await c.patch("/api/v1/leader/team", data={"name": "Renamed", "tag": "RNM"}, headers=lead(1))
    assert r.json()["profile_status"] == "pending"   # edits go back through approval
    await c.post("/api/v1/admin/teams/1/approve-profile", headers=c.admin)
    await configure(c, credits_per_team=100, min_players=2, max_players=2)
    await c.post(A + "start", headers=c.admin)
    assert (await c.patch("/api/v1/leader/team", data={"name": "Again"}, headers=lead(1))).status_code == 409


async def test_websocket_hello_snapshot(c):  # TC-28 basis: a reconnecting client gets the full state in one message
    await small(c)
    await core.engine.dispose()   # TestClient runs the app on its own loop; start it with a clean pool
    with TestClient(app).websocket_connect("/api/v1/ws") as ws:   # no lifespan: we don't want restart recovery here
        msg = ws.receive_json()
    assert msg["event"] == "hello" and msg["snapshot"]["status"] == "auction_live" and "server_now" in msg["snapshot"]
