"""End-to-end ML -> API path with a genuinely trained (tiny, synthetic) model.

The model is trained here on coloured synthetic shapes. That makes it a *trained*
artifact with a real metrics.json, so the evaluation endpoints can be tested for
real - but it has nothing to do with dermatology and is never shipped.
"""

from __future__ import annotations

import json
import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from PIL import Image, ImageDraw

from ml.training.config import load_config
from ml.training.train import train
from tests.conftest import image_bytes

pytestmark = [pytest.mark.asyncio, pytest.mark.slow]


def _shape(kind: str, rng: np.random.Generator) -> Image.Image:
    image = Image.fromarray(rng.integers(0, 40, size=(64, 64, 3), dtype=np.uint8) + 100)
    draw = ImageDraw.Draw(image)
    if kind == "circle":
        draw.ellipse((12, 12, 52, 52), fill=(220, 40, 40))
    elif kind == "square":
        draw.rectangle((10, 10, 54, 54), fill=(40, 200, 60))
    else:
        for x in range(0, 64, 8):
            draw.line((x, 0, x, 64), fill=(40, 60, 220), width=3)
    return image


@pytest.fixture(scope="session")
def trained_artifact(tmp_root: Path) -> Path:
    root = tmp_root / "shapes"
    rng = np.random.default_rng(0)
    for split, n in (("train", 10), ("validation", 5), ("test", 5)):
        for kind in ("circle", "square", "stripes"):
            folder = root / split / kind
            folder.mkdir(parents=True, exist_ok=True)
            for i in range(n):
                _shape(kind, rng).save(folder / f"{i}.png")
    classes = tmp_root / "shapes.yaml"
    classes.write_text(
        "dataset_id: synthetic-shapes\nclasses:\n"
        "  - {index: 0, code: circle, name: Circle, group: malignant}\n"
        "  - {index: 1, code: square, name: Square, group: benign}\n"
        "  - {index: 2, code: stripes, name: Stripes, group: benign}\n"
    )
    config = load_config(
        None,
        [
            f"data.root={root}",
            f"data.classes_file={classes}",
            "data.batch_size=8",
            "data.num_workers=0",
            "model.architecture=resnet18",
            "model.pretrained=false",
            "model.input_size=64",
            "model.version=0.0.1-synthetic",
            "training.epochs=2",
            "training.device=cpu",
            f"output.dir={tmp_root / 'trained'}",
            "output.sample_predictions=3",
        ],
    )
    return train(config)


async def test_trained_model_serves_real_evaluation(
    app_factory: Callable[..., Any], trained_artifact: Path
) -> None:
    app = await app_factory(model_path=str(trained_artifact), allow_untrained_model=False)
    headers = await app.register()

    info = (await app.client.get("/api/model/info", headers=headers)).json()
    assert info["status"] == "ready"
    assert info["version"] == "0.0.1-synthetic"
    assert info["dataset"]["id"] == "synthetic-shapes"

    metrics = (await app.client.get("/api/model/metrics", headers=headers)).json()
    assert metrics["evaluation_available"] is True
    evaluation = metrics["evaluation"]
    assert evaluation["split"] == "test"
    assert evaluation["metrics"]["n_samples"] == 15
    assert len(evaluation["metrics"]["confusion_matrix"]["matrix"]) == 3
    assert len(metrics["training_history"]) == 2
    assert metrics["training_summary"]["epochs_completed"] == 2
    sample = evaluation["samples"][0]
    assert (await app.client.get(sample["overlay_url"])).status_code == 200

    health = (await app.client.get("/api/health")).json()
    assert health["status"] == "ok"

    detail = (
        await app.client.post(
            "/api/analyses",
            files={"file": ("x.jpg", image_bytes(size=(96, 96)), "image/jpeg")},
            headers=headers,
        )
    ).json()
    assert len(detail["prediction"]["probabilities"]) == 3
    assert detail["prediction"]["model"]["trained"] is True


async def test_metrics_for_other_weights_are_not_shown(
    app_factory: Callable[..., Any], trained_artifact: Path, tmp_path: Path
) -> None:
    copy = tmp_path / "artifact"
    shutil.copytree(trained_artifact, copy)
    report = json.loads((copy / "metrics.json").read_text())
    report["weights_sha256"] = "0" * 64
    (copy / "metrics.json").write_text(json.dumps(report))
    app = await app_factory(model_path=str(copy))
    headers = await app.register()
    metrics = (await app.client.get("/api/model/metrics", headers=headers)).json()
    assert metrics["evaluation_available"] is False
    assert "different model weights" in metrics["evaluation_unavailable_reason"]


async def test_rerun_after_model_upgrade(
    app_factory: Callable[..., Any], trained_artifact: Path, untrained_artifact: Path
) -> None:
    """An analysis made with model A can be re-run with model B; both predictions are kept."""
    old = await app_factory(model_path=str(untrained_artifact))
    headers = await old.register(email="upgrade-user@example.org")
    detail = (
        await old.client.post(
            "/api/analyses", files={"file": ("x.jpg", image_bytes(), "image/jpeg")}, headers=headers
        )
    ).json()
    new = await app_factory(model_path=str(trained_artifact))
    login = await new.client.post(
        "/api/auth/login", json={"email": "upgrade-user@example.org", "password": "correct-horse-42"}
    )
    new_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    before = (await new.client.get(f"/api/analyses/{detail['id']}", headers=new_headers)).json()
    assert before["produced_by_current_model"] is False
    explain = await new.client.get(f"/api/analyses/{detail['id']}/explanations/mel", headers=new_headers)
    assert explain.status_code == 409  # cannot explain with a different model

    rerun = await new.client.post(f"/api/analyses/{detail['id']}/predictions", headers=new_headers)
    assert rerun.status_code == 201
    after = rerun.json()
    assert after["produced_by_current_model"] is True
    assert len(after["prediction_history"]) == 2
    assert len(after["prediction"]["probabilities"]) == 3
    assert after["prediction_history"][1]["model_label"].endswith("v0.0.0-untrained")
