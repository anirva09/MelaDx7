"""Storage backends and factory."""

from __future__ import annotations

from app.core.config import Settings
from app.storage.base import (
    InvalidKeyError,
    ObjectNotFoundError,
    StorageBackend,
    StorageError,
    StoredObject,
    content_type_for,
    validate_key,
)
from app.storage.local import LocalStorage


def create_storage(settings: Settings) -> StorageBackend:
    if settings.storage_backend == "s3":
        from app.storage.s3 import S3Storage

        assert settings.s3_bucket is not None  # enforced by Settings validation
        return S3Storage(
            settings.s3_bucket,
            prefix=settings.s3_prefix,
            endpoint_url=settings.s3_endpoint_url,
            region=settings.s3_region,
            access_key_id=settings.s3_access_key_id.get_secret_value() if settings.s3_access_key_id else None,
            secret_access_key=(
                settings.s3_secret_access_key.get_secret_value() if settings.s3_secret_access_key else None
            ),
        )
    return LocalStorage(settings.resolve_path(settings.upload_directory))


__all__ = [
    "InvalidKeyError",
    "LocalStorage",
    "ObjectNotFoundError",
    "StorageBackend",
    "StorageError",
    "StoredObject",
    "content_type_for",
    "create_storage",
    "validate_key",
]
