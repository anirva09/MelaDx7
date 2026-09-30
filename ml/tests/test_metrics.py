from __future__ import annotations

import numpy as np
import pytest
import torch
from sklearn.metrics import f1_score, roc_auc_score

from ml.evaluation import compute_classification_metrics, expected_calibration_error
from ml.taxonomy import ClassTaxonomy
from ml.training.calibration import fit_temperature

TAX = ClassTaxonomy.from_dict(
    {
        "dataset_id": "t",
        "classes": [
            {"index": 0, "code": "a", "name": "A", "group": "malignant"},
            {"index": 1, "code": "b", "name": "B", "group": "benign"},
            {"index": 2, "code": "c", "name": "C", "group": "benign"},
        ],
    }
)


def test_perfect_predictions() -> None:
    y = np.array([0, 1, 2, 0, 1, 2])
    probs = np.eye(3)[y] * 0.9 + 0.1 / 3
    m = compute_classification_metrics(y, probs, TAX)
    assert m["accuracy"] == 1.0
    assert m["balanced_accuracy"] == 1.0
    assert m["macro"]["f1"] == 1.0
    assert m["roc_auc_macro_ovr"] == 1.0
    assert m["confusion_matrix"]["matrix"] == [[2, 0, 0], [0, 2, 0], [0, 0, 2]]
    assert m["concern_screening"]["roc_auc"] == 1.0


def test_matches_sklearn_on_random_data() -> None:
    rng = np.random.default_rng(0)
    y = rng.integers(0, 3, size=200)
    probs = rng.dirichlet(np.ones(3), size=200)
    m = compute_classification_metrics(y, probs, TAX)
    assert m["macro"]["f1"] == pytest.approx(f1_score(y, probs.argmax(1), average="macro"), abs=1e-4)
    for row in m["per_class"]:
        expected = roc_auc_score((y == row["index"]).astype(int), probs[:, row["index"]])
        assert row["roc_auc"] == pytest.approx(expected, abs=1e-4)


def test_specificity_and_missing_class_auc() -> None:
    y = np.array([0, 0, 1, 1])
    probs = np.array([[0.8, 0.1, 0.1], [0.2, 0.7, 0.1], [0.1, 0.8, 0.1], [0.1, 0.8, 0.1]])
    m = compute_classification_metrics(y, probs, TAX)
    a, b, c = m["per_class"]
    assert a["recall"] == 0.5 and a["specificity"] == 1.0
    assert b["specificity"] == pytest.approx(0.5)
    assert c["roc_auc"] is None  # class absent from labels
    assert c["support"] == 0


def test_rejects_wrong_shape() -> None:
    with pytest.raises(ValueError):
        compute_classification_metrics(np.array([0, 1]), np.ones((2, 2)) / 2, TAX)


def test_ece_zero_when_calibrated_and_positive_when_overconfident() -> None:
    y = np.array([0, 0, 0, 0])
    confident_correct = np.tile([1.0, 0.0, 0.0], (4, 1))
    assert expected_calibration_error(y, confident_correct)[0] == pytest.approx(0.0)
    wrong = np.tile([0.0, 1.0, 0.0], (4, 1))
    assert expected_calibration_error(y, wrong)[0] == pytest.approx(1.0)


def test_temperature_scaling_recovers_overconfidence() -> None:
    torch.manual_seed(0)
    n, k = 4000, 4
    true_logits = torch.randn(n, k) * 1.5
    labels = torch.distributions.Categorical(logits=true_logits).sample()
    overconfident = true_logits * 3.0
    temperature, before, after = fit_temperature(overconfident, labels)
    assert temperature == pytest.approx(3.0, rel=0.15)
    assert after < before


def test_temperature_never_worsens_nll() -> None:
    logits = torch.tensor([[2.0, 0.0], [0.0, 2.0]])
    labels = torch.tensor([0, 1])
    t, before, after = fit_temperature(logits, labels)
    assert after <= before + 1e-9 and t > 0


def test_sample_gallery_covers_every_class() -> None:
    from ml.evaluation.evaluate import _select_samples

    y = np.array([0] * 30 + [1] * 5 + [2] * 5)
    probs = np.full((40, 3), 0.01)
    probs[np.arange(40), y] = 0.98
    probs[35] = [0.6, 0.2, 0.2]  # one misclassified class-2 image
    chosen = _select_samples(y, probs, 6)
    assert len(chosen) == 6
    assert len({i for i, _ in chosen}) == 6
    assert {int(y[i]) for i, _ in chosen} == {0, 1, 2}
    assert "misclassified" in {c for _, c in chosen}
