"""Authentication and user schemas."""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, EmailStr, Field, StringConstraints

from app.schemas.common import APIModel

PASSWORD_MIN = 10
PASSWORD_MAX = 128


def _check_password(value: str) -> str:
    if not re.search(r"[A-Za-z]", value) or not re.search(r"\d", value):
        raise ValueError("password must contain at least one letter and one number")
    if len(set(value)) < 5:
        raise ValueError("password is too repetitive")
    return value


Password = Annotated[
    str,
    StringConstraints(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX),
    AfterValidator(_check_password),
]
FullName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


def _normalize_email(value: str) -> str:
    return value.strip().lower()


NormalizedEmail = Annotated[EmailStr, AfterValidator(_normalize_email)]


class RegisterRequest(BaseModel):
    email: NormalizedEmail
    full_name: FullName
    password: Password


class LoginRequest(BaseModel):
    email: NormalizedEmail
    password: Annotated[str, StringConstraints(min_length=1, max_length=PASSWORD_MAX)]


class UserOut(APIModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: str
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"  # noqa: S105 - OAuth2 token type, not a secret
    expires_in: int = Field(description="Access-token lifetime in seconds")
    user: UserOut


class UpdateProfileRequest(BaseModel):
    full_name: FullName


class DeleteAccountRequest(BaseModel):
    password: Annotated[str, StringConstraints(min_length=1, max_length=PASSWORD_MAX)]


class ChangePasswordRequest(BaseModel):
    current_password: Annotated[str, StringConstraints(min_length=1, max_length=PASSWORD_MAX)]
    new_password: Password
