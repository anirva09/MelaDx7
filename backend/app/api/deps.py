"""FastAPI dependencies: settings, DB session, services, authentication."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Depends, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import AuthenticationError, PermissionDeniedError, UnprocessableError
from app.core.logging import user_id_var
from app.core.rate_limit import RateLimiter
from app.core.signing import UrlSigner
from app.models import User
from app.services.account import AccountService
from app.services.analyses import AnalysisService
from app.services.auth import AuthService
from app.services.model_service import ModelService
from app.services.stats import StatsService
from app.storage import StorageBackend

_bearer = HTTPBearer(auto_error=False, description="Access token from /api/auth/login")


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


def get_storage(request: Request) -> StorageBackend:
    return request.app.state.storage


def get_models(request: Request) -> ModelService:
    return request.app.state.models


def get_signer(request: Request) -> UrlSigner:
    return request.app.state.signer


def get_rate_limiter(request: Request) -> RateLimiter:
    return request.app.state.rate_limiter


SettingsDep = Annotated[Settings, Depends(get_settings)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]
StorageDep = Annotated[StorageBackend, Depends(get_storage)]
ModelsDep = Annotated[ModelService, Depends(get_models)]
SignerDep = Annotated[UrlSigner, Depends(get_signer)]
LimiterDep = Annotated[RateLimiter, Depends(get_rate_limiter)]


def get_auth_service(session: SessionDep, settings: SettingsDep) -> AuthService:
    return AuthService(session, settings)


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]


async def get_current_user(
    auth: AuthServiceDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise AuthenticationError()
    user = await auth.user_from_access_token(credentials.credentials)
    user_id_var.set(str(user.id))
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_admin(user: CurrentUser) -> User:
    if not user.is_admin:
        raise PermissionDeniedError("Administrator access is required.")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


def get_analysis_service(
    session: SessionDep, storage: StorageDep, models: ModelsDep, signer: SignerDep, settings: SettingsDep
) -> AnalysisService:
    return AnalysisService(session, storage, models, signer, settings)


def get_account_service(session: SessionDep, storage: StorageDep) -> AccountService:
    return AccountService(session, storage)


def get_stats_service(session: SessionDep, models: ModelsDep) -> StatsService:
    return StatsService(session, models)


AnalysisServiceDep = Annotated[AnalysisService, Depends(get_analysis_service)]
StatsServiceDep = Annotated[StatsService, Depends(get_stats_service)]
AccountServiceDep = Annotated[AccountService, Depends(get_account_service)]


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def get_timezone(
    tz: Annotated[str | None, Query(description="IANA time zone, e.g. Asia/Kolkata", max_length=64)] = None,
) -> ZoneInfo:
    if not tz:
        return ZoneInfo("UTC")
    try:
        return ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise UnprocessableError(f"Unknown time zone '{tz}'.", code="invalid_timezone") from exc


TimezoneDep = Annotated[ZoneInfo, Depends(get_timezone)]
