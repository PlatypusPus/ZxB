"""Admin console API: login, verification queue, payments, approvals, team profiles, settings, exports."""
import csv
import io
import re
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, Response, UploadFile
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

import asyncio
import os

from ...core import (ADMIN_EMAIL, ADMIN_PASSWORD_HASH, PRIVATE_DIR, PUBLIC_DIR, audit, image_name, mail_html, process_image, send_mail, send_many, SITE, check_password, get_db, new_token,
                     publish, rate_limit, require_admin, sign_admin_token, utcnow)
from ...models import AuditLog, Lot, Payment, Player, Sale, Team
from ..auction.service import active_sales, auction_teams
from ...tournament import RIOT_ID, TERMS_VERSION, approved_leaders, load, settings

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
             "follows": p.follows,
             "signed_in_with": p.auth_provider and f"{p.auth_provider.title()} {p.auth_email or ''}".strip(),
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
    if pay.status not in ("submitted", "due"):
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


async def notify(p: Player, event_name: str, subject: str, body: str, button: tuple[str, str] | None = None) -> bool:
    """Email the person at their sign-in email. Runs after the commit, so a mail failure never undoes a decision."""
    text = f"Hi {p.display_name},\n\n{body}\n\nYour profile: {SITE}/profile\n\n{event_name}\n{SITE}\n"
    paras = [f"Hi {p.display_name},", *body.split("\n\n")]
    button = button or ("Open my profile", f"{SITE}/profile")
    if button:   # the link is the button in HTML, so drop its bare-URL paragraph
        paras = [x for x in paras if x.strip() != button[1]]
    return await asyncio.to_thread(send_mail, p.auth_email or "", f"{event_name}: {subject}", text,
                                   mail_html(subject[:1].upper() + subject[1:], paras, button))


@router.post("/players/{player_id}/approve")
async def approve_player(player_id: int, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    t, _ = await load(db, lock=True)  # tournament row lock serialises approvals, so two can't take the 8th slot
    p, pay = await player_and_payment(db, player_id)
    if pay.status != "verified" and p.path != "leader":   # captains are approved before their fee is in
        raise HTTPException(409, "Verify the payment first")
    if p.status not in ("verified", "waitlisted", "submitted" if p.path == "leader" else "verified"):
        raise HTTPException(409, f"Sign-up is {p.status}")
    access_link_code = None
    if p.path == "leader":
        if await approved_leaders(db) >= t.settings["teams"]:
            p.status = "waitlisted"
            audit(db, admin, "player.waitlisted", player_id=p.id)
            await db.commit()
            emailed = await notify(p, t.name, "you're on the captain waitlist",
                                   "All captain slots are full right now, so you're on the waitlist. If a slot opens you'll "
                                   "hear from us, or the organisers may move you into the auction player pool.")
            return {"status": p.status, "emailed": emailed}
        team = await db.scalar(select(Team).where(Team.leader_player_id == p.id))
        access_link_code, team.access_code_hash = new_token()
    p.status = "approved"
    audit(db, admin, "player.approved", player_id=p.id, path=p.path)
    await db.commit()
    publish("player.approved", player_id=p.id)
    # The raw leader code is shown once and emailed. Lost it? Approving can't repeat, use /teams/{id}/new-code.
    if p.path == "leader":
        emailed = await notify(p, t.name, "you're selected as a captain",
                               "You've been selected as a captain. Use your private captain link to set your team name, "
                               f"tag and logo before the auction:\n\n{SITE}/leader/{access_link_code}\n\n"
                               "Keep this link to yourself; anyone with it can edit your team.",
                               ("Open my captain page", f"{SITE}/leader/{access_link_code}"))
    else:
        emailed = await notify(p, t.name, "your sign-up is approved",
                               "You're in the sub pool. We'll be in touch when a team needs you." if p.path == "sub" else
                               "You're in the auction player pool. Captains will bid for you live on auction day.")
    return {"status": p.status, "leader_code": access_link_code, "emailed": emailed}


@router.post("/players/{player_id}/reject")
async def reject_player(player_id: int, body: dict, db: AsyncSession = Depends(get_db),
                        admin: str = Depends(require_admin)):
    reason = str(body.get("reason", "")).strip()
    if not reason:
        raise HTTPException(422, "Give a reason; the player will see it")
    p, pay = await player_and_payment(db, player_id)
    if p.path == "leader" and p.status not in ("rejected", "withdrawn"):
        # A captain who isn't accepted stays in the event as an auction player.
        t, _ = await load(db)
        if t.locked_at:
            raise HTTPException(409, "The auction has started")
        await db.execute(delete(Team).where(Team.leader_player_id == p.id))
        p.path, p.status = "auction", "verified" if pay.status == "verified" else "submitted"
        audit(db, admin, "player.captain_rejected", player_id=p.id, reason=reason)
        await db.commit()
        emailed = await notify(p, t.name, "you weren't selected as a captain",
                               f"You weren't selected as a captain.\n\nReason: {reason}\n\nYou're still in: you've been moved "
                               "into the auction player pool, and captains will bid for you live on auction day.")
        return {"status": p.status, "path": p.path, "emailed": emailed}
    p.status, p.reject_reason = "rejected", reason
    audit(db, admin, "player.rejected", player_id=p.id, reason=reason)
    await db.commit()
    t, _ = await load(db)
    what = "as a captain" if p.path == "leader" else "for this event"
    emailed = await notify(p, t.name, "sign-up not accepted",
                           f"Sorry, your sign-up {what} wasn't accepted.\n\nReason: {reason}\n\n"
                           "Message the organisers if you have questions.")
    return {"status": p.status, "emailed": emailed}


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


@router.post("/players/{player_id}/delete")
async def delete_player(player_id: int, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    """Remove a sign-up completely: the player, their payment, their team and uploaded files. For junk and test entries."""
    t, _ = await load(db)
    if t.locked_at:
        raise HTTPException(409, "The auction has started")
    p = await db.get(Player, player_id)
    if not p:
        raise HTTPException(404, "Not found")
    if await db.scalar(select(Lot.id).where(Lot.player_id == p.id).limit(1)):
        raise HTTPException(409, "This player has been in the auction")
    pay = await db.scalar(select(Payment).where(Payment.player_id == p.id))
    team = await db.scalar(select(Team).where(Team.leader_player_id == p.id))
    files = [(PUBLIC_DIR, p.photo), (PRIVATE_DIR, pay and pay.screenshot), (PUBLIC_DIR, team and team.logo)]
    await db.execute(delete(Team).where(Team.leader_player_id == p.id))
    await db.execute(delete(Payment).where(Payment.player_id == p.id))
    await db.delete(p)
    audit(db, admin, "player.deleted", player_id=player_id, riot_id=p.riot_id, path=p.path, status=p.status)
    await db.commit()
    for folder, name in files:
        if name and "/" not in name and "\\" not in name:
            (folder / name).unlink(missing_ok=True)
    return {"deleted": player_id}


@router.post("/players/{player_id}/make-auction-player")
async def leader_to_player(player_id: int, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    """A waitlisted (or not yet approved) leader switches to the auction pool."""
    p, pay = await player_and_payment(db, player_id)
    if p.path != "leader" or p.status in ("approved", "rejected", "withdrawn"):
        raise HTTPException(409, "Only a captain who isn't approved yet can switch")
    await db.execute(delete(Team).where(Team.leader_player_id == p.id))
    p.path = "auction"
    if p.status == "waitlisted":
        p.status = "verified" if pay.status == "verified" else "submitted"
    audit(db, admin, "player.switched_to_auction", player_id=p.id)
    await db.commit()
    t, _ = await load(db)
    emailed = await notify(p, t.name, "you weren't selected as a captain",
                           "You weren't selected as a captain this time, so you've been moved into the auction player "
                           "pool. Captains will bid for you live on auction day.")
    return {"status": p.status, "path": p.path, "emailed": emailed}


@router.post("/players")
async def add_player(body: dict, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    """Organiser adds someone by hand: name, Riot ID, rank and role. They go straight in, approved."""
    t, cfg = await load(db)
    if t.locked_at:
        raise HTTPException(409, "The auction has started")
    name, riot = str(body.get("display_name", "")).strip(), str(body.get("riot_id", "")).strip()
    rank, role, path = int(body.get("rank") or 0), body.get("role"), body.get("path", "auction")
    if not 1 <= len(name) <= 32 or not RIOT_ID.match(riot) or not 1 <= rank <= len(cfg["ranks"])             or role not in cfg["roles"] or path not in ("auction", "sub"):
        raise HTTPException(422, "Fill in the name, a Riot ID like name#tag, a rank and a role")
    if await db.scalar(select(Player.id).where(Player.riot_id_key == riot.lower(),
                                               Player.status.not_in(["rejected", "withdrawn"]))):
        raise HTTPException(409, f"{riot} is already signed up")
    p = Player(display_name=name, riot_id=riot, riot_id_key=riot.lower(), current_rank_tier=rank, peak_rank_tier=rank,
               role=role, playstyle="", discord="", phone="", path=path, status="approved",
               edit_token_hash=new_token()[1], terms_version=TERMS_VERSION, terms_accepted_at=utcnow())
    db.add(p)
    await db.flush()
    db.add(Payment(player_id=p.id, amount=0, utr=f"FREE{p.id}", screenshot="", status="verified", verified_by=admin,
                   verified_at=utcnow()) if path == "sub" else
           Payment(player_id=p.id, amount=t.settings["fee"], utr=f"DUE{p.id}", screenshot="", status="due"))
    audit(db, admin, "player.added", player_id=p.id, riot_id=riot, path=path)
    await db.commit()
    publish("player.approved", player_id=p.id)
    return {"id": p.id, "status": p.status, "path": p.path}


@router.post("/players/{player_id}/switch-path")
async def switch_path(player_id: int, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    """Auction player <-> sub. Only organisers can do this; players ask them."""
    t, _ = await load(db)
    if t.locked_at:
        raise HTTPException(409, "The auction has started")
    p, pay = await player_and_payment(db, player_id)
    if p.path not in ("auction", "sub"):
        raise HTTPException(409, "Only auction players and subs can switch")
    p.path = "sub" if p.path == "auction" else "auction"
    if p.path == "sub" and pay.status == "due":   # subs are free
        pay.amount, pay.status, pay.verified_by, pay.verified_at = 0, "verified", admin, utcnow()
        p.status = "verified" if p.status == "submitted" else p.status
    elif p.path == "auction" and pay.amount == 0:   # a free sub now owes the entry fee
        pay.amount, pay.status, pay.verified_by, pay.verified_at = t.settings["fee"], "due", None, None
        p.status = "submitted" if p.status == "verified" else p.status
    audit(db, admin, "player.switched", player_id=p.id, path=p.path)
    await db.commit()
    return {"status": p.status, "path": p.path}


@router.post("/teams/{team_id}/approve-profile")
async def approve_team(team_id: int, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    team = await db.get(Team, team_id)
    if not team:
        raise HTTPException(404, "Team not found")
    leader = await db.get(Player, team.leader_player_id)
    r = {}
    if leader.status != "approved":
        # Approving a team approves its captain too: that takes a slot and makes the team public.
        r = await approve_player(leader.id, db, admin)
        if r["status"] != "approved":
            return r   # waitlisted: every captain slot is taken
        team = await db.get(Team, team_id)
    team.profile_status = "approved"
    audit(db, admin, "team.profile_approved", team_id=team.id, name=team.name, tag=team.tag)
    await db.commit()
    publish("team.created", team_id=team.id)
    return {**r, "profile_status": team.profile_status}


async def approve_waiting_captains(db: AsyncSession):
    """Run at startup: teams approved before approving a team also approved its captain get their captain now."""
    ids = (await db.scalars(select(Team.id).join(Player, Team.leader_player_id == Player.id)
                            .where(Team.profile_status == "approved", Player.status.in_(["verified", "submitted"])))).all()
    for team_id in ids:
        try:
            await approve_team(team_id, db, "system")
        except HTTPException:
            await db.rollback()


@router.get("/rosters")
async def rosters(db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    """Each approved team's captain and bought players, plus who could replace someone who backs out."""
    _, cfg = await load(db)
    card = lambda p: {"id": p.id, "display_name": p.display_name, "riot_id": p.riot_id, "role": p.role,  # noqa: E731
                      "rank": cfg["ranks"][p.current_rank_tier - 1], "path": p.path}
    sales, teams = await active_sales(db), await auction_teams(db)
    taken = {p.id for _, p in sales} | {leader.id for _, leader in teams}
    free = await db.scalars(select(Player).where(Player.status == "approved", Player.path != "leader",
                                                 Player.id.not_in(taken or {0})).order_by(Player.display_name))
    return {"teams": {team.id: {"captain": card(leader), "players": [card(p) | {"price": sale.price}
                                                                     for sale, p in sales if sale.team_id == team.id]}
                      for team, leader in teams},
            "free": [card(p) for p in free]}


@router.post("/teams/{team_id}/swap")
async def swap_player(team_id: int, body: dict, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    """Someone backed out: their roster spot (and the price paid) goes to a replacement. Credits don't change."""
    t, _ = await load(db, lock=True)
    if t.status in ("auction_live", "auction_paused"):
        raise HTTPException(409, "Wait until the auction is over")
    try:
        out_id, in_id = int(body.get("out_player_id")), int(body.get("in_player_id"))
    except (TypeError, ValueError):
        raise HTTPException(422, "Pick who is leaving and who replaces them")
    sale = await db.scalar(select(Sale).where(Sale.team_id == team_id, Sale.player_id == out_id,
                                              Sale.undone_at.is_(None)).with_for_update())
    if not sale:
        raise HTTPException(404, "That player isn't on this team")
    new = await db.get(Player, in_id)
    if not new or new.status != "approved" or new.path == "leader":
        raise HTTPException(409, "The replacement must be an approved player or sub, not a captain")
    if await db.scalar(select(Sale.id).where(Sale.player_id == in_id, Sale.undone_at.is_(None))):
        raise HTTPException(409, f"{new.display_name} is already on a team")
    old = await db.get(Player, out_id)
    sale.player_id = in_id
    audit(db, admin, "team.player_swapped", team_id=team_id, sale_id=sale.id, out_player_id=out_id,
          in_player_id=in_id, out=old.display_name, replacement=new.display_name)
    await db.commit()
    publish("team.updated", team_id=team_id)
    return {"out": old.display_name, "in": new.display_name}


@router.post("/teams/{team_id}/new-code")
async def new_leader_code(team_id: int, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    """Revokes the old leader link and issues a new one."""
    team = await db.get(Team, team_id)
    if not team or not team.access_code_hash:
        raise HTTPException(404, "No approved captain for this team")
    code, team.access_code_hash = new_token()
    audit(db, admin, "team.code_reissued", team_id=team.id)
    await db.commit()
    return {"leader_code": code}


INT_KEYS = {"fee", "teams", "credits_per_team", "min_players", "max_players", "flat_base_price", "bid_increment",
            "bid_increment_high", "bid_increment_from", "bid_timer", "bid_reset", "round2_discount"}
CAN_BE_ZERO = {"bid_increment_from", "bid_timer", "round2_discount"}
CHOICES = {"base_price_mode": ("band", "flat"), "lot_order": ("rank_band", "random")}
SCHEDULE_KEYS = {"group_start", "group_end", "playoffs_start"}   # the tournament runs after the auction, so these stay editable
SETTINGS_KEYS = INT_KEYS | set(CHOICES) | SCHEDULE_KEYS | {"event_date", "upi_id", "upi_name", "registration_opens_at",
                                           "registration_closes_at", "role_caps", "band_base_price"}


@router.put("/settings")
async def put_settings(body: dict, db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    t, _ = await load(db, lock=True)
    changes = {k: v for k, v in body.get("settings", {}).items() if k in SETTINGS_KEYS}
    if t.locked_at:
        if any(k not in SCHEDULE_KEYS and t.settings.get(k) != v for k, v in changes.items()):
            raise HTTPException(409, "Settings are locked once the auction starts (tournament dates can still change)")
        changes = {k: v for k, v in changes.items() if k in SCHEDULE_KEYS}
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
    before, was = settings(t), {"status": t.status, "name": t.name}
    t.settings = {**t.settings, **changes}
    if body.get("status") in ("draft", "registration_open", "registration_closed") and not t.locked_at:
        t.status = body["status"]
    if body.get("name"):
        t.name = str(body["name"])[:80]
    # Log only what actually changed, so the audit trail stays readable.
    diff = {k: v for k, v in changes.items() if before.get(k) != v}
    diff |= {k: v for k, v in {"status": t.status, "name": t.name}.items() if was[k] != v}
    if diff:
        audit(db, admin, "settings.changed", **diff)
    await db.commit()
    return {"name": t.name, "status": t.status, "settings": t.settings}


@router.put("/settings/upi-qr")
async def put_upi_qr(qr: UploadFile = File(...), db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    """The QR players scan to pay. Stored as public media; the old image is deleted."""
    data = process_image(await qr.read(2**21 + 1), "upi_qr", False)
    t, _ = await load(db, lock=True)
    old, name = t.settings.get("upi_qr"), image_name()
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    (PUBLIC_DIR / name).write_bytes(data)
    t.settings = {**t.settings, "upi_qr": name}
    audit(db, admin, "settings.changed", upi_qr="uploaded")
    await db.commit()
    if old:
        (PUBLIC_DIR / old).unlink(missing_ok=True)
    return {"upi_qr": name, "upi_qr_url": f"/media/{name}"}


@router.delete("/settings/upi-qr")
async def delete_upi_qr(db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    t, _ = await load(db, lock=True)
    old = t.settings.get("upi_qr")
    t.settings = {**t.settings, "upi_qr": None}
    audit(db, admin, "settings.changed", upi_qr="removed")
    await db.commit()
    if old:
        (PUBLIC_DIR / old).unlink(missing_ok=True)
    return {"upi_qr": None, "upi_qr_url": None}


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


@router.get("/players.csv")
async def players_csv(db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin)):
    _, cfg = await load(db)
    rows = await db.execute(select(Player, Payment, Team).join(Payment, Payment.player_id == Player.id)
                            .outerjoin(Team, Team.leader_player_id == Player.id).order_by(Player.id))
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["id", "display_name", "riot_id", "tracker_url", "path", "status", "current_rank", "peak_rank", "role",
                "team", "discord", "phone", "email", "fee_status", "signed_up_at"])
    for p, pay, team in rows:
        w.writerow([p.id, p.display_name, p.riot_id, cfg["tracker_url"].format(riot_id=quote(p.riot_id, safe="")),
                    p.path, p.status, cfg["ranks"][p.current_rank_tier - 1], cfg["ranks"][p.peak_rank_tier - 1],
                    p.role, team.name if team else "", p.discord, p.phone, p.auth_email or "", pay.status,
                    p.created_at.isoformat()])
    return Response(out.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=players.csv"})


@router.get("/audit")
async def audit_log(db: AsyncSession = Depends(get_db), admin: str = Depends(require_admin), limit: int = 200):
    rows = await db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(min(limit, 1000)))
    return [{"id": a.id, "actor": a.actor, "action": a.action, "payload": a.payload, "at": a.created_at} for a in rows]



# ---------- announcements by email

AUDIENCES = {"all": {}, "captains": {"path": "leader"}, "players": {"path": "auction"}, "subs": {"path": "sub"},
             "approved": {"status": "approved"}}


async def audience_emails(db: AsyncSession, audience: str) -> dict[str, str]:
    if audience not in AUDIENCES:
        raise HTTPException(422, {"errors": {"audience": "Pick who gets it"}})
    q = select(Player.auth_email, Player.display_name).where(
        Player.auth_email.is_not(None), Player.status.not_in(["rejected", "withdrawn"]))
    for col, val in AUDIENCES[audience].items():
        q = q.where(getattr(Player, col) == val)
    return {e.lower(): n for e, n in (await db.execute(q)).all()}   # one email per address


@router.get("/announce/recipients")
async def announce_recipients(audience: str = "all", db: AsyncSession = Depends(get_db),
                              admin: str = Depends(require_admin)):
    return {"count": len(await audience_emails(db, audience)), "smtp": bool(os.environ.get("SMTP_HOST"))}


@router.post("/announce")
async def announce(body: dict, tasks: BackgroundTasks, db: AsyncSession = Depends(get_db),
                   admin: str = Depends(require_admin)):
    subject, message = str(body.get("subject", "")).strip(), str(body.get("message", "")).strip()
    e = {}
    if not 3 <= len(subject) <= 120:
        e["subject"] = "3 to 120 characters"
    if not 10 <= len(message) <= 5000:
        e["message"] = "10 to 5000 characters"
    if e:
        raise HTTPException(422, {"errors": e})
    if not os.environ.get("SMTP_HOST"):
        raise HTTPException(409, "Email isn't set up on the server yet (SMTP_HOST in .env)")
    people = await audience_emails(db, str(body.get("audience", "all")))
    t, _ = await load(db)
    paras = message.split("\n\n")
    msgs = [(email, f"{t.name}: {subject}", f"Hi {name},\n\n{message}\n\n{t.name}\n{SITE}\n",
             mail_html(subject, [f"Hi {name},", *paras], ("Open the site", SITE))) for email, name in people.items()]
    audit(db, admin, "announcement.sent", audience=body.get("audience", "all"), subject=subject, recipients=len(msgs))
    await db.commit()
    tasks.add_task(send_many, msgs)   # runs after the response, in a worker thread
    return {"queued": len(msgs)}
