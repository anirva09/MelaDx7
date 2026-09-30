"""Short-lived signed URLs for images.

Browsers load images with plain ``<img src>`` requests that cannot carry an
Authorization header. Instead of exposing files publicly, the API hands out URLs
of the form ``/api/files/<token>`` where the token is an HMAC-signed, expiring
reference to a storage key. Tokens are bound to a namespace so a token for a
model-sample image cannot be replayed against user uploads, and vice versa.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass

URL_EXPIRY_BUCKET = 300


class SignatureError(Exception):
    pass


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


@dataclass(frozen=True, slots=True)
class SignedReference:
    namespace: str
    key: str
    expires_at: int


class UrlSigner:
    def __init__(self, secret: str, *, default_ttl: int, prefix: str = "/api/files") -> None:
        # Derive a dedicated key so file signatures never share a key with JWTs.
        self._key = hmac.new(secret.encode(), b"meladx7/file-url/v1", hashlib.sha256).digest()
        self.default_ttl = default_ttl
        self.prefix = prefix.rstrip("/")

    def _sign(self, body: str) -> str:
        return _b64(hmac.new(self._key, body.encode("ascii"), hashlib.sha256).digest())

    def token(self, namespace: str, key: str, ttl: int | None = None) -> str:
        # Round the expiry up to a 5-minute boundary: URLs for the same object stay
        # identical for a while, so browsers can cache the image. Every URL is still
        # valid for at least `ttl` seconds.
        ttl = self.default_ttl if ttl is None else ttl
        expires = int(time.time()) + ttl
        if ttl > 0:
            expires = -(-expires // URL_EXPIRY_BUCKET) * URL_EXPIRY_BUCKET
        body = _b64(json.dumps({"n": namespace, "k": key, "e": expires}, separators=(",", ":")).encode())
        return f"{body}.{self._sign(body)}"

    def url(self, namespace: str, key: str, ttl: int | None = None) -> str:
        return f"{self.prefix}/{self.token(namespace, key, ttl)}"

    def verify(self, token: str) -> SignedReference:
        try:
            body, signature = token.split(".", 1)
        except ValueError as exc:
            raise SignatureError("malformed") from exc
        if not hmac.compare_digest(signature, self._sign(body)):
            raise SignatureError("bad signature")
        try:
            data = json.loads(_unb64(body))
            ref = SignedReference(namespace=str(data["n"]), key=str(data["k"]), expires_at=int(data["e"]))
        except (ValueError, KeyError, TypeError) as exc:
            raise SignatureError("malformed") from exc
        if ref.expires_at < time.time():
            raise SignatureError("expired")
        return ref
