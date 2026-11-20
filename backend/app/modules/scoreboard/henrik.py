"""HenrikDev Valorant API: one shared queue so the whole app stays under the key's rate limit.

Regular key = 25 requests/minute. Calls are spaced GAP seconds apart (24/min) and a 429 waits for Retry-After.
"""
import asyncio
import json
import os
import time
import urllib.error
import urllib.request
from urllib.parse import quote

BASE = "https://api.henrikdev.xyz/valorant"
REGION, PLATFORM = "ap", "pc"
KEY = os.environ.get("HENRIKDEV_API_KEY", "")
GAP = 2.5          # seconds between calls
RETRIES = 3

_lock = asyncio.Lock()
_last = 0.0


class HenrikError(Exception):
    pass


def _get(url: str) -> tuple[int, dict | None, float]:
    req = urllib.request.Request(url, headers={"Authorization": KEY, "Accept": "application/json",
                                               "User-Agent": "zxb-scoreboard"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.load(r), 0
    except urllib.error.HTTPError as e:
        wait = float(e.headers.get("Retry-After") or 5) if e.code == 429 else 0
        return e.code, None, wait
    except (urllib.error.URLError, TimeoutError) as e:
        raise HenrikError(f"Henrik is unreachable ({e})") from e


async def get(path: str) -> dict | None:
    """GET a Henrik path. None on 404; HenrikError on anything else that isn't 2xx."""
    global _last
    if not KEY:
        raise HenrikError("HENRIKDEV_API_KEY is not set on the server")
    async with _lock:   # ponytail: one global queue; per-endpoint buckets if the key ever gets a higher tier
        for _ in range(RETRIES + 1):
            wait = GAP - (time.monotonic() - _last)
            if wait > 0:
                await asyncio.sleep(wait)
            _last = time.monotonic()
            status, body, retry_after = await asyncio.to_thread(_get, BASE + path)
            if status == 429:
                await asyncio.sleep(retry_after + 0.5)
                continue
            if status == 404:
                return None
            if status >= 400:
                raise HenrikError(f"Henrik returned {status} for {path.split('?')[0]}")
            return body
    raise HenrikError("Henrik rate limit: try again in a minute")


def _name_tag(riot_id: str) -> str:
    name, _, tag = riot_id.rpartition("#")
    return f"{quote(name, safe='')}/{quote(tag, safe='')}"


async def account(riot_id: str) -> dict | None:
    """{puuid, card: {large, wide}, ...} or None if the Riot ID doesn't exist."""
    body = await get(f"/v1/account/{_name_tag(riot_id)}")
    return body and body.get("data")


async def custom_history(riot_id: str, size: int = 10) -> list[dict]:
    """Recent custom games for a player, newest first (Henrik v3 match list items)."""
    body = await get(f"/v3/matches/{REGION}/{_name_tag(riot_id)}?mode=custom&size={size}")
    return (body or {}).get("data") or []


async def match(match_id: str) -> dict | None:
    body = await get(f"/v2/match/{quote(match_id, safe='')}")
    return body and body.get("data")
