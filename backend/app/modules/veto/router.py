"""Map veto (BO1 or BO3, Challonge style). The organiser pairs two teams and sends each captain their team's link (or they sign in);
they call a coin toss and take turns: BO1 bans until one map is left; BO3 bans two, picks two (the other team picks the side
on each pick), bans the rest, and the last map left is the decider. The team that didn't make the last move picks the
decider's side. Anyone with the link can watch."""
import hmac
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import SECRET_KEY, SITE, audit, get_db, new_token, require_admin, sha256
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


def plan(v: Veto) -> list[str]:
    """Every ban/pick in order; the toss winner makes the 1st, 3rd, 5th... The map left after them is the decider."""
    n = len(v.pool)
    if v.bo == 3:
        first = min(2, n - 3)
        return ["ban"] * first + ["pick", "pick"] + ["ban"] * (n - 3 - first)
    return ["ban"] * (n - 1)


def step_team(v: Veto, i: int) -> int | None:
    return v.first_team_id and (v.first_team_id if i % 2 == 0 else other(v, v.first_team_id))


def turn(v: Veto) -> int | None:
    """Whose move it is."""
    if v.status == "coin":
        return v.team_a_id
    if v.status == "ban":
        return step_team(v, len(v.bans))
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
    elif action in ("ban", "pick") and v.status == "ban":
        if action != plan(v)[len(v.bans)]:
            raise ValueError(f"This move is a {plan(v)[len(v.bans)]}")
        if value not in remaining(v):
            raise ValueError("That map isn't in the pool any more")
        v.bans = [*v.bans, {"team_id": team_id, "map": value, "kind": action}]
        if action == "pick":   # the other team picks the side on this map
            v.side_team_id, v.status = other(v, team_id), "side"
        else:
            _next(v)
    elif action == "side" and v.status == "side":
        if value not in ("attack", "defense"):
            raise ValueError("Pick attack or defense")
        if v.map:   # the decider: veto over
            v.side, v.status = value, "done"
        else:       # side on a picked map, then the veto goes on
            v.bans = [*v.bans[:-1], {**v.bans[-1], "side_team_id": v.side_team_id, "side": value}]
            v.side_team_id, v.status = None, "ban"
            _next(v)
    else:
        raise ValueError("That move isn't open right now")


def _next(v: Veto) -> None:
    """After a move: once every ban/pick is made, the map left is the decider and the team that didn't move last picks its side."""
    if len(v.bans) == len(plan(v)):
        v.map, v.side_team_id, v.status = remaining(v)[0], other(v, v.bans[-1]["team_id"]), "side"


def maps(v: Veto) -> list[dict]:
    """The maps to play, in order: the picks, then the decider."""
    out = [{"map": b["map"], "picked_by": b["team_id"], "side_team_id": b.get("side_team_id"), "side": b.get("side")}
           for b in v.bans if b.get("kind") == "pick"]
    if v.map:
        out.append({"map": v.map, "picked_by": None, "side_team_id": v.side_team_id, "side": v.side})
    return out


# ---------- views

async def _teams(db: AsyncSession) -> dict[int, tuple[Team, Player]]:
    return {t.id: (t, leader) for t, leader in await auction_teams(db) if t.profile_status == "approved"}


def view(v: Veto, teams: dict, you: int | None = None) -> dict:
    stand_in = {v.team_a_id: v.a_delegate, v.team_b_id: v.b_delegate}
    side = lambda tid: {**team_card(teams[tid][0]), "captain": teams[tid][1].display_name,  # noqa: E731
                        "delegate": stand_in.get(tid)} if tid in teams else None
    steps = [{"kind": k, "team_id": step_team(v, i), "map": v.bans[i]["map"] if i < len(v.bans) else None}
             for i, k in enumerate(plan(v))]
    return {"id": v.id, "bo": v.bo, "steps": steps, "step": plan(v)[len(v.bans)] if v.status == "ban" else None,
            "maps": maps(v), "status": v.status, "pool": v.pool, "remaining": remaining(v), "bans": v.bans,
            "call": v.call, "coin": v.coin, "first_team_id": v.first_team_id, "map": v.map,
            "side_team_id": v.side_team_id, "side": v.side, "turn": turn(v),
            "team_a": side(v.team_a_id), "team_b": side(v.team_b_id), "you": you,
            "created_at": v.created_at}


def team_key(v: Veto, team_id: int) -> str:
    """The key in a team's veto link. Signed, so the organiser can copy it again any time.
    ponytail: can't be revoked on its own; if one leaks, delete the veto and start a new one (new id, new links)."""
    return hmac.new(SECRET_KEY.encode(), f"veto.{v.id}.{team_id}".encode(), "sha256").hexdigest()[:32]


def admin_view(v: Veto, teams: dict) -> dict:
    """The view plus each team's private link. Never send this from a public route."""
    return {**view(v, teams), "links": {t: f"/veto/{v.id}?k={team_key(v, t)}" for t in (v.team_a_id, v.team_b_id)}}


def key_team(v: Veto, key: str) -> int | None:
    """The team a veto link belongs to."""
    if key:
        for t in (v.team_a_id, v.team_b_id):
            if secrets.compare_digest(key.encode(), team_key(v, t).encode()):
                return t
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
    if action not in ("call", "ban", "pick", "side"):
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
            "vetoes": [admin_view(v, teams) for v in vetoes]}


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
    bo = 3 if body.get("bo") == 3 else 1
    if len(pool) < bo + 1:
        raise HTTPException(422, f"Pick at least {bo + 1} maps for a BO{bo} pool")
    busy = await db.scalar(select(Veto.id).where(Veto.status.in_(LIVE), or_(
        Veto.team_a_id.in_((a, b)), Veto.team_b_id.in_((a, b)))))
    if busy:
        raise HTTPException(409, "One of these teams already has a veto going. Finish or delete it first.")
    v = Veto(team_a_id=a, team_b_id=b, pool=pool, bans=[], bo=bo)
    db.add(v)
    await db.flush()
    audit(db, admin, "veto.created", veto_id=v.id, team_a=a, team_b=b, pool=pool, bo=bo)
    await db.commit()
    return admin_view(v, teams)


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
