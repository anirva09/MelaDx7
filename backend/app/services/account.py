"""Account deletion: removes the user, every analysis and every stored file."""

from __future__ import annotations

import logging

import anyio
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BadRequestError
from app.core.security import verify_password
from app.models import User
from app.repositories import AnalysisRepository
from app.storage import StorageBackend

log = logging.getLogger("app.account")


class AccountService:
    def __init__(self, session: AsyncSession, storage: StorageBackend) -> None:
        self.session = session
        self.storage = storage

    async def delete_account(self, user: User, password: str) -> int:
        """Delete the account after re-authentication. Returns the number of analyses removed.

        Database rows go first in one transaction (analyses, predictions, scores and
        sessions cascade). Files are removed afterwards; a storage failure is logged with
        the affected keys and never leaves database rows pointing at missing files.
        """
        if not verify_password(password, user.password_hash):
            raise BadRequestError("The password is incorrect.", code="invalid_current_password")
        analysis_ids = await AnalysisRepository(self.session).ids_for_user(user.id)
        user_id = str(user.id)
        await self.session.delete(user)
        await self.session.commit()
        failed = []
        for analysis_id in analysis_ids:
            try:
                await anyio.to_thread.run_sync(self.storage.delete_prefix, f"analyses/{analysis_id}")
            except Exception:
                failed.append(str(analysis_id))
                log.exception("failed to delete stored files", extra={"analysis_id": str(analysis_id)})
        log.info(
            "account deleted",
            extra={
                "user_id": user_id,
                "analyses_removed": len(analysis_ids),
                "storage_failures": len(failed),
            },
        )
        return len(analysis_ids)
