"""Local filesystem storage (development and single-host deployments)."""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

from app.storage.base import (
    InvalidKeyError,
    ObjectNotFoundError,
    StorageBackend,
    StoredObject,
    content_type_for,
    validate_key,
)


class LocalStorage(StorageBackend):
    name = "local"

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        validate_key(key)
        path = (self.root / key).resolve()
        # Defence in depth against traversal, even though keys are validated above.
        if path != self.root and self.root not in path.parents:
            raise InvalidKeyError(f"key escapes storage root: {key!r}")
        return path

    def put(self, key: str, data: bytes, content_type: str | None = None) -> StoredObject:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".upload-")
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
            os.chmod(tmp, 0o640)
            os.replace(tmp, path)  # atomic: readers never see a partial file
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
        return StoredObject(key=key, size=len(data), content_type=content_type or content_type_for(key))

    def get(self, key: str) -> bytes:
        path = self._path(key)
        try:
            return path.read_bytes()
        except (FileNotFoundError, IsADirectoryError) as exc:
            raise ObjectNotFoundError(key) from exc

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def delete_prefix(self, prefix: str) -> int:
        path = self._path(prefix.rstrip("/"))
        if not path.exists():
            return 0
        count = sum(1 for p in path.rglob("*") if p.is_file()) if path.is_dir() else 1
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()
        return count

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def healthcheck(self) -> bool:
        return self.root.is_dir() and os.access(self.root, os.W_OK)
