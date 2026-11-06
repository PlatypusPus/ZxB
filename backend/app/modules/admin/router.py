"""Admin console API: login, verification queue, payments, approvals, team profiles, settings, exports."""
import csv
import io
import re
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import (ADMIN_EMAIL, ADMIN_PASSWORD_HASH, PRIVATE_DIR, audit, check_password, get_db, new_token,
                     publish, rate_limit, require_admin, sign_admin_token, utcnow)
from ...models import AuditLog, Payment, Player, Team
from ...tournament import approved_leaders, load, settings

router = APIRouter(prefix="/admin")


@router.post("/login")
async def login(body: dict, request: Request):
    rate_limit(request, "login", 10, 600)
    if not (str(body.get("email", "")).lower() == ADMIN_EMAIL
            and check_password(str(body.get("password", "")), ADMIN_PASSWORD_HASH)):
        raise HTTPException(401, "Wrong email or password")
    return {"token": sign_admin_token()}


@router.get("/queue")
async def queue(status: str = "", db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    _, cfg = await load(db)
    q = (select(Player, Payment, Team).join(Payment, Payment.player_id == Player.id)
         .outerjoin(Team, Team.leader_player_id == Player.id).order_by(Player.created_at))
    if status:
        q = q.where(Player.status == status)
    return [{"id": p.id, "display_name": p.display_name, "riot_id": p.riot_id, "role": p.role, "path": p.path,
             "status": p.status, "reject_reason": p.reject_reason, "phone": p.phone, "discord": p.discord,
             "current_rank": cfg["ranks"][p.current_rank_tier - 1], "peak_rank": cfg["ranks"][p.peak_rank_tier - 1],
             "photo_url": p.photo and f"/media/{p.photo}", "created_at": p.created_at,
             "tracker_url": cfg["tracker_url"].format(riot_id=quote(p.riot_id, safe="")),
             "payment": {"id": pay.id, "utr": pay.utr, "amount": pay.amount, "status": pay.status,
                         "screenshot": pay.screenshot, "note": pay.note},
             "team": team and {"id": team.id, "name": team.name, "tag": team.tag, "logo_url": f"/media/{team.logo}",
                               "profile_status": team.profile_status}}
            for p, pay, team in await db.execute(q)]


@router.get("/files/{name}")
async def private_file(name: str, admin: str = Depends(require_admin)):
    # Bytes, not FileResponse: no Range parsing, and the strict name pattern blocks path tricks.
    if not re.fullmatch(r"[0-9a-f]{32}\.webp", name) or not (PRIVATE_DIR / name).is_file():
        raise HTTPException(404)
    return Response((PRIVATE_DIR / name).read_bytes(), media_type="image/webp",
                    headers={"Cache-Control": "private, no-store"})


async def player_and_payment(db: AsyncSession, player_id: int):
    p = await db.get(Player, player_id, with_for_update=True)
    if not p:
        raise HTTPException(404, "Player not found")
    pay = await db.scalar(select(Payment).where(Payment.player_id == p.id).with_for_update())
    return p, pay


async def pay_of(db: AsyncSession, payment_id: int):
    pay = await db.get(Payment, payment_id, with_for_update=True)
    if not pay:
        raise HTTPException(404, "Payment not found")
    return await player_and_payment(db, pay.player_id)


@router.post("/payments/{payment_id}/verify")
async def verify_payment(payment_id: int, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    p, pay = await pay_of(db, payment_id)
    if pay.status != "submitted":
        raise HTTPException(409, f"Payment is already {pay.status}")
    pay.status, pay.verified_by, pay.verified_at = "verified", admin, utcnow()
    if p.status == "submitted":
        p.status = "verified"
    audit(db, admin, "payment.verified", payment_id=pay.id, player_id=p.id, utr=pay.utr)
    await db.commit()
    publish("payment.verified", player_id=p.id)
    return {"payment_status": pay.status, "status": p.status}


@router.post("/payments/{payment_id}/reject")
async def reject_payment(payment_id: int, body: dict, db: AsyncSession = Depends(get_db),
                         admin: str = Depends(require_admin)):
    reason = str(body.get("reason", "")).strip()
    if not reason:
        raise HTTPException(422, "Give a reason; the player will see it")
    p, pay = await pay_of(db, payment_id)
    if pay.status == "refunded":
        raise HTTPException(409, "Payment is already refunded")
    pay.status, pay.note, pay.verified_by, pay.verified_at = "rejected", reason, admin, utcnow()
    p.status, p.reject_reason = "rejected", reason
    audit(db, admin, "payment.rejected", payment_id=pay.id, player_id=p.id, reason=reason)
    await db.commit()
    return {"payment_status": pay.status, "status": p.status}


@router.post("/payments/{payment_id}/refund")
async def refund_payment(payment_id: int, body: dict, db: AsyncSession = Depends(get_db),
                         admin: str = Depends(require_admin)):
    p, pay = await pay_of(db, payment_id)
    if p.status not in ("rejected", "withdrawn", "waitlisted"):
        raise HTTPException(409, "Reject or withdraw the sign-up before refunding")
    if pay.status not in ("verified", "rejected"):
        raise HTTPException(409, f"Payment is {pay.status}; only received money can be refunded")
    pay.status, pay.note = "refunded", str(body.get("note", "")).strip() or pay.note
    audit(db, admin, "payment.refunded", payment_id=pay.id, player_id=p.id, amount=pay.amount)
    await db.commit()
    return {"payment_status": pay.status}


@router.post("/players/{player_id}/approve")
async def approve_player(player_id: int, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    t, _ = await load(db, lock=True)  # tournament row lock serialises approvals, so two can't take the 8th slot
    p, pay = await player_and_payment(db, player_id)
    if pay.status != "verified":
        raise HTTPException(409, "Verify the payment first")
    if p.status not in ("verified", "waitlisted"):
        raise HTTPException(409, f"Sign-up is {p.status}")
    access_link_code = None
    if p.path == "leader":
        if await approved_leaders(db) >= t.settings["teams"]:
            p.status = "waitlisted"
            audit(db, admin, "player.waitlisted", player_id=p.id)
            await db.commit()
            return {"status": p.status}
        team = await db.scalar(select(Team).where(Team.leader_player_id == p.id))
        access_link_code, team.access_code_hash = new_token()
    p.status = "approved"
    audit(db, admin, "player.approved", player_id=p.id, path=p.path)
    await db.commit()
    publish("player.approved", player_id=p.id)
    # The raw leader code is shown once; send it over WhatsApp. Lost it? Approving can't repeat, use /teams/{id}/new-code.
    return {"status": p.status, "leader_code": access_link_code}


@router.post("/players/{player_id}/reject")
async def reject_player(player_id: int, body: dict, db: AsyncSession = Depends(get_db),
                        admin: str = Depends(require_admin)):
    reason = str(body.get("reason", "")).strip()
    if not reason:
        raise HTTPException(422, "Give a reason; the player will see it")
    p, _ = await player_and_payment(db, player_id)
    p.status, p.reject_reason = "rejected", reason
    audit(db, admin, "player.rejected", player_id=p.id, reason=reason)
    await db.commit()
    return {"status": p.status}


@router.post("/players/{player_id}/withdraw")
async def withdraw_player(player_id: int, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    t, _ = await load(db)
    if t.locked_at:
        raise HTTPException(409, "The auction has started")
    p, _ = await player_and_payment(db, player_id)
    p.status = "withdrawn"
    audit(db, admin, "player.withdrawn", player_id=p.id)
    await db.commit()
    return {"status": p.status}


@router.post("/players/{player_id}/make-auction-player")
async def leader_to_player(player_id: int, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    """A waitlisted (or not yet approved) leader switches to the auction pool."""
    p, pay = await player_and_payment(db, player_id)
    if p.path != "leader" or p.status in ("approved", "rejected", "withdrawn"):
        raise HTTPException(409, "Only a leader who isn't approved yet can switch")
    await db.execute(delete(Team).where(Team.leader_player_id == p.id))
    p.path = "auction"
    if p.status == "waitlisted":
        p.status = "verified" if pay.status == "verified" else "submitted"
    audit(db, admin, "player.switched_to_auction", player_id=p.id)
    await db.commit()
    return {"status": p.status, "path": p.path}


@router.post("/teams/{team_id}/approve-profile")
async def approve_team(team_id: int, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    team = await db.get(Team, team_id)
    if not team:
        raise HTTPException(404, "Team not found")
    team.profile_status = "approved"
    audit(db, admin, "team.profile_approved", team_id=team.id, name=team.name, tag=team.tag)
    await db.commit()
    publish("team.created", team_id=team.id)
    return {"profile_status": team.profile_status}


@router.post("/teams/{team_id}/new-code")
async def new_leader_code(team_id: int, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    """Revokes the old leader link and issues a new one."""
    team = await db.get(Team, team_id)
    if not team or not team.access_code_hash:
        raise HTTPException(404, "No approved leader for this team")
    code, team.access_code_hash = new_token()
    audit(db, admin, "team.code_reissued", team_id=team.id)
    await db.commit()
    return {"leader_code": code}


INT_KEYS = {"fee", "teams", "credits_per_team", "min_players", "max_players", "flat_base_price", "bid_increment",
            "bid_increment_high", "bid_increment_from", "bid_timer", "bid_reset", "round2_discount"}
CAN_BE_ZERO = {"bid_increment_from", "bid_timer", "round2_discount"}
CHOICES = {"base_price_mode": ("band", "flat"), "lot_order": ("rank_band", "random")}
SETTINGS_KEYS = INT_KEYS | set(CHOICES) | {"event_date", "upi_id", "upi_name", "registration_opens_at",
                                           "registration_closes_at", "role_caps", "band_base_price"}


@router.put("/settings")
async def put_settings(body: dict, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    t, _ = await load(db, lock=True)
    if t.locked_at:
        raise HTTPException(409, "Settings are locked once the auction starts")
    changes = {k: v for k, v in body.get("settings", {}).items() if k in SETTINGS_KEYS}
    for k in ("registration_opens_at", "registration_closes_at"):
        if changes.get(k):
            try:
                if datetime.fromisoformat(changes[k]).tzinfo is None:
                    raise ValueError
            except ValueError:
                raise HTTPException(422, {"errors": {k: "Use an ISO time with a timezone, e.g. 2026-11-20T18:00+05:30"}})
    for k in INT_KEYS & changes.keys():
        v = changes[k]
        if v is None and k == "max_players":
            continue
        if not isinstance(v, int) or isinstance(v, bool) or v < (0 if k in CAN_BE_ZERO else 1):
            raise HTTPException(422, {"errors": {k: "Must be a whole number" + ("" if k in CAN_BE_ZERO else " above 0")}})
    if changes.get("round2_discount", 0) > 100:
        raise HTTPException(422, {"errors": {"round2_discount": "A percentage, 0 to 100"}})
    for k, ok in CHOICES.items():
        if k in changes and changes[k] not in ok:
            raise HTTPException(422, {"errors": {k: "One of " + ", ".join(ok)}})
    for k in ("role_caps", "band_base_price"):
        v = changes.get(k)
        if v is not None and not (isinstance(v, dict) and all(isinstance(x, int) and x >= 0 for x in v.values())):
            raise HTTPException(422, {"errors": {k: "A map of name to whole number"}})
    t.settings = {**t.settings, **changes}
    if body.get("status") in ("draft", "registration_open", "registration_closed") and not t.locked_at:
        t.status = body["status"]
    if body.get("name"):
        t.name = str(body["name"])[:80]
    audit(db, admin, "settings.changed", changes=changes, status=t.status, name=t.name)
    await db.commit()
    return {"name": t.name, "status": t.status, "settings": t.settings}


@router.get("/settings")
async def get_settings(db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    t, _ = await load(db)
    return {"name": t.name, "status": t.status, "settings": settings(t), "locked": bool(t.locked_at)}


@router.get("/payments.csv")
async def payments_csv(db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    rows = await db.execute(select(Payment, Player).join(Player, Payment.player_id == Player.id).order_by(Payment.id))
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["payment_id", "display_name", "riot_id", "utr", "amount", "status", "verified_by", "verified_at",
                "submitted_at", "note"])
    totals = {"verified": 0, "refunded": 0}
    for pay, p in rows:
        w.writerow([pay.id, p.display_name, p.riot_id, pay.utr, pay.amount, pay.status, pay.verified_by or "",
                    pay.verified_at.isoformat() if pay.verified_at else "", pay.created_at.isoformat(), pay.note])
        if pay.status in totals:
            totals[pay.status] += pay.amount
    w.writerow([])
    w.writerow(["total_verified", totals["verified"]])
    w.writerow(["total_refunded", totals["refunded"]])
    return Response(out.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=payments.csv"})


@router.get("/audit")
async def audit_log(db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin), limit: int = 200):
    rows = await db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(min(limit, 1000)))
    return [{"id": a.id, "actor": a.actor, "action": a.action, "payload": a.payload, "at": a.created_at} for a in rows]
