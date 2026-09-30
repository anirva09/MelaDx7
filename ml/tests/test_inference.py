from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
import pytest

from ml.inference import ArtifactError, InferenceEngine, load_model_card, summarize_probabilities
from ml.inference.artifact import CARD_FILENAME

from .conftest import make_image


@pytest.fixture(scope="module")
def engine(untrained_artifact: Path) -> InferenceEngine:
    return InferenceEngine.from_path(untrained_artifact)


def test_card_marks_untrained(engine: InferenceEngine) -> None:
    assert engine.is_trained is False
    assert engine.card.version == "0.0.0-untrained"
    assert engine.card.taxonomy.num_classes == 7


def test_prediction_is_a_valid_distribution(engine: InferenceEngine) -> None:
    result = engine.predict(make_image(400, 300, seed=3))
    probs = np.array(result.probabilities)
    assert probs.shape == (7,)
    assert np.isclose(probs.sum(), 1.0, atol=1e-5)
    assert result.confidence == pytest.approx(probs.max())
    assert result.predicted.code == engine.card.taxonomy.codes[int(probs.argmax())]
    assert result.margin >= 0
    assert 0.0 <= result.normalized_entropy <= 1.0
    concern = sum(probs[engine.card.taxonomy.index_of(c)] for c in ("akiec", "bcc", "mel"))
    assert result.concern_probability == pytest.approx(concern)
    assert result.inference_ms > 0


def test_prediction_is_deterministic(engine: InferenceEngine) -> None:
    image = make_image(seed=5)
    assert engine.predict(image).probabilities == engine.predict(image).probabilities


def test_explanation_matches_input_resolution(engine: InferenceEngine) -> None:
    image = make_image(seed=9)
    pred = engine.predict(image)
    explanation = engine.explain(image, pred.predicted_index)
    size = engine.card.preprocessing.input_size
    assert explanation.cam.cam.shape == (size, size)
    assert explanation.target_code == pred.predicted.code
    with pytest.raises(ValueError):
        engine.explain(image, 42)


def test_uncertainty_flags(engine: InferenceEngine) -> None:
    probs = np.array([0.7, 0.1, 0.05, 0.05, 0.05, 0.03, 0.02])
    result = summarize_probabilities(probs, engine.card, temperature=1.0, inference_ms=1.0)
    assert result.uncertain is False
    flat = summarize_probabilities(np.full(7, 1 / 7), engine.card, temperature=1.0, inference_ms=1.0)
    assert flat.uncertain is True
    assert "low_top_probability" in flat.uncertainty_reasons
    assert flat.normalized_entropy == pytest.approx(1.0)


def _copy(src: Path, dst: Path) -> Path:
    shutil.copytree(src, dst)
    return dst


def test_checksum_mismatch_is_rejected(untrained_artifact: Path, tmp_path: Path) -> None:
    art = _copy(untrained_artifact, tmp_path / "tampered")
    with open(art / "model.pt", "ab") as handle:
        handle.write(b"tamper")
    with pytest.raises(ArtifactError, match="checksum"):
        InferenceEngine.from_path(art)


def test_missing_artifact_gives_actionable_error(tmp_path: Path) -> None:
    with pytest.raises(ArtifactError, match="Train a model"):
        InferenceEngine.from_path(tmp_path / "nope")


def test_card_cannot_point_outside_directory(untrained_artifact: Path, tmp_path: Path) -> None:
    art = _copy(untrained_artifact, tmp_path / "evil")
    card = json.loads((art / CARD_FILENAME).read_text())
    card["weights"]["file"] = "../../etc/passwd"
    (art / CARD_FILENAME).write_text(json.dumps(card))
    with pytest.raises(ArtifactError, match="invalid weights file"):
        load_model_card(art)


def test_unknown_schema_version(untrained_artifact: Path, tmp_path: Path) -> None:
    art = _copy(untrained_artifact, tmp_path / "future")
    card = json.loads((art / CARD_FILENAME).read_text())
    card["schema_version"] = 99
    (art / CARD_FILENAME).write_text(json.dumps(card))
    with pytest.raises(ArtifactError, match="schema"):
        load_model_card(art)
