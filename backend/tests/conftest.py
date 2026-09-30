"""Backend test fixtures.

By default tests run against a temporary SQLite database (migrated with Alembic,
exactly as in production). Set ``TEST_DATABASE_URL`` to run the same suite
against PostgreSQL, e.g.::

    TEST_DATABASE_URL=postgresql+asyncpg://lesionlens:pw@localhost:5432/lesionlens_test pytest backend/tests

Images are synthetic and generated on the fly; the model is an *untrained*
pipeline-verification artifact (or a tiny model trained on synthetic shapes).
Tests verify the software pipeline, not diagnostic performance.
"""

from __future__ import annotations

import asyncio
import io
import os
import secrets
import uuid
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from PIL import Image, ImageDraw

from app.core.config import Settings
from app.main import create_app

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
HAM_CLASSES = REPO_ROOT / "ml" / "configs" / "classes" / "ham10000.yaml"
TEST_PASSWORD = "correct-horse-42"


# ---------------------------------------------------------------- images
def synthetic_image(width: int = 320, height: int = 256, seed: int = 0) -> Image.Image:
    rng = np.random.default_rng(seed)
    image = Image.fromarray(rng.integers(90, 200, size=(height, width, 3), dtype=np.uint8))
    ImageDraw.Draw(image).ellipse(
        (width * 0.3, height * 0.25, width * 0.7, height * 0.75), fill=(110, 60, 45)
    )
    return image


def image_bytes(fmt: str = "JPEG", *, seed: int = 0, size: tuple[int, int] = (320, 256), **kw: Any) -> bytes:
    buffer = io.BytesIO()
    synthetic_image(*size, seed=seed).save(buffer, format=fmt, **kw)
    return buffer.getvalue()


# ------------------------------------------------------------- database
def _database_url(tmp_root: Path) -> str:
    return os.environ.get("TEST_DATABASE_URL") or f"sqlite+aiosqlite:///{tmp_root / 'test.db'}"


def _reset_postgres(url: str) -> None:
    import asyncpg

    dsn = url.replace("postgresql+asyncpg://", "postgresql://")

    async def reset() -> None:
        conn = await asyncpg.connect(dsn)
        try:
            await conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
        finally:
            await conn.close()

    asyncio.run(reset())


def migrate(url: str) -> None:
    if url.startswith("postgresql"):
        _reset_postgres(url)
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.attributes["database_url"] = url
    command.upgrade(cfg, "head")


@pytest.fixture(scope="session")
def tmp_root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("backend")


@pytest.fixture(scope="session")
def untrained_artifact(tmp_root: Path) -> Path:
    from ml.scripts.create_untrained_artifact import create_untrained_artifact

    return create_untrained_artifact(
        tmp_root / "models" / "resnet18-untrained", architecture="resnet18", classes_file=HAM_CLASSES, seed=3
    )


@pytest.fixture(scope="session")
def database_url(tmp_root: Path) -> str:
    url = _database_url(tmp_root)
    migrate(url)
    return url


def make_settings(tmp_root: Path, database_url: str, **overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "environment": "test",
        "jwt_secret": secrets.token_hex(32),
        "database_url": database_url,
        "upload_directory": str(tmp_root / "uploads"),
        "model_path": str(tmp_root / "models" / "resnet18-untrained"),
        "allow_untrained_model": True,
        "log_json": False,
        "log_level": "WARNING",
        "cors_origins": ["http://localhost:5173"],
        "rate_limit_auth_per_minute": 1000,
        "rate_limit_inference_per_minute": 1000,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]  # ignore any local .env


@pytest.fixture(scope="session")
def settings(tmp_root: Path, database_url: str, untrained_artifact: Path) -> Settings:
    return make_settings(tmp_root, database_url, model_path=str(untrained_artifact))


class AppHarness:
    """A running app (lifespan executed) plus an HTTP client bound to it."""

    def __init__(self, app: Any, client: httpx.AsyncClient) -> None:
        self.app = app
        self.client = client

    async def register(self, email: str | None = None, password: str = TEST_PASSWORD) -> dict[str, str]:
        email = email or f"user-{uuid.uuid4().hex[:10]}@example.org"
        response = await self.client.post(
            "/api/auth/register", json={"email": email, "full_name": "Test User", "password": password}
        )
        assert response.status_code == 201, response.text
        return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def _start(settings: Settings) -> tuple[Any, Any, httpx.AsyncClient]:
    app = create_app(settings)
    lifespan = app.router.lifespan_context(app)
    await lifespan.__aenter__()
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
    return app, lifespan, client


@pytest_asyncio.fixture(scope="session")
async def harness(settings: Settings) -> AsyncIterator[AppHarness]:
    app, lifespan, client = await _start(settings)
    try:
        yield AppHarness(app, client)
    finally:
        await client.aclose()
        await lifespan.__aexit__(None, None, None)


@pytest_asyncio.fixture
async def app_factory(tmp_root: Path, database_url: str) -> AsyncIterator[Callable[..., Any]]:
    """Start additional apps with custom settings (e.g. no model available)."""
    started: list[tuple[Any, httpx.AsyncClient]] = []

    async def factory(**overrides: Any) -> AppHarness:
        app, lifespan, client = await _start(make_settings(tmp_root, database_url, **overrides))
        started.append((lifespan, client))
        return AppHarness(app, client)

    yield factory
    for lifespan, client in started:
        await client.aclose()
        await lifespan.__aexit__(None, None, None)


@pytest_asyncio.fixture
async def client(harness: AppHarness) -> AsyncIterator[httpx.AsyncClient]:
    harness.client.cookies.clear()
    harness.app.state.rate_limiter.reset()
    yield harness.client


@pytest_asyncio.fixture
async def auth_headers(harness: AppHarness, client: httpx.AsyncClient) -> dict[str, str]:
    headers = await harness.register()
    client.cookies.clear()
    return headers


@pytest.fixture
def jpeg() -> bytes:
    return image_bytes("JPEG", quality=92)


@pytest.fixture(autouse=True)
def _no_proxy_env(monkeypatch: pytest.MonkeyPatch) -> None:
    # httpx must never try to reach a real proxy from tests.
    for var in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        monkeypatch.delenv(var, raising=False)
