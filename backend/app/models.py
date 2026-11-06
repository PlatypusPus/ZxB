from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def tournament_fk():
    return mapped_column(ForeignKey("tournament.id"), default=1, index=True)


def created():
    return mapped_column(DateTime(timezone=True), server_default=func.now())


class GameConfig(Base):
    """Ranks, roles and price bands as data, so another game is a new row, not a rewrite."""
    __tablename__ = "game_config"
    id: Mapped[int] = mapped_column(primary_key=True)
    game: Mapped[str] = mapped_column(String(32), unique=True)
    data: Mapped[dict] = mapped_column(JSONB)


class Tournament(Base):
    __tablename__ = "tournament"
    id: Mapped[int] = mapped_column(primary_key=True)
    game_config_id: Mapped[int] = mapped_column(ForeignKey("game_config.id"))
    name: Mapped[str] = mapped_column(String(80))
    host: Mapped[str] = mapped_column(String(80), default="ZenithXBeans")
    # draft, registration_open, registration_closed, auction_live, auction_paused, completed
    status: Mapped[str] = mapped_column(String(24), default="registration_open")
    settings: Mapped[dict] = mapped_column(JSONB, default=dict)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Player(Base):
    __tablename__ = "player"
    __table_args__ = (
        # Riot ID is unique among live sign-ups; a rejected/withdrawn person can sign up again.
        Index("uq_player_riot", "tournament_id", "riot_id_key", unique=True,
              postgresql_where=text("status NOT IN ('rejected', 'withdrawn')")),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    tournament_id: Mapped[int] = tournament_fk()
    display_name: Mapped[str] = mapped_column(String(32))
    riot_id: Mapped[str] = mapped_column(String(24))
    riot_id_key: Mapped[str] = mapped_column(String(24))  # lowercased
    current_rank_tier: Mapped[int] = mapped_column(Integer)
    peak_rank_tier: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(16))
    playstyle: Mapped[str] = mapped_column(String(80))
    quote: Mapped[str] = mapped_column(String(80), default="")
    discord: Mapped[str] = mapped_column(String(40))
    phone: Mapped[str] = mapped_column(String(10))
    photo: Mapped[str | None] = mapped_column(String(40))
    path: Mapped[str] = mapped_column(String(8))  # leader | auction
    # submitted, verified, approved, rejected, waitlisted, withdrawn
    status: Mapped[str] = mapped_column(String(12), default="submitted", index=True)
    reject_reason: Mapped[str] = mapped_column(Text, default="")
    edit_token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    terms_version: Mapped[str] = mapped_column(String(16))
    terms_accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created()


class Payment(Base):
    __tablename__ = "payment"
    id: Mapped[int] = mapped_column(primary_key=True)
    tournament_id: Mapped[int] = tournament_fk()
    player_id: Mapped[int] = mapped_column(ForeignKey("player.id"), unique=True)
    amount: Mapped[int] = mapped_column(Integer)
    utr: Mapped[str] = mapped_column(String(12), unique=True)  # a UTR can never be reused
    screenshot: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(10), default="submitted")  # submitted, verified, rejected, refunded
    verified_by: Mapped[str | None] = mapped_column(String(80))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = created()


class Team(Base):
    __tablename__ = "team"
    __table_args__ = (
        UniqueConstraint("tournament_id", "name_key", name="uq_team_name"),
        UniqueConstraint("tournament_id", "tag", name="uq_team_tag"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    tournament_id: Mapped[int] = tournament_fk()
    leader_player_id: Mapped[int] = mapped_column(ForeignKey("player.id"), unique=True)
    name: Mapped[str] = mapped_column(String(24))
    name_key: Mapped[str] = mapped_column(String(24))
    tag: Mapped[str] = mapped_column(String(4))
    logo: Mapped[str] = mapped_column(String(40))
    profile_status: Mapped[str] = mapped_column(String(10), default="pending")  # pending, approved
    access_code_hash: Mapped[str | None] = mapped_column(String(64))


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    tournament_id: Mapped[int] = tournament_fk()
    actor: Mapped[str] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = created()


class Lot(Base):
    """One player up for auction in one round. round: 1, 2 (discounted) or 3 (final assignment)."""
    __tablename__ = "lot"
    __table_args__ = (
        Index("uq_one_open_lot", "tournament_id", unique=True, postgresql_where=text("status = 'open'")),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    tournament_id: Mapped[int] = tournament_fk()
    player_id: Mapped[int] = mapped_column(ForeignKey("player.id"), index=True)
    round: Mapped[int] = mapped_column(Integer, default=1)
    order_index: Mapped[int] = mapped_column(Integer)
    base_price: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(10), default="queued")  # queued, open, sold, unsold, assigned, undone
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    timer_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # persisted so a restart can restore it
    paused_remaining: Mapped[float | None] = mapped_column()


class Bid(Base):
    __tablename__ = "bid"
    id: Mapped[int] = mapped_column(primary_key=True)
    tournament_id: Mapped[int] = tournament_fk()
    lot_id: Mapped[int] = mapped_column(ForeignKey("lot.id"), index=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("team.id"))
    amount: Mapped[int] = mapped_column(Integer)
    placed_by: Mapped[str] = mapped_column(String(12))  # leader | admin_proxy
    created_at: Mapped[datetime] = created()


class Sale(Base):
    """Credits are always derived from active sales, never stored, so undo can't drift."""
    __tablename__ = "sale"
    __table_args__ = (
        Index("uq_active_sale", "player_id", unique=True, postgresql_where=text("undone_at IS NULL")),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    tournament_id: Mapped[int] = tournament_fk()
    lot_id: Mapped[int] = mapped_column(ForeignKey("lot.id"))
    player_id: Mapped[int] = mapped_column(ForeignKey("player.id"))
    team_id: Mapped[int] = mapped_column(ForeignKey("team.id"), index=True)
    price: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = created()
    undone_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
