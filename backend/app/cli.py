"""Administrative command-line tasks.

python -m app.cli create-user --email admin@example.org --name "Admin" --admin
python -m app.cli promote-admin user@example.org
python -m app.cli check-model
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import sys

from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import create_engine, create_sessionmaker
from app.models import ROLE_ADMIN, User
from app.schemas.auth import RegisterRequest


async def _create_user(email: str, name: str, admin: bool) -> int:
    password = getpass.getpass("Password: ")
    if password != getpass.getpass("Repeat password: "):
        print("Passwords do not match.", file=sys.stderr)
        return 1
    request = RegisterRequest(email=email, full_name=name, password=password)  # validates policy
    engine = create_engine(get_settings())
    async with create_sessionmaker(engine)() as session:
        if (await session.execute(select(User).where(User.email == request.email))).scalar_one_or_none():
            print("A user with this email already exists.", file=sys.stderr)
            return 1
        session.add(
            User(
                email=request.email,
                full_name=request.full_name,
                password_hash=hash_password(request.password),
                role=ROLE_ADMIN if admin else "user",
            )
        )
        await session.commit()
    await engine.dispose()
    print(f"Created {'admin' if admin else 'user'} {request.email}")
    return 0


async def _promote(email: str) -> int:
    engine = create_engine(get_settings())
    async with create_sessionmaker(engine)() as session:
        user = (await session.execute(select(User).where(User.email == email.lower()))).scalar_one_or_none()
        if user is None:
            print("No such user.", file=sys.stderr)
            return 1
        user.role = ROLE_ADMIN
        await session.commit()
    await engine.dispose()
    print(f"{email} is now an administrator")
    return 0


async def _prune_sessions(days: int) -> int:
    """Delete refresh-token rows that expired or were revoked more than `days` ago."""
    from datetime import timedelta

    from sqlalchemy import delete, or_

    from app.db.base import utcnow
    from app.models import RefreshToken

    cutoff = utcnow() - timedelta(days=days)
    engine = create_engine(get_settings())
    async with create_sessionmaker(engine)() as session:
        result = await session.execute(
            delete(RefreshToken).where(
                or_(RefreshToken.expires_at < cutoff, RefreshToken.revoked_at < cutoff)
            )
        )
        await session.commit()
    await engine.dispose()
    print(f"Deleted {getattr(result, 'rowcount', 0)} stale session records")
    return 0


def _check_model() -> int:
    from app.services.model_service import ModelService

    service = ModelService(get_settings())
    status = service.load()
    print(f"status: {status}\n{service.message}")
    return 0 if status == "ready" else 2


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("create-user", help="create a user (prompts for a password)")
    create.add_argument("--email", required=True)
    create.add_argument("--name", required=True)
    create.add_argument("--admin", action="store_true")
    promote = sub.add_parser("promote-admin", help="grant the admin role to an existing user")
    promote.add_argument("email")
    sub.add_parser("check-model", help="try to load the model at MODEL_PATH and report its status")
    prune = sub.add_parser("prune-sessions", help="delete expired/revoked refresh tokens (run daily)")
    prune.add_argument("--days", type=int, default=7)
    args = parser.parse_args(argv)

    if args.command == "create-user":
        return asyncio.run(_create_user(args.email, args.name, args.admin))
    if args.command == "promote-admin":
        return asyncio.run(_promote(args.email))
    if args.command == "prune-sessions":
        return asyncio.run(_prune_sessions(args.days))
    return _check_model()


if __name__ == "__main__":
    sys.exit(main())
