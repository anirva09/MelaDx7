"""Authentication endpoints: register, login, refresh (rotating cookie), logout, me."""

from __future__ import annotations

from fastapi import APIRouter, Request, Response, status

from app.api.deps import AuthServiceDep, CurrentUser, LimiterDep, SettingsDep, client_ip
from app.core.config import Settings
from app.core.errors import AuthenticationError, PermissionDeniedError
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserOut
from app.schemas.common import ERROR_RESPONSES, ErrorResponse
from app.services.auth import IssuedTokens

router = APIRouter(prefix="/auth", tags=["auth"])
REFRESH_PATH = "/api/auth"


def _set_refresh_cookie(response: Response, settings: Settings, tokens: IssuedTokens) -> None:
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=tokens.refresh_token,
        max_age=settings.refresh_token_ttl_days * 86_400,
        httponly=True,
        secure=settings.secure_cookies,
        samesite=settings.cookie_samesite,
        path=REFRESH_PATH,  # only sent to auth endpoints, never to data endpoints
    )


def clear_refresh_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        key=settings.refresh_cookie_name,
        path=REFRESH_PATH,
        httponly=True,
        secure=settings.secure_cookies,
        samesite=settings.cookie_samesite,
    )


def _token_response(user: object, tokens: IssuedTokens) -> TokenResponse:
    return TokenResponse(
        access_token=tokens.access_token,
        expires_in=tokens.expires_in,
        user=UserOut.model_validate(user),
    )


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create an account and start a session",
    responses={
        403: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        429: {"model": ErrorResponse},
        **ERROR_RESPONSES,
    },
)
async def register(
    body: RegisterRequest,
    request: Request,
    response: Response,
    auth: AuthServiceDep,
    settings: SettingsDep,
    limiter: LimiterDep,
) -> TokenResponse:
    if not settings.registration_enabled:
        raise PermissionDeniedError(
            "Self-service registration is disabled. Ask an administrator for an account.",
            code="registration_disabled",
        )
    limiter.hit(f"register:{client_ip(request)}", settings.rate_limit_auth_per_minute)
    user = await auth.register(body)
    tokens = await auth.issue_tokens(user)
    _set_refresh_cookie(response, settings, tokens)
    return _token_response(user, tokens)


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Sign in with email and password",
    responses={401: {"model": ErrorResponse}, 429: {"model": ErrorResponse}},
)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    auth: AuthServiceDep,
    settings: SettingsDep,
    limiter: LimiterDep,
) -> TokenResponse:
    limiter.hit(f"login-ip:{client_ip(request)}", settings.rate_limit_auth_per_minute * 3)
    limiter.hit(f"login-account:{body.email}", settings.rate_limit_auth_per_minute)
    user = await auth.authenticate(body.email, body.password)
    tokens = await auth.issue_tokens(user)
    _set_refresh_cookie(response, settings, tokens)
    return _token_response(user, tokens)


@router.post(
    "/refresh",
    response_model=TokenResponse,
    summary="Exchange the refresh cookie for a new access token (rotates the cookie)",
    responses={401: {"model": ErrorResponse}},
)
async def refresh(
    request: Request,
    response: Response,
    auth: AuthServiceDep,
    settings: SettingsDep,
    limiter: LimiterDep,
) -> TokenResponse:
    limiter.hit(f"refresh:{client_ip(request)}", settings.rate_limit_auth_per_minute * 6)
    try:
        user, tokens = await auth.rotate(request.cookies.get(settings.refresh_cookie_name))
    except AuthenticationError as exc:
        # Error responses are built by the exception handler, so attach the cookie
        # deletion to the exception itself; a dead session must not linger.
        cleared = Response()
        clear_refresh_cookie(cleared, settings)
        exc.headers = {**(exc.headers or {}), "set-cookie": cleared.headers["set-cookie"]}
        raise
    _set_refresh_cookie(response, settings, tokens)
    return _token_response(user, tokens)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, summary="End the current session")
async def logout(request: Request, auth: AuthServiceDep, settings: SettingsDep) -> Response:
    await auth.revoke(request.cookies.get(settings.refresh_cookie_name))
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_refresh_cookie(response, settings)
    return response


@router.get("/me", response_model=UserOut, summary="The signed-in user", responses=ERROR_RESPONSES)
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)
