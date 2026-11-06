"""Seed a throwaway demo database: 8 approved teams, 24 approved players. For dress rehearsals.

    DATABASE_URL=postgresql+asyncpg://postgres:devpassword@127.0.0.1:5440/zxb_demo UPLOAD_DIR=uploads-demo         uv run python -m scripts.seed_demo

Leader links: /leader/demo-leader-1 .. /leader/demo-leader-8. WIPES the target database.
"""
import asyncio
import os
import random
import sys

from PIL import Image

from app.core import PUBLIC_DIR, Session, engine, sha256, utcnow
from app.models import Base, Payment, Player, Team, Tournament
from app.tournament import init_db

NAMES = ["Kairo", "Nyx", "Vanta", "Rook", "Sable", "Echo", "Juno", "Vex", "Lumen", "Onyx", "Pyre", "Quill", "Riven", "Sol",
         "Tarn", "Umbra", "Wren", "Xeno", "Yara", "Zeph", "Astra", "Bolt", "Cinder", "Drift", "Ember", "Flint", "Gale", "Haze",
         "Ion", "Jolt", "Kite", "Lynx"]
TEAMS = [("Zenith Owls", "ZOWL", (224, 48, 30)), ("Night Shift", "NGT", (90, 60, 200)), ("Basalt", "BSLT", (120, 120, 130)),
         ("Monsoon", "MNSN", (30, 150, 200)), ("Red Kite", "RKT", (200, 40, 80)), ("Amber Line", "AMB", (255, 181, 71)),
         ("Low Orbit", "LOW", (40, 200, 140)), ("Static", "STC", (240, 240, 230))]
ROLES = ["Duelist", "Initiator", "Controller", "Sentinel", "Flex"]


async def main():
    if "demo" not in os.environ.get("DATABASE_URL", ""):
        sys.exit("Refusing: DATABASE_URL must point at a database with 'demo' in its name (this wipes it).")
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)
    await init_db()
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    rng = random.Random(4)
    async with Session() as db:
        t = await db.get(Tournament, 1)
        t.settings = {**t.settings, "max_players": 4, "min_players": 2, "bid_timer": 20, "event_date": "22 Nov 2026",
                      "upi_id": "zenithxbeans@upi"}
        for i, name in enumerate(NAMES):
            leader = i < 8
            tier = rng.randint(8, 25)
            p = Player(display_name=name, riot_id=f"{name}#ZXB", riot_id_key=f"{name.lower()}#zxb", current_rank_tier=tier,
                       peak_rank_tier=min(25, tier + rng.randint(0, 3)), role=ROLES[i % 5],
                       playstyle=rng.choice(["Entry with Jett, loud comms", "Smokes early, lurks late", "Info first, then the trade",
                                             "Anchors B like rent is due", "Plays whatever the team needs"]),
                       quote=rng.choice(["", "Rising to the zenith", "One tap, no cap", "Trust the util"]), discord=name.lower(),
                       phone="9000000000", path="leader" if leader else "auction", status="approved",
                       edit_token_hash=sha256(f"demo{i}"), terms_version="v1", terms_accepted_at=utcnow())
            db.add(p)
            await db.flush()
            db.add(Payment(player_id=p.id, amount=300, utr=f"{900000000000 + i}", screenshot="x.webp", status="verified"))
            if leader:
                tn, tag, color = TEAMS[i]
                logo = f"demo-logo-{i}.webp"
                im = Image.new("RGB", (128, 128), (17, 17, 20))
                for x in range(8):
                    for y in range(8):
                        if rng.random() < 0.45 or (x in (3, 4) and y in (3, 4)):
                            im.paste(color, (x * 16 + 1, y * 16 + 1, x * 16 + 15, y * 16 + 15))
                im.save(PUBLIC_DIR / logo, "WEBP")
                db.add(Team(leader_player_id=p.id, name=tn, name_key=tn.lower(), tag=tag, logo=logo,
                            profile_status="approved", access_code_hash=sha256(f"demo-leader-{i + 1}")))
        await db.commit()
    print("seeded; leader links: /leader/demo-leader-1 .. /leader/demo-leader-8")


asyncio.run(main())
