"""Tournament scoreboard: find custom games in Henrik, import them, and score them.

Method (ported from NTG with permission):
  1. every lineup player is resolved to a Riot PUUID once (Henrik account lookup);
  2. custom-game histories are fetched player by player, alternating team A and team B;
  3. a match counts only if players from BOTH teams were in it, so a random custom never matches;
  4. the organiser imports the right one; the full match is fetched once and stored per player;
  5. only published matches feed the public standings and role awards.
"""
from collections import Counter
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...models import GameMatch, GameMatchPlayer, Player, PlayerAlias, Team
from ..auction.service import active_sales, auction_teams
from . import henrik

ROLES = ["Duelist", "Initiator", "Controller", "Sentinel"]
# Role awards and the leaderboard go by the agent actually played. A new agent missing here falls back to the
# role the player signed up with, so add it when Riot releases one.
AGENT_ROLE = {**dict.fromkeys(["Jett", "Phoenix", "Reyna", "Raze", "Yoru", "Neon", "Iso", "Waylay", "Hush"], "Duelist"),
              **dict.fromkeys(["Sova", "Breach", "Skye", "KAY/O", "Fade", "Gekko", "Tejo"], "Initiator"),
              **dict.fromkeys(["Brimstone", "Viper", "Omen", "Astra", "Harbor", "Clove", "Miks"], "Controller"),
              **dict.fromkeys(["Killjoy", "Cypher", "Sage", "Chamber", "Deadlock", "Vyse", "Veto"], "Sentinel")}
WIN, CLOSE_LOSS, LOSS = 3, 1, 0
CLOSE_MARGIN = 3        # losing by this many rounds or fewer still earns CLOSE_LOSS


# ---------- pure helpers (unit tested without the network)

def lobby_puuids(match: dict) -> set[str]:
    return {p["puuid"] for p in ((match.get("players") or {}).get("all_players") or []) if p.get("puuid")}


def corroborate(rows: list[dict], a: set[str], b: set[str], map_name: str | None = None) -> list[dict]:
    """rows: {match_id, map, started_at, lobby: set, scanner}. Keep matches seen from both teams.

    Hits are lineup players known to be in the match: from the full lobby when Henrik includes it,
    otherwise the player whose history listed it.
    """
    seen: dict[str, dict] = {}
    for r in rows:
        e = seen.setdefault(r["match_id"], {"match_id": r["match_id"], "map": r["map"], "started_at": r["started_at"],
                                            "in_a": set(), "in_b": set()})
        present = (r["lobby"] or set()) | {r["scanner"]}
        e["in_a"] |= present & a
        e["in_b"] |= present & b
    out = [{"match_id": e["match_id"], "map": e["map"], "started_at": e["started_at"],
            "a_hits": len(e["in_a"]), "b_hits": len(e["in_b"])}
           for e in seen.values() if e["in_a"] and e["in_b"]
           and (not map_name or (e["map"] or "").lower() == map_name.lower())]
    out.sort(key=lambda c: (c["a_hits"] + c["b_hits"], c["started_at"] or ""), reverse=True)
    return out


def first_kills(kills: list[dict]) -> dict[str, list[int]]:
    """puuid -> [first kills, first deaths]: the earliest kill of every round."""
    by_round: dict[int, dict] = {}
    for k in kills or []:
        r, t = k.get("round"), k.get("kill_time_in_round") or 0
        if r is None or not k.get("killer_puuid") or not k.get("victim_puuid"):
            continue
        if r not in by_round or t < (by_round[r].get("kill_time_in_round") or 0):
            by_round[r] = k
    out: dict[str, list[int]] = {}
    for k in by_round.values():
        out.setdefault(k["killer_puuid"], [0, 0])[0] += 1
        out.setdefault(k["victim_puuid"], [0, 0])[1] += 1
    return out


def parse_match(detail: dict, a: set[str], b: set[str]) -> dict:
    """Henrik v2 match -> rounds per lineup and one row per lobby player tagged 'a' or 'b'.

    Lineup players go to their team; anyone else (a sub, a stand-in) goes with the side most of team A was on.
    """
    lobby = (detail.get("players") or {}).get("all_players") or []
    sides = Counter((p.get("team") or "").lower() for p in lobby if p.get("puuid") in a)
    a_side = sides.most_common(1)[0][0] if sides else "red"
    if not sides:   # nobody from A resolved in this lobby: use B's side instead
        b_sides = Counter((p.get("team") or "").lower() for p in lobby if p.get("puuid") in b)
        a_side = "blue" if b_sides and b_sides.most_common(1)[0][0] == "red" else "red"
    teams = detail.get("teams") or {}
    won = {s: (teams.get(s) or {}).get("rounds_won") or 0 for s in ("red", "blue")}
    fk = first_kills(detail.get("kills") or [])
    rows = []
    for p in lobby:
        pu = p.get("puuid")
        if not pu:
            continue
        side = "a" if pu in a else "b" if pu in b else "a" if (p.get("team") or "").lower() == a_side else "b"
        st = p.get("stats") or {}
        rows.append({"puuid": pu, "side": side, "riot_id": f"{p.get('name', '?')}#{p.get('tag', '')}"[:40],
                     "agent": p.get("character"), "kills": st.get("kills") or 0, "deaths": st.get("deaths") or 0,
                     "assists": st.get("assists") or 0, "score": st.get("score") or 0,
                     "damage": p.get("damage_made") or 0, "headshots": st.get("headshots") or 0,
                     "bodyshots": st.get("bodyshots") or 0, "legshots": st.get("legshots") or 0,
                     "first_kills": fk.get(pu, [0, 0])[0], "first_deaths": fk.get(pu, [0, 0])[1]})
    meta = detail.get("metadata") or {}
    start = meta.get("game_start")
    return {"map": meta.get("map"), "started_at": datetime.fromtimestamp(start, timezone.utc) if start else None,
            "rounds_a": won[a_side], "rounds_b": won["blue" if a_side == "red" else "red"], "players": rows}


def points(rounds_for: int, rounds_against: int) -> int:
    if rounds_for > rounds_against:
        return WIN
    return CLOSE_LOSS if rounds_against - rounds_for <= CLOSE_MARGIN else LOSS


def standings(teams: list[dict], matches: list[dict]) -> list[dict]:
    """teams: {id, ...}; matches: {team_a_id, team_b_id, rounds_a, rounds_b}. Points -> RD -> RW -> head-to-head.
    Teams yet to play go last, so a team that has played is never ranked below one that hasn't."""
    table = {t["id"]: {**t, "p": 0, "w": 0, "l": 0, "rw": 0, "rl": 0, "rd": 0, "pts": 0} for t in teams}
    beat: set[tuple[int, int]] = set()
    for m in matches:
        for me, other, rf, ra in ((m["team_a_id"], m["team_b_id"], m["rounds_a"], m["rounds_b"]),
                                  (m["team_b_id"], m["team_a_id"], m["rounds_b"], m["rounds_a"])):
            row = table.get(me)
            if not row:
                continue
            row["p"] += 1
            row["rw"] += rf
            row["rl"] += ra
            row["pts"] += points(rf, ra)
            if rf > ra:
                row["w"] += 1
                beat.add((me, other))
            elif rf < ra:
                row["l"] += 1
    for row in table.values():
        row["rd"] = row["rw"] - row["rl"]
    out = sorted(table.values(), key=lambda r: (r["p"] == 0, -r["pts"], -r["rd"], -r["rw"], r["name"].lower()))
    # ponytail: head-to-head only settles two-way ties; a three-way tie stays in RD/RW/name order
    for i in range(len(out) - 1):
        x, y = out[i], out[i + 1]
        if (x["pts"], x["rd"], x["rw"]) == (y["pts"], y["rd"], y["rw"]) and (y["id"], x["id"]) in beat:
            out[i], out[i + 1] = y, x
    return out


def aggregate(rows: list[dict]) -> dict:
    """rows: per-match player rows with 'key' and 'rounds' (total rounds in that map). Totals per player."""
    agg: dict = {}
    for r in rows:
        a = agg.setdefault(r["key"], {"key": r["key"], "games": 0, "rounds": 0, "agents": Counter(),
                                      **{k: 0 for k in ("kills", "deaths", "assists", "score", "damage", "headshots",
                                                        "bodyshots", "legshots", "first_kills", "first_deaths")}})
        a["games"] += 1
        a["rounds"] += r["rounds"]
        if r.get("agent"):
            a["agents"][r["agent"]] += 1
        for k in ("kills", "deaths", "assists", "score", "damage", "headshots", "bodyshots", "legshots",
                  "first_kills", "first_deaths"):
            a[k] += r[k]
    for a in agg.values():
        rounds = max(1, a["rounds"])
        shots = a["headshots"] + a["bodyshots"] + a["legshots"]
        a["acs"] = round(a["score"] / rounds)
        a["adr"] = round(a["damage"] / rounds)
        a["kd"] = round(a["kills"] / a["deaths"], 2) if a["deaths"] else float(a["kills"])
        a["hs"] = round(100 * a["headshots"] / shots, 1) if shots else 0.0
    return agg


BASELINE_ROUNDS = 72   # about 3 maps of below-average play added to everyone's record
BASELINE_SHARE = 0.75  # ...at 75% of the league's ACS


def baseline(stats: list[dict]) -> float:
    """The below-average ACS every record is blended with: BASELINE_SHARE of the league's ACS."""
    rounds = sum(s["rounds"] for s in stats)
    return BASELINE_SHARE * sum(s["score"] for s in stats) / rounds if rounds else 0


def rank_players(stats: list[dict], base: float | None = None) -> list[dict]:
    """Everyone is ranked by rating: ACS blended with a below-average baseline, so few maps pull a player down
    and the pull fades as they play more. K/D breaks ties. base: the league's, when stats is only part of it."""
    base = baseline(stats) if base is None else base
    rated = [{**s, "rating": round((s["score"] + base * BASELINE_ROUNDS) / (s["rounds"] + BASELINE_ROUNDS))} for s in stats]
    return sorted(rated, key=lambda s: (-s["rating"], -s["kd"]))


def role_leaders(by_role: list[dict], base: float) -> list[dict]:
    """by_role: one row per (player, role played), from only the maps on that role's agents. Top rated in each."""
    ranked = rank_players(by_role, base)
    return [best for role in ROLES if (best := next((s for s in ranked if s["role"] == role), None))]


def top_agents(agents: Counter, n: int = 3) -> list[list]:
    return [[a, c] for a, c in agents.most_common(n)]


def group_maps(matches: list[dict], group: dict[int, str | None]) -> list[dict]:
    """The group stage maps: the first published map between two teams of the same group (group stage was BO1);
    two teams with no group yet count as the same group.
    Everything else (a second map between them, cross-group maps) is playoffs and stays out of the standings.
    matches: {id, team_a_id, team_b_id, started_at}; a forfeit has no start time and counts as earliest."""
    seen, out = set(), []
    for m in sorted(matches, key=lambda m: (m["started_at"] is not None, m["started_at"] or 0, m["id"])):
        pair = frozenset((m["team_a_id"], m["team_b_id"]))
        if group.get(m["team_a_id"]) == group.get(m["team_b_id"]) and pair not in seen:
            seen.add(pair)
            out.append(m)
    return out


# ---------- database side

def team_card(t: Team) -> dict:
    return {"id": t.id, "name": t.name, "tag": t.tag, "logo_url": f"/media/{t.logo}", "group": t.grp}


async def lineups(db: AsyncSession) -> dict[int, dict]:
    """Every approved team with its default lineup: captain + players bought in the auction + playoff subs
    (who also stay on the team that bought them)."""
    sales = await active_sales(db)
    subs = list(await db.scalars(select(Player).where(Player.sub_team_id.is_not(None), Player.status == "approved")))
    out = {}
    for team, leader in await auction_teams(db):
        roster = [p for sale, p in sales if sale.team_id == team.id]
        mine = [p for p in subs if p.sub_team_id == team.id]
        out[team.id] = {"team": team, "players": [leader, *roster, *mine], "subs": mine}
    return out


async def resolve(db: AsyncSession, players: list[Player]) -> list[str]:
    """Fill in PUUID + card art from Henrik for players that don't have them. Returns Riot IDs not found."""
    missing = []
    for p in players:
        if p.puuid:
            continue
        acc = await henrik.account(p.riot_id)
        if not acc or not acc.get("puuid"):
            missing.append(p.riot_id)
            continue
        card = acc.get("card") or {}
        p.puuid = acc["puuid"]
        p.card_url = (card.get("large") if isinstance(card, dict) else None) or p.card_url
        p.card_wide_url = (card.get("wide") if isinstance(card, dict) else None) or p.card_wide_url
        await db.commit()   # keep each lookup, so a later failure doesn't waste the calls already made
    return missing


async def players_by_id(db: AsyncSession, ids: list[int]) -> list[Player]:
    rows = {p.id: p for p in await db.scalars(select(Player).where(Player.id.in_(ids or [0])))}
    return [rows[i] for i in ids if i in rows]


async def search(db: AsyncSession, side_a: list[Player], side_b: list[Player], map_name: str | None) -> dict:
    missing = await resolve(db, side_a + side_b)
    a = {p.puuid for p in side_a if p.puuid}
    b = {p.puuid for p in side_b if p.puuid}
    if not a or not b:
        return {"candidates": [], "missing": missing, "calls": 0,
                "note": "Each team needs at least one player whose Riot ID resolves."}
    # Alternate A, B, A, B... so both sides are covered early; stop once a match seen from both sides is found.
    scanners = [p for pair in zip(side_a, side_b) for p in pair if p.puuid]
    longer = side_a if len(side_a) > len(side_b) else side_b
    scanners += [p for p in longer[min(len(side_a), len(side_b)):] if p.puuid]
    rows, calls, found = [], 0, []
    for p in scanners:
        try:
            history = await henrik.custom_history(p.riot_id)
        except henrik.HenrikError:
            continue
        calls += 1
        for m in history:
            meta = m.get("metadata") or {}
            if not meta.get("matchid"):
                continue
            start = meta.get("game_start")
            rows.append({"match_id": meta["matchid"], "map": meta.get("map"), "scanner": p.puuid, "lobby": lobby_puuids(m),
                         "started_at": datetime.fromtimestamp(start, timezone.utc).isoformat() if start else None})
        found = corroborate(rows, a, b, map_name)
        if found:
            break
    imported = {m.henrik_match_id: m.status for m in await db.scalars(
        select(GameMatch).where(GameMatch.henrik_match_id.in_([c["match_id"] for c in found] or [""])))}
    for c in found:
        c["imported"] = imported.get(c["match_id"])
    return {"candidates": found, "missing": missing, "calls": calls}


async def import_match(db: AsyncSession, match_id: str, team_a: Team, team_b: Team,
                       side_a: list[Player], side_b: list[Player]) -> GameMatch:
    existing = await db.scalar(select(GameMatch).where(GameMatch.henrik_match_id == match_id))
    if existing and existing.status == "published":
        raise ValueError("Already published. Unpublish it first to re-import.")
    await resolve(db, side_a + side_b)
    detail = await henrik.match(match_id)
    if not detail:
        raise LookupError("Henrik has no match with that id")
    parsed = parse_match(detail, {p.puuid for p in side_a if p.puuid}, {p.puuid for p in side_b if p.puuid})
    m = existing or GameMatch(henrik_match_id=match_id)
    m.map, m.started_at, m.team_a_id, m.team_b_id = parsed["map"], parsed["started_at"], team_a.id, team_b.id
    m.rounds_a, m.rounds_b, m.status = parsed["rounds_a"], parsed["rounds_b"], "candidate"
    db.add(m)
    await db.flush()
    await db.execute(delete(GameMatchPlayer).where(GameMatchPlayer.match_id == m.id))
    known = {p.puuid: p.id for p in await db.scalars(
        select(Player).where(Player.puuid.in_([r["puuid"] for r in parsed["players"]] or [""]),
                             Player.status.not_in(["rejected", "withdrawn"])))}
    known.update({a.puuid: a.player_id for a in await db.scalars(
        select(PlayerAlias).where(PlayerAlias.puuid.in_([r["puuid"] for r in parsed["players"]] or [""])))})
    for r in parsed["players"]:
        side = r.pop("side")
        db.add(GameMatchPlayer(match_id=m.id, team_id=team_a.id if side == "a" else team_b.id,
                               player_id=known.get(r["puuid"]), **r))
    await db.commit()
    return m


async def accounts(db: AsyncSession) -> dict:
    """Riot accounts in imported matches that count for nobody yet, and the ones already linked as alts."""
    rows = list(await db.execute(select(GameMatchPlayer.puuid, GameMatchPlayer.riot_id, GameMatchPlayer.team_id)
                                 .where(GameMatchPlayer.player_id.is_(None))))
    tags = {t.id: t.tag for t in await db.scalars(select(Team))}
    unlinked: dict[str, dict] = {}
    for puuid, riot_id, team_id in rows:
        u = unlinked.setdefault(puuid, {"puuid": puuid, "riot_id": riot_id, "games": 0, "teams": []})
        u["games"] += 1
        if tags.get(team_id) and tags[team_id] not in u["teams"]:
            u["teams"].append(tags[team_id])
    aliases = list(await db.execute(select(PlayerAlias, Player).join(Player, Player.id == PlayerAlias.player_id)))
    seen = {pu: rid for pu, rid in await db.execute(select(GameMatchPlayer.puuid, GameMatchPlayer.riot_id)
                                                    .where(GameMatchPlayer.puuid.in_([a.puuid for a, _ in aliases] or [""])))}
    return {"unlinked": sorted(unlinked.values(), key=lambda u: -u["games"]),
            "aliases": [{"puuid": a.puuid, "riot_id": seen.get(a.puuid, a.puuid[:8]), "player_id": p.id,
                         "display_name": p.display_name} for a, p in aliases]}


async def link(db: AsyncSession, puuid: str, player_id: int | None) -> int:
    """Count this account's games for player_id (None unlinks). Returns match rows changed."""
    await db.execute(delete(PlayerAlias).where(PlayerAlias.puuid == puuid))
    if player_id:
        db.add(PlayerAlias(puuid=puuid, player_id=player_id))
    # an account that is someone's own signed-up puuid stays theirs
    owner = await db.scalar(select(Player.id).where(Player.puuid == puuid, Player.status.not_in(["rejected", "withdrawn"])))
    res = await db.execute(GameMatchPlayer.__table__.update().where(GameMatchPlayer.puuid == puuid)
                           .values(player_id=player_id or owner))
    return res.rowcount


async def board(db: AsyncSession, published_only: bool = True) -> dict:
    """Everything the scoreboard shows. Standings and awards only ever count published matches."""
    approved = {t.id: t for t, _ in await auction_teams(db)}
    teams = dict(approved)
    q = select(GameMatch).order_by(GameMatch.started_at.desc().nulls_last(), GameMatch.id.desc())
    matches = list(await db.scalars(q.where(GameMatch.status == "published") if published_only else q))
    rows = list(await db.scalars(select(GameMatchPlayer).where(
        GameMatchPlayer.match_id.in_([m.id for m in matches] or [0]))))
    people = {p.id: p for p in await db.scalars(select(Player).where(
        Player.id.in_({r.player_id for r in rows if r.player_id} or {0})))}
    extra = {r.team_id for r in rows} | {m.team_a_id for m in matches} | {m.team_b_id for m in matches}
    for t in await db.scalars(select(Team).where(Team.id.in_(extra - set(teams) or {0}))):
        teams[t.id] = t

    def who(r: GameMatchPlayer) -> dict:
        p = people.get(r.player_id)
        return {"display_name": p.display_name if p else r.riot_id.split("#")[0], "riot_id": r.riot_id,
                "player_id": r.player_id, "team_id": r.team_id}

    published = [m for m in matches if m.status == "published"]
    grp = {t.id: t.grp for t in teams.values()}
    slim = lambda ms: [{"id": m.id, "team_a_id": m.team_a_id, "team_b_id": m.team_b_id, "started_at": m.started_at} for m in ms]  # noqa: E731
    group_ids = {m["id"] for m in group_maps(slim(published), grp)}
    labelled = group_ids | {m["id"] for m in group_maps(slim(matches), grp)}   # admin preview: candidates too
    out_matches = []
    for m in matches:
        rounds = m.rounds_a + m.rounds_b
        players = []
        for r in (x for x in rows if x.match_id == m.id):
            st = aggregate([{"key": 0, "rounds": rounds, **{k: getattr(r, k) for k in (
                "agent", "kills", "deaths", "assists", "score", "damage", "headshots", "bodyshots", "legshots",
                "first_kills", "first_deaths")}}])[0]
            players.append({**who(r), "agent": r.agent, "kills": r.kills, "deaths": r.deaths, "assists": r.assists,
                            "acs": st["acs"], "adr": st["adr"], "hs": st["hs"], "first_kills": r.first_kills,
                            "first_deaths": r.first_deaths})
        players.sort(key=lambda p: (p["team_id"] != m.team_a_id, -p["acs"]))
        mvp = max(players, key=lambda p: p["acs"], default=None)
        out_matches.append({"id": m.id, "henrik_match_id": m.henrik_match_id, "status": m.status, "map": m.map,
                            "started_at": m.started_at.isoformat() if m.started_at else None,
                            "team_a": team_card(teams[m.team_a_id]), "team_b": team_card(teams[m.team_b_id]),
                            "rounds_a": m.rounds_a, "rounds_b": m.rounds_b,
                            "stage": "group" if m.id in labelled else "playoffs",
                            "mvp": mvp and mvp["display_name"], "players": players})

    pub_ids = {m.id: m.rounds_a + m.rounds_b for m in published}
    # Player stats are for the auction tournament only: captains, bought players and playoff subs, on maps for a
    # team they're on (a playoff sub counts for both teams). Other stand-ins never reach the leaderboard.
    plays: dict[int, set] = {}
    own: dict[int, int] = {}
    for tid, v in (await lineups(db)).items():
        for p in v["players"]:
            plays.setdefault(p.id, set()).add(tid)
            if p not in v["subs"]:
                own[p.id] = tid
    stat_rows = [{"key": r.player_id, "rounds": pub_ids[r.match_id],
                  "role": AGENT_ROLE.get(r.agent) or people[r.player_id].role, **{k: getattr(r, k) for k in (
        "agent", "kills", "deaths", "assists", "score", "damage", "headshots", "bodyshots", "legshots",
        "first_kills", "first_deaths")}} for r in rows
        if r.match_id in pub_ids and r.player_id and r.team_id in plays.get(r.player_id, ())]
    stats = list(aggregate(stat_rows).values())
    # The same maps split by the role of the agent played: "best Duelist" counts only their Duelist maps.
    by_role = list(aggregate([{**r, "key": (r["key"], r["role"])} for r in stat_rows]).values())
    main_role = {}
    for s in sorted(by_role, key=lambda s: s["games"]):
        main_role[s["key"][0]] = s["key"][1]     # most maps wins (ties: the later, arbitrary)
    for s in stats + by_role:
        pid = s["key"][0] if isinstance(s["key"], tuple) else s["key"]
        p = people[pid]
        s.update(id=pid, role=s["key"][1] if isinstance(s["key"], tuple) else main_role[pid], display_name=p.display_name,
                 riot_id=p.riot_id, card_url=p.card_url, agents=top_agents(s["agents"]),
                 team=team_card(teams[own.get(pid) or min(plays[pid])]))
    public = ("id", "display_name", "riot_id", "role", "agents", "team", "games", "rating", "acs", "kd", "adr", "hs",
              "kills", "deaths", "assists", "first_kills", "first_deaths")
    base = baseline(stats)
    # Each role's best agent per player: rated like the leaderboard, so one lucky map on an agent doesn't win it.
    by_agent = rank_players(list(aggregate([{**r, "key": (r["key"], r["role"], r["agent"])}
                                            for r in stat_rows if r["agent"]]).values()), base)
    for s in by_role:
        best = next((a for a in by_agent if a["key"][:2] == s["key"]), None)
        s["best_agent"] = best and {"agent": best["key"][2], "acs": best["acs"], "games": best["games"]}
    leaders = [{k: l[k] for k in ("role", "agents", "best_agent", "display_name", "riot_id", "card_url", "team", "games", "rating", "acs", "kd")}
               for l in role_leaders(by_role, base)]
    players = [{k: p[k] for k in public} for p in rank_players(stats, base)]
    players_by_role = [{k: p[k] for k in public} for p in rank_players(by_role, base)]
    cards = [team_card(t) for t in approved.values()]
    games = [{"team_a_id": m.team_a_id, "team_b_id": m.team_b_id, "rounds_a": m.rounds_a, "rounds_b": m.rounds_b}
             for m in published if m.id in group_ids]
    # ranked within each group (A, B; teams without a group last)
    table = [row for g in sorted({c["group"] or "~" for c in cards})
             for row in standings([c for c in cards if (c["group"] or "~") == g], games)]
    return {"role_leaders": leaders, "players": players, "players_by_role": players_by_role,
            "rating": {"baseline": round(base), "rounds": BASELINE_ROUNDS, "share": BASELINE_SHARE}, "standings": table, "matches": out_matches}
