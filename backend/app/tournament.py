"""Tournament + game config: seeding, loading and the profile rules every module shares."""
import re
from datetime import datetime

from sqlalchemy import func, select, text
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
    "fee": 300, "teams": 10, "credits_per_team": 1000, "min_players": 4,
    "event_date": "15 Nov 2026", "group_start": "15 Nov 2026", "group_end": "21 Nov 2026",
    "playoffs_start": "23 Nov 2026", "upi_id": "", "upi_name": "ZenithXBeans",
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
TERMS_VERSION = "v2"  # v2: refund policy (no refunds, swaps) and privacy pages


GROUPS = {"A": ["ravanaesports", "ravananesports", "teamnextera", "nextera", "ataraxia", "zenparadise",
                "bhadwayojnacentre", "bhadwayojnacenter", "bunssquad"],
          "B": ["thekaalabilla", "kaalabilla", "kaalabillas", "godsowngamers", "meowdiff", "raaje", "toothmonsters",
                "irisgaming"]}

PLAYOFF_SUBS = {"SNOW WHITE#ryuu": "ravanaesports", "ryuu#fwahh": "thekaalabillas", "Valorant hater#IGL": "nextera",
                "PaiN#eeee": "irisgaming", "TheDKSam#1147": "meowdiff", "Klyx#onyt": "raaje"}

# (loser, winner), normalised team names: Raaje to Tooth Monsters in group B (27 Nov), Buns Squad to Meow Diff in the
# playoff qualifier (28 Nov). A cross-group forfeit is a playoff map, so it stays out of the group standings.
FORFEITS = [("raaje", "toothmonsters"), ("bunssquad", "meowdiff")]


async def init_db() -> None:
    async with engine.begin() as c:
        # ponytail: create_all until the first deploy; switch to Alembic before Phase 5a.
        await c.run_sync(Base.metadata.create_all)
        # create_all never alters existing tables, so columns added after the first deploy go here.
        for col in ("auth_provider varchar(8)", "auth_sub varchar(64)", "auth_email varchar(254)", "follows varchar(16)",
                    "puuid varchar(80)", "card_url varchar(200)", "card_wide_url varchar(200)", "sub_team_id integer"):
            await c.execute(text(f"ALTER TABLE player ADD COLUMN IF NOT EXISTS {col}"))
        await c.execute(text("CREATE INDEX IF NOT EXISTS ix_player_puuid ON player (puuid)"))
        await c.execute(text("ALTER TABLE team ADD COLUMN IF NOT EXISTS grp varchar(1)"))
        for col in ("a_key_hash varchar(64)", "b_key_hash varchar(64)", "a_delegate varchar(32)", "b_delegate varchar(32)",
                    "bo integer NOT NULL DEFAULT 1"):
            await c.execute(text(f"ALTER TABLE veto ADD COLUMN IF NOT EXISTS {col}"))
        # ponytail: one-off seed of the announced group allocation (19 Nov); teams already given a group are left alone,
        # names that don't match stay blank and are set in Admin -> Teams -> Manage team.
        for grp, names in GROUPS.items():
            await c.execute(text("UPDATE team SET grp = :g WHERE grp IS NULL AND "
                                 "regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = ANY(:n)"), {"g": grp, "n": names})
        # ponytail: one-off seed of the playoff subs announced 28 Nov (Riot ID -> team); a sub already set is left alone.
        for riot, team in PLAYOFF_SUBS.items():
            await c.execute(text("UPDATE player SET sub_team_id = t.id FROM team t WHERE player.sub_team_id IS NULL "
                                 "AND player.riot_id = :r AND regexp_replace(lower(t.name), '[^a-z0-9]', '', 'g') = :n"),
                            {"r": riot, "n": team})
        # ponytail: one-off forfeits, scored 13-0 to the winner with no player stats. Deleting one in Admin brings it
        # back on restart; drop this block after the playoffs.
        for loser, winner in FORFEITS:
            await c.execute(text(
                "INSERT INTO game_match (tournament_id, henrik_match_id, map, team_a_id, team_b_id, rounds_a, rounds_b, status) "
                "SELECT 1, :k, 'Forfeit', a.id, b.id, 0, 13, 'published' FROM team a, team b "
                "WHERE regexp_replace(lower(a.name), '[^a-z0-9]', '', 'g') = :l "
                "AND regexp_replace(lower(b.name), '[^a-z0-9]', '', 'g') = :w "
                "ON CONFLICT (henrik_match_id) DO NOTHING"), {"k": f"forfeit:{loser}-{winner}", "l": loser, "w": winner})
        await c.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_player_auth ON player (tournament_id, auth_provider, auth_sub) "
                             "WHERE auth_sub IS NOT NULL AND status NOT IN ('rejected', 'withdrawn')"))
    async with Session() as db:
        if not await db.get(Tournament, 1):
            cfg = GameConfig(game="valorant", data=VALORANT)
            db.add(cfg)
            await db.flush()
            db.add(Tournament(id=1, game_config_id=cfg.id, name="ZenithXBeans Valorant Auction",
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
    if len(d["discord"]) > 37:
        e["discord"] = "Discord usernames are at most 37 characters"
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
