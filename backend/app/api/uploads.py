"""Upload helpers shared by the analysis and stateless inference routes."""

from __future__ import annotations

from fastapi import UploadFile

from app.core.errors import PayloadTooLargeError, UnprocessableError


async def read_upload(file: UploadFile, max_bytes: int) -> bytes:
    """Read at most ``max_bytes`` (+1 to detect overflow). Never trust client headers."""
    data = await file.read(max_bytes + 1)
    await file.close()
    if len(data) > max_bytes:
        raise PayloadTooLargeError(
            f"The file is larger than the {max_bytes / (1024 * 1024):.0f} MB limit.", code="file_too_large"
        )
    if not data:
        raise UnprocessableError("The uploaded file is empty.", code="empty_file")
    return data
