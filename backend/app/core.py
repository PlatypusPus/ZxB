"""Shared plumbing: settings, DB session, event bus, audit, auth, rate limits, image uploads."""
import hashlib
import hmac
import io
import os
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Header, HTTPException, Request
from PIL import Image, ImageOps
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .models import AuditLog

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql+asyncpg://postgres:devpassword@127.0.0.1:5440/zxb")
SECRET_KEY = os.environ.get("SECRET_KEY") or secrets.token_hex(32)  # set in prod or tokens die on restart
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@zenithxbeans.local").lower()
ADMIN_PASSWORD_HASH = os.environ.get("ADMIN_PASSWORD_HASH", "")
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "uploads"))
PUBLIC_DIR, PRIVATE_DIR = UPLOAD_DIR / "public", UPLOAD_DIR / "private"
MAX_UPLOAD = 2 * 1024 * 1024
MAX_BODY = 7 * 1024 * 1024  # 3 images + form fields; Traefik enforces the same cap in prod

engine = create_async_engine(DATABASE_URL, pool_size=10, max_overflow=60)
Session = async_sessionmaker(engine, expire_on_commit=False)


async def get_db():
    async with Session() as s:
        yield s


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# --- Domain events. ponytail: in-process, sync handlers; swap for a queue if a module needs async work.
_subscribers: dict[str, list] = defaultdict(list)


def subscribe(event: str, fn) -> None:
    _subscribers[event].append(fn)


def publish(event: str, **payload) -> None:
    for fn in _subscribers[event]:
        fn(**payload)


def audit(db: AsyncSession, actor: str, action: str, **payload) -> None:
    db.add(AuditLog(actor=actor, action=action, payload=payload))


# --- Secrets and tokens (stdlib only)
def sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def new_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(24)
    return raw, sha256(raw)


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    return salt.hex() + ":" + hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1).hex()


def check_password(pw: str, stored: str) -> bool:
    if ":" not in stored:
        return False
    salt, h = stored.split(":", 1)
    got = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1).hex()
    return hmac.compare_digest(got, h)


def sign_admin_token(hours: int = 12) -> str:
    exp = str(int(time.time()) + hours * 3600)
    return exp + "." + hmac.new(SECRET_KEY.encode(), b"admin." + exp.encode(), "sha256").hexdigest()


def require_admin(authorization: str = Header("")) -> str:
    tok = authorization.removeprefix("Bearer ").strip()
    exp, _, sig = tok.partition(".")
    good = hmac.new(SECRET_KEY.encode(), b"admin." + exp.encode(), "sha256").hexdigest()
    if not (exp.isdigit() and hmac.compare_digest(sig, good) and int(exp) > time.time()):
        raise HTTPException(401, "Admin login required")
    return ADMIN_EMAIL


# --- Rate limits. ponytail: in-memory, fine for the single-worker deploy; Redis if we ever run several.
_hits: dict[str, deque] = defaultdict(deque)


def rate_limit(request: Request, bucket: str, limit: int, per: float) -> None:
    rate_limit_key(f"{bucket}:{request.client.host if request.client else '?'}", limit, per)


def rate_limit_key(key: str, limit: int, per: float) -> None:
    now, q = time.monotonic(), _hits[key]
    while q and q[0] <= now - per:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(429, "Too many requests. Wait a minute and try again.")
    q.append(now)


# --- Images: check the real type, re-encode to WebP (drops EXIF/GPS), random name.
def process_image(raw: bytes, field: str, square: bool) -> bytes:
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(413, {"errors": {field: "Image must be 2 MB or smaller"}})
    try:
        im = Image.open(io.BytesIO(raw))
        if im.format not in ("JPEG", "PNG", "WEBP") or im.width * im.height > 30_000_000:
            raise ValueError
        im = ImageOps.exif_transpose(im)
    except Exception:
        raise HTTPException(422, {"errors": {field: "Upload a PNG, JPG or WebP image"}})
    if square:
        im = ImageOps.fit(im, (min(im.size + (512,)),) * 2)
    else:
        im.thumbnail((1600, 1600))
    im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
    im.info.clear()
    out = io.BytesIO()
    im.save(out, "WEBP", quality=85, exif=b"")
    return out.getvalue()


def image_name() -> str:
    return secrets.token_hex(16) + ".webp"
