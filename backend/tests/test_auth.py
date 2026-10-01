from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import jwt
import pytest

from tests.conftest import TEST_PASSWORD, AppHarness

pytestmark = pytest.mark.asyncio


def _email() -> str:
    return f"user-{uuid.uuid4().hex[:10]}@example.org"


async def _register(client: httpx.AsyncClient, email: str, password: str = TEST_PASSWORD) -> httpx.Response:
    return await client.post(
        "/api/auth/register", json={"email": email, "full_name": "Dr. Test", "password": password}
    )


class TestRegistration:
    async def test_register_returns_tokens_and_httponly_cookie(self, client: httpx.AsyncClient) -> None:
        email = _email()
        response = await _register(client, email.upper())
        assert response.status_code == 201
        body = response.json()
        assert body["token_type"] == "bearer"
        assert body["user"]["email"] == email  # normalised to lower case
        assert body["user"]["role"] == "user"
        assert "password" not in response.text
        cookie = response.headers["set-cookie"].lower()
        assert "httponly" in cookie
        assert "samesite=strict" in cookie
        assert "path=/api/auth" in cookie

    async def test_duplicate_email_conflicts(self, client: httpx.AsyncClient) -> None:
        email = _email()
        assert (await _register(client, email)).status_code == 201
        response = await _register(client, email)
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "email_taken"

    @pytest.mark.parametrize("password", ["short1", "onlyletters", "1234567890", "aaaaaaaaaa1"])
    async def test_weak_passwords_rejected_without_echo(
        self, client: httpx.AsyncClient, password: str
    ) -> None:
        response = await _register(client, _email(), password)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"
        assert password not in response.text

    async def test_invalid_email_rejected(self, client: httpx.AsyncClient) -> None:
        response = await _register(client, "not-an-email")
        assert response.status_code == 422


class TestLogin:
    async def test_login_and_me(self, client: httpx.AsyncClient) -> None:
        email = _email()
        await _register(client, email)
        client.cookies.clear()
        response = await client.post("/api/auth/login", json={"email": email, "password": TEST_PASSWORD})
        assert response.status_code == 200
        token = response.json()["access_token"]
        me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        assert me.json()["email"] == email
        assert me.json()["last_login_at"] is not None

    async def test_wrong_password_and_unknown_user_are_indistinguishable(
        self, client: httpx.AsyncClient
    ) -> None:
        email = _email()
        await _register(client, email)
        wrong = await client.post("/api/auth/login", json={"email": email, "password": "wrong-password-1"})
        unknown = await client.post(
            "/api/auth/login", json={"email": _email(), "password": "wrong-password-1"}
        )
        assert wrong.status_code == unknown.status_code == 401
        assert wrong.json()["error"]["message"] == unknown.json()["error"]["message"]
        assert wrong.headers["www-authenticate"] == "Bearer"

    async def test_login_rate_limited(self, harness: AppHarness, client: httpx.AsyncClient) -> None:
        settings = harness.app.state.settings
        original = settings.rate_limit_auth_per_minute
        settings.rate_limit_auth_per_minute = 3
        try:
            email = _email()
            codes = [
                (
                    await client.post("/api/auth/login", json={"email": email, "password": "nope-nope-1"})
                ).status_code
                for _ in range(4)
            ]
            assert codes[:3] == [401, 401, 401]
            limited = await client.post("/api/auth/login", json={"email": email, "password": "nope-nope-1"})
            assert limited.status_code == 429
            assert int(limited.headers["retry-after"]) >= 1
        finally:
            settings.rate_limit_auth_per_minute = original


class TestAccessTokens:
    async def test_missing_token(self, client: httpx.AsyncClient) -> None:
        response = await client.get("/api/auth/me")
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "not_authenticated"

    async def test_garbage_and_tampered_tokens(
        self, client: httpx.AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        assert (
            await client.get("/api/auth/me", headers={"Authorization": "Bearer nonsense"})
        ).status_code == 401
        token = auth_headers["Authorization"].split()[1]
        tampered = token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB")
        response = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {tampered}"})
        assert response.status_code == 401

    async def test_alg_none_and_foreign_secret_rejected(
        self, harness: AppHarness, client: httpx.AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        token = auth_headers["Authorization"].split()[1]
        claims = jwt.decode(token, options={"verify_signature": False})
        unsigned = jwt.encode(claims, key=None, algorithm="none")
        forged = jwt.encode(claims, "x" * 64, algorithm="HS256")
        for bad in (unsigned, forged):
            response = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {bad}"})
            assert response.status_code == 401

    async def test_expired_token(
        self, harness: AppHarness, client: httpx.AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        settings = harness.app.state.settings
        token = auth_headers["Authorization"].split()[1]
        claims = jwt.decode(token, options={"verify_signature": False})
        claims["exp"] = int((datetime.now(UTC) - timedelta(minutes=5)).timestamp())
        expired = jwt.encode(claims, settings.jwt_secret.get_secret_value(), algorithm="HS256")
        response = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired}"})
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "token_expired"


class TestRefreshRotation:
    async def test_refresh_rotates_and_detects_reuse(
        self, client: httpx.AsyncClient, harness: AppHarness, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.services import auth as auth_service

        monkeypatch.setattr(auth_service, "REUSE_GRACE_SECONDS", 0)  # no grace: any reuse is theft
        await _register(client, _email())
        cookie_name = harness.app.state.settings.refresh_cookie_name
        first = client.cookies.get(cookie_name)
        assert first

        refreshed = await client.post("/api/auth/refresh")
        assert refreshed.status_code == 200
        second = client.cookies.get(cookie_name)
        assert second
        assert second != first

        # Replay the old (rotated) token: the whole family must be revoked.
        client.cookies.clear()
        client.cookies.set(cookie_name, first, path="/api/auth")
        replay = await client.post("/api/auth/refresh")
        assert replay.status_code == 401
        assert replay.json()["error"]["code"] == "session_revoked"
        assert "max-age=0" in replay.headers.get("set-cookie", "").lower()

        client.cookies.clear()
        client.cookies.set(cookie_name, second, path="/api/auth")
        after = await client.post("/api/auth/refresh")
        assert after.status_code == 401

    async def test_concurrent_refresh_within_grace_window(
        self, client: httpx.AsyncClient, harness: AppHarness
    ) -> None:
        """Two tabs refreshing with the same cookie at once must not sign the user out."""
        await _register(client, _email())
        cookie_name = harness.app.state.settings.refresh_cookie_name
        first = client.cookies.get(cookie_name)
        assert (await client.post("/api/auth/refresh")).status_code == 200
        latest = client.cookies.get(cookie_name)

        client.cookies.clear()
        client.cookies.set(cookie_name, first, path="/api/auth")
        parallel = await client.post("/api/auth/refresh")
        assert parallel.status_code == 200

        client.cookies.clear()
        client.cookies.set(cookie_name, latest, path="/api/auth")
        assert (await client.post("/api/auth/refresh")).status_code == 200

    async def test_parallel_refreshes_never_end_the_session(
        self, client: httpx.AsyncClient, harness: AppHarness
    ) -> None:
        """A page load can fire several refreshes at once (tabs, retries). Rotation must be atomic:
        a request that lands between "old token revoked" and "replacement recorded" used to look
        like token theft and revoked the whole session."""
        await _register(client, _email())
        name = harness.app.state.settings.refresh_cookie_name
        cookie = client.cookies.get(name)
        client.cookies.clear()

        async def refresh() -> httpx.Response:
            return await client.post("/api/auth/refresh", headers={"Cookie": f"{name}={cookie}"})

        results = await asyncio.gather(*(refresh() for _ in range(8)))
        assert [r.status_code for r in results] == [200] * 8
        # the session survived: the newest cookie still refreshes
        newest = results[-1].headers["set-cookie"].split(";", 1)[0].split("=", 1)[1]
        again = await client.post("/api/auth/refresh", headers={"Cookie": f"{name}={newest}"})
        assert again.status_code == 200

    async def test_reuse_after_logout_is_rejected_even_within_grace(
        self, client: httpx.AsyncClient, harness: AppHarness
    ) -> None:
        await _register(client, _email())
        cookie_name = harness.app.state.settings.refresh_cookie_name
        first = client.cookies.get(cookie_name)
        assert (await client.post("/api/auth/refresh")).status_code == 200
        assert (await client.post("/api/auth/logout")).status_code == 204  # revokes the active token
        client.cookies.set(cookie_name, first, path="/api/auth")
        assert (await client.post("/api/auth/refresh")).status_code == 401

    async def test_refresh_without_cookie(self, client: httpx.AsyncClient) -> None:
        response = await client.post("/api/auth/refresh")
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "no_session"

    async def test_logout_revokes_session(self, client: httpx.AsyncClient, harness: AppHarness) -> None:
        await _register(client, _email())
        cookie_name = harness.app.state.settings.refresh_cookie_name
        token = client.cookies.get(cookie_name)
        assert (await client.post("/api/auth/logout")).status_code == 204
        client.cookies.set(cookie_name, token, path="/api/auth")
        assert (await client.post("/api/auth/refresh")).status_code == 401


class TestAccount:
    async def test_update_profile(self, client: httpx.AsyncClient, auth_headers: dict[str, str]) -> None:
        response = await client.patch(
            "/api/users/me", json={"full_name": "  Dr. Renamed  "}, headers=auth_headers
        )
        assert response.status_code == 200
        assert response.json()["full_name"] == "Dr. Renamed"

    async def test_change_password_revokes_sessions(
        self, client: httpx.AsyncClient, harness: AppHarness
    ) -> None:
        email = _email()
        registered = await _register(client, email)
        headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
        cookie_name = harness.app.state.settings.refresh_cookie_name
        old_refresh = client.cookies.get(cookie_name)

        wrong = await client.post(
            "/api/users/me/password",
            json={"current_password": "not-it-123", "new_password": "brand-new-pass-7"},
            headers=headers,
        )
        assert wrong.status_code == 400
        ok = await client.post(
            "/api/users/me/password",
            json={"current_password": TEST_PASSWORD, "new_password": "brand-new-pass-7"},
            headers=headers,
        )
        assert ok.status_code == 204
        client.cookies.set(cookie_name, old_refresh, path="/api/auth")
        assert (await client.post("/api/auth/refresh")).status_code == 401
        login = await client.post("/api/auth/login", json={"email": email, "password": "brand-new-pass-7"})
        assert login.status_code == 200


class TestAccountDeletion:
    async def test_delete_account_removes_user_data_and_files(
        self, client: httpx.AsyncClient, harness: AppHarness, jpeg: bytes
    ) -> None:
        email = _email()
        registered = await _register(client, email)
        headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
        detail = (
            await client.post("/api/analyses", files={"file": ("a.jpg", jpeg, "image/jpeg")}, headers=headers)
        ).json()
        image_url = detail["image"]["url"]
        assert (await client.get(image_url)).status_code == 200

        wrong = await client.request(
            "DELETE", "/api/users/me", json={"password": "not-mine-123"}, headers=headers
        )
        assert wrong.status_code == 400
        assert (await client.get("/api/auth/me", headers=headers)).status_code == 200

        deleted = await client.request(
            "DELETE", "/api/users/me", json={"password": TEST_PASSWORD}, headers=headers
        )
        assert deleted.status_code == 204
        assert "max-age=0" in deleted.headers.get("set-cookie", "").lower()
        assert (await client.get("/api/auth/me", headers=headers)).status_code == 401
        assert (await client.get(image_url)).status_code == 404
        login = await client.post("/api/auth/login", json={"email": email, "password": TEST_PASSWORD})
        assert login.status_code == 401
        # The email address can be registered again from scratch.
        assert (await _register(client, email)).status_code == 201
