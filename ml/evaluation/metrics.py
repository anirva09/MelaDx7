"""Classification metrics for model evaluation.

All metrics are computed from real labels and predicted probabilities; nothing is
estimated or smoothed. Per-class ROC-AUC is one-vs-rest and is reported as ``None``
when a class has no positive (or no negative) samples in the evaluated split.
"""

from __future__ import annotations

from itertools import pairwise
from typing import Any

import numpy as np
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    confusion_matrix,
    precision_recall_fscore_support,
    roc_auc_score,
    roc_curve,
)

from ml.taxonomy import ClassTaxonomy


def _round(value: float | None, digits: int = 4) -> float | None:
    if value is None or not np.isfinite(value):
        return None
    return round(float(value), digits)


def expected_calibration_error(
    y_true: np.ndarray, probs: np.ndarray, n_bins: int = 15
) -> tuple[float, list[dict[str, float]]]:
    """Top-label ECE with equal-width confidence bins, plus the reliability table."""
    confidences = probs.max(axis=1)
    predictions = probs.argmax(axis=1)
    correct = (predictions == y_true).astype(np.float64)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    table = []
    for lo, hi in pairwise(edges):
        mask = (confidences > lo) & (confidences <= hi)
        count = int(mask.sum())
        if count == 0:
            continue
        acc = float(correct[mask].mean())
        conf = float(confidences[mask].mean())
        ece += (count / len(y_true)) * abs(acc - conf)
        table.append(
            {
                "bin_lower": round(float(lo), 4),
                "bin_upper": round(float(hi), 4),
                "confidence": round(conf, 4),
                "accuracy": round(acc, 4),
                "count": count,
            }
        )
    return float(ece), table


def _downsample_curve(fpr: np.ndarray, tpr: np.ndarray, max_points: int = 60) -> dict[str, list[float]]:
    if len(fpr) > max_points:
        keep = np.unique(np.linspace(0, len(fpr) - 1, max_points).round().astype(int))
        fpr, tpr = fpr[keep], tpr[keep]
    return {"fpr": [round(float(v), 4) for v in fpr], "tpr": [round(float(v), 4) for v in tpr]}


def _binary_auc(y: np.ndarray, score: np.ndarray) -> float | None:
    if y.min() == y.max():
        return None
    return float(roc_auc_score(y, score))


def compute_classification_metrics(
    y_true: np.ndarray | list[int],
    probs: np.ndarray,
    taxonomy: ClassTaxonomy,
) -> dict[str, Any]:
    y = np.asarray(y_true, dtype=np.int64)
    p = np.asarray(probs, dtype=np.float64)
    if p.ndim != 2 or p.shape[0] != y.shape[0] or p.shape[1] != taxonomy.num_classes:
        raise ValueError("probs must have shape (n_samples, num_classes)")
    k = taxonomy.num_classes
    labels = list(range(k))
    y_pred = p.argmax(axis=1)

    precision, recall, f1, support = precision_recall_fscore_support(
        y, y_pred, labels=labels, zero_division=0
    )
    macro = precision_recall_fscore_support(y, y_pred, labels=labels, average="macro", zero_division=0)
    weighted = precision_recall_fscore_support(y, y_pred, labels=labels, average="weighted", zero_division=0)
    cm = confusion_matrix(y, y_pred, labels=labels)

    per_class = []
    aucs = []
    roc_curves: dict[str, dict[str, list[float]]] = {}
    for spec in taxonomy.classes:
        i = spec.index
        positives = y == i
        tn = int(cm.sum() - cm[i, :].sum() - cm[:, i].sum() + cm[i, i])
        fp = int(cm[:, i].sum() - cm[i, i])
        specificity = tn / (tn + fp) if (tn + fp) else None
        auc = _binary_auc(positives.astype(int), p[:, i])
        if auc is not None:
            aucs.append(auc)
            fpr, tpr, _ = roc_curve(positives.astype(int), p[:, i])
            roc_curves[spec.code] = _downsample_curve(fpr, tpr)
        per_class.append(
            {
                "index": i,
                "code": spec.code,
                "name": spec.name,
                "group": spec.group,
                "support": int(support[i]),
                "precision": _round(precision[i]),
                "recall": _round(recall[i]),
                "specificity": _round(specificity),
                "f1": _round(f1[i]),
                "roc_auc": _round(auc),
            }
        )

    top2 = np.argsort(-p, axis=1)[:, :2]
    top2_acc = float(np.mean([y[n] in top2[n] for n in range(len(y))]))
    ece, reliability = expected_calibration_error(y, p)
    nll = float(-np.mean(np.log(np.clip(p[np.arange(len(y)), y], 1e-12, 1.0))))
    onehot = np.eye(k)[y]
    brier = float(np.mean(np.sum((p - onehot) ** 2, axis=1)))

    concern_idx = taxonomy.concern_indices()
    concern: dict[str, Any] | None = None
    if concern_idx:
        y_bin = np.isin(y, concern_idx).astype(int)
        score = p[:, concern_idx].sum(axis=1)
        pred_bin = (score >= 0.5).astype(int)
        tp = int(((pred_bin == 1) & (y_bin == 1)).sum())
        tn_b = int(((pred_bin == 0) & (y_bin == 0)).sum())
        fp_b = int(((pred_bin == 1) & (y_bin == 0)).sum())
        fn_b = int(((pred_bin == 0) & (y_bin == 1)).sum())
        auc_b = _binary_auc(y_bin, score)
        concern = {
            "description": "Derived binary task: malignant/pre-malignant classes combined vs. all others",
            "classes": [taxonomy.classes[i].code for i in concern_idx],
            "positives": int(y_bin.sum()),
            "negatives": int((1 - y_bin).sum()),
            "roc_auc": _round(auc_b),
            "threshold": 0.5,
            "sensitivity": _round(tp / (tp + fn_b)) if (tp + fn_b) else None,
            "specificity": _round(tn_b / (tn_b + fp_b)) if (tn_b + fp_b) else None,
            "roc_curve": _downsample_curve(*roc_curve(y_bin, score)[:2]) if auc_b is not None else None,
        }

    return {
        "n_samples": len(y),
        "accuracy": _round(accuracy_score(y, y_pred)),
        "balanced_accuracy": _round(balanced_accuracy_score(y, y_pred)),
        "top2_accuracy": _round(top2_acc),
        "macro": {"precision": _round(macro[0]), "recall": _round(macro[1]), "f1": _round(macro[2])},
        "weighted": {
            "precision": _round(weighted[0]),
            "recall": _round(weighted[1]),
            "f1": _round(weighted[2]),
        },
        "roc_auc_macro_ovr": _round(float(np.mean(aucs))) if aucs else None,
        "per_class": per_class,
        "confusion_matrix": {"labels": taxonomy.codes, "matrix": cm.astype(int).tolist()},
        "roc_curves": roc_curves,
        "calibration": {
            "ece": _round(ece),
            "nll": _round(nll),
            "brier": _round(brier),
            "reliability": reliability,
        },
        "concern_screening": concern,
    }
