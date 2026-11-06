import hashlib
import os
import tempfile

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://postgres:devpassword@127.0.0.1:5440/zxb_test")
os.environ["UPLOAD_DIR"] = tempfile.mkdtemp(prefix="zxb-uploads-")
os.environ["ADMIN_EMAIL"] = "admin@test.local"
os.environ["ADMIN_PASSWORD_HASH"] = "00" * 16 + ":" + hashlib.scrypt(b"pw", salt=bytes(16), n=2**14, r=8, p=1).hex()

import shutil  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402

from app import core  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402
from app.modules.signup import router as signup_mod  # noqa: E402
from app.tournament import init_db  # noqa: E402


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def c():
    async with core.engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await init_db()
    shutil.rmtree(core.UPLOAD_DIR, ignore_errors=True)
    core._hits.clear()
    signup_mod.SIGNUP_LIMIT = (1000, 600)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as client:
        tok = (await client.post("/api/v1/admin/login", json={"email": "admin@test.local", "password": "pw"})).json()
        client.admin = {"Authorization": f"Bearer {tok['token']}"}
        yield client
    await core.engine.dispose()   # each test has its own event loop; don't carry connections across
