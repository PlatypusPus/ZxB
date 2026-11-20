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


def test_role_leaders_compare_within_the_signed_up_role():
    def p(key, role, **kw):
        base = {"key": key, "role": role, "games": 1, "rounds": 24, "kills": 15, "deaths": 15, "assists": 5,
                "score": 4800, "damage": 3000, "headshots": 10, "bodyshots": 30, "legshots": 2,
                "first_kills": 2, "first_deaths": 2, "agent": "Jett"}
        return {**base, **kw}
    stats = list(service.aggregate([
        p(1, "Duelist", score=7200, first_kills=6), p(2, "Duelist", score=5000),
        p(3, "Controller", assists=12), p(4, "Initiator", assists=14), p(5, "Sentinel"), p(6, "Flex"),
    ]).values())
    for s in stats:
        s["role"] = {1: "Duelist", 2: "Duelist", 3: "Controller", 4: "Initiator", 5: "Sentinel", 6: "Flex"}[s["key"]]
    leaders = {l["role"]: l for l in service.role_leaders(stats)}
    assert set(leaders) == set(service.ROLES)
    assert leaders["Duelist"]["key"] == 1 and leaders["Duelist"]["stat_value"] == 6
    assert leaders["Controller"]["stat_label"] == "KAST" and str(leaders["Controller"]["stat_value"]).endswith("%")
    assert service.aggregate([p(9, "Flex")])[9]["acs"] == 200 and service.aggregate([p(9, "Flex")])[9]["hs"] == 23.8


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

    assert (await c.post(f"{S}/matches/{game['id']}/publish", headers=c.admin)).status_code == 200
    pub = (await c.get("/api/v1/scoreboard")).json()
    assert "henrik_match_id" not in pub["matches"][0] and pub["matches"][0]["mvp"] == "P0"
    top = pub["standings"][0]
    assert (top["name"], top["p"], top["w"], top["rd"], top["pts"]) == ("Team 0", 1, 1, 2, 3)
    assert pub["standings"][1]["pts"] == 1   # 11-13 is a close loss
    leaders = {l["role"]: l for l in pub["role_leaders"]}
    assert leaders["Duelist"]["display_name"] == "P0" and leaders["Duelist"]["card_url"].endswith("large.png")
    assert "phone" not in str(pub) and "9000000000" not in str(pub)

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
