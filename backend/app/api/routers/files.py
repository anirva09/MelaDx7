"""Signed file delivery (images for <img> tags; see core/signing.py)."""

from __future__ import annotations

import logging
import time

import anyio
from fastapi import APIRouter, Response
from fastapi.responses import FileResponse

from app.api.deps import ModelsDep, SignerDep, StorageDep
from app.core.errors import NotFoundError
from app.core.signing import SignatureError
from app.services.presenters import MODEL_NS, STORAGE_NS
from app.storage import InvalidKeyError, ObjectNotFoundError, content_type_for

router = APIRouter(prefix="/files", tags=["files"])
log = logging.getLogger("app.files")

_NOT_FOUND = "The file does not exist or the link has expired."


@router.get(
    "/{token}",
    summary="Fetch a stored image through a short-lived signed URL",
    response_class=Response,
    responses={200: {"content": {"image/jpeg": {}, "image/png": {}}}, 404: {}},
)
async def get_file(token: str, signer: SignerDep, storage: StorageDep, models: ModelsDep) -> Response:
    try:
        ref = signer.verify(token)
    except SignatureError as exc:
        raise NotFoundError(_NOT_FOUND, code="file_not_found") from exc

    # Stored objects never change under a key, so the browser may reuse them until the link expires.
    max_age = max(0, ref.expires_at - int(time.time()))
    headers = {"Cache-Control": f"private, max-age={max_age}, immutable", "Content-Disposition": "inline"}
    if ref.namespace == STORAGE_NS:
        try:
            data = await anyio.to_thread.run_sync(storage.get, ref.key)
        except (ObjectNotFoundError, InvalidKeyError) as exc:
            raise NotFoundError(_NOT_FOUND, code="file_not_found") from exc
        return Response(content=data, media_type=content_type_for(ref.key), headers=headers)
    if ref.namespace == MODEL_NS:
        path = models.sample_path(ref.key)
        if path is None:
            raise NotFoundError(_NOT_FOUND, code="file_not_found")
        # Sample images are regenerated when a model is re-evaluated, so cache them only briefly.
        return FileResponse(
            path,
            media_type="image/jpeg",
            headers={"Cache-Control": "private, max-age=60", "Content-Disposition": "inline"},
        )
    raise NotFoundError(_NOT_FOUND, code="file_not_found")
