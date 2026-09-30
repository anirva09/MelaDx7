"""S3-compatible object storage (AWS S3, MinIO, Cloudflare R2, ...).

``boto3`` is imported lazily so local deployments do not need it installed.
Objects are served through the API's signed ``/api/files`` URLs rather than
public bucket URLs, so the bucket can stay fully private.
"""

from __future__ import annotations

from typing import Any

from app.storage.base import ObjectNotFoundError, StorageBackend, StoredObject, content_type_for, validate_key


class S3Storage(StorageBackend):
    name = "s3"

    def __init__(
        self,
        bucket: str,
        *,
        prefix: str = "",
        endpoint_url: str | None = None,
        region: str | None = None,
        access_key_id: str | None = None,
        secret_access_key: str | None = None,
        client: Any | None = None,
    ) -> None:
        self.bucket = bucket
        self.prefix = prefix.strip("/")
        if client is None:
            import boto3

            client = boto3.client(
                "s3",
                endpoint_url=endpoint_url,
                region_name=region,
                aws_access_key_id=access_key_id,
                aws_secret_access_key=secret_access_key,
            )
        self._client = client

    def _full(self, key: str) -> str:
        validate_key(key)
        return f"{self.prefix}/{key}" if self.prefix else key

    def put(self, key: str, data: bytes, content_type: str | None = None) -> StoredObject:
        ctype = content_type or content_type_for(key)
        self._client.put_object(
            Bucket=self.bucket,
            Key=self._full(key),
            Body=data,
            ContentType=ctype,
            ServerSideEncryption="AES256",
        )
        return StoredObject(key=key, size=len(data), content_type=ctype)

    def get(self, key: str) -> bytes:
        try:
            response = self._client.get_object(Bucket=self.bucket, Key=self._full(key))
        except self._client.exceptions.NoSuchKey as exc:
            raise ObjectNotFoundError(key) from exc
        return response["Body"].read()

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self.bucket, Key=self._full(key))

    def delete_prefix(self, prefix: str) -> int:
        full = self._full(prefix.rstrip("/")) + "/"
        paginator = self._client.get_paginator("list_objects_v2")
        deleted = 0
        for page in paginator.paginate(Bucket=self.bucket, Prefix=full):
            objects = [{"Key": obj["Key"]} for obj in page.get("Contents", [])]
            if objects:
                self._client.delete_objects(Bucket=self.bucket, Delete={"Objects": objects, "Quiet": True})
                deleted += len(objects)
        return deleted

    def exists(self, key: str) -> bool:
        try:
            self._client.head_object(Bucket=self.bucket, Key=self._full(key))
        except self._client.exceptions.ClientError:
            return False
        return True

    def healthcheck(self) -> bool:
        try:
            self._client.head_bucket(Bucket=self.bucket)
        except Exception:  # noqa: BLE001 - any failure means unhealthy
            return False
        return True
