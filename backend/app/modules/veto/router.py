"""Map veto (BO1, Challonge style). The organiser pairs two teams; their captains, signed in with their own accounts,
call a coin toss, ban maps in turn until one is left, and the team that didn't make the last ban picks a side.
Anyone with the link can watch."""
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import SITE, audit, get_db, new_token, require_admin, sha256
from ...models import Player, Team, Veto
from ..auction.service import active_sales, auction_teams
from ..auth import identity, is_verified
from ..scoreboard.service import team_card

router = APIRouter()
MAPS = ["Abyss", "Ascent", "Bind", "Breeze", "Corrode", "Fracture", "Haven", "Icebox", "Lotus", "Pearl", "Split", "Summit", "Sunset"]
LIVE = ("coin", "ban", "side")


# ---------- the rules (pure, so they're easy to test)

def other(v: Veto, team_id: int) -> int:
    return v.team_b_id if team_id == v.team_a_id else v.team_a_id


def remaining(v: Veto) -> list[str]:
    gone = {b["map"] for b in v.bans}
    return [m for m in v.pool if m not in gone]


def turn(v: Veto) -> int | None:
    """Whose move it is."""
    if v.status == "coin":
        return v.team_a_id
    if v.status == "ban":
        return v.first_team_id if len(v.bans) % 2 == 0 else other(v, v.first_team_id)
    if v.status == "side":
        return v.side_team_id
    return None


def act(v: Veto, team_id: int, action: str, value: str) -> None:
    """Apply one move or raise ValueError with a message for the captain."""
    if v.status == "done":
        raise ValueError("The veto is finished")
    if team_id != turn(v):
        raise ValueError("It's the other captain's turn")
    if action == "call" and v.status == "coin":
        if value not in ("heads", "tails"):
            raise ValueError("Call heads or tails")
        v.call, v.coin = value, secrets.choice(("heads", "tails"))
        v.first_team_id = v.team_a_id if v.call == v.coin else v.team_b_id
        v.status = "ban"
    elif action == "ban" and v.status == "ban":
        if value not in remaining(v):
            raise ValueError("That map isn't in the pool any more")
        v.bans = [*v.bans, {"team_id": team_id, "map": value}]
        left = remaining(v)
        if len(left) == 1:   # the last ban decided the map; the other team picks the side
            v.map, v.side_team_id, v.status = left[0], other(v, team_id), "side"
    elif action == "side" and v.status == "side":
        if value not in ("attack", "defense"):
            raise ValueError("Pick attack or defense")
        v.side, v.status = value, "done"
    else:
        raise ValueError("That move isn't open right now")


# ---------- views

async def _teams(db: AsyncSession) -> dict[int, tuple[Team, Player]]:
    return {t.id: (t, leader) for t, leader in await auction_teams(db) if t.profile_status == "approved"}


def view(v: Veto, teams: dict, you: int | None = None) -> dict:
    stand_in = {v.team_a_id: v.a_delegate, v.team_b_id: v.b_delegate}
    side = lambda tid: {**team_card(teams[tid][0]), "captain": teams[tid][1].display_name,  # noqa: E731
                        "delegate": stand_in.get(tid)} if tid in teams else None
    return {"id": v.id, "status": v.status, "pool": v.pool, "remaining": remaining(v), "bans": v.bans,
            "call": v.call, "coin": v.coin, "first_team_id": v.first_team_id, "map": v.map,
            "side_team_id": v.side_team_id, "side": v.side, "turn": turn(v),
            "team_a": side(v.team_a_id), "team_b": side(v.team_b_id), "you": you,
            "created_at": v.created_at}


def key_team(v: Veto, key: str) -> int | None:
    """The team a veto link belongs to."""
    if key:
        h = sha256(key)
        if v.a_key_hash and secrets.compare_digest(h, v.a_key_hash):
            return v.team_a_id
        if v.b_key_hash and secrets.compare_digest(h, v.b_key_hash):
            return v.team_b_id
    return None


async def my_team(db: AsyncSession, request: Request) -> int | None:
    """The team whose captain is signed in, if any."""
    who = identity(request)
    if not who or not await is_verified(db, who):
        return None
    return await db.scalar(select(Team.id).join(Player, Team.leader_player_id == Player.id).where(
        Player.auth_provider == who["provider"], Player.auth_sub == who["sub"],
        Player.path == "leader", Player.status == "approved"))


# ---------- captains and spectators

@router.get("/vetoes/mine")
async def mine(request: Request, db: AsyncSession = Depends(get_db)):
    """The veto waiting on the signed-in captain (drives the Veto button in the nav)."""
    team = await my_team(db, request)
    if not team:
        return {"id": None}
    v = await db.scalar(select(Veto).where(Veto.status.in_(LIVE), or_(Veto.team_a_id == team, Veto.team_b_id == team))
                        .order_by(Veto.id.desc()))
    return {"id": v and v.id}


@router.get("/vetoes/{veto_id}")
async def get_veto(veto_id: int, request: Request, k: str = "", db: AsyncSession = Depends(get_db)):
    v = await db.get(Veto, veto_id)
    if not v:
        raise HTTPException(404, "Veto not found")
    team = key_team(v, k) or await my_team(db, request)
    return view(v, await _teams(db), team if team in (v.team_a_id, v.team_b_id) else None)


@router.post("/vetoes/{veto_id}/{action}")
async def move(veto_id: int, action: str, body: dict, request: Request, k: str = "", db: AsyncSession = Depends(get_db)):
    if action not in ("call", "ban", "side"):
        raise HTTPException(404, "Unknown move")
    v = await db.scalar(select(Veto).where(Veto.id == veto_id).with_for_update())
    if not v:
        raise HTTPException(404, "Veto not found")
    team = key_team(v, k) or await my_team(db, request)
    if team not in (v.team_a_id, v.team_b_id):
        raise HTTPException(403, "Only the two captains, or whoever has their team's veto link, can veto. "
                                 "Captains: sign in with the account you signed up with.")
    try:
        act(v, team, action, str(body.get("value", "")))
    except ValueError as e:
        raise HTTPException(409, str(e))
    audit(db, f"team:{team}", f"veto.{action}", veto_id=v.id, value=body.get("value"))
    await db.commit()
    return view(v, await _teams(db), team)


# ---------- organisers

@router.get("/admin/vetoes")
async def admin_vetoes(db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    teams = await _teams(db)
    vetoes = list(await db.scalars(select(Veto).order_by(Veto.id.desc())))
    sales = await active_sales(db)
    roster = lambda t, cap: [{"id": cap.id, "display_name": cap.display_name, "captain": True}] + [  # noqa: E731
        {"id": p.id, "display_name": p.display_name} for s, p in sales if s.team_id == t.id]
    return {"maps": MAPS, "last_pool": vetoes[0].pool if vetoes else [],
            "teams": [{**team_card(t), "captain": p.display_name, "has_account": bool(p.auth_sub), "players": roster(t, p)}
                      for t, p in teams.values()],
            "vetoes": [view(v, teams) for v in vetoes]}


@router.post("/admin/vetoes")
async def create_veto(body: dict, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    try:
        a, b = int(body.get("team_a")), int(body.get("team_b"))
    except (TypeError, ValueError):
        raise HTTPException(422, "Pick both teams")
    pool = [m for m in MAPS if m in (body.get("pool") or [])]
    teams = await _teams(db)
    if a == b or a not in teams or b not in teams:
        raise HTTPException(422, "Pick two different approved teams")
    if len(pool) < 2:
        raise HTTPException(422, "Pick at least 2 maps for the pool")
    busy = await db.scalar(select(Veto.id).where(Veto.status.in_(LIVE), or_(
        Veto.team_a_id.in_((a, b)), Veto.team_b_id.in_((a, b)))))
    if busy:
        raise HTTPException(409, "One of these teams already has a veto going. Finish or delete it first.")
    v = Veto(team_a_id=a, team_b_id=b, pool=pool, bans=[])
    db.add(v)
    await db.flush()
    audit(db, admin, "veto.created", veto_id=v.id, team_a=a, team_b=b, pool=pool)
    await db.commit()
    return view(v, teams)


@router.post("/admin/vetoes/{veto_id}/link")
async def veto_link(veto_id: int, body: dict, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    """Captain away: hand someone from the team a link that vetoes for that team. A new link revokes the old one."""
    v = await db.scalar(select(Veto).where(Veto.id == veto_id).with_for_update())
    if not v:
        raise HTTPException(404, "Veto not found")
    try:
        team_id, player_id = int(body.get("team_id")), int(body.get("player_id"))
    except (TypeError, ValueError):
        raise HTTPException(422, "Pick the team and the player")
    if team_id not in (v.team_a_id, v.team_b_id):
        raise HTTPException(422, "That team isn't in this veto")
    teams = await _teams(db)
    on_team = {teams[team_id][1].id} | {p.id for s, p in await active_sales(db) if s.team_id == team_id}
    p = await db.get(Player, player_id)
    if not p or p.id not in on_team:
        raise HTTPException(422, "Pick someone on that team")
    raw, h = new_token()
    if team_id == v.team_a_id:
        v.a_key_hash, v.a_delegate = h, p.display_name
    else:
        v.b_key_hash, v.b_delegate = h, p.display_name
    audit(db, admin, "veto.link", veto_id=v.id, team_id=team_id, player_id=p.id)
    await db.commit()
    return {"link": f"{SITE}/veto/{v.id}?k={raw}", "delegate": p.display_name}


@router.post("/admin/vetoes/{veto_id}/{action}")
async def admin_action(veto_id: int, action: str, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    v = await db.scalar(select(Veto).where(Veto.id == veto_id).with_for_update())
    if not v:
        raise HTTPException(404, "Veto not found")
    if action == "reset":
        v.status, v.call, v.coin, v.first_team_id, v.bans, v.map, v.side_team_id, v.side = \
            "coin", None, None, None, [], None, None, None
    elif action == "delete":
        await db.delete(v)
    else:
        raise HTTPException(404, "Unknown action")
    audit(db, admin, f"veto.{action}", veto_id=veto_id)
    await db.commit()
    return {"id": veto_id, "action": action}
