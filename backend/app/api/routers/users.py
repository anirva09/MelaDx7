"""Profile and password management for the signed-in user."""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.api.deps import AccountServiceDep, AuthServiceDep, CurrentUser, SettingsDep
from app.api.routers.auth import clear_refresh_cookie
from app.schemas.auth import ChangePasswordRequest, DeleteAccountRequest, UpdateProfileRequest, UserOut
from app.schemas.common import ERROR_RESPONSES, ErrorResponse

router = APIRouter(prefix="/users", tags=["users"], responses=ERROR_RESPONSES)


@router.patch("/me", response_model=UserOut, summary="Update your profile")
async def update_me(body: UpdateProfileRequest, user: CurrentUser, auth: AuthServiceDep) -> UserOut:
    return UserOut.model_validate(await auth.update_profile(user, body.full_name))


@router.post(
    "/me/password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Change your password (signs out all other sessions)",
    responses={400: {"model": ErrorResponse}},
)
async def change_password(body: ChangePasswordRequest, user: CurrentUser, auth: AuthServiceDep) -> Response:
    await auth.change_password(user, body.current_password, body.new_password)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/me",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Permanently delete your account, all analyses and all stored images",
    responses={400: {"model": ErrorResponse}},
)
async def delete_me(
    body: DeleteAccountRequest, user: CurrentUser, accounts: AccountServiceDep, settings: SettingsDep
) -> Response:
    await accounts.delete_account(user, body.password)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_refresh_cookie(response, settings)
    return response
