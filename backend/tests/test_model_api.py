from __future__ import annotations

from collections.abc import Callable
from typing import Any

import httpx
import pytest
from sqlalchemy import update

from app.models import User
from tests.conftest import AppHarness

pytestmark = pytest.mark.asyncio


async def test_model_info_describes_untrained_model(
    client: httpx.AsyncClient, auth_headers: dict[str, str]
) -> None:
    info = (await client.get("/api/model/info", headers=auth_headers)).json()
    assert info["status"] == "untrained"
    assert "UNTRAINED" in info["message"]
    assert info["trained"] is False
    assert [c["code"] for c in info["classes"]] == ["akiec", "bcc", "bkl", "df", "mel", "nv", "vasc"]
    assert info["explainability"]["method"] == "grad-cam"
    assert info["thresholds"]["low_confidence"] == 0.6
    assert info["model_version_id"]


async def test_metrics_never_invented_for_untrained_model(
    client: httpx.AsyncClient, auth_headers: dict[str, str]
) -> None:
    metrics = (await client.get("/api/model/metrics", headers=auth_headers)).json()
    assert metrics["evaluation_available"] is False
    assert metrics["evaluation"] is None
    assert "untrained" in metrics["evaluation_unavailable_reason"]


async def test_inference_stats_reflect_real_predictions(
    client: httpx.AsyncClient, auth_headers: dict[str, str], jpeg: bytes
) -> None:
    empty = (await client.get("/api/model/inference-stats", headers=auth_headers)).json()
    assert empty["predictions"] == 0
    assert empty["average_confidence"] is None
    await client.post("/api/analyses", files={"file": ("a.jpg", jpeg, "image/jpeg")}, headers=auth_headers)
    stats = (await client.get("/api/model/inference-stats", headers=auth_headers)).json()
    assert stats["predictions"] == 1
    assert sum(b["count"] for b in stats["confidence_histogram"]) == 1
    assert stats["average_inference_ms"] > 0
    # scope=all silently falls back to the caller's own data for non-admins
    assert (await client.get("/api/model/inference-stats?scope=all", headers=auth_headers)).json()[
        "scope"
    ] == "mine"


async def _make_admin(harness: AppHarness, headers: dict[str, str]) -> None:
    me = (await harness.client.get("/api/auth/me", headers=headers)).json()
    async with harness.app.state.sessionmaker() as session:
        await session.execute(update(User).where(User.email == me["email"]).values(role="admin"))
        await session.commit()


async def test_reload_requires_admin(
    harness: AppHarness, client: httpx.AsyncClient, auth_headers: dict[str, str]
) -> None:
    denied = await client.post("/api/model/reload", headers=auth_headers)
    assert denied.status_code == 403
    await _make_admin(harness, auth_headers)
    allowed = await client.post("/api/model/reload", headers=auth_headers)
    assert allowed.status_code == 200
    assert allowed.json()["status"] == "untrained"


class TestModelUnavailable:
    async def test_missing_weights(self, app_factory: Callable[..., Any], jpeg: bytes, tmp_path: Any) -> None:
        app = await app_factory(model_path=str(tmp_path / "no-model-here"))
        headers = await app.register()
        info = (await app.client.get("/api/model/info", headers=headers)).json()
        assert info["status"] == "unavailable"
        assert "not available" in info["message"]
        assert info["classes"] == []

        response = await app.client.post(
            "/api/analyses", files={"file": ("a.jpg", jpeg, "image/jpeg")}, headers=headers
        )
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "model_unavailable"
        predict = await app.client.post(
            "/api/predict", files={"file": ("a.jpg", jpeg, "image/jpeg")}, headers=headers
        )
        assert predict.status_code == 503

        health = await app.client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["checks"]["model"] == "unavailable"

        # History, dashboard and model pages still work without a model.
        assert (await app.client.get("/api/analyses", headers=headers)).status_code == 200
        assert (await app.client.get("/api/stats/overview", headers=headers)).status_code == 200
        metrics = (await app.client.get("/api/model/metrics", headers=headers)).json()
        assert metrics["evaluation_available"] is False

    async def test_untrained_artifact_refused_unless_allowed(
        self, app_factory: Callable[..., Any], untrained_artifact: Any
    ) -> None:
        app = await app_factory(model_path=str(untrained_artifact), allow_untrained_model=False)
        headers = await app.register()
        info = (await app.client.get("/api/model/info", headers=headers)).json()
        assert info["status"] == "unavailable"
        assert "ALLOW_UNTRAINED_MODEL" in info["message"]


async def test_overview_stats(client: httpx.AsyncClient, auth_headers: dict[str, str], jpeg: bytes) -> None:
    # Legacy IANA aliases (what many browsers report for India) must be accepted too.
    legacy = await client.get("/api/stats/overview?tz=Asia/Calcutta", headers=auth_headers)
    assert legacy.status_code == 200
    empty = (await client.get("/api/stats/overview?tz=Asia/Kolkata", headers=auth_headers)).json()
    assert empty["total_analyses"] == 0
    assert empty["average_confidence"] is None
    assert empty["most_recent"] is None
    assert empty["class_distribution"] == []
    assert len(empty["activity"]) == 30
    assert sum(d["count"] for d in empty["activity"]) == 0

    for _ in range(2):
        await client.post(
            "/api/analyses", files={"file": ("a.jpg", jpeg, "image/jpeg")}, headers=auth_headers
        )
    stats = (await client.get("/api/stats/overview?tz=Asia/Kolkata", headers=auth_headers)).json()
    assert stats["total_analyses"] == 2
    assert stats["analyses_last_7_days"] == 2
    assert 0 <= stats["average_confidence"] <= 1
    assert stats["activity"][-1]["count"] == 2
    assert sum(c["count"] for c in stats["class_distribution"]) == 2
    assert sum(b["count"] for b in stats["confidence_histogram"]) == 2
    assert stats["most_recent"]["predicted_class"]["name"]


async def test_registration_can_be_disabled(app_factory: Callable[..., Any]) -> None:
    app = await app_factory(registration_enabled=False)
    response = await app.client.post(
        "/api/auth/register",
        json={"email": "closed@example.org", "full_name": "Closed", "password": "a-long-password-1"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "registration_disabled"
