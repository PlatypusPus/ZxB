"""WebSocket hub. One process holds every socket, which is why the API runs a single worker.
ponytail: in-process set; add Redis pub/sub only if we ever run several workers (scale tier 2)."""
import asyncio
import json

from fastapi import WebSocket

clients: set[WebSocket] = set()


async def _send(ws: WebSocket, text: str) -> None:
    try:
        await asyncio.wait_for(ws.send_text(text), timeout=2)
    except Exception:
        clients.discard(ws)


async def broadcast(message: dict) -> None:
    text = json.dumps(message, default=str)
    await asyncio.gather(*(_send(ws, text) for ws in list(clients)))
