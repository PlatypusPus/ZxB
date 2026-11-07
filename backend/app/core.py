"""Shared plumbing: settings, DB session, event bus, audit, auth, rate limits, image uploads."""
import hashlib
import html
import hmac
import io
import os
import logging
import secrets
import smtplib
import time
from collections import defaultdict, deque
from email.message import EmailMessage
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


# --- Email (stdlib smtplib). Without SMTP_HOST nothing is sent and callers report that to the admin.
SITE = os.environ.get("PUBLIC_URL", "https://zxb.shov.in").rstrip("/")


def mail_html(heading: str, paragraphs: list[str], button: tuple[str, str] | None = None) -> str:
    """Branded HTML email. Inline styles and tables only, because that's what mail apps render reliably."""
    e = html.escape
    paras = "".join(f'<p style="margin:0 0 16px;font:16px/1.55 Arial,Helvetica,sans-serif;color:#d9d6cf">'
                    f'{e(p).replace(chr(10), "<br>")}</p>' for p in paragraphs if p)
    btn = button and (f'<p style="margin:8px 0 0"><a href="{e(button[1])}" style="display:inline-block;background:#ff3d8b;'
                      f'color:#0b0b0d;font:bold 15px Arial,Helvetica,sans-serif;letter-spacing:1px;text-transform:uppercase;'
                      f'text-decoration:none;padding:14px 28px">{e(button[0])}</a></p>')
    return f"""<!doctype html><html><body style="margin:0;padding:32px 12px;background:#0b0b0d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#16161a;border:1px solid #2a2a30">
<tr><td style="padding:22px 32px;border-bottom:4px solid #ff3d8b"><img src="{SITE}/zxb-logo.png" alt="ZenithXBeans" height="40" style="display:block;height:40px;width:auto"></td></tr>
<tr><td style="padding:32px"><h1 style="margin:0 0 20px;font:bold 28px/1.15 Arial,Helvetica,sans-serif;color:#f4f1ea;text-transform:uppercase">{e(heading)}</h1>{paras}{btn or ""}</td></tr>
<tr><td style="padding:18px 32px;border-top:1px solid #2a2a30;font:13px/1.5 Arial,Helvetica,sans-serif;color:#8a8790">ZenithXBeans · Community tournaments<br><a href="{SITE}" style="color:#ffb547">{e(SITE.split("//")[-1])}</a></td></tr>
</table></td></tr></table></body></html>"""


def send_many(msgs: list[tuple[str, str, str, str | None]]) -> int:
    """(to, subject, text, html) over one SMTP connection. Returns how many were accepted.
    ponytail: sequential on one connection; add a queue if mailing lists grow past a few hundred."""
    host, msgs = os.environ.get("SMTP_HOST"), [m for m in msgs if m[0]]
    if not host or not msgs:
        return 0
    port, sent = int(os.environ.get("SMTP_PORT", "587")), 0
    try:
        with (smtplib.SMTP_SSL(host, port, timeout=20) if port == 465 else smtplib.SMTP(host, port, timeout=20)) as s:
            if port != 465:
                s.starttls()
            if os.environ.get("SMTP_USER"):
                s.login(os.environ["SMTP_USER"], os.environ.get("SMTP_PASSWORD", ""))
            for to, subject, text, html_body in msgs:
                msg = EmailMessage()
                msg["From"] = os.environ.get("SMTP_FROM") or os.environ.get("SMTP_USER", "")
                msg["To"], msg["Subject"] = to, subject
                msg.set_content(text)
                if html_body:
                    msg.add_alternative(html_body, subtype="html")
                try:
                    s.send_message(msg)
                    sent += 1
                except smtplib.SMTPRecipientsRefused:
                    logging.warning("Email to %s refused", to)
    except Exception:
        logging.exception("SMTP stopped after %d of %d emails", sent, len(msgs))
    return sent


def send_mail(to: str, subject: str, text: str, html_body: str | None = None) -> bool:
    return send_many([(to, subject, text, html_body)]) == 1
