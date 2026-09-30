from __future__ import annotations

import httpx


async def test_health_reports_components(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["checks"]["database"] == "ok"
    assert body["checks"]["storage"] == "ok"
    assert body["checks"]["model"] == "untrained"
    assert body["status"] == "degraded"  # untrained model => never "ok"


async def test_liveness(client: httpx.AsyncClient) -> None:
    assert (await client.get("/api/health/live")).json() == {"status": "ok"}


async def test_security_headers_and_request_id(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/health/live", headers={"X-Request-ID": "abc-123"})
    assert response.headers["x-request-id"] == "abc-123"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert "default-src 'none'" in response.headers["content-security-policy"]
    assert response.headers["cache-control"] == "no-store"


async def test_unsafe_request_id_is_replaced(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/health/live", headers={"X-Request-ID": "bad id\nwith newline"})
    assert response.headers["x-request-id"] != "bad id\nwith newline"
    assert len(response.headers["x-request-id"]) == 32


async def test_unknown_route_uses_error_envelope(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/does-not-exist")
    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "not_found"
    assert error["request_id"] == response.headers["x-request-id"]


async def test_openapi_documents_core_endpoints(client: httpx.AsyncClient) -> None:
    spec = (await client.get("/api/openapi.json")).json()
    for path in (
        "/api/auth/login",
        "/api/analyses",
        "/api/analyses/{analysis_id}",
        "/api/predict",
        "/api/explain",
        "/api/model/info",
        "/api/model/metrics",
        "/api/health",
    ):
        assert path in spec["paths"], path


async def test_cors_preflight(client: httpx.AsyncClient) -> None:
    response = await client.options(
        "/api/auth/login",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"},
    )
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert response.headers["access-control-allow-credentials"] == "true"
    evil = await client.options(
        "/api/auth/login",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in evil.headers
