"""Tournament + game config: seeding, loading and the profile rules every module shares."""
import re
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .core import Session, engine, utcnow
from .models import Base, GameConfig, Player, Tournament

TIERS = ["Iron", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Ascendant", "Immortal"]
VALORANT = {
    "ranks": [f"{t} {n}" for t in TIERS for n in (1, 2, 3)] + ["Radiant"],  # tier = index + 1
    "roles": ["Duelist", "Initiator", "Controller", "Sentinel", "Flex"],
    "band_base_price": {"Iron": 10, "Bronze": 20, "Silver": 30, "Gold": 50, "Platinum": 70,
                        "Diamond": 100, "Ascendant": 130, "Immortal": 170, "Radiant": 220},
    "tracker_url": "https://tracker.gg/valorant/profile/riot/{riot_id}/overview",
}
DEFAULT_SETTINGS = {
    "fee": 300, "teams": 8, "credits_per_team": 1000, "min_players": 4,
    "event_date": "", "upi_id": "", "upi_name": "ZenithXBeans",
    "registration_opens_at": None, "registration_closes_at": None, "terms_version": "v1",
    # auction (locked once it starts)
    "max_players": None,            # set after registration closes; must fit every approved player
    "base_price_mode": "band",      # band | flat
    "flat_base_price": 50,
    "band_base_price": None,        # None = game config defaults; admin can override per band
    "bid_increment": 10, "bid_increment_high": 25, "bid_increment_from": 200,  # +10 below 200, +25 from 200
    "bid_timer": 20, "bid_reset": 10,  # seconds; 0 disables the timer
    "round2_discount": 50,          # percent off base price for the unsold round
    "role_caps": {},                # e.g. {"Duelist": 2}, leader included
    "lot_order": "rank_band",       # rank_band (highest band first, random within) | random
}


def settings(t: Tournament) -> dict:
    return {**DEFAULT_SETTINGS, **t.settings}
TERMS_VERSION = "v1"


async def init_db() -> None:
    async with engine.begin() as c:
        # ponytail: create_all until the first deploy; switch to Alembic before Phase 5a.
        await c.run_sync(Base.metadata.create_all)
    async with Session() as db:
        if not await db.get(Tournament, 1):
            cfg = GameConfig(game="valorant", data=VALORANT)
            db.add(cfg)
            await db.flush()
            db.add(Tournament(id=1, game_config_id=cfg.id, name="ZenithXBeans Valorant Draft",
                              settings=DEFAULT_SETTINGS))
            await db.commit()


async def load(db: AsyncSession, lock: bool = False) -> tuple[Tournament, dict]:
    t = await db.get(Tournament, 1, with_for_update=lock)
    cfg = await db.get(GameConfig, t.game_config_id)
    return t, cfg.data


def registration_open(t: Tournament) -> bool:
    s, now = settings(t), utcnow()
    opens, closes = s.get("registration_opens_at"), s.get("registration_closes_at")
    return (t.status == "registration_open"
            and (not opens or now >= datetime.fromisoformat(opens))
            and (not closes or now < datetime.fromisoformat(closes)))


async def approved_leaders(db: AsyncSession) -> int:
    q = select(func.count()).where(Player.path == "leader", Player.status == "approved")
    return await db.scalar(q)


RIOT_ID = re.compile(r"^[^#]{3,16}#[A-Za-z0-9]{3,5}$")
TAG = re.compile(r"^[A-Z]{2,4}$")


def clean_phone(p: str) -> str:
    p = re.sub(r"[\s\-()]", "", p or "")
    if p.startswith("+91"):
        p = p[3:]
    elif len(p) == 12 and p.startswith("91") or len(p) == 11 and p.startswith("0"):
        p = p[-10:]
    return p


def validate_profile(d: dict, cfg: dict) -> dict:
    """Normalises d in place, returns {field: message} for anything wrong."""
    e, n = {}, len(cfg["ranks"])
    for k in ("display_name", "riot_id", "playstyle", "quote", "discord"):
        d[k] = (d.get(k) or "").strip()
    d["phone"] = clean_phone(d.get("phone"))
    if not 2 <= len(d["display_name"]) <= 32:
        e["display_name"] = "Use 2 to 32 characters"
    if not RIOT_ID.match(d["riot_id"]):
        e["riot_id"] = "Use the format name#tag, for example Shovn#SJEC"
    cur, peak = d.get("current_rank"), d.get("peak_rank")
    if not isinstance(cur, int) or not 1 <= cur <= n:
        e["current_rank"] = "Pick your current rank"
    if not isinstance(peak, int) or not 1 <= peak <= n:
        e["peak_rank"] = "Pick your peak rank"
    elif "current_rank" not in e and peak < cur:
        e["peak_rank"] = "Peak rank can't be lower than your current rank"
    if d.get("role") not in cfg["roles"]:
        e["role"] = "Pick a role"
    if not 1 <= len(d["playstyle"]) <= 80:
        e["playstyle"] = "Describe your playstyle in up to 80 characters"
    if len(d["quote"]) > 80:
        e["quote"] = "Keep it to 80 characters"
    if not 2 <= len(d["discord"]) <= 37:
        e["discord"] = "Enter your Discord username"
    if not re.fullmatch(r"[6-9]\d{9}", d["phone"]):
        e["phone"] = "Enter a 10-digit Indian mobile number"
    return e


def validate_team(d: dict) -> dict:
    e = {}
    d["team_name"] = (d.get("team_name") or "").strip()
    d["team_tag"] = (d.get("team_tag") or "").strip()
    if not 3 <= len(d["team_name"]) <= 24:
        e["team_name"] = "Use 3 to 24 characters"
    if not TAG.match(d["team_tag"]):
        e["team_tag"] = "2 to 4 uppercase letters"
    return e


def public_card(p: Player, cfg: dict) -> dict:
    """Everything a public screen may show. Never add phone, discord or payment data here."""
    return {"id": p.id, "display_name": p.display_name, "riot_id": p.riot_id, "role": p.role,
            "current_rank": cfg["ranks"][p.current_rank_tier - 1], "current_rank_tier": p.current_rank_tier,
            "peak_rank": cfg["ranks"][p.peak_rank_tier - 1], "playstyle": p.playstyle, "quote": p.quote,
            "photo_url": f"/media/{p.photo}" if p.photo else None,
            "base_price": cfg["band_base_price"][cfg["ranks"][p.current_rank_tier - 1].split()[0]]}
