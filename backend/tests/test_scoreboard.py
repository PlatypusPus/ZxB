"""Scoreboard: finding custom games from both teams' histories, importing, standings and role awards (Henrik mocked)."""
import pytest

from app.modules.scoreboard import henrik, service
from tests.test_auction import seed

pytestmark = pytest.mark.anyio
S = "/api/v1/admin/scoreboard"


# ---------- pure rules

def test_corroborate_needs_both_teams():
    rows = [
        {"match_id": "shared", "map": "Ascent", "started_at": "2026-11-20T10:00", "scanner": "a1", "lobby": set()},
        {"match_id": "only-a", "map": "Bind", "started_at": "2026-11-20T11:00", "scanner": "a1", "lobby": set()},
        {"match_id": "shared", "map": "Ascent", "started_at": "2026-11-20T10:00", "scanner": "b1", "lobby": set()},
        # a full lobby proves both sides from a single history row
        {"match_id": "lobby", "map": "Haven", "started_at": "2026-11-19T10:00", "scanner": "a2", "lobby": {"a2", "b2", "b1"}},
    ]
    found = service.corroborate(rows, {"a1", "a2"}, {"b1", "b2"})
    assert [c["match_id"] for c in found] == ["lobby", "shared"]
    assert found[0]["a_hits"] == 1 and found[0]["b_hits"] == 2
    assert [c["match_id"] for c in service.corroborate(rows, {"a1", "a2"}, {"b1", "b2"}, "ascent")] == ["shared"]


def test_first_kills_take_the_earliest_kill_each_round():
    kills = [{"round": 0, "kill_time_in_round": 900, "killer_puuid": "x", "victim_puuid": "y"},
             {"round": 0, "kill_time_in_round": 300, "killer_puuid": "y", "victim_puuid": "z"},
             {"round": 1, "kill_time_in_round": 100, "killer_puuid": "x", "victim_puuid": "z"}]
    assert service.first_kills(kills) == {"y": [1, 0], "z": [0, 2], "x": [1, 0]}


def test_points_and_tiebreaks():
    assert [service.points(13, 5), service.points(11, 13), service.points(12, 14), service.points(9, 13)] == [3, 1, 1, 0]
    teams = [{"id": i, "name": n} for i, n in ((1, "Alpha"), (2, "Bravo"), (3, "Charlie"), (4, "Delta"))]
    table = service.standings(teams, [
        {"team_a_id": 1, "team_b_id": 2, "rounds_a": 13, "rounds_b": 11},   # Alpha 3, Bravo 1 (close loss)
        {"team_a_id": 3, "team_b_id": 4, "rounds_a": 13, "rounds_b": 3},    # Charlie 3, Delta 0
    ])
    assert [r["name"] for r in table] == ["Charlie", "Alpha", "Bravo", "Delta"]   # equal points: RD 10 beats RD 2
    alpha = table[1]
    assert (alpha["p"], alpha["w"], alpha["l"], alpha["rw"], alpha["rl"], alpha["rd"], alpha["pts"]) == (1, 1, 0, 13, 11, 2, 3)
    # identical points, RD and rounds won: the head-to-head winner goes first
    h2h = service.standings(teams[:2], [{"team_a_id": 2, "team_b_id": 1, "rounds_a": 13, "rounds_b": 11},
                                         {"team_a_id": 1, "team_b_id": 2, "rounds_a": 13, "rounds_b": 11},
                                         {"team_a_id": 2, "team_b_id": 1, "rounds_a": 13, "rounds_b": 11}])
    assert [r["name"] for r in h2h] == ["Bravo", "Alpha"]


def test_everyone_is_ranked_but_few_maps_pull_the_rating_down():
    def p(key, games=1, score=4800):
        return [{"key": key, "rounds": 24, "kills": 15, "deaths": 15, "assists": 5, "score": score, "damage": 3000,
                 "headshots": 10, "bodyshots": 30, "legshots": 2, "first_kills": 2, "first_deaths": 2, "agent": "Jett"}] * games
    # 1 and 5 play equally well (200 ACS); 5 has 6 maps, 1 has 1. 3 had one huge map (375 ACS).
    stats = list(service.aggregate(p(1, 1, 4800) + p(5, 6, 4800) + p(2, 4, 5200) + p(3, 1, 9000) + p(4, 2, 2400)).values())
    for s, role in zip(stats, ("Duelist", "Initiator", "Duelist", "Duelist", "Sentinel")):
        s["role"] = role
    ranked = {s["key"]: s for s in service.rank_players(stats)}
    assert len(ranked) == 5                                   # one map is enough to appear
    assert ranked[5]["rating"] > ranked[1]["rating"]          # same ACS, more maps ranks higher
    assert ranked[3]["rating"] < ranked[3]["acs"] - 150       # one hot map is heavily discounted
    assert [s["key"] for s in service.rank_players(stats)][-1] == 4
    assert {l["role"]: l["key"] for l in service.role_leaders(stats)} == {"Duelist": 3, "Initiator": 5, "Sentinel": 4}


def test_teams_yet_to_play_sit_below_teams_that_have():
    teams = [{"id": 1, "name": "Alpha"}, {"id": 2, "name": "Bravo"}, {"id": 3, "name": "Charlie"}, {"id": 4, "name": "Delta"}]
    table = service.standings(teams, [{"team_a_id": 3, "team_b_id": 4, "rounds_a": 13, "rounds_b": 2}])
    assert [r["name"] for r in table] == ["Charlie", "Delta", "Alpha", "Bravo"]


# ---------- the admin flow, with Henrik faked

def lobby_player(puuid, name, side, agent="Jett", kills=10, score=4000):
    return {"puuid": puuid, "name": name, "tag": "T", "team": side, "character": agent, "damage_made": 2500,
            "stats": {"kills": kills, "deaths": 8, "assists": 3, "score": score, "headshots": 5, "bodyshots": 15, "legshots": 0}}


def fake_henrik(monkeypatch, calls):
    async def account(riot_id):
        calls.append(("account", riot_id))
        return None if riot_id.startswith("ghost") else {"puuid": "pu-" + riot_id.split("#")[0],
                                                         "card": {"large": f"https://cards/{riot_id}/large.png"}}

    async def custom_history(riot_id, size=10):
        calls.append(("history", riot_id))
        # p0 (team 1) and p1 (team 2) both played M1; p0 also has an unrelated custom
        return {"p0#T": [{"metadata": {"matchid": "M1", "map": "Ascent", "game_start": 1795000000}},
                         {"metadata": {"matchid": "OTHER", "map": "Bind", "game_start": 1795000500}}],
                "p1#T": [{"metadata": {"matchid": "M1", "map": "Ascent", "game_start": 1795000000}}]}.get(riot_id, [])

    async def match(match_id):
        calls.append(("match", match_id))
        return {"metadata": {"map": "Ascent", "game_start": 1795000000},
                "teams": {"red": {"rounds_won": 13}, "blue": {"rounds_won": 11}},
                "players": {"all_players": [
                    lobby_player("pu-p0", "p0", "Red", score=6000), lobby_player("pu-p2", "p2", "Red"),
                    lobby_player("pu-standin", "standin", "Red", agent="Omen"),   # not signed up: goes with Red = team 1
                    lobby_player("pu-p1", "p1", "Blue"), lobby_player("pu-p3", "p3", "Blue")]},
                "kills": [{"round": 0, "kill_time_in_round": 100, "killer_puuid": "pu-p0", "victim_puuid": "pu-p1"}]}

    monkeypatch.setattr(henrik, "account", account)
    monkeypatch.setattr(henrik, "custom_history", custom_history)
    monkeypatch.setattr(henrik, "match", match)


async def test_admin_finds_imports_and_publishes_a_match(c, monkeypatch):
    calls = []
    fake_henrik(monkeypatch, calls)
    await seed(n_teams=2, n_players=4)   # players 1,2 lead teams 1,2; players 3..6 are auction players
    assert (await c.get(S)).status_code == 401
    lineup = {"team_a": 1, "team_b": 2, "players_a": [1, 3], "players_b": [2, 4]}   # p0+p2 vs p1+p3

    r = (await c.post(S + "/search", json=lineup, headers=c.admin)).json()
    assert [x["match_id"] for x in r["candidates"]] == ["M1"] and r["candidates"][0]["imported"] is None
    assert r["calls"] == 2 and r["missing"] == []   # stopped after one player per team found the shared match
    assert len([x for x in calls if x[0] == "account"]) == 4   # resolved once...
    calls.clear()
    await c.post(S + "/search", json=lineup, headers=c.admin)
    assert not [x for x in calls if x[0] == "account"]           # ...and cached on the player

    m = (await c.post(S + "/import", json={**lineup, "match_id": "M1"}, headers=c.admin)).json()
    assert (m["rounds_a"], m["rounds_b"], m["map"]) == (13, 11, "Ascent")
    assert (await c.get("/api/v1/scoreboard")).json()["matches"] == []   # not public until published

    admin = (await c.get(S, headers=c.admin)).json()
    game = admin["matches"][0]
    assert game["status"] == "candidate" and len(game["players"]) == 5
    standin = next(p for p in game["players"] if p["riot_id"] == "standin#T")
    assert standin["team_id"] == 1 and standin["player_id"] is None
    assert [u["riot_id"] for u in admin["unlinked"]] == ["standin#T"] and admin["unlinked"][0]["teams"] == ["TAA"]

    # the stand-in is player 5 on an alt: linking moves the row to them and survives a re-import; unlink reverts
    assert (await c.post(S + "/link", json={"puuid": "pu-standin", "player_id": 5}, headers=c.admin)).json() == {"rows": 1}
    await c.post(S + "/import", json={**lineup, "match_id": "M1"}, headers=c.admin)
    admin = (await c.get(S, headers=c.admin)).json()
    assert admin["unlinked"] == [] and admin["aliases"][0]["player_id"] == 5
    assert next(p for p in admin["matches"][0]["players"] if p["riot_id"] == "standin#T")["player_id"] == 5
    await c.post(S + "/link", json={"puuid": "pu-standin", "player_id": None}, headers=c.admin)
    admin = (await c.get(S, headers=c.admin)).json()
    assert admin["aliases"] == [] and len(admin["unlinked"]) == 1
    game = admin["matches"][0]

    assert (await c.post(f"{S}/matches/{game['id']}/publish", headers=c.admin)).status_code == 200
    pub = (await c.get("/api/v1/scoreboard")).json()
    assert "henrik_match_id" not in pub["matches"][0] and pub["matches"][0]["mvp"] == "P0"
    top = pub["standings"][0]
    assert (top["name"], top["p"], top["w"], top["rd"], top["pts"]) == ("Team 0", 1, 1, 2, 3)
    assert pub["standings"][1]["pts"] == 1   # 11-13 is a close loss
    leaders = {l["role"]: l for l in pub["role_leaders"]}
    assert leaders["Duelist"]["display_name"] == "P0" and leaders["Duelist"]["card_url"].endswith("large.png")
    assert pub["players"][0]["display_name"] == "P0" and pub["players"][0]["rating"] > 0
    assert pub["rating"]["rounds"] == service.BASELINE_ROUNDS and pub["rating"]["baseline"] > 0
    assert "phone" not in str(pub) and "9000000000" not in str(pub)
    # only rostered players on maps for their own team: P2/P3 weren't bought, so they don't appear
    assert {p["display_name"]: p["games"] for p in pub["players"]} == {"P0": 1, "P1": 1}
    # team 1's stand-in turns out to be P1 (team 2's captain) on an alt: that map doesn't count for P1
    await c.post(S + "/link", json={"puuid": "pu-standin", "player_id": 2}, headers=c.admin)
    pub = (await c.get("/api/v1/scoreboard")).json()
    assert {p["display_name"]: p["games"] for p in pub["players"]} == {"P0": 1, "P1": 1}
    assert pub["matches"][0]["players"] and len(pub["matches"][0]["players"]) == 5   # match table still shows everyone

    # a published match can't be overwritten by a re-import
    assert (await c.post(S + "/import", json={**lineup, "match_id": "M1"}, headers=c.admin)).status_code == 409
    await c.post(f"{S}/matches/{game['id']}/delete", headers=c.admin)
    assert (await c.get("/api/v1/scoreboard")).json()["matches"] == []


async def test_search_reports_riot_ids_that_dont_resolve(c, monkeypatch):
    fake_henrik(monkeypatch, [])
    await seed(n_teams=2, n_players=0)
    from app.core import Session
    from app.models import Player
    async with Session() as db:
        (await db.get(Player, 2)).riot_id = "ghost#T"
        await db.commit()
    r = (await c.post(S + "/search", json={"team_a": 1, "team_b": 2}, headers=c.admin)).json()
    assert r["missing"] == ["ghost#T"] and r["candidates"] == []
    assert (await c.post(S + "/search", json={"team_a": 1, "team_b": 1}, headers=c.admin)).status_code == 422


async def test_groups_split_the_standings(c):
    await seed(n_teams=4, n_players=0)
    from app.core import Session
    from app.models import GameMatch, Team
    from app.tournament import init_db
    async with Session() as db:
        (await db.get(Team, 1)).name = "Meow Diff!"          # punctuation and case don't matter
        db.add(GameMatch(henrik_match_id="g1", map="Ascent", team_a_id=3, team_b_id=4, rounds_a=13, rounds_b=2, status="published"))
        await db.commit()
    await init_db()                                           # seeds the announced groups by team name
    async with Session() as db:
        assert (await db.get(Team, 1)).grp == "B" and (await db.get(Team, 2)).grp is None
    put = lambda t, g: c.post(f"/api/v1/admin/teams/{t}/group", json={"group": g}, headers=c.admin)
    assert (await put(2, "x")).status_code == 422
    for t, g in ((2, "B"), (3, "a"), (4, "A")):
        assert (await put(t, g)).json()["group"] == g.upper()
    rows = (await c.get("/api/v1/scoreboard")).json()["standings"]
    assert [(r["group"], r["id"]) for r in rows][:2] == [("A", 3), ("A", 4)] and {r["group"] for r in rows[2:]} == {"B"}
    assert [t["group"] for t in (await c.get("/api/v1/teams")).json()] == ["B", "B", "A", "A"]
    assert (await c.post("/api/v1/admin/teams/1/group", json={"group": "A"})).status_code == 401


async def test_bracket_results_are_admin_only_and_public(c):
    assert (await c.put("/api/v1/admin/bracket", json={"results": {"ub1": "a"}})).status_code == 401
    bad = await c.put("/api/v1/admin/bracket", json={"results": {"ub1": "x"}}, headers=c.admin)
    assert bad.status_code == 422
    ok = await c.put("/api/v1/admin/bracket", json={"results": {"ub1": "a", "q": "b"}}, headers=c.admin)
    assert ok.status_code == 200
    assert (await c.get("/api/v1/public")).json()["bracket"] == {"ub1": "a", "q": "b"}
