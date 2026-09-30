from __future__ import annotations

import base64
import io
import math

import httpx
import pytest
from PIL import Image

from tests.conftest import AppHarness

pytestmark = pytest.mark.asyncio


async def test_stateless_predict(
    client: httpx.AsyncClient, auth_headers: dict[str, str], jpeg: bytes
) -> None:
    response = await client.post(
        "/api/predict", files={"file": ("a.jpg", jpeg, "image/jpeg")}, headers=auth_headers
    )
    assert response.status_code == 200
    body = response.json()
    assert body["id"] is None  # not persisted
    assert math.isclose(sum(p["probability"] for p in body["probabilities"]), 1.0, abs_tol=1e-4)
    assert body["explanation"] is None
    assert (await client.get("/api/analyses", headers=auth_headers)).json()["total"] == 0


async def test_stateless_explain_default_and_target(
    client: httpx.AsyncClient, auth_headers: dict[str, str], jpeg: bytes
) -> None:
    response = await client.post(
        "/api/explain", files={"file": ("a.jpg", jpeg, "image/jpeg")}, headers=auth_headers
    )
    assert response.status_code == 200
    body = response.json()
    assert body["explanation"]["target_class"]["code"] == body["prediction"]["predicted_class"]["code"]
    heatmap = Image.open(io.BytesIO(base64.b64decode(body["explanation"]["heatmap_png_base64"])))
    assert heatmap.format == "PNG"

    targeted = await client.post(
        "/api/explain",
        files={"file": ("a.jpg", jpeg, "image/jpeg")},
        data={"target_class": "mel"},
        headers=auth_headers,
    )
    assert targeted.json()["explanation"]["target_class"]["code"] == "mel"

    unknown = await client.post(
        "/api/explain",
        files={"file": ("a.jpg", jpeg, "image/jpeg")},
        data={"target_class": "unicorn"},
        headers=auth_headers,
    )
    assert unknown.status_code == 404


async def test_inference_rate_limit(
    harness: AppHarness, client: httpx.AsyncClient, auth_headers: dict[str, str], jpeg: bytes
) -> None:
    settings = harness.app.state.settings
    original = settings.rate_limit_inference_per_minute
    settings.rate_limit_inference_per_minute = 2
    try:
        codes = []
        for _ in range(3):
            r = await client.post(
                "/api/predict", files={"file": ("a.jpg", jpeg, "image/jpeg")}, headers=auth_headers
            )
            codes.append(r.status_code)
        assert codes == [200, 200, 429]
    finally:
        settings.rate_limit_inference_per_minute = original


async def test_body_limit_rejects_before_parsing(
    harness: AppHarness, client: httpx.AsyncClient, auth_headers: dict[str, str]
) -> None:
    limit = harness.app.state.settings.max_upload_bytes + 256 * 1024
    payload = b"\xff\xd8\xff" + b"0" * (limit + 10)
    response = await client.post(
        "/api/predict", files={"file": ("big.jpg", payload, "image/jpeg")}, headers=auth_headers
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


async def test_body_limit_streaming_without_content_length(
    harness: AppHarness, client: httpx.AsyncClient, auth_headers: dict[str, str]
) -> None:
    limit = harness.app.state.settings.max_upload_bytes + 256 * 1024

    async def chunks():
        boundary = b"--XBOUNDARY\r\n"
        yield boundary + b'Content-Disposition: form-data; name="file"; filename="a.jpg"\r\n'
        yield b"Content-Type: image/jpeg\r\n\r\n"
        for _ in range(limit // 65536 + 2):
            yield b"0" * 65536

    response = await client.post(
        "/api/predict",
        content=chunks(),
        headers={**auth_headers, "Content-Type": "multipart/form-data; boundary=XBOUNDARY"},
    )
    assert response.status_code == 413
