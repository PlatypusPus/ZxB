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


async def test_each_captain_plays_from_their_own_link(c):
    await seed(n_teams=2, n_players=0)                     # nobody has an account
    r = (await c.post("/api/v1/admin/vetoes", headers=c.admin, json={"team_a": 1, "team_b": 2, "pool": POOL[:2]})).json()
    vid, url = r["id"], f"/api/v1/vetoes/{r['id']}"
    k = {t: u.split("?k=")[1] for t, u in ((int(t), u) for t, u in r["links"].items())}
    assert k[1] != k[2]
    assert "links" not in (await c.get(url)).json()        # the public page never shows the keys
    assert (await c.get(f"{url}?k={k[1]}")).json()["you"] == 1 and (await c.get(f"{url}?k={k[2]}")).json()["you"] == 2
    assert (await c.get(f"{url}?k={k[1][:-1]}x")).json()["you"] is None
    assert (await c.post(f"{url}/call", json={"value": "heads"})).status_code == 403
    assert (await c.post(f"{url}/call?k={k[2]}", json={"value": "heads"})).status_code == 409
    first = (await c.post(f"{url}/call?k={k[1]}", json={"value": "heads"})).json()["first_team_id"]
    assert (await c.post(f"{url}/ban?k={k[first]}", json={"value": "Ascent"})).json()["status"] == "side"
    assert (await c.post(f"{url}/side?k={k[3 - first]}", json={"value": "attack"})).json()["status"] == "done"
    listed = (await c.get("/api/v1/admin/vetoes", headers=c.admin)).json()["vetoes"][0]
    assert listed["id"] == vid and listed["links"] == r["links"]


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


async def test_bo3_bans_picks_sides_then_decider(c):
    await seed(n_teams=2, n_players=0)
    pool = ["Ascent", "Bind", "Haven", "Lotus", "Pearl", "Split", "Sunset"]
    admin = lambda **kw: c.post("/api/v1/admin/vetoes", headers=c.admin, json={"team_a": 1, "team_b": 2, **kw})  # noqa: E731
    assert (await admin(pool=pool[:2], bo=3)).status_code == 422
    r = (await admin(pool=pool, bo=3)).json()
    assert r["bo"] == 3 and [s["kind"] for s in r["steps"]] == ["ban", "ban", "pick", "pick", "ban", "ban"]
    vid = r["id"]
    k = {int(t): u.split("?k=")[1] for t, u in r["links"].items()}
    move = lambda team, action, value: c.post(f"/api/v1/vetoes/{vid}/{action}?k={k[team]}", json={"value": value})  # noqa: E731
    f = (await move(1, "call", "heads")).json()["first_team_id"]
    s_ = 3 - f
    await move(f, "ban", "Ascent")
    await move(s_, "ban", "Bind")
    assert (await move(f, "ban", "Haven")).status_code == 409           # this step is a pick
    s = (await move(f, "pick", "Haven")).json()
    assert (s["status"], s["turn"]) == ("side", s_)
    s = (await move(s_, "side", "attack")).json()
    assert (s["status"], s["turn"], s["step"]) == ("ban", s_, "pick")
    await move(s_, "pick", "Lotus")
    await move(f, "side", "defense")
    await move(f, "ban", "Pearl")
    s = (await move(s_, "ban", "Split")).json()
    assert (s["status"], s["map"], s["side_team_id"]) == ("side", "Sunset", f)
    s = (await move(f, "side", "attack")).json()
    assert s["status"] == "done" and s["maps"] == [
        {"map": "Haven", "picked_by": f, "side_team_id": s_, "side": "attack"},
        {"map": "Lotus", "picked_by": s_, "side_team_id": f, "side": "defense"},
        {"map": "Sunset", "picked_by": None, "side_team_id": f, "side": "attack"}]
    assert [x["team_id"] for x in s["steps"]] == [f, s_, f, s_, f, s_]
