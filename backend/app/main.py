import asyncio
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .core import MAX_BODY, PUBLIC_DIR, Session, hash_password
from .modules.admin.router import router as admin_router
from .modules.auction import service as auction
from .modules.auction.router import router as auction_router, timer_loop
from .modules.signup.router import router as signup_router
from .tournament import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    async with Session() as db:
        await auction.recover_after_restart(db)
    timer = asyncio.create_task(timer_loop())
    yield
    timer.cancel()


app = FastAPI(title="ZenithXBeans Tournament API", lifespan=lifespan, docs_url=None, redoc_url=None)


@app.middleware("http")
async def cap_body(request: Request, call_next):
    # ponytail: trusts Content-Length; Caddy's request_body max_size covers chunked bodies in prod.
    if int(request.headers.get("content-length") or 0) > MAX_BODY:
        return JSONResponse({"detail": "Upload too large"}, status_code=413)
    return await call_next(request)


for r in (signup_router, admin_router, auction_router):
    app.include_router(r, prefix="/api/v1")


@app.get("/api/v1/health")
async def health():
    return {"ok": True}


PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=PUBLIC_DIR), name="media")

# Production: serve the built site (frontend/dist) from this same process. Unknown paths get index.html,
# because the frontend routes by pathname (/draft, /signup, /leader/<code>...).
DIST = Path(os.environ.get("FRONTEND_DIST") or Path(__file__).resolve().parents[2] / "frontend" / "dist")
if (DIST / "index.html").is_file():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def site(path: str):
        if path.startswith("api/"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        f = (DIST / path).resolve()
        return FileResponse(f if path and f.is_file() and DIST.resolve() in f.parents else DIST / "index.html")

if __name__ == "__main__" and sys.argv[1:2] == ["hash"]:
    print(hash_password(sys.argv[2]))  # python -m app.main hash 'password' -> ADMIN_PASSWORD_HASH
