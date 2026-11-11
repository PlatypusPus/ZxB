"""Sign in with Google, or an email and password, before registering.

Google uses the OAuth 2.0 authorization-code flow. Either way the result is a short-lived signed cookie
(`zxb_id`) holding who the person is; POST /signup requires it, so each account can hold one live sign-up.
Every account has an email, which is where selection results are sent.
"""
import asyncio
import base64
import logging
import hmac
import json
import os
import re
import secrets
import time
import urllib.parse
import urllib.request

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..core import SECRET_KEY, check_password, get_db, hash_password, mail_html, rate_limit, send_mail, utcnow
from ..models import Account
from ..tournament import load

router = APIRouter()
PUBLIC_URL = os.environ.get("PUBLIC_URL", "http://127.0.0.1:5180").rstrip("/")
SECURE = PUBLIC_URL.startswith("https://")
COOKIE, STATE_COOKIE = "zxb_id", "zxb_oauth_state"
ID_HOURS = 6

PROVIDERS = {
    "google": {
        "authorize": "https://accounts.google.com/o/oauth2/v2/auth",
        "token": "https://oauth2.googleapis.com/token",
        "me": "https://openidconnect.googleapis.com/v1/userinfo",
        "scope": "openid email profile",
    },
}


def creds(provider: str) -> tuple[str, str] | None:
    cid = os.environ.get(f"{provider.upper()}_CLIENT_ID", "")
    secret = os.environ.get(f"{provider.upper()}_CLIENT_SECRET", "")
    return (cid, secret) if cid and secret else None


def enabled() -> list[str]:
    # AUTH_DEV=1 adds a fake provider for local testing only; never set it in production.
    return [p for p in PROVIDERS if creds(p)] + (["dev"] if os.environ.get("AUTH_DEV") == "1" else [])


def redirect_uri(provider: str) -> str:
    return f"{PUBLIC_URL}/api/v1/auth/{provider}/callback"


# ---------- signed values (same HMAC key as admin tokens, different purpose prefix)

def _sign(purpose: str, data: dict, hours: float) -> str:
    body = base64.urlsafe_b64encode(json.dumps({**data, "exp": int(time.time() + hours * 3600)}).encode()).decode()
    return body + "." + hmac.new(SECRET_KEY.encode(), f"{purpose}.{body}".encode(), "sha256").hexdigest()


def _unsign(purpose: str, value: str) -> dict | None:
    body, _, sig = (value or "").partition(".")
    good = hmac.new(SECRET_KEY.encode(), f"{purpose}.{body}".encode(), "sha256").hexdigest()
    if not body or not hmac.compare_digest(sig, good):
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(body))
    except ValueError:
        return None
    return data if data.get("exp", 0) > time.time() else None


def issue_identity(provider: str, sub: str, name: str, email: str = "") -> str:
    return _sign("id", {"provider": provider, "sub": sub, "name": name, "email": email}, ID_HOURS)


def identity(request: Request) -> dict | None:
    return _unsign("id", request.cookies.get(COOKIE, ""))


def require_identity(request: Request) -> dict:
    who = identity(request)
    if not who:
        raise HTTPException(401, "Sign in with Google or your email to register")
    return who


# ---------- HTTP to the provider (stdlib, run in a thread so the event loop never blocks)

def _call(url: str, data: dict | None = None, token: str = "") -> dict:
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode() if data else None,
                                 headers={"Accept": "application/json", "User-Agent": "zxb-signup",
                                          **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


async def fetch_profile(provider: str, code: str) -> dict:
    cid, secret = creds(provider)
    cfg = PROVIDERS[provider]
    tok = await asyncio.to_thread(_call, cfg["token"], {
        "grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri(provider),
        "client_id": cid, "client_secret": secret})
    me = await asyncio.to_thread(_call, cfg["me"], None, tok["access_token"])
    if not me.get("email_verified"):
        raise HTTPException(403, "Verify your Google email first")
    return {"sub": me["sub"], "name": me.get("name") or me["email"], "email": me["email"]}


# ---------- routes

def _back(request: Request, error: str = "") -> RedirectResponse:
    return RedirectResponse("/signup" + (f"?login_error={urllib.parse.quote(error)}" if error else ""), 303)


def _set_identity(resp, value: str):
    resp.set_cookie(COOKIE, value, max_age=ID_HOURS * 3600, httponly=True, secure=SECURE, samesite="lax", path="/")
    resp.delete_cookie(STATE_COOKIE, path="/api/v1/auth")
    return resp


@router.get("/auth/{provider}/start")
async def start(provider: str, request: Request):
    if provider == "dev" and "dev" in enabled():
        n = secrets.token_hex(3)
        return _set_identity(_back(request), issue_identity("dev", n, f"Dev {n}", email=f"dev{n}@example.com"))
    if provider not in PROVIDERS or not creds(provider):
        raise HTTPException(404, "This sign-in option isn't set up")
    state = secrets.token_urlsafe(24)
    q = {"client_id": creds(provider)[0], "redirect_uri": redirect_uri(provider), "response_type": "code",
         "scope": PROVIDERS[provider]["scope"], "state": state, "prompt": "select_account"}
    resp = RedirectResponse(PROVIDERS[provider]["authorize"] + "?" + urllib.parse.urlencode(q), 303)
    # The state cookie ties the callback to this browser, which blocks login CSRF.
    resp.set_cookie(STATE_COOKIE, _sign("state", {"s": state, "p": provider}, 0.25), max_age=900,
                    httponly=True, secure=SECURE, samesite="lax", path="/api/v1/auth")
    return resp


@router.get("/auth/{provider}/callback")
async def callback(provider: str, request: Request, code: str = "", state: str = "", error: str = ""):
    saved = _unsign("state", request.cookies.get(STATE_COOKIE, ""))
    if error:
        return _back(request, "Sign-in was cancelled")
    if provider not in PROVIDERS or not creds(provider) or not saved or saved.get("p") != provider \
            or not hmac.compare_digest(saved.get("s", ""), state) or not code:
        return _back(request, "Sign-in expired, please try again")
    try:
        prof = await fetch_profile(provider, code)
    except HTTPException as e:
        return _back(request, e.detail)
    except Exception:
        return _back(request, f"Couldn't reach {provider.title()}, please try again")
    return _set_identity(_back(request), issue_identity(provider, **prof))


async def is_verified(db: AsyncSession, who: dict) -> bool:
    """Google already verifies emails; email accounts must click the link we send."""
    if who.get("provider") != "email":
        return True
    acct = await db.get(Account, int(who["sub"]))
    return bool(acct and acct.verified_at)


@router.get("/auth/me")
async def me(request: Request, db: AsyncSession = Depends(get_db)):
    who = identity(request)
    user = who and {k: who.get(k, "") for k in ("provider", "name", "email")}
    if user:
        user["verified"] = await is_verified(db, who)
    return {"providers": enabled(), "user": user}


# ---------- email + password accounts

EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")


def _account_input(body: dict) -> tuple[str, str]:
    return str(body.get("email", "")).strip().lower(), str(body.get("password", ""))


@router.post("/auth/register")
async def register(body: dict, request: Request, tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    rate_limit(request, "register", 10, 600)
    email, pw = _account_input(body)
    name, e = str(body.get("name", "")).strip(), {}
    if not 2 <= len(name) <= 64:
        e["name"] = "Enter your name"
    if len(email) > 254 or not EMAIL.match(email):
        e["email"] = "Enter a valid email; your result is sent here"
    if not 8 <= len(pw) <= 128:
        e["password"] = "Use at least 8 characters"
    if e:
        raise HTTPException(422, {"errors": e})
    acct = Account(email=email, name=name, password_hash=await asyncio.to_thread(hash_password, pw))
    db.add(acct)
    try:
        await db.commit()
    except IntegrityError:
        raise HTTPException(409, {"errors": {"email": "This email already has an account. Log in instead."}})
    await send_verification(db, acct, tasks)
    return _set_identity(JSONResponse({"ok": True, "emailed": True}, 201), issue_identity("email", str(acct.id), name, email=email))


@router.post("/auth/login")
async def login(body: dict, request: Request, db: AsyncSession = Depends(get_db)):
    rate_limit(request, "login", 10, 600)
    email, pw = _account_input(body)
    acct = await db.scalar(select(Account).where(Account.email == email))
    # Same answer and similar work whether or not the email exists, so it can't be used to probe accounts.
    ok = await asyncio.to_thread(check_password, pw, acct.password_hash if acct else hash_password("x"))
    if not acct or not ok:
        raise HTTPException(401, "Wrong email or password")
    return _set_identity(JSONResponse({"ok": True}), issue_identity("email", str(acct.id), acct.name, email=acct.email))


@router.post("/auth/logout")
async def logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE, path="/")
    return resp



# ---------- email verification

VERIFY_HOURS = 48


def _deliver(to: str, subject: str, text: str, html_body: str, link: str) -> None:
    if not send_mail(to, subject, text, html_body):
        logging.warning("Verification email to %s failed", to)
        if os.environ.get("AUTH_DEV") == "1":
            logging.warning("Dev verification link for %s: %s", to, link)


async def send_verification(db: AsyncSession, acct: Account, tasks: BackgroundTasks) -> None:
    """Queues the email to go out after the response, so the page doesn't wait on the mail server (2-5 s)."""
    t, _ = await load(db)
    link = f"{PUBLIC_URL}/api/v1/auth/verify?t={_sign('verify', {'a': acct.id, 'e': acct.email}, VERIFY_HOURS)}"
    lines = [f"Hi {acct.name},", f"Confirm this is your email to finish signing up for {t.name}. "
             "Your selection result and event announcements will be sent here.",
             f"The link works for {VERIFY_HOURS} hours. If you didn't make an account, ignore this email."]
    tasks.add_task(_deliver, acct.email, f"{t.name}: verify your email", "\n\n".join(lines[:2] + [link] + lines[2:]),
                   mail_html("Verify your email", lines, ("Verify my email", link)), link)


@router.get("/auth/verify")
async def verify(t: str = "", db: AsyncSession = Depends(get_db)):
    data = _unsign("verify", t)
    acct = data and await db.get(Account, data.get("a"))
    if not acct or acct.email != data.get("e"):
        return RedirectResponse("/verified?error=1", 303)
    if not acct.verified_at:
        acct.verified_at = utcnow()
        await db.commit()
    # Also signs them in, so a link opened on another device still lands on a working sign-up.
    return _set_identity(RedirectResponse("/verified", 303), issue_identity("email", str(acct.id), acct.name, email=acct.email))


@router.post("/auth/resend")
async def resend(request: Request, tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    who = require_identity(request)
    rate_limit(request, "resend", 3, 600)
    acct = who["provider"] == "email" and await db.get(Account, int(who["sub"]))
    if not acct or acct.verified_at:
        return {"emailed": False, "verified": True}
    await send_verification(db, acct, tasks)
    return {"emailed": True, "verified": False}
