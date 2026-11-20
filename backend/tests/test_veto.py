"""Map veto: only the two signed-in captains move, in turn; bans run until one map is left, then the other team picks a side."""
import pytest

from app import core
from app.models import Player
from app.modules.auth import COOKIE, issue_identity
from tests.test_auction import seed

pytestmark = pytest.mark.anyio
POOL = ["Ascent", "Bind", "Haven", "Lotus"]


async def sign_in(c, player_id):
    """Link a captain to an account and return the cookie for it."""
    async with core.Session() as db:
        p = await db.get(Player, player_id)
        p.auth_provider, p.auth_sub = "google", f"g{player_id}"
        await db.commit()
    return {COOKIE: issue_identity("google", f"g{player_id}", f"P{player_id}", f"p{player_id}@x.y")}


async def test_veto_from_coin_toss_to_side(c):
    await seed(n_teams=3, n_players=0)        # captains are players 1..3, leading teams 1..3
    a, b, outsider = await sign_in(c, 1), await sign_in(c, 2), await sign_in(c, 3)
    admin = lambda path, **kw: c.post("/api/v1/admin/vetoes" + path, headers=c.admin, **kw)   # noqa: E731

    assert (await admin("", json={"team_a": 1, "team_b": 1, "pool": POOL})).status_code == 422
    assert (await admin("", json={"team_a": 1, "team_b": 2, "pool": ["Ascent"]})).status_code == 422
    v = (await admin("", json={"team_a": 1, "team_b": 2, "pool": POOL + ["Nowhere"]})).json()
    assert v["pool"] == POOL and v["status"] == "coin" and v["turn"] == 1
    assert (await admin("", json={"team_a": 2, "team_b": 3, "pool": POOL})).status_code == 409   # team 2 is busy

    vid = v["id"]
    move = lambda who, action, value: c.post(f"/api/v1/vetoes/{vid}/{action}", json={"value": value}, cookies=who)  # noqa: E731
    assert (await c.get("/api/v1/vetoes/mine", cookies=b)).json() == {"id": vid}
    assert (await c.get("/api/v1/vetoes/mine", cookies=outsider)).json() == {"id": None}
    assert (await move(outsider, "call", "heads")).status_code == 403
    assert (await move({}, "call", "heads")).status_code == 403
    assert (await move(b, "call", "heads")).status_code == 409          # team A calls the toss
    assert (await move(a, "call", "edge")).status_code == 409

    s = (await move(a, "call", "heads")).json()
    assert s["status"] == "ban" and s["coin"] in ("heads", "tails")
    first = 1 if s["coin"] == "heads" else 2
    assert s["first_team_id"] == first == s["turn"]
    cap = {1: a, 2: b}
    second = 3 - first

    assert (await move(cap[second], "ban", "Ascent")).status_code == 409   # not their turn
    assert (await move(cap[first], "ban", "Breeze")).status_code == 409     # not in the pool
    await move(cap[first], "ban", "Ascent")
    assert (await move(cap[second], "ban", "Ascent")).status_code == 409    # already gone
    await move(cap[second], "ban", "Bind")
    s = (await move(cap[first], "ban", "Haven")).json()                     # last ban: Lotus is the map
    assert (s["status"], s["map"], s["remaining"], s["side_team_id"]) == ("side", "Lotus", ["Lotus"], second)

    assert (await move(cap[first], "side", "attack")).status_code == 409    # the other team picks the side
    s = (await move(cap[second], "side", "defense")).json()
    assert (s["status"], s["side"], s["turn"]) == ("done", "defense", None)
    assert (await move(cap[second], "side", "attack")).status_code == 409

    watch = (await c.get(f"/api/v1/vetoes/{vid}")).json()                  # anyone can watch
    assert watch["you"] is None and watch["map"] == "Lotus" and [x["map"] for x in watch["bans"]] == ["Ascent", "Bind", "Haven"]
    assert (await c.get("/api/v1/vetoes/mine", cookies=a)).json() == {"id": None}

    # organisers can reset or delete; the next veto for these teams is then allowed
    assert (await admin(f"/{vid}/reset")).status_code == 200
    assert (await c.get(f"/api/v1/vetoes/{vid}")).json()["status"] == "coin"
    assert (await admin(f"/{vid}/delete")).status_code == 200
    assert (await admin("", json={"team_a": 2, "team_b": 3, "pool": POOL})).status_code == 200
    lst = (await c.get("/api/v1/admin/vetoes", headers=c.admin)).json()
    assert lst["last_pool"] == POOL and len(lst["vetoes"]) == 1 and lst["teams"][0]["has_account"] is True
    assert (await c.get("/api/v1/admin/vetoes")).status_code == 401


async def test_veto_link_for_a_stand_in(c):
    await seed(n_teams=2, n_players=0)
    a = await sign_in(c, 1)
    vid = (await c.post("/api/v1/admin/vetoes", headers=c.admin, json={"team_a": 1, "team_b": 2, "pool": POOL})).json()["id"]
    link = lambda team, player: c.post(f"/api/v1/admin/vetoes/{vid}/link", headers=c.admin,  # noqa: E731
                                       json={"team_id": team, "player_id": player})
    assert (await link(2, 1)).status_code == 422            # player 1 is team 1's captain, not on team 2
    assert (await link(3, 2)).status_code == 422            # team 3 isn't in this veto
    r = (await link(2, 2)).json()
    key = r["link"].split("?k=")[1]
    assert r["delegate"] == "P1" and f"/veto/{vid}?k=" in r["link"]

    s = (await c.get(f"/api/v1/vetoes/{vid}?k={key}")).json()
    assert s["you"] == 2 and s["team_b"]["delegate"] == "P1"
    assert (await c.get(f"/api/v1/vetoes/{vid}?k=wrong")).json()["you"] is None
    move = lambda action, value, k="", who=None: c.post(f"/api/v1/vetoes/{vid}/{action}?k={k}", json={"value": value}, cookies=who)  # noqa: E731
    assert (await move("call", "heads", key)).status_code == 409    # the link is team B's; A calls
    s = (await move("call", "heads", who=a)).json()
    first = s["first_team_id"]
    turn = {1: dict(who=a), 2: dict(k=key)}
    assert (await move("ban", "Ascent", **turn[first])).status_code == 200
    assert (await move("ban", "Bind", **turn[3 - first])).status_code == 200

    new = (await link(2, 2)).json()["link"].split("?k=")[1]          # a new link revokes the old one
    assert (await c.get(f"/api/v1/vetoes/{vid}?k={key}")).json()["you"] is None
    assert (await c.get(f"/api/v1/vetoes/{vid}?k={new}")).json()["you"] == 2
    assert (await c.post(f"/api/v1/admin/vetoes/{vid}/link", json={"team_id": 2, "player_id": 2})).status_code == 401
