"""The core workflow: upload -> prediction -> explanation -> save -> retrieve -> report -> delete."""

from __future__ import annotations

import io
import math

import httpx
import pytest
from PIL import Image

from app.services.imaging import load_stored_image
from tests.conftest import AppHarness, image_bytes

pytestmark = pytest.mark.asyncio


async def _upload(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    data: bytes,
    name: str = "lesion.jpg",
    ctype: str = "image/jpeg",
) -> httpx.Response:
    return await client.post("/api/analyses", files={"file": (name, data, ctype)}, headers=headers)


class TestWorkflow:
    async def test_upload_predict_explain_save_retrieve(
        self, client: httpx.AsyncClient, auth_headers: dict[str, str], jpeg: bytes
    ) -> None:
        response = await _upload(client, auth_headers, jpeg, name="../../etc/Case 01 (left arm).jpg")
        assert response.status_code == 201, response.text
        detail = response.json()

        # --- prediction: a real distribution over all 7 model classes
        prediction = detail["prediction"]
        probabilities = prediction["probabilities"]
        assert len(probabilities) == 7
        assert math.isclose(sum(p["probability"] for p in probabilities), 1.0, abs_tol=1e-4)
        assert probabilities == sorted(probabilities, key=lambda p: p["probability"], reverse=True)
        assert prediction["predicted_class"]["code"] == probabilities[0]["code"]
        assert prediction["confidence"] == pytest.approx(probabilities[0]["probability"])
        assert prediction["model"]["trained"] is False
        assert prediction["model"]["architecture"] == "resnet18"
        assert prediction["timing"]["inference_ms"] > 0
        concern = sum(p["probability"] for p in probabilities if p["code"] in {"akiec", "bcc", "mel"})
        assert prediction["concern"]["probability"] == pytest.approx(concern, abs=1e-6)
        assert set(prediction["concern"]["classes"]) == {"akiec", "bcc", "mel"}

        # --- explanation generated from the same model and stored
        explanation = prediction["explanation"]
        assert explanation["status"] == "completed"
        assert explanation["target_class"]["code"] == prediction["predicted_class"]["code"]
        assert explanation["layer"] == "layer4.1"

        # --- filename sanitised for display, never used as a path
        assert detail["original_filename"] == "Case 01 (left arm).jpg"
        assert detail["produced_by_current_model"] is True
        assert len(detail["prediction_history"]) == 1

        # --- stored images are retrievable through signed URLs
        original = await client.get(detail["image"]["url"])
        assert original.status_code == 200
        assert original.headers["content-type"] == "image/jpeg"
        stored = Image.open(io.BytesIO(original.content))
        assert stored.size == (detail["image"]["width"], detail["image"]["height"])
        heatmap = await client.get(explanation["heatmap_url"])
        assert heatmap.headers["content-type"] == "image/png"
        assert Image.open(io.BytesIO(heatmap.content)).size == stored.size
        overlay = await client.get(explanation["overlay_url"])
        assert overlay.status_code == 200
        cam = Image.open(io.BytesIO((await client.get(explanation["cam_url"])).content))
        assert cam.mode == "L"
        thumb = await client.get(detail["image"]["thumbnail_url"])
        assert max(Image.open(io.BytesIO(thumb.content)).size) <= 320

        # --- retrieve again: identical stored result
        again = (await client.get(f"/api/analyses/{detail['id']}", headers=auth_headers)).json()
        assert again["prediction"]["probabilities"] == probabilities
        assert again["image"]["sha256"] == detail["image"]["sha256"]

    async def test_inference_is_reproducible_from_stored_image(
        self, harness: AppHarness, client: httpx.AsyncClient, auth_headers: dict[str, str], jpeg: bytes
    ) -> None:
        """Re-running the stored image through the same model reproduces the stored output exactly."""
        detail = (await _upload(client, auth_headers, jpeg)).json()
        stored = (await client.get(detail["image"]["url"])).content
        engine = harness.app.state.models.require().engine
        result = engine.predict(load_stored_image(stored))
        recomputed = {s.code: s.probability for s in result.scores}
        for item in detail["prediction"]["probabilities"]:
            assert recomputed[item["code"]] == pytest.approx(item["probability"], abs=1e-6)

    async def test_metadata_is_stripped(
        self, client: httpx.AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        exif = Image.Exif()
        exif[0x010F] = "PatientCameraMaker"
        exif[0x0132] = "2020:01:01 10:00:00"
        data = image_bytes("JPEG", exif=exif)
        detail = (await _upload(client, auth_headers, data)).json()
        stored = (await client.get(detail["image"]["url"])).content
        assert b"PatientCameraMaker" not in stored
        assert not Image.open(io.BytesIO(stored)).getexif()

    async def test_png_and_webp_accepted(
        self, client: httpx.AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        for fmt, ctype in (("PNG", "image/png"), ("WEBP", "image/webp")):
            response = await _upload(
                client, auth_headers, image_bytes(fmt), name=f"x.{fmt.lower()}", ctype=ctype
            )
            assert response.status_code == 201, response.text
            assert response.json()["image"]["source_format"] == fmt

    async def test_explain_another_class(
        self, client: httpx.AsyncClient, auth_headers: dict[str, str], jpeg: bytes
    ) -> None:
        detail = (await _upload(client, auth_headers, jpeg)).json()
        target = next(
            p
            for p in detail["prediction"]["probabilities"]
            if p["code"] != detail["prediction"]["predicted_class"]["code"]
        )
        response = await client.get(
            f"/api/analyses/{detail['id']}/explanations/{target['code']}", headers=auth_headers
        )
        assert response.status_code == 200
        body = response.json()
        assert body["target_class"]["code"] == target["code"]
        assert body["probability"] == pytest.approx(target["probability"])
        assert (await client.get(body["heatmap_url"])).status_code == 200
        cam = Image.open(io.BytesIO((await client.get(body["cam_url"])).content))
        assert cam.mode == "L"
        assert cam.size == (224, 224)
        cached = await client.get(
            f"/api/analyses/{detail['id']}/explanations/{target['code']}", headers=auth_headers
        )
        assert cached.status_code == 200
        unknown = await client.get(f"/api/analyses/{detail['id']}/explanations/nope", headers=auth_headers)
        assert unknown.status_code == 404

    async def test_rerun_with_same_model_conflicts(
        self, client: httpx.AsyncClient, auth_headers: dict[str, str], jpeg: bytes
    ) -> None:
        detail = (await _upload(client, auth_headers, jpeg)).json()
        response = await client.post(f"/api/analyses/{detail['id']}/predictions", headers=auth_headers)
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "already_current"

    async def test_pdf_report(
        self, client: httpx.AsyncClient, auth_headers: dict[str, str], jpeg: bytes
    ) -> None:
        detail = (await _upload(client, auth_headers, jpeg)).json()
        response = await client.get(
            f"/api/analyses/{detail['id']}/report?tz=Asia/Kolkata", headers=auth_headers
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        assert response.content.startswith(b"%PDF")
        assert "attachment" in response.headers["content-disposition"]
        bad_tz = await client.get(
            f"/api/analyses/{detail['id']}/report?tz=Mars/Olympus", headers=auth_headers
        )
        assert bad_tz.status_code == 422

    async def test_delete_removes_record_and_files(
        self, client: httpx.AsyncClient, auth_headers: dict[str, str], jpeg: bytes
    ) -> None:
        detail = (await _upload(client, auth_headers, jpeg)).json()
        image_url = detail["image"]["url"]
        assert (await client.delete(f"/api/analyses/{detail['id']}", headers=auth_headers)).status_code == 204
        assert (await client.get(f"/api/analyses/{detail['id']}", headers=auth_headers)).status_code == 404
        assert (await client.get(image_url)).status_code == 404
        assert (await client.delete(f"/api/analyses/{detail['id']}", headers=auth_headers)).status_code == 404


class TestIsolation:
    async def test_users_cannot_see_each_others_analyses(
        self, harness: AppHarness, client: httpx.AsyncClient, auth_headers: dict[str, str], jpeg: bytes
    ) -> None:
        detail = (await _upload(client, auth_headers, jpeg)).json()
        other = await harness.register()
        for method, path in (
            ("GET", f"/api/analyses/{detail['id']}"),
            ("DELETE", f"/api/analyses/{detail['id']}"),
            ("GET", f"/api/analyses/{detail['id']}/report"),
            ("POST", f"/api/analyses/{detail['id']}/predictions"),
        ):
            response = await client.request(method, path, headers=other)
            assert response.status_code == 404, (method, path)
        listing = (await client.get("/api/analyses", headers=other)).json()
        assert listing["total"] == 0

    async def test_requires_authentication(self, client: httpx.AsyncClient, jpeg: bytes) -> None:
        assert (await _upload(client, {}, jpeg)).status_code == 401
        assert (await client.get("/api/analyses")).status_code == 401


class TestUploadValidation:
    @pytest.mark.parametrize(
        ("payload", "status", "code"),
        [
            (b"%PDF-1.7 fake", 415, "unsupported_format"),
            (b"GIF89a....", 415, "unsupported_format"),
            (b"", 422, "empty_file"),
        ],
    )
    async def test_rejects_non_images(
        self, client: httpx.AsyncClient, auth_headers: dict[str, str], payload: bytes, status: int, code: str
    ) -> None:
        response = await _upload(client, auth_headers, payload, ctype="image/jpeg")
        assert response.status_code == status
        assert response.json()["error"]["code"] == code

    async def test_rejects_corrupted_image(
        self, client: httpx.AsyncClient, auth_headers: dict[str, str], jpeg: bytes
    ) -> None:
        response = await _upload(client, auth_headers, jpeg[: len(jpeg) // 2])
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "corrupted_image"

    async def test_rejects_tiny_image(self, client: httpx.AsyncClient, auth_headers: dict[str, str]) -> None:
        response = await _upload(client, auth_headers, image_bytes("PNG", size=(32, 32)))
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "image_too_small"

    async def test_rejects_oversized_file(
        self, harness: AppHarness, client: httpx.AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        settings = harness.app.state.settings
        original = settings.max_upload_bytes
        settings.max_upload_bytes = 20_000
        try:
            big = image_bytes("PNG", size=(400, 400))
            assert len(big) > 20_000
            response = await _upload(client, auth_headers, big, ctype="image/png")
            assert response.status_code == 413
            assert response.json()["error"]["code"] == "file_too_large"
        finally:
            settings.max_upload_bytes = original

    async def test_nothing_is_stored_for_rejected_uploads(
        self, client: httpx.AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        await _upload(client, auth_headers, b"%PDF-1.7 fake")
        listing = (await client.get("/api/analyses", headers=auth_headers)).json()
        assert listing["total"] == 0


class TestHistory:
    async def test_search_filter_sort_paginate(
        self, client: httpx.AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        created = []
        for i in range(5):
            detail = (await _upload(client, auth_headers, image_bytes(seed=i), name=f"case-{i}.jpg")).json()
            created.append(detail)

        page1 = (await client.get("/api/analyses?page_size=2", headers=auth_headers)).json()
        assert page1["total"] == 5
        assert page1["pages"] == 3
        assert len(page1["items"]) == 2
        assert page1["items"][0]["id"] == created[-1]["id"]  # newest first
        page3 = (await client.get("/api/analyses?page_size=2&page=3", headers=auth_headers)).json()
        assert len(page3["items"]) == 1

        by_conf = (await client.get("/api/analyses?sort=confidence&order=asc", headers=auth_headers)).json()
        confidences = [item["confidence"] for item in by_conf["items"]]
        assert confidences == sorted(confidences)

        search = (await client.get("/api/analyses?q=case-3", headers=auth_headers)).json()
        assert [item["original_filename"] for item in search["items"]] == ["case-3.jpg"]
        by_id = (await client.get(f"/api/analyses?q={created[1]['id']}", headers=auth_headers)).json()
        assert by_id["total"] == 1

        code = created[0]["prediction"]["predicted_class"]["code"]
        filtered = (await client.get(f"/api/analyses?predicted_class={code}", headers=auth_headers)).json()
        assert filtered["total"] >= 1
        assert all(item["predicted_class"]["code"] == code for item in filtered["items"])

        threshold = sorted(confidences)[2]
        high = (await client.get(f"/api/analyses?min_confidence={threshold}", headers=auth_headers)).json()
        assert all(item["confidence"] >= threshold for item in high["items"])

        wildcard = (await client.get("/api/analyses?q=%25", headers=auth_headers)).json()
        assert wildcard["total"] == 0  # LIKE wildcards are escaped

    async def test_invalid_query_parameters(
        self, client: httpx.AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        for query in ("page_size=500", "sort=password", "min_confidence=2", "page=0"):
            response = await client.get(f"/api/analyses?{query}", headers=auth_headers)
            assert response.status_code == 422, query
