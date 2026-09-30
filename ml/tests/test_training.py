"""End-to-end training smoke test on a tiny synthetic dataset.

This verifies the training *pipeline* (data loading, staged fine-tuning, early
stopping, checkpointing, calibration, evaluation, model card) - not model quality.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ml.inference import InferenceEngine, load_model_card
from ml.training.config import load_config
from ml.training.train import train

from .conftest import make_image


def _config(tmp_path: Path, root: Path, taxonomy: Path, epochs: int = 3, extra: list[str] | None = None):
    return load_config(
        None,
        [
            f"data.root={root}",
            f"data.classes_file={taxonomy}",
            "data.batch_size=8",
            "data.num_workers=0",
            "model.architecture=resnet18",
            "model.pretrained=false",
            "model.input_size=64",
            "model.version=0.1.0-test",
            f"training.epochs={epochs}",
            "training.freeze_backbone_epochs=1",
            "training.early_stopping_patience=10",
            "training.device=cpu",
            f"output.dir={tmp_path / 'models'}",
            "output.sample_predictions=3",
            "optim.lr=0.003",
            *(extra or []),
        ],
    )


@pytest.mark.slow
def test_training_pipeline_produces_complete_artifact(
    tmp_path: Path, synthetic_dataset: tuple[Path, Path]
) -> None:
    root, taxonomy = synthetic_dataset
    out = train(_config(tmp_path, root, taxonomy))

    for name in ("model.pt", "model_card.json", "history.jsonl", "metrics.json", "training_config.json"):
        assert (out / name).is_file(), name
    history = [json.loads(line) for line in (out / "history.jsonl").read_text().splitlines()]
    assert len(history) == 3
    assert history[0]["backbone_frozen"] is True and history[1]["backbone_frozen"] is False

    card = load_model_card(out)
    assert card.trained is True
    assert card.taxonomy.codes == ["alpha", "beta", "gamma"]
    assert card.preprocessing.input_size == 64
    assert card.temperature > 0
    assert card.training["epochs_completed"] == 3

    metrics = json.loads((out / "metrics.json").read_text())
    assert metrics["split"] == "test"
    assert metrics["weights_sha256"] == card.weights_sha256
    assert metrics["metrics"]["n_samples"] == 18
    assert len(metrics["samples"]) == 3
    assert (out / "samples" / metrics["samples"][0]["overlay"]).is_file()

    engine = InferenceEngine.from_path(out)
    result = engine.predict(make_image(64, 64))
    assert len(result.probabilities) == 3


@pytest.mark.slow
def test_early_stopping_and_resume(tmp_path: Path, synthetic_dataset: tuple[Path, Path]) -> None:
    root, taxonomy = synthetic_dataset
    config = _config(
        tmp_path,
        root,
        taxonomy,
        epochs=2,
        extra=["output.evaluate_on_test=false", "calibrate_temperature=false"],
    )
    out = train(config)
    assert len((out / "history.jsonl").read_text().splitlines()) == 2

    resumed = _config(
        tmp_path,
        root,
        taxonomy,
        epochs=4,
        extra=["output.evaluate_on_test=false", "calibrate_temperature=false"],
    )
    train(resumed, resume=True)
    history = [json.loads(line) for line in (out / "history.jsonl").read_text().splitlines()]
    assert [h["epoch"] for h in history] == [1, 2, 3, 4]


def test_config_rejects_unknown_keys() -> None:
    with pytest.raises(ValueError, match="unknown config keys"):
        load_config(None, ["training.epochz=3"])


def test_config_validates_values() -> None:
    with pytest.raises(ValueError, match="monitor"):
        load_config(None, ["training.monitor=val_vibes"])


def test_default_config_file_is_valid() -> None:
    config = load_config("ml/configs/efficientnet_b0.yaml")
    assert config.model.architecture == "efficientnet_b0"
    assert config.data.provenance["license"].startswith("CC BY-NC")
