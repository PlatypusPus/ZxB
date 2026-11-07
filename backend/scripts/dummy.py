"""Add or remove dummy sign-ups on a live database, for testing the real site.

    uv run --no-sync --env-file ../.env python -m scripts.dummy add
    uv run --no-sync --env-file ../.env python -m scripts.dummy remove

Adds 10 approved captains with approved teams, 40 approved auction players, 6 sign-ups waiting in the
admin Queue and 4 subs. Every dummy has the Riot tag #DMY and no email, so nobody gets mailed.
Captain links: /leader/dummy-captain-1 .. /leader/dummy-captain-10.

remove deletes every #DMY sign-up and ALL auction data (lots, bids, sales), then reopens registration.
Run it before the real auction, never after.
"""
import asyncio
import random
import sys

from PIL import Image
from sqlalchemy import delete, select

from app.core import PRIVATE_DIR, PUBLIC_DIR, Session, audit, sha256, utcnow
from app.models import Bid, Lot, Payment, Player, Sale, Team, Tournament
from app.tournament import init_db

TAG = "DMY"
NAMES = ["Kairo", "Nyx", "Vanta", "Rook", "Sable", "Echo", "Juno", "Vex", "Lumen", "Onyx", "Pyre", "Quill", "Riven", "Solace",
         "Tarn", "Umbra", "Wren", "Xeno", "Yara", "Zeph", "Astra", "Bolt", "Cinder", "Drift", "Ember", "Flint", "Gale", "Haze",
         "Ion", "Jolt", "Kite", "Lynx", "Mako", "Nova", "Orbit", "Prism", "Quartz", "Rift", "Shard", "Talon", "Vale", "Warden",
         "Axel", "Blaze", "Comet", "Dusk", "Ezra", "Fable", "Glint", "Hex", "Iris", "Jinx", "Koda", "Lux", "Mira", "Nero",
         "Opal", "Pike", "Rune", "Sage"]
TEAMS = [("Dummy Owls", "DOWL", (224, 48, 30)), ("Night Shift", "NGT", (90, 60, 200)), ("Basalt", "BSLT", (120, 120, 130)),
         ("Monsoon", "MNSN", (30, 150, 200)), ("Red Kite", "RKT", (200, 40, 80)), ("Amber Line", "AMB", (255, 181, 71)),
         ("Low Orbit", "LOW", (40, 200, 140)), ("Static", "STC", (240, 240, 230)), ("Tidal", "TDL", (20, 90, 220)),
         ("Ashfall", "ASH", (160, 90, 40))]
ROLES = ["Duelist", "Initiator", "Controller", "Sentinel", "Flex"]
STYLES = ["Entry with Jett, loud comms", "Smokes early, lurks late", "Info first, then the trade",
          "Anchors B like rent is due", "Plays whatever the team needs", "Op on every eco"]


def tile(path, color, rng, size=128):
    im = Image.new("RGB", (size, size), (17, 17, 20))
    cell = size // 8
    for x in range(8):
        for y in range(8):
            if rng.random() < 0.45 or (x in (3, 4) and y in (3, 4)):
                im.paste(color, (x * cell + 1, y * cell + 1, (x + 1) * cell - 1, (y + 1) * cell - 1))
    im.save(path, "WEBP")


async def add():
    await init_db()
    async with Session() as db:
        if await db.scalar(select(Player.id).where(Player.riot_id_key.like(f"%#{TAG.lower()}")).limit(1)):
            sys.exit("Dummies are already there. Run remove first.")
        t = await db.get(Tournament, 1, with_for_update=True)
        if t.locked_at:
            sys.exit("The auction has started; not adding dummies.")
        PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
        PRIVATE_DIR.mkdir(parents=True, exist_ok=True)
        rng = random.Random(7)
        shot = "dummy-payment.webp"
        Image.new("RGB", (360, 640), (240, 242, 248)).save(PRIVATE_DIR / shot, "WEBP")
        # 10 captains, 40 auction players, 6 waiting in the queue, 4 subs
        plan = [("leader", "approved")] * 10 + [("auction", "approved")] * 40 + [("auction", "submitted")] * 6 \
            + [("sub", "verified")] * 4
        for i, (path, status) in enumerate(plan):
            name = NAMES[i % len(NAMES)] + ("" if i < len(NAMES) else str(i))
            tier = rng.randint(8, 25)
            p = Player(display_name=name, riot_id=f"{name}#{TAG}", riot_id_key=f"{name.lower()}#{TAG.lower()}",
                       current_rank_tier=tier, peak_rank_tier=min(25, tier + rng.randint(0, 3)), role=ROLES[i % 5],
                       playstyle=rng.choice(STYLES), quote=rng.choice(["", "Rising to the zenith", "One tap, no cap", "Trust the util"]),
                       discord=f"{name.lower()}_dummy", phone="9000000000", path=path, status=status,
                       edit_token_hash=sha256(f"dummy-edit-{i}"), terms_version="v2", terms_accepted_at=utcnow(),
                       follows="followed")
            db.add(p)
            await db.flush()
            free = path == "sub"
            db.add(Payment(player_id=p.id, amount=0 if free else 300, utr=f"FREE{p.id}" if free else f"{999000000000 + i}",
                           screenshot="" if free else shot, status="submitted" if status == "submitted" else "verified"))
            if path == "leader":
                tn, tag, color = TEAMS[i]
                logo = f"dummy-logo-{i}.webp"
                tile(PUBLIC_DIR / logo, color, rng)
                db.add(Team(leader_player_id=p.id, name=tn, name_key=tn.lower(), tag=tag, logo=logo,
                            profile_status="approved", access_code_hash=sha256(f"dummy-captain-{i + 1}")))
        # 40 players over 10 teams: each team buys 4 (min and max), so the test auction can finish.
        t.settings = {**t.settings, "max_players": 4, "_dummy_before": {k: t.settings.get(k) for k in ("max_players", "min_players")},
                      "min_players": 4}
        audit(db, "script", "dummy.added", players=len(plan))
        await db.commit()
    print(f"Added {len(plan)} dummy sign-ups (#{TAG}). Captain links: /leader/dummy-captain-1 .. /leader/dummy-captain-10")


async def remove():
    async with Session() as db:
        t = await db.get(Tournament, 1, with_for_update=True)
        ids = list(await db.scalars(select(Player.id).where(Player.riot_id_key.like(f"%#{TAG.lower()}"))))
        team_ids = list(await db.scalars(select(Team.id).where(Team.leader_player_id.in_(ids))))
        logos = list(await db.scalars(select(Team.logo).where(Team.id.in_(team_ids))))
        # The test auction ran on dummy teams, so all auction data goes.
        for model in (Sale, Bid, Lot):
            await db.execute(delete(model))
        await db.execute(delete(Payment).where(Payment.player_id.in_(ids)))
        await db.execute(delete(Team).where(Team.id.in_(team_ids)))
        await db.execute(delete(Player).where(Player.id.in_(ids)))
        before = t.settings.get("_dummy_before") or {"max_players": None, "min_players": 4}
        t.settings = {**{k: v for k, v in t.settings.items() if k != "_dummy_before"}, **before}
        t.locked_at = None
        if t.status not in ("draft", "registration_open", "registration_closed"):
            t.status = "registration_open"
        audit(db, "script", "dummy.removed", players=len(ids))
        await db.commit()
    for name in logos + ["dummy-payment.webp"]:
        (PUBLIC_DIR / name).unlink(missing_ok=True)
        (PRIVATE_DIR / name).unlink(missing_ok=True)
    print(f"Removed {len(ids)} dummy sign-ups and all auction data; registration is open again.")


if __name__ == "__main__":
    cmd = sys.argv[1:2]
    if cmd == ["add"]:
        asyncio.run(add())
    elif cmd == ["remove"]:
        asyncio.run(remove())
    else:
        sys.exit("Usage: python -m scripts.dummy add|remove")
