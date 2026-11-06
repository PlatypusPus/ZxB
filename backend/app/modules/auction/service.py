"""Auction engine. The server is the single source of truth; every change happens under a row lock."""
import random
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import audit, publish, utcnow
from ...models import Bid, Lot, Player, Sale, Team, Tournament
from ...tournament import load, public_card, settings

FINAL = 3
LIVE, PAUSED = "auction_live", "auction_paused"


class Reject(HTTPException):
    def __init__(self, reason: str, status: int = 409):
        super().__init__(status, reason)


# ---------- pure rules (unit-tested directly)

def band(p: Player, cfg: dict) -> str:
    return cfg["ranks"][p.current_rank_tier - 1].split()[0]


def base_price(p: Player, s: dict, cfg: dict, round_: int) -> int:
    if round_ >= FINAL:
        return 0
    price = s["flat_base_price"] if s["base_price_mode"] == "flat" else (s["band_base_price"] or cfg["band_base_price"])[band(p, cfg)]
    return price * (100 - s["round2_discount"]) // 100 if round_ == 2 else price


def increment(amount: int, s: dict) -> int:
    high_from = s["bid_increment_from"]
    return s["bid_increment_high"] if high_from and amount >= high_from else s["bid_increment"]


def next_amount(base: int, highest: int | None, s: dict) -> int:
    return base if highest is None else highest + increment(highest, s)


def max_bid(remaining: int, bought: int, min_players: int, lowest_base: int) -> int:
    """Reserve rule: always keep enough to fill the rest of the minimum roster at the cheapest price left."""
    still_needed = max(0, min_players - bought)
    return remaining - max(0, still_needed - 1) * lowest_base


# ---------- reads

async def auction_teams(db: AsyncSession) -> list[tuple[Team, Player]]:
    q = (select(Team, Player).join(Player, Team.leader_player_id == Player.id)
         .where(Player.status == "approved").order_by(Team.id))
    return list((await db.execute(q)).all())


async def active_sales(db: AsyncSession) -> list[tuple[Sale, Player]]:
    q = select(Sale, Player).join(Player, Sale.player_id == Player.id).where(Sale.undone_at.is_(None)).order_by(Sale.id)
    return list((await db.execute(q)).all())


async def pool_players(db: AsyncSession) -> list[Player]:
    q = select(Player).where(Player.path == "auction", Player.status == "approved")
    return list(await db.scalars(q))


async def open_lot(db: AsyncSession, lock: bool = False) -> Lot | None:
    q = select(Lot).where(Lot.status == "open")
    return await db.scalar(q.with_for_update() if lock else q)


async def current_round(db: AsyncSession) -> int:
    return await db.scalar(select(func.max(Lot.round)).where(Lot.round < FINAL, Lot.status != "undone")) or 1


async def highest_bid(db: AsyncSession, lot: Lot) -> Bid | None:
    return await db.scalar(select(Bid).where(Bid.lot_id == lot.id).order_by(Bid.amount.desc(), Bid.id).limit(1))


async def team_state(db: AsyncSession, t: Tournament, cfg: dict, lot: Lot | None = None) -> dict[int, dict]:
    """Per team: credits left, roster, role counts, max bid for the open lot."""
    s = settings(t)
    teams, sales = await auction_teams(db), await active_sales(db)
    sold_ids = {sale.player_id for sale, _ in sales}
    excluded = sold_ids | ({lot.player_id} if lot else set())
    rnd = await current_round(db)
    left = [p for p in await pool_players(db) if p.id not in excluded]
    lowest = min((base_price(p, s, cfg, rnd) for p in left), default=0)
    out = {}
    for team, leader in teams:
        roster = [(sale, p) for sale, p in sales if sale.team_id == team.id]
        spent = sum(sale.price for sale, _ in roster)
        roles: dict[str, int] = {leader.role: 1}
        for _, p in roster:
            roles[p.role] = roles.get(p.role, 0) + 1
        out[team.id] = {"team": team, "leader": leader, "roster": roster, "roles": roles,
                        "credits_left": s["credits_per_team"] - spent, "bought": len(roster),
                        "max_bid": max_bid(s["credits_per_team"] - spent, len(roster), s["min_players"], lowest)}
    return out


def bid_block(st: dict, s: dict, lot_player: Player | None, amount: int, highest_team: int | None) -> str | None:
    """Why this team can't bid `amount` right now, or None."""
    if st["team"].id == highest_team:
        return "You're the highest bidder"
    if s["max_players"] and st["bought"] >= s["max_players"]:
        return "Your roster is full"
    cap = (s["role_caps"] or {}).get(lot_player.role) if lot_player else None
    if cap and st["roles"].get(lot_player.role, 0) >= cap:
        return f"You already have {cap} {lot_player.role}s"
    if amount > st["max_bid"]:
        return "Over max bid"
    return None


async def snapshot(db: AsyncSession) -> dict:
    t, cfg = await load(db)
    s = settings(t)
    lot = await open_lot(db)
    states = await team_state(db, t, cfg, lot)
    top = await highest_bid(db, lot) if lot else None
    lot_player = await db.get(Player, lot.player_id) if lot else None
    amount = next_amount(lot.base_price, top.amount if top else None, s) if lot else None
    last = await db.scalar(select(Lot).where(Lot.status.in_(["sold", "unsold", "assigned"])).order_by(Lot.closed_at.desc(), Lot.id.desc()).limit(1))
    last_sale = last and await db.scalar(select(Sale).where(Sale.lot_id == last.id))
    rnd = await current_round(db)
    queued = await db.scalar(select(func.count()).select_from(Lot).where(Lot.status == "queued"))
    recent = (await db.execute(select(Sale, Player, Team).join(Player, Sale.player_id == Player.id)
                               .join(Team, Sale.team_id == Team.id).where(Sale.undone_at.is_(None))
                               .order_by(Sale.id.desc()).limit(5))).all()
    placed = sum(st["bought"] for st in states.values())
    return {
        "server_now": utcnow().timestamp(), "status": t.status, "name": t.name, "round": rnd,
        "settings": {k: s[k] for k in ("credits_per_team", "min_players", "max_players", "bid_timer", "bid_reset", "event_date") if k in s},
        "pool": {"total": len(await pool_players(db)), "placed": placed, "queued": queued},
        "lot": lot and {
            "id": lot.id, "round": lot.round, "base_price": lot.base_price, "player": public_card(lot_player, cfg) | {"base_price": lot.base_price},
            "highest": top and {"amount": top.amount, "team_id": top.team_id},
            "next_amount": amount,
            "timer_end": lot.timer_end.timestamp() if lot.timer_end else None, "paused_remaining": lot.paused_remaining,
        },
        "last_closed": last and {"lot_id": last.id, "result": last.status, "player_id": last.player_id,
                                 "team_id": last_sale.team_id if last_sale else None, "price": last_sale.price if last_sale else None},
        "teams": [{
            "id": st["team"].id, "name": st["team"].name, "tag": st["team"].tag, "logo_url": f"/media/{st['team'].logo}",
            "leader": st["leader"].display_name, "credits_left": st["credits_left"], "bought": st["bought"],
            "max_bid": st["max_bid"], "roster": [{"id": p.id, "display_name": p.display_name, "role": p.role, "price": sale.price,
                                                  "current_rank": cfg["ranks"][p.current_rank_tier - 1]} for sale, p in st["roster"]],
            "blocked": (bid_block(st, s, lot_player, amount, top.team_id if top else None) if lot else "No player up yet"),
        } for st in states.values()],
        "recent": [{"player": p.display_name, "team": tm.tag, "price": sale.price} for sale, p, tm in recent],
    }


# ---------- writes

async def start(db: AsyncSession, actor: str) -> None:
    t, cfg = await load(db, lock=True)
    s = settings(t)
    if t.status in (LIVE, PAUSED, "completed"):
        raise Reject("The auction has already started")
    teams = await auction_teams(db)
    players = await pool_players(db)
    problems = []
    if len(teams) < 2:
        problems.append("Need at least 2 approved leaders")
    if any(team.profile_status != "approved" for team, _ in teams):
        problems.append("Approve every team's name and logo first")
    if not s["max_players"]:
        problems.append("Set the maximum players per team")
    elif s["max_players"] * len(teams) < len(players):
        problems.append(f"Max roster {s['max_players']} x {len(teams)} teams can't fit {len(players)} players; "
                        f"set it to at least {-(-len(players) // max(1, len(teams)))}")
    if s["min_players"] * len(teams) > len(players):
        problems.append(f"{len(players)} players can't give {len(teams)} teams {s['min_players']} each")
    if s["max_players"] and s["min_players"] > s["max_players"]:
        problems.append("Minimum players is above the maximum")
    if problems:
        raise Reject(". ".join(problems))
    random.shuffle(players)
    if s["lot_order"] != "random":   # highest band first, random within a band (sort is stable)
        bands = list(dict.fromkeys(r.split()[0] for r in cfg["ranks"]))
        players.sort(key=lambda p: -bands.index(band(p, cfg)))
    for i, p in enumerate(players):
        db.add(Lot(player_id=p.id, round=1, order_index=i, base_price=base_price(p, s, cfg, 1)))
    t.status, t.locked_at = LIVE, utcnow()
    audit(db, actor, "auction.started", teams=len(teams), players=len(players), settings=s)
    await db.commit()


async def open_next(db: AsyncSession, actor: str) -> Lot:
    t, cfg = await load(db, lock=True)
    s = settings(t)
    if t.status not in (LIVE, PAUSED):
        raise Reject("The auction isn't running")
    if await open_lot(db):
        raise Reject("Close the current lot first")
    lot = await db.scalar(select(Lot).where(Lot.status == "queued").order_by(Lot.round, Lot.order_index).limit(1))
    if not lot and await current_round(db) == 1:
        sold = {sale.player_id for sale, _ in await active_sales(db)}
        unsold = [p for p in await pool_players(db) if p.id not in sold]
        random.shuffle(unsold)
        for i, p in enumerate(unsold):
            db.add(Lot(player_id=p.id, round=2, order_index=i, base_price=base_price(p, s, cfg, 2)))
        await db.flush()
        if unsold:
            audit(db, actor, "auction.round2", players=len(unsold))
        lot = await db.scalar(select(Lot).where(Lot.status == "queued").order_by(Lot.round, Lot.order_index).limit(1))
    if not lot:
        raise Reject("The pool is empty. Run the final assignment.")
    now = utcnow()
    lot.status, lot.opened_at = "open", now
    if s["bid_timer"]:
        if t.status == LIVE:
            lot.timer_end = now + timedelta(seconds=s["bid_timer"])
        else:
            lot.paused_remaining = float(s["bid_timer"])
    audit(db, actor, "lot.opened", lot_id=lot.id, player_id=lot.player_id, round=lot.round, base=lot.base_price)
    await db.commit()
    publish("lot.opened", lot_id=lot.id)
    return lot


async def place_bid(db: AsyncSession, team_id: int, lot_id: int, amount: int, placed_by: str) -> Bid:
    lot = await db.get(Lot, lot_id, with_for_update=True)   # serialises every bid on this lot
    t, cfg = await load(db)
    s = settings(t)
    if not lot or lot.status != "open":
        raise Reject("This player is no longer up")
    if t.status != LIVE:
        raise Reject("The auction is paused")
    now = utcnow()
    if lot.timer_end and now >= lot.timer_end:
        raise Reject("Time is up")
    top = await highest_bid(db, lot)
    expected = next_amount(lot.base_price, top.amount if top else None, s)
    if amount != expected:
        raise Reject(f"The price moved. Next bid is {expected}")
    states = await team_state(db, t, cfg, lot)
    if team_id not in states:
        raise Reject("Unknown team", 404)
    why = bid_block(states[team_id], s, await db.get(Player, lot.player_id), amount, top.team_id if top else None)
    if why:
        raise Reject(why)
    bid = Bid(lot_id=lot.id, team_id=team_id, amount=amount, placed_by=placed_by)
    db.add(bid)
    if lot.timer_end:
        lot.timer_end = max(lot.timer_end, now + timedelta(seconds=s["bid_reset"]))
    audit(db, placed_by if placed_by == "leader" else "admin_proxy", "bid.accepted", lot_id=lot.id, team_id=team_id, amount=amount)
    await db.commit()
    return bid


async def close_lot(db: AsyncSession, actor: str, force_unsold: bool = False, only_if_expired: bool = False) -> Lot | None:
    lot = await open_lot(db, lock=True)
    if not lot:
        if only_if_expired:
            return None
        raise Reject("No player is up")
    now = utcnow()
    if only_if_expired and not (lot.timer_end and now >= lot.timer_end):
        await db.rollback()
        return None
    top = await highest_bid(db, lot)
    lot.closed_at, lot.timer_end, lot.paused_remaining = now, None, None
    if top and not force_unsold:
        lot.status = "sold"
        db.add(Sale(lot_id=lot.id, player_id=lot.player_id, team_id=top.team_id, price=top.amount))
        audit(db, actor, "lot.sold", lot_id=lot.id, player_id=lot.player_id, team_id=top.team_id, price=top.amount)
    else:
        lot.status = "unsold"
        audit(db, actor, "lot.unsold", lot_id=lot.id, player_id=lot.player_id)
    await db.commit()
    publish("lot.sold" if lot.status == "sold" else "lot.unsold", lot_id=lot.id)
    return lot


async def pause(db: AsyncSession, actor: str, on: bool) -> None:
    t, _ = await load(db, lock=True)
    if t.status != (LIVE if on else PAUSED):
        raise Reject("The auction is already paused" if on else "The auction isn't paused")
    lot = await open_lot(db, lock=True)
    now = utcnow()
    if lot and on and lot.timer_end:
        lot.paused_remaining, lot.timer_end = max(0.0, (lot.timer_end - now).total_seconds()), None
    if lot and not on and lot.paused_remaining is not None:
        lot.timer_end, lot.paused_remaining = now + timedelta(seconds=lot.paused_remaining), None
    t.status = PAUSED if on else LIVE
    audit(db, actor, "auction.paused" if on else "auction.resumed")
    await db.commit()


async def undo_last_sale(db: AsyncSession, actor: str) -> Sale:
    t, cfg = await load(db, lock=True)
    if t.status not in (LIVE, PAUSED):
        raise Reject("Rosters are locked")
    sale = await db.scalar(select(Sale).where(Sale.undone_at.is_(None)).order_by(Sale.id.desc()).limit(1).with_for_update())
    if not sale:
        raise Reject("Nothing to undo")
    sale.undone_at = utcnow()
    old = await db.get(Lot, sale.lot_id)
    old.status = "undone"
    rnd = await current_round(db)
    last = await db.scalar(select(func.max(Lot.order_index)).where(Lot.round == rnd)) or 0
    p = await db.get(Player, sale.player_id)
    db.add(Lot(player_id=p.id, round=rnd, order_index=last + 1, base_price=base_price(p, settings(t), cfg, rnd)))
    audit(db, actor, "sale.undone", sale_id=sale.id, player_id=p.id, team_id=sale.team_id, price=sale.price)
    await db.commit()
    return sale


async def assign_leftovers(db: AsyncSession, actor: str) -> list[tuple[int, int]]:
    """Everyone paid, so nobody is left out: leftovers go at 0 credits to the smallest team under the max."""
    t, cfg = await load(db, lock=True)
    s = settings(t)
    if t.status not in (LIVE, PAUSED):
        raise Reject("The auction isn't running")
    if await open_lot(db) or await db.scalar(select(func.count()).select_from(Lot).where(Lot.status == "queued")):
        raise Reject("Finish the remaining lots first")
    states = await team_state(db, t, cfg)
    sold = {sale.player_id for sale, _ in await active_sales(db)}
    left = sorted((p for p in await pool_players(db) if p.id not in sold), key=lambda p: -p.current_rank_tier)
    placed, now = [], utcnow()
    for i, p in enumerate(left):
        open_teams = [st for st in states.values() if not s["max_players"] or st["bought"] < s["max_players"]]
        if not open_teams:
            raise Reject("Every team is full; raise the maximum roster")
        st = min(open_teams, key=lambda x: (x["bought"], -x["credits_left"], x["team"].id))
        lot = Lot(player_id=p.id, round=FINAL, order_index=i, base_price=0, status="assigned", opened_at=now, closed_at=now)
        db.add(lot)
        await db.flush()
        db.add(Sale(lot_id=lot.id, player_id=p.id, team_id=st["team"].id, price=0))
        st["bought"] += 1
        placed.append((p.id, st["team"].id))
    short = [st["team"].name for st in states.values() if st["bought"] < s["min_players"]]
    if short:
        await db.rollback()
        raise Reject(f"{', '.join(short)} would end below {s['min_players']} players. Undo a sale or proxy-bid first.")
    t.status = "completed"
    audit(db, actor, "auction.completed", assigned=placed)
    await db.commit()
    publish("auction.completed")
    return placed


async def recover_after_restart(db: AsyncSession) -> None:
    """A restart mid-lot pauses the auction with the persisted timer and bids intact."""
    t, _ = await load(db, lock=True)
    if t.status != LIVE:
        return
    lot = await open_lot(db, lock=True)
    s = settings(t)
    if lot and lot.timer_end:
        lot.paused_remaining = max(float(s["bid_reset"]), (lot.timer_end - utcnow()).total_seconds())
        lot.timer_end = None
    t.status = PAUSED
    audit(db, "system", "auction.paused", reason="server restart")
    await db.commit()
