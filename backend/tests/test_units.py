"""Unit tests for security primitives, signing, storage and configuration."""

from __future__ import annotations

import secrets
import time
from pathlib import Path

import boto3
import pytest
from moto import mock_aws
from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import RateLimitedError
from app.core.rate_limit import RateLimiter
from app.core.security import hash_password, hash_refresh_token, verify_password
from app.core.signing import SignatureError, UrlSigner
from app.services.imaging import sanitize_filename
from app.storage import InvalidKeyError, LocalStorage, ObjectNotFoundError, validate_key
from app.storage.s3 import S3Storage


class TestPasswords:
    def test_hash_and_verify(self) -> None:
        hashed = hash_password("a-good-password-1")
        assert hashed.startswith("$argon2id$")
        assert verify_password("a-good-password-1", hashed)
        assert not verify_password("a-bad-password-1", hashed)
        assert not verify_password("anything", None)
        assert not verify_password("anything", "not-a-hash")

    def test_refresh_tokens_are_stored_hashed(self) -> None:
        assert len(hash_refresh_token("abc")) == 64
        assert hash_refresh_token("abc") != "abc"


class TestSigner:
    def test_round_trip(self) -> None:
        signer = UrlSigner(secrets.token_hex(32), default_ttl=60)
        token = signer.token("s", "analyses/x/original.jpg")
        ref = signer.verify(token)
        assert (ref.namespace, ref.key) == ("s", "analyses/x/original.jpg")
        assert signer.url("s", "k").startswith("/api/files/")

    def test_urls_are_stable_within_a_window(self) -> None:
        signer = UrlSigner(secrets.token_hex(32), default_ttl=900)
        first = signer.url("s", "analyses/x/original.jpg")
        assert signer.url("s", "analyses/x/original.jpg") == first  # cacheable
        ref = signer.verify(first.rsplit("/", 1)[1])
        assert ref.expires_at - time.time() >= 899

    def test_tampering_expiry_and_foreign_key(self) -> None:
        signer = UrlSigner(secrets.token_hex(32), default_ttl=60)
        token = signer.token("s", "analyses/x/original.jpg")
        body, sig = token.split(".")
        with pytest.raises(SignatureError):
            signer.verify(body + "." + sig[::-1])
        forged_body = signer.token("m", "00_original.jpg").split(".")[0]
        with pytest.raises(SignatureError):
            signer.verify(forged_body + "." + sig)
        expired = signer.token("s", "k", ttl=-10)
        with pytest.raises(SignatureError):
            signer.verify(expired)
        other = UrlSigner(secrets.token_hex(32), default_ttl=60)
        with pytest.raises(SignatureError):
            other.verify(token)
        with pytest.raises(SignatureError):
            signer.verify("no-dot-here")


class TestLocalStorage:
    def test_put_get_delete(self, tmp_path: Path) -> None:
        storage = LocalStorage(tmp_path)
        storage.put("analyses/a/original.jpg", b"data")
        assert storage.get("analyses/a/original.jpg") == b"data"
        assert storage.exists("analyses/a/original.jpg")
        storage.put("analyses/a/predictions/p/heatmap.png", b"x")
        assert storage.delete_prefix("analyses/a") == 2
        with pytest.raises(ObjectNotFoundError):
            storage.get("analyses/a/original.jpg")
        assert storage.healthcheck()

    @pytest.mark.parametrize(
        "key",
        ["../etc/passwd", "/etc/passwd", "a/../../b", "a//b", ".hidden", "a/.", "a\\b", "", "a/b/"],
    )
    def test_rejects_unsafe_keys(self, tmp_path: Path, key: str) -> None:
        storage = LocalStorage(tmp_path)
        with pytest.raises(InvalidKeyError):
            storage.put(key, b"x")
        with pytest.raises(InvalidKeyError):
            validate_key(key)

    def test_symlink_escape_blocked(self, tmp_path: Path) -> None:
        root = tmp_path / "root"
        outside = tmp_path / "outside"
        outside.mkdir()
        (outside / "secret.jpg").write_bytes(b"secret")
        storage = LocalStorage(root)
        try:
            (root / "link").symlink_to(outside)
        except OSError:
            pytest.skip("symlinks need elevated rights here (Windows without Developer Mode)")
        with pytest.raises(InvalidKeyError):
            storage.get("link/secret.jpg")


class TestS3Storage:
    @mock_aws
    def test_round_trip_with_moto(self) -> None:
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket="lesionlens-test")
        storage = S3Storage("lesionlens-test", prefix="dev", client=client)
        storage.put("analyses/a/original.jpg", b"jpeg-bytes")
        storage.put("analyses/a/predictions/p/heatmap.png", b"png-bytes")
        assert storage.get("analyses/a/original.jpg") == b"jpeg-bytes"
        assert storage.exists("analyses/a/original.jpg")
        head = client.head_object(Bucket="lesionlens-test", Key="dev/analyses/a/original.jpg")
        assert head["ContentType"] == "image/jpeg"
        assert head["ServerSideEncryption"] == "AES256"
        assert storage.delete_prefix("analyses/a") == 2
        assert not storage.exists("analyses/a/original.jpg")
        with pytest.raises(ObjectNotFoundError):
            storage.get("analyses/a/original.jpg")
        with pytest.raises(InvalidKeyError):
            storage.put("../x", b"")
        assert storage.healthcheck()


class TestRateLimiter:
    def test_window(self) -> None:
        limiter = RateLimiter()
        limiter.hit("k", 2, window_seconds=0.2)
        limiter.hit("k", 2, window_seconds=0.2)
        with pytest.raises(RateLimitedError) as err:
            limiter.hit("k", 2, window_seconds=0.2)
        assert err.value.headers and "Retry-After" in err.value.headers
        limiter.hit("other", 2, window_seconds=0.2)
        time.sleep(0.25)
        limiter.hit("k", 2, window_seconds=0.2)


class TestSettings:
    def _base(self, **kw: object) -> dict[str, object]:
        # _env_file=None: never let a developer's local .env influence these tests
        return {"_env_file": None, "jwt_secret": secrets.token_hex(32), **kw}

    def test_requires_strong_secret(self) -> None:
        with pytest.raises(ValidationError):
            Settings(**self._base(jwt_secret="short"))
        with pytest.raises(ValidationError):
            Settings(**self._base(jwt_secret="a" * 40))
        with pytest.raises(ValidationError, match="placeholder"):
            Settings(**self._base(jwt_secret="replace-with-output-of-openssl-rand-hex-32"))

    def test_production_guards(self) -> None:
        with pytest.raises(ValidationError, match="ALLOW_UNTRAINED_MODEL"):
            Settings(**self._base(environment="production", allow_untrained_model=True))
        with pytest.raises(ValidationError, match="CORS"):
            Settings(**self._base(environment="production", cors_origins="*"))
        prod = Settings(**self._base(environment="production", cors_origins="https://app.example.org"))
        assert prod.secure_cookies is True
        assert prod.cors_origins == ["https://app.example.org"]

    def test_cors_origins_from_comma_string(self) -> None:
        settings = Settings(**self._base(cors_origins="http://a.test, http://b.test/"))
        assert settings.cors_origins == ["http://a.test", "http://b.test"]

    def test_s3_requires_bucket(self) -> None:
        with pytest.raises(ValidationError, match="S3_BUCKET"):
            Settings(**self._base(storage_backend="s3"))


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("../../etc/passwd", "passwd"),
        ("C:\\Users\\me\\lesion 1.jpg", "lesion 1.jpg"),
        ("naïve <script>.png", "naive _script_.png"),
        ("", "image"),
        (None, "image"),
        ("...", "image"),
    ],
)
def test_sanitize_filename(raw: str | None, expected: str) -> None:
    assert sanitize_filename(raw) == expected


def test_sanitize_filename_length() -> None:
    assert len(sanitize_filename("a" * 500 + ".jpeg")) <= 120
    assert sanitize_filename("a" * 500 + ".jpeg").endswith(".jpeg")


class TestDatabaseUrl:
    @pytest.mark.parametrize(
        ("given", "expected"),
        [
            ("postgres://u:p@h:5432/d", "postgresql+asyncpg://u:p@h:5432/d"),
            ("postgresql://u:p@h/d", "postgresql+asyncpg://u:p@h/d"),
            ("postgresql+asyncpg://u:p@h/d", "postgresql+asyncpg://u:p@h/d"),
            ("sqlite+aiosqlite:///x.db", "sqlite+aiosqlite:///x.db"),
        ],
    )
    def test_scheme_is_normalised_for_asyncpg(self, given: str, expected: str) -> None:
        from app.core.config import Settings

        secret = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
        assert Settings(jwt_secret=secret, database_url=given).database_url == expected
