"""Password hashing, access tokens and refresh tokens.

* Passwords: Argon2id (``argon2-cffi`` defaults, RFC 9106 low-memory profile).
* Access tokens: short-lived JWTs (HS256 by default) with issuer/audience/type claims.
* Refresh tokens: opaque random strings. Only their SHA-256 digest is stored, so a
  database leak does not reveal usable tokens. They rotate on every use; reuse of a
  rotated token revokes the whole token family (see services/auth.py).
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import Settings

_hasher = PasswordHasher()
# A real hash used to equalise timing when the user does not exist.
_DUMMY_HASH = _hasher.hash("dummy-password-for-timing-equalisation")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


@dataclass(frozen=True, slots=True)
class AccessTokenClaims:
    user_id: uuid.UUID
    role: str
    expires_at: datetime


class TokenError(Exception):
    """The token is missing, malformed, expired or otherwise invalid."""


def create_access_token(settings: Settings, user_id: uuid.UUID, role: str) -> tuple[str, int]:
    now = datetime.now(UTC)
    ttl = timedelta(minutes=settings.access_token_ttl_minutes)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "role": role,
        "type": "access",
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
        "jti": secrets.token_hex(8),
    }
    token = jwt.encode(payload, settings.jwt_secret.get_secret_value(), algorithm=settings.jwt_algorithm)
    return token, int(ttl.total_seconds())


def decode_access_token(settings: Settings, token: str) -> AccessTokenClaims:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=[settings.jwt_algorithm],  # never trust the header's alg
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
            options={"require": ["exp", "iat", "sub", "type", "iss", "aud"]},
            leeway=5,
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("token_expired") from exc
    except jwt.PyJWTError as exc:
        raise TokenError("invalid_token") from exc
    if payload.get("type") != "access":
        raise TokenError("invalid_token")
    try:
        user_id = uuid.UUID(str(payload["sub"]))
    except ValueError as exc:
        raise TokenError("invalid_token") from exc
    return AccessTokenClaims(
        user_id=user_id,
        role=str(payload.get("role", "user")),
        expires_at=datetime.fromtimestamp(int(payload["exp"]), UTC),
    )


def new_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
