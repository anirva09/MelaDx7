"""Registration, login, token rotation and account management."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import AuthenticationError, BadRequestError, ConflictError
from app.core.security import (
    TokenError,
    create_access_token,
    decode_access_token,
    hash_password,
    hash_refresh_token,
    new_refresh_token,
    password_needs_rehash,
    verify_password,
)
from app.db.base import utcnow
from app.models import RefreshToken, User
from app.repositories import RefreshTokenRepository, UserRepository
from app.schemas.auth import RegisterRequest

log = logging.getLogger("app.auth")

#: A just-rotated refresh token may be presented again within this window without
#: being treated as theft (parallel refreshes from several tabs of the same browser).
REUSE_GRACE_SECONDS = 20


@dataclass(frozen=True, slots=True)
class IssuedTokens:
    access_token: str
    expires_in: int
    refresh_token: str
    refresh_expires_at: datetime


class AuthService:
    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings
        self.users = UserRepository(session)
        self.tokens = RefreshTokenRepository(session)

    # ----------------------------------------------------------- accounts
    async def register(self, request: RegisterRequest) -> User:
        if await self.users.get_by_email(request.email):
            raise ConflictError("An account with this email address already exists.", code="email_taken")
        user = User(
            email=request.email,
            full_name=request.full_name,
            password_hash=hash_password(request.password),
        )
        try:
            await self.users.add(user)
            await self.session.commit()
        except IntegrityError as exc:  # concurrent registration with the same email
            await self.session.rollback()
            raise ConflictError(
                "An account with this email address already exists.", code="email_taken"
            ) from exc
        log.info("user registered", extra={"user_id": str(user.id)})
        return user

    async def authenticate(self, email: str, password: str) -> User:
        user = await self.users.get_by_email(email)
        # verify_password runs a full hash even when the user does not exist, so
        # response timing does not reveal which email addresses are registered.
        valid = verify_password(password, user.password_hash if user else None)
        if user is None or not valid:
            raise AuthenticationError("Incorrect email or password.", code="invalid_credentials")
        if not user.is_active:
            raise AuthenticationError("This account has been deactivated.", code="account_disabled")
        if password_needs_rehash(user.password_hash):
            user.password_hash = hash_password(password)
        user.last_login_at = utcnow()
        await self.session.commit()
        log.info("user logged in", extra={"user_id": str(user.id)})
        return user

    async def update_profile(self, user: User, full_name: str) -> User:
        user.full_name = full_name
        await self.session.commit()
        return user

    async def change_password(self, user: User, current: str, new: str) -> None:
        if not verify_password(current, user.password_hash):
            raise BadRequestError("The current password is incorrect.", code="invalid_current_password")
        if current == new:
            raise BadRequestError("The new password must be different.", code="password_unchanged")
        user.password_hash = hash_password(new)
        await self.tokens.revoke_all_for_user(user.id)  # sign out every other session
        await self.session.commit()
        log.info("password changed; sessions revoked", extra={"user_id": str(user.id)})

    # ------------------------------------------------------------- tokens
    async def issue_tokens(self, user: User, *, family_id: uuid.UUID | None = None) -> IssuedTokens:
        access, expires_in = create_access_token(self.settings, user.id, user.role)
        plain = new_refresh_token()
        expires_at = utcnow() + timedelta(days=self.settings.refresh_token_ttl_days)
        await self.tokens.add(
            RefreshToken(
                user_id=user.id,
                family_id=family_id or uuid.uuid4(),
                token_hash=hash_refresh_token(plain),
                expires_at=expires_at,
            )
        )
        await self.session.commit()
        return IssuedTokens(access, expires_in, plain, expires_at)

    async def rotate(self, plain: str | None) -> tuple[User, IssuedTokens]:
        """Exchange a refresh token for new tokens (rotation with reuse detection)."""
        if not plain:
            raise AuthenticationError("Your session has ended. Please sign in again.", code="no_session")
        record = await self.tokens.get_by_hash(hash_refresh_token(plain))
        if record is None:
            raise AuthenticationError("Your session has ended. Please sign in again.", code="invalid_session")
        if record.revoked_at is not None:
            rotated_recently = (
                record.replaced_by_id is not None
                and utcnow() - record.revoked_at <= timedelta(seconds=REUSE_GRACE_SECONDS)
            )
            if not (rotated_recently and await self.tokens.family_has_active_token(record.family_id)):
                # A rotated token was presented again: it may have been stolen. Revoke the
                # whole family so both the attacker and the victim must sign in again.
                await self.tokens.revoke_family(record.family_id)
                await self.session.commit()
                log.warning(
                    "refresh token reuse detected; family revoked", extra={"user_id": str(record.user_id)}
                )
                raise AuthenticationError(
                    "Your session has ended. Please sign in again.", code="session_revoked"
                )
            # Benign race: two tabs refreshed with the same cookie within a few seconds.
            # Issue another token in the same family instead of signing the user out.
            reuser = await self.users.get(record.user_id)
            if reuser is None or not reuser.is_active:
                raise AuthenticationError(
                    "Your session has ended. Please sign in again.", code="invalid_session"
                )
            log.info("concurrent refresh within grace window", extra={"user_id": str(reuser.id)})
            return reuser, await self.issue_tokens(reuser, family_id=record.family_id)
        if record.expires_at <= utcnow():
            raise AuthenticationError(
                "Your session has expired. Please sign in again.", code="session_expired"
            )
        user = await self.users.get(record.user_id)
        if user is None or not user.is_active:
            raise AuthenticationError("Your session has ended. Please sign in again.", code="invalid_session")

        record.revoked_at = utcnow()
        issued = await self.issue_tokens(user, family_id=record.family_id)
        replacement = await self.tokens.get_by_hash(hash_refresh_token(issued.refresh_token))
        record.replaced_by_id = replacement.id if replacement else None
        await self.session.commit()
        return user, issued

    async def revoke(self, plain: str | None) -> None:
        if not plain:
            return
        record = await self.tokens.get_by_hash(hash_refresh_token(plain))
        if record is not None and record.revoked_at is None:
            record.revoked_at = utcnow()
            await self.session.commit()

    async def user_from_access_token(self, token: str) -> User:
        try:
            claims = decode_access_token(self.settings, token)
        except TokenError as exc:
            code = str(exc)
            message = (
                "Your session has expired." if code == "token_expired" else "Invalid authentication token."
            )
            raise AuthenticationError(message, code=code) from exc
        user = await self.users.get(claims.user_id)
        if user is None or not user.is_active:
            raise AuthenticationError("Invalid authentication token.", code="invalid_token")
        return user
