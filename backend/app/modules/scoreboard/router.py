"""Scoreboard API: admin finds and imports custom games; the public sees published results only."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import audit, get_db, require_admin
from ...models import GameMatch, Player, Team
from . import henrik, service

router = APIRouter()


@router.get("/scoreboard")
async def public_scoreboard(db: AsyncSession = Depends(get_db)):
    data = await service.board(db)
    for m in data["matches"]:
        m.pop("henrik_match_id"), m.pop("status")
    return data


@router.get("/admin/scoreboard")
async def admin_scoreboard(db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    """Teams with default lineups, players who can stand in, every imported match, and the public preview."""
    lineups = await service.lineups(db)
    pool = await db.scalars(select(Player).where(Player.status == "approved").order_by(Player.display_name))
    card = lambda p: {"id": p.id, "display_name": p.display_name, "riot_id": p.riot_id, "role": p.role,  # noqa: E731
                      "path": p.path, "resolved": bool(p.puuid)}
    return {"configured": bool(henrik.KEY),
            "teams": [{**service.team_card(v["team"]), "players": [card(p) for p in v["players"]]} for v in lineups.values()],
            "players": [card(p) for p in pool],
            **await service.accounts(db),
            **await service.board(db, published_only=False)}


@router.post("/admin/scoreboard/link")
async def link(body: dict, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    """Map a Riot account from imported matches to a signed-up player (player_id null unlinks)."""
    puuid = str(body.get("puuid") or "").strip()
    try:
        player_id = int(body["player_id"]) if body.get("player_id") else None
    except (TypeError, ValueError):
        raise HTTPException(422, "Pick a player")
    if not puuid:
        raise HTTPException(422, "Pick an account")
    if player_id and not await db.get(Player, player_id):
        raise HTTPException(404, "Player not found")
    rows = await service.link(db, puuid, player_id)
    audit(db, admin, "scoreboard.linked" if player_id else "scoreboard.unlinked", puuid=puuid, player_id=player_id, rows=rows)
    await db.commit()
    return {"rows": rows}


async def _sides(db: AsyncSession, body: dict) -> tuple[Team, Team, list[Player], list[Player]]:
    try:
        a_id, b_id = int(body.get("team_a")), int(body.get("team_b"))
    except (TypeError, ValueError):
        raise HTTPException(422, "Pick both teams")
    if a_id == b_id:
        raise HTTPException(422, "Pick two different teams")
    lineups = await service.lineups(db)
    if a_id not in lineups or b_id not in lineups:
        raise HTTPException(404, "Team not found")
    sides = []
    for tid, key in ((a_id, "players_a"), (b_id, "players_b")):
        ids = body.get(key)   # the organiser's edited lineup (subs in, players out); default = auction roster
        sides.append(await service.players_by_id(db, [int(i) for i in ids]) if ids else lineups[tid]["players"])
    return lineups[a_id]["team"], lineups[b_id]["team"], sides[0], sides[1]


@router.post("/admin/scoreboard/search")
async def search(body: dict, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    _, _, side_a, side_b = await _sides(db, body)
    try:
        return await service.search(db, side_a, side_b, (body.get("map") or "").strip() or None)
    except henrik.HenrikError as e:
        raise HTTPException(502, str(e))


@router.post("/admin/scoreboard/import")
async def import_match(body: dict, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    match_id = str(body.get("match_id") or "").strip()
    if not match_id:
        raise HTTPException(422, "Pick a match")
    team_a, team_b, side_a, side_b = await _sides(db, body)
    try:
        m = await service.import_match(db, match_id, team_a, team_b, side_a, side_b)
    except ValueError as e:
        raise HTTPException(409, str(e))
    except LookupError as e:
        raise HTTPException(404, str(e))
    except henrik.HenrikError as e:
        raise HTTPException(502, str(e))
    audit(db, admin, "scoreboard.imported", match_id=m.id, henrik_match_id=match_id, team_a=team_a.id, team_b=team_b.id)
    await db.commit()
    return {"id": m.id, "rounds_a": m.rounds_a, "rounds_b": m.rounds_b, "map": m.map}


async def _set_status(db: AsyncSession, match_id: int, status: str | None, admin: str) -> dict:
    m = await db.get(GameMatch, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    if status:
        m.status = status
    else:
        await db.delete(m)
    audit(db, admin, f"scoreboard.{status or 'deleted'}", match_id=match_id, henrik_match_id=m.henrik_match_id)
    await db.commit()
    return {"id": match_id, "status": status or "deleted"}


@router.post("/admin/scoreboard/matches/{match_id}/publish")
async def publish(match_id: int, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    return await _set_status(db, match_id, "published", admin)


@router.post("/admin/scoreboard/matches/{match_id}/unpublish")
async def unpublish(match_id: int, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    return await _set_status(db, match_id, "candidate", admin)


@router.post("/admin/scoreboard/matches/{match_id}/delete")
async def delete(match_id: int, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    return await _set_status(db, match_id, None, admin)
