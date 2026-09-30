"""Application settings, loaded from environment variables (and an optional .env file).

Every setting has a safe development default except JWT_SECRET, which must always
be provided. Production mode adds stricter validation (see ``_production_guards``).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_DIR.parent

_WEAK_SECRETS = {"change-me", "changeme", "secret", "dev", "development"}
_PLACEHOLDER_MARKERS = ("replace-with", "change-me", "changeme", "your-secret", "example")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        protected_namespaces=(),
    )

    # ------------------------------------------------------------- general
    environment: Literal["development", "test", "production"] = "development"
    app_name: str = "MelaDx7"
    app_version: str = "1.0.0"
    log_level: str = "INFO"
    log_json: bool = True
    docs_enabled: bool = True

    # ------------------------------------------------------------ database
    database_url: str = "postgresql+asyncpg://lesionlens:lesionlens@localhost:5432/lesionlens"
    database_echo: bool = False
    database_pool_size: int = 5

    # -------------------------------------------------------- auth / JWT
    jwt_secret: SecretStr = Field(min_length=32)
    jwt_algorithm: Literal["HS256", "HS384", "HS512"] = "HS256"
    jwt_issuer: str = "lesionlens"
    jwt_audience: str = "lesionlens-api"
    access_token_ttl_minutes: int = Field(default=15, ge=1, le=120)
    refresh_token_ttl_days: int = Field(default=7, ge=1, le=60)
    refresh_cookie_name: str = "lesionlens_refresh"
    cookie_secure: bool | None = None  # None -> True in production, False otherwise
    cookie_samesite: Literal["strict", "lax"] = "strict"

    # ------------------------------------------------------------- HTTP
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]
    max_upload_bytes: int = Field(default=10 * 1024 * 1024, ge=1024)
    registration_enabled: bool = True
    rate_limit_auth_per_minute: int = 10
    rate_limit_inference_per_minute: int = 30

    # ------------------------------------------------------------- model
    model_path: str = "models/current"
    model_device: str = "cpu"
    model_num_threads: int | None = None
    allow_untrained_model: bool = False
    max_concurrent_inferences: int = Field(default=2, ge=1, le=16)

    # ----------------------------------------------------------- images
    max_image_pixels: int = 50_000_000
    min_image_side: int = 64
    storage_max_side: int = 2048

    # ---------------------------------------------------------- storage
    storage_backend: Literal["local", "s3"] = "local"
    upload_directory: str = "data/uploads"
    s3_bucket: str | None = None
    s3_prefix: str = ""
    s3_endpoint_url: str | None = None
    s3_region: str | None = None
    s3_access_key_id: SecretStr | None = None
    s3_secret_access_key: SecretStr | None = None
    signed_url_ttl_seconds: int = Field(default=900, ge=30, le=86_400)

    # --------------------------------------------------------- validators
    @field_validator("database_url", mode="before")
    @classmethod
    def _async_database_url(cls, value: object) -> object:
        """Hosting providers (Render, Heroku...) hand out ``postgres://`` / ``postgresql://``
        URLs; the async engine needs the asyncpg driver in the scheme."""
        if isinstance(value, str):
            for plain in ("postgres://", "postgresql://"):
                if value.startswith(plain):
                    return "postgresql+asyncpg://" + value[len(plain) :]
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip().rstrip("/") for origin in value.split(",") if origin.strip()]
        return value

    @model_validator(mode="after")
    def _production_guards(self) -> Settings:
        secret = self.jwt_secret.get_secret_value()
        if (
            secret.lower() in _WEAK_SECRETS
            or len(set(secret)) < 8
            or any(marker in secret.lower() for marker in _PLACEHOLDER_MARKERS)
        ):
            raise ValueError("JWT_SECRET is weak or a placeholder; generate one with `openssl rand -hex 32`")
        if self.environment == "production":
            if self.allow_untrained_model:
                raise ValueError("ALLOW_UNTRAINED_MODEL must be false in production")
            if "*" in self.cors_origins:
                raise ValueError("CORS_ORIGINS must list explicit origins in production")
            if self.cookie_secure is False:
                raise ValueError("COOKIE_SECURE cannot be false in production")
        if self.storage_backend == "s3" and not self.s3_bucket:
            raise ValueError("S3_BUCKET is required when STORAGE_BACKEND=s3")
        return self

    # ----------------------------------------------------------- helpers
    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def secure_cookies(self) -> bool:
        return self.is_production if self.cookie_secure is None else self.cookie_secure

    def resolve_path(self, value: str) -> Path:
        """Relative paths are resolved against the repository root."""
        path = Path(value)
        return path if path.is_absolute() else (REPO_ROOT / path).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
