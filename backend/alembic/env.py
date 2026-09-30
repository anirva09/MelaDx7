"""Alembic environment (async engine; URL from application settings)."""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from alembic import context
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config
from sqlalchemy.pool import NullPool

# Make `app` (backend/) and `ml` (repository root) importable wherever alembic runs from.
_BACKEND = Path(__file__).resolve().parents[1]
for _path in (_BACKEND, _BACKEND.parent):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))

import app.models  # noqa: E402, F401  - register all tables on the metadata
from app.db.base import Base, UTCDateTime  # noqa: E402

config = context.config
target_metadata = Base.metadata


def _database_url() -> str:
    # Allow an explicit override (used by tests); otherwise read the app settings.
    url = config.attributes.get("database_url") or os.environ.get("ALEMBIC_DATABASE_URL")
    if url:
        return url
    from app.core.config import get_settings

    return get_settings().database_url


def _render_item(type_: str, obj: object, _ctx: object) -> str | bool:
    """Render the app's UTCDateTime decorator as a plain timestamptz column."""
    if type_ == "type" and isinstance(obj, UTCDateTime):
        return "sa.DateTime(timezone=True)"
    return False


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        render_item=_render_item,
        render_as_batch=_database_url().startswith("sqlite"),
    )
    with context.begin_transaction():
        context.run_migrations()


def _run(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        render_item=_render_item,
        render_as_batch=connection.dialect.name == "sqlite",
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = async_engine_from_config(
        {"sqlalchemy.url": _database_url()}, prefix="sqlalchemy.", poolclass=NullPool
    )
    async with engine.connect() as connection:
        await connection.run_sync(_run)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    connection = config.attributes.get("connection")
    if connection is not None:
        _run(connection)
    else:
        asyncio.run(run_migrations_online())
