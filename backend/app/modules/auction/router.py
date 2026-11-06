"""Auction API: admin live control, leader bidding, public snapshot + WebSocket stream, results."""
import asyncio
import csv
import io
import logging
import os

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, Response, UploadFile, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import PUBLIC_DIR, Session, audit, get_db, image_name, process_image, rate_limit_key, require_admin, sha256
from ...models import Team
from ...tournament import TAG, load, settings
from ..realtime import hub
from . import service

router = APIRouter()
log = logging.getLogger("auction")
ALLOWED_ORIGINS = {o for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o}  # empty = allow (dev)


async def push(event: str, **extra) -> None:
    """Every change goes out as the full snapshot plus what happened; clients just re-render."""
    async with Session() as db:
        snap = await service.snapshot(db)
    await hub.broadcast({"event": event, **extra, "snapshot": snap})


@router.get("/auction/snapshot")
async def get_snapshot(db: AsyncSession = Depends(get_db)):
    return await service.snapshot(db)


@router.websocket("/ws")
async def ws(socket: WebSocket):
    if ALLOWED_ORIGINS and socket.headers.get("origin") not in ALLOWED_ORIGINS:
        await socket.close(code=4403)
        return
    await socket.accept()
    hub.clients.add(socket)
    try:
        async with Session() as db:
            await socket.send_json({"event": "hello", "snapshot": await service.snapshot(db)})
        while True:
            await socket.receive_text()   # clients don't talk; this just notices disconnects
    except WebSocketDisconnect:
        pass
    finally:
        hub.clients.discard(socket)


# ---------- admin live control

def admin_action(name: str):
    async def run(db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
        if name == "start":
            await service.start(db, admin)
            await push("auction.started")
        elif name == "next":
            lot = await service.open_next(db, admin)
            await push("lot.opened", lot_id=lot.id)
        elif name in ("sold", "unsold"):
            lot = await service.close_lot(db, admin, force_unsold=name == "unsold")
            await push("lot.closed", lot_id=lot.id, result=lot.status)
        elif name in ("pause", "resume"):
            await service.pause(db, admin, on=name == "pause")
            await push("auction." + ("paused" if name == "pause" else "resumed"))
        elif name == "undo":
            sale = await service.undo_last_sale(db, admin)
            await push("sale.undone", player_id=sale.player_id, team_id=sale.team_id)
        elif name == "assign-leftovers":
            placed = await service.assign_leftovers(db, admin)
            await push("auction.completed", assigned=placed)
        return await service.snapshot(db)
    return run


for _name in ("start", "next", "sold", "unsold", "pause", "resume", "undo", "assign-leftovers"):
    router.post(f"/admin/auction/{_name}")(admin_action(_name))


@router.post("/admin/auction/proxy-bid")
async def proxy_bid(body: dict, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    """For a leader whose phone died. Labelled admin_proxy in the audit log."""
    bid = await service.place_bid(db, int(body.get("team_id", 0)), int(body.get("lot_id", 0)), int(body.get("amount", 0)), "admin_proxy")
    await push("bid.accepted", team_id=bid.team_id, amount=bid.amount, proxy=True)
    return {"ok": True}


# ---------- leaders

async def leader_team(authorization: str = Header(""), db: AsyncSession = Depends(get_db)) -> Team:
    code = authorization.removeprefix("Leader ").strip()
    team = code and await db.scalar(select(Team).where(Team.access_code_hash == sha256(code)))
    if not team:
        raise HTTPException(401, "This leader link is invalid or was replaced. Ask the organisers for a new one.")
    return team


@router.get("/leader/me")
async def leader_me(team: Team = Depends(leader_team), db: AsyncSession = Depends(get_db)):
    t, _ = await load(db)
    return {"team_id": team.id, "name": team.name, "tag": team.tag, "logo_url": f"/media/{team.logo}",
            "profile_status": team.profile_status, "editable": not t.locked_at}


@router.post("/leader/bid")
async def leader_bid(body: dict, team: Team = Depends(leader_team), db: AsyncSession = Depends(get_db)):
    rate_limit_key(f"bid:{team.id}", 5, 1)
    bid = await service.place_bid(db, team.id, int(body.get("lot_id", 0)), int(body.get("amount", 0)), "leader")
    await push("bid.accepted", team_id=bid.team_id, amount=bid.amount)
    return {"ok": True, "amount": bid.amount}


@router.patch("/leader/team")
async def leader_edit_team(name: str = Form(""), tag: str = Form(""), logo: UploadFile | None = File(None),
                           team: Team = Depends(leader_team), db: AsyncSession = Depends(get_db)):
    t, _ = await load(db)
    if t.locked_at:
        raise HTTPException(409, "Team profiles are locked once the auction starts")
    errors = {}
    name, tag = name.strip() or team.name, tag.strip() or team.tag
    if not 3 <= len(name) <= 24:
        errors["name"] = "Use 3 to 24 characters"
    if not TAG.match(tag):
        errors["tag"] = "2 to 4 uppercase letters"
    if errors:
        raise HTTPException(422, {"errors": errors})
    new_logo = None
    if logo and logo.filename:
        new_logo = (PUBLIC_DIR / image_name(), process_image(await logo.read(2**21 + 1), "logo", True))
    team.name, team.name_key, team.tag = name, name.lower(), tag
    if new_logo:
        new_logo[0].write_bytes(new_logo[1])
        team.logo = new_logo[0].name
    team.profile_status = "pending"   # changes go back through admin approval before showing publicly
    audit(db, f"team:{team.id}", "team.profile_edited", name=name, tag=tag, logo=bool(new_logo))
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        field = "name" if "uq_team_name" in str(e.orig) else "tag"
        raise HTTPException(409, {"errors": {field: f"Team {field} already taken"}})
    return {"name": team.name, "tag": team.tag, "logo_url": f"/media/{team.logo}", "profile_status": team.profile_status}


# ---------- results

async def _results(db: AsyncSession) -> list[dict]:
    snap = await service.snapshot(db)
    return [{"name": tm["name"], "tag": tm["tag"], "leader": tm["leader"], "credits_left": tm["credits_left"],
             "roster": tm["roster"]} for tm in snap["teams"]]


@router.get("/results")
async def results(db: AsyncSession = Depends(get_db)):
    t, _ = await load(db)
    if t.status != "completed":
        raise HTTPException(404, "Results are published when the auction ends")
    return await _results(db)


@router.get("/admin/results.csv")
async def results_csv(db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    """Downloadable state after every sale: the spreadsheet fallback if the server dies mid-auction."""
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["team", "tag", "leader", "player", "role", "rank", "price", "team_credits_left"])
    for tm in await _results(db):
        for p in tm["roster"]:
            w.writerow([tm["name"], tm["tag"], tm["leader"], p["display_name"], p["role"], p["current_rank"], p["price"], tm["credits_left"]])
        if not tm["roster"]:
            w.writerow([tm["name"], tm["tag"], tm["leader"], "", "", "", "", tm["credits_left"]])
    return Response(out.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=results.csv"})


# ---------- server-side timer

async def timer_loop() -> None:
    # ponytail: polls 5x a second; fine for one auction, schedule exact wake-ups if it ever matters.
    while True:
        await asyncio.sleep(0.2)
        try:
            async with Session() as db:
                lot = await service.close_lot(db, "timer", only_if_expired=True)
            if lot:
                await push("lot.closed", lot_id=lot.id, result=lot.status)
        except Exception:
            log.exception("timer loop")
