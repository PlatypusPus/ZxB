"""Public side: sign-up (profile, path, payment proof), edit link, landing-page data."""
import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import (PRIVATE_DIR, PUBLIC_DIR, audit, get_db, image_name, new_token, process_image,
                     publish, rate_limit, sha256, utcnow)
from ...models import Payment, Player, Sale, Team
from ...tournament import (TERMS_VERSION, approved_leaders, load, public_card, registration_open,
                           validate_profile, validate_team)

router = APIRouter()
SIGNUP_LIMIT = (5, 600)  # per IP: 5 sign-ups per 10 minutes
UNIQUE_ERRORS = {
    "uq_player_riot": ("riot_id", "Riot ID already registered"),
    "payment_utr_key": ("utr", "This UTR has already been used"),
    "uq_team_name": ("team_name", "Team name already taken"),
    "uq_team_tag": ("team_tag", "Team tag already taken"),
}


def unique_error(e: IntegrityError) -> HTTPException:
    for constraint, (field, msg) in UNIQUE_ERRORS.items():
        if constraint in str(e.orig):
            return HTTPException(409, {"errors": {field: msg}})
    raise e


@router.get("/public")
async def public_info(db: AsyncSession = Depends(get_db)):
    t, cfg = await load(db)
    s = t.settings
    signups = await db.scalar(select(func.count()).where(Player.status.not_in(["rejected", "withdrawn"])))
    return {"name": t.name, "host": t.host, "status": t.status, "registration_open": registration_open(t),
            "event_date": s["event_date"], "fee": s["fee"], "upi_id": s["upi_id"], "upi_name": s["upi_name"],
            "signups": signups, "leader_slots_left": max(0, s["teams"] - await approved_leaders(db)),
            "teams": s["teams"], "credits_per_team": s["credits_per_team"], "min_players": s["min_players"],
            "ranks": cfg["ranks"], "roles": cfg["roles"], "band_base_price": cfg["band_base_price"],
            "terms_version": TERMS_VERSION}


@router.get("/teams")
async def teams(db: AsyncSession = Depends(get_db)):
    _, cfg = await load(db)
    rows = await db.execute(select(Team, Player).join(Player, Team.leader_player_id == Player.id)
                            .where(Player.status == "approved", Team.profile_status == "approved")
                            .order_by(Team.id))
    sales = (await db.execute(select(Sale, Player).join(Player, Sale.player_id == Player.id)
                              .where(Sale.undone_at.is_(None)).order_by(Sale.id))).all()
    return [{"id": t.id, "name": t.name, "tag": t.tag, "logo_url": f"/media/{t.logo}", "leader": public_card(p, cfg),
             "roster": [{"id": sp.id, "display_name": sp.display_name, "role": sp.role, "price": sale.price}
                        for sale, sp in sales if sale.team_id == t.id]} for t, p in rows]


@router.get("/players")
async def players(db: AsyncSession = Depends(get_db), role: str = "", rank: int = 0):
    _, cfg = await load(db)
    q = select(Player).where(Player.path == "auction", Player.status == "approved")
    if role:
        q = q.where(Player.role == role)
    if rank:
        q = q.where(Player.current_rank_tier == rank)
    rows = await db.scalars(q.order_by(Player.current_rank_tier.desc(), Player.id))
    return [public_card(p, cfg) for p in rows]


@router.post("/signup", status_code=201)
async def signup(
    request: Request, db: AsyncSession = Depends(get_db),
    display_name: str = Form(""), riot_id: str = Form(""), current_rank: int = Form(0), peak_rank: int = Form(0),
    role: str = Form(""), playstyle: str = Form(""), quote: str = Form(""), discord: str = Form(""),
    phone: str = Form(""), path: str = Form("auction"), team_name: str = Form(""), team_tag: str = Form(""),
    utr: str = Form(""), terms: bool = Form(False),
    screenshot: UploadFile | None = File(None), photo: UploadFile | None = File(None),
    logo: UploadFile | None = File(None),
):
    rate_limit(request, "signup", *SIGNUP_LIMIT)
    t, cfg = await load(db)
    if not registration_open(t):
        raise HTTPException(403, "Registration is closed")

    d = dict(display_name=display_name, riot_id=riot_id, current_rank=current_rank, peak_rank=peak_rank,
             role=role, playstyle=playstyle, quote=quote, discord=discord, phone=phone,
             team_name=team_name, team_tag=team_tag)
    errors = validate_profile(d, cfg)
    if path not in ("leader", "auction"):
        errors["path"] = "Choose team leader or auction player"
    if path == "leader":
        errors |= validate_team(d)
        if not logo or not logo.filename:
            errors["logo"] = "Upload your team logo"
    utr = re.sub(r"\s", "", utr)
    if not re.fullmatch(r"\d{12}", utr):
        errors["utr"] = "The UTR is the 12-digit number in your UPI app's payment details"
    if not screenshot or not screenshot.filename:
        errors["screenshot"] = "Upload the payment screenshot"
    if not terms:
        errors["terms"] = "You need to accept the rules, refund policy and privacy notice"
    if errors:
        raise HTTPException(422, {"errors": errors})

    # Validate every image in memory first, so a bad upload writes nothing to disk.
    files: list[tuple] = [(PRIVATE_DIR / image_name(), process_image(await screenshot.read(2**21 + 1), "screenshot", False))]
    if photo and photo.filename:
        files.append((PUBLIC_DIR / image_name(), process_image(await photo.read(2**21 + 1), "photo", True)))
    if path == "leader":
        files.append((PUBLIC_DIR / image_name(), process_image(await logo.read(2**21 + 1), "logo", True)))

    waitlist = path == "leader" and await approved_leaders(db) >= t.settings["teams"]
    raw_token, token_hash = new_token()
    p = Player(display_name=d["display_name"], riot_id=d["riot_id"], riot_id_key=d["riot_id"].lower(),
               current_rank_tier=current_rank, peak_rank_tier=peak_rank, role=role, playstyle=d["playstyle"],
               quote=d["quote"], discord=d["discord"], phone=d["phone"], path=path,
               photo=files[1][0].name if photo and photo.filename else None,
               status="waitlisted" if waitlist else "submitted", edit_token_hash=token_hash,
               terms_version=TERMS_VERSION, terms_accepted_at=utcnow())
    db.add(p)
    try:
        await db.flush()
        db.add(Payment(player_id=p.id, amount=t.settings["fee"], utr=utr, screenshot=files[0][0].name))
        if path == "leader":
            db.add(Team(leader_player_id=p.id, name=d["team_name"], name_key=d["team_name"].lower(),
                        tag=d["team_tag"], logo=files[-1][0].name))
        await db.flush()
    except IntegrityError as e:
        await db.rollback()
        raise unique_error(e)

    audit(db, f"player:{p.id}", "signup.submitted", path=path, waitlisted=waitlist)
    for f, data in files:
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(data)
    try:
        await db.commit()
    except Exception:
        for f, _ in files:
            f.unlink(missing_ok=True)
        raise
    publish("signup.submitted", player_id=p.id)
    return {"edit_token": raw_token, "status": p.status}


async def by_token(db: AsyncSession, token: str):
    row = (await db.execute(select(Player, Payment, Team).join(Payment, Payment.player_id == Player.id)
                            .outerjoin(Team, Team.leader_player_id == Player.id)
                            .where(Player.edit_token_hash == sha256(token)))).first()
    if not row:
        raise HTTPException(404, "Sign-up not found. Check your edit link.")
    return row


def own_view(p: Player, pay: Payment, team: Team | None, cfg: dict, editable: bool) -> dict:
    return {**public_card(p, cfg), "status": p.status, "reject_reason": p.reject_reason, "path": p.path,
            "discord": p.discord, "phone": p.phone, "payment_status": pay.status,
            "current_rank_tier": p.current_rank_tier, "peak_rank_tier": p.peak_rank_tier, "editable": editable,
            "team": team and {"name": team.name, "tag": team.tag, "logo_url": f"/media/{team.logo}",
                              "profile_status": team.profile_status}}


@router.get("/signup/{token}")
async def my_signup(token: str, db: AsyncSession = Depends(get_db)):
    t, cfg = await load(db)
    p, pay, team = await by_token(db, token)
    return own_view(p, pay, team, cfg, registration_open(t) and pay.status == "submitted")


@router.patch("/signup/{token}")
async def edit_signup(token: str, body: dict, request: Request, db: AsyncSession = Depends(get_db)):
    rate_limit(request, "edit", 20, 600)
    t, cfg = await load(db)
    p, pay, team = await by_token(db, token)
    if not registration_open(t):
        raise HTTPException(403, "Registration is closed, so sign-ups can't be edited")
    if pay.status != "submitted":
        raise HTTPException(409, "Your sign-up is already being checked, so it can't be edited. Message the organisers.")
    fields = ("display_name", "riot_id", "playstyle", "quote", "discord", "phone", "role", "current_rank", "peak_rank")
    d = {"display_name": p.display_name, "riot_id": p.riot_id, "playstyle": p.playstyle, "quote": p.quote,
         "discord": p.discord, "phone": p.phone, "role": p.role, "current_rank": p.current_rank_tier,
         "peak_rank": p.peak_rank_tier, "team_name": team.name if team else "", "team_tag": team.tag if team else ""}
    d |= {k: body[k] for k in fields + ("team_name", "team_tag") if k in body}
    errors = validate_profile(d, cfg) | (validate_team(d) if team else {})
    if errors:
        raise HTTPException(422, {"errors": errors})
    for k in fields:
        setattr(p, {"current_rank": "current_rank_tier", "peak_rank": "peak_rank_tier"}.get(k, k), d[k])
    p.riot_id_key = p.riot_id.lower()
    if team:
        team.name, team.name_key, team.tag = d["team_name"], d["team_name"].lower(), d["team_tag"]
    audit(db, f"player:{p.id}", "signup.edited", fields=sorted(k for k in body if k in d))
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise unique_error(e)
    return own_view(p, pay, team, cfg, True)
