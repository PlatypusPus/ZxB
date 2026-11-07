"""Sign in with Discord or Google before registering.

Standard OAuth 2.0 authorization-code flow. The provider's answer becomes a short-lived signed cookie
(`zxb_id`) holding who the person is; POST /signup requires it, so each account can hold one live sign-up.
"""
import asyncio
import base64
import hmac
import json
import os
import secrets
import time
import urllib.parse
import urllib.request

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse

from ..core import SECRET_KEY

router = APIRouter()
PUBLIC_URL = os.environ.get("PUBLIC_URL", "http://127.0.0.1:5180").rstrip("/")
SECURE = PUBLIC_URL.startswith("https://")
COOKIE, STATE_COOKIE = "zxb_id", "zxb_oauth_state"
ID_HOURS = 6

PROVIDERS = {
    "discord": {
        "authorize": "https://discord.com/oauth2/authorize",
        "token": "https://discord.com/api/oauth2/token",
        "me": "https://discord.com/api/users/@me",
        "scope": "identify",
    },
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


def issue_identity(provider: str, sub: str, name: str, discord: str = "", email: str = "") -> str:
    return _sign("id", {"provider": provider, "sub": sub, "name": name, "discord": discord, "email": email}, ID_HOURS)


def identity(request: Request) -> dict | None:
    return _unsign("id", request.cookies.get(COOKIE, ""))


def require_identity(request: Request) -> dict:
    who = identity(request)
    if not who:
        raise HTTPException(401, "Sign in with Discord or Google to register")
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
    if provider == "discord":
        return {"sub": me["id"], "name": me.get("global_name") or me["username"], "discord": me["username"]}
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
        return _set_identity(_back(request), issue_identity("dev", n, f"Dev {n}", discord=f"dev{n}"))
    if provider not in PROVIDERS or not creds(provider):
        raise HTTPException(404, "This sign-in option isn't set up")
    state = secrets.token_urlsafe(24)
    q = {"client_id": creds(provider)[0], "redirect_uri": redirect_uri(provider), "response_type": "code",
         "scope": PROVIDERS[provider]["scope"], "state": state, "prompt": "select_account" if provider == "google" else "none"}
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


@router.get("/auth/me")
async def me(request: Request):
    who = identity(request)
    return {"providers": enabled(), "user": who and {k: who[k] for k in ("provider", "name", "discord", "email")}}


@router.post("/auth/logout")
async def logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE, path="/")
    return resp
