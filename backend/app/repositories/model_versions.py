"""Model-version registry persistence."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ModelVersion


class ModelVersionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, model_version_id: uuid.UUID) -> ModelVersion | None:
        return await self.session.get(ModelVersion, model_version_id)

    async def get_by_sha(self, sha256: str) -> ModelVersion | None:
        result = await self.session.execute(select(ModelVersion).where(ModelVersion.weights_sha256 == sha256))
        return result.scalar_one_or_none()

    async def get_or_create(self, candidate: ModelVersion) -> ModelVersion:
        """Idempotent registration keyed by the weights checksum (race-safe)."""
        existing = await self.get_by_sha(candidate.weights_sha256)
        if existing is not None:
            return existing
        try:
            async with self.session.begin_nested():
                self.session.add(candidate)
            return candidate
        except IntegrityError:
            found = await self.get_by_sha(candidate.weights_sha256)
            if found is None:  # pragma: no cover - constraint violated for another reason
                raise
            return found
