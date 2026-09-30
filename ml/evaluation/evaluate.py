"""Evaluate a trained model artifact on a held-out split.

Usage (from the repository root)::

    python -m ml.evaluation.evaluate --model models/efficientnet_b0-v1.0.0 --data data/processed

Writes ``metrics.json`` into the artifact directory (served by the API at
``GET /api/model/metrics``) and saves a small set of sample predictions with
Grad-CAM overlays under ``samples/``.
"""

from __future__ import annotations

import argparse
import logging
import shutil
import sys
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch.utils.data import DataLoader

from ml.datasets import LesionFolderDataset
from ml.evaluation.metrics import compute_classification_metrics, expected_calibration_error
from ml.explainability import GradCAM, render_overlay
from ml.inference.artifact import (
    METRICS_FILENAME,
    SAMPLES_DIRNAME,
    load_model,
    load_model_card,
    resolve_artifact_dir,
    utc_now_iso,
    write_json,
)
from ml.models import get_spec
from ml.preprocessing import build_eval_transform, preprocess
from ml.preprocessing.image_io import load_image_file
from ml.training.engine import collect_logits
from ml.training.reproducibility import resolve_device

log = logging.getLogger("ml.evaluation")
METRICS_SCHEMA_VERSION = 1


def _select_samples(y: np.ndarray, probs: np.ndarray, n: int) -> list[tuple[int, str]]:
    """Pick up to n examples: confident-correct, misclassified and least-confident.

    Within each category, examples are taken round-robin across true classes so the
    gallery is not dominated by the majority class.
    """
    if n <= 0:
        return []
    preds = probs.argmax(1)
    conf = probs.max(1)
    chosen: list[tuple[int, str]] = []
    used: set[int] = set()

    def take(candidates: np.ndarray, label: str, limit: int) -> None:
        by_class: dict[int, list[int]] = {}
        for idx in candidates:
            by_class.setdefault(int(y[idx]), []).append(int(idx))
        queues = [q for _, q in sorted(by_class.items())]
        taken = 0
        while taken < limit and len(chosen) < n and any(queues):
            for queue in queues:
                while queue and queue[0] in used:
                    queue.pop(0)
                if queue and taken < limit and len(chosen) < n:
                    idx = queue.pop(0)
                    used.add(idx)
                    chosen.append((idx, label))
                    taken += 1

    per_bucket = max(1, n // 3)
    correct = np.where(preds == y)[0]
    wrong = np.where(preds != y)[0]
    take(correct[np.argsort(-conf[correct])], "confident_correct", per_bucket)
    take(wrong[np.argsort(-conf[wrong])], "misclassified", per_bucket)
    take(np.argsort(conf), "least_confident", n - len(chosen))
    return chosen


def evaluate_artifact(
    model_path: str | Path,
    data_root: str | Path,
    *,
    split: str = "test",
    batch_size: int = 32,
    num_workers: int = 2,
    device: str = "auto",
    n_samples: int = 12,
) -> dict[str, Any]:
    artifact_dir = resolve_artifact_dir(model_path)
    card = load_model_card(artifact_dir)
    torch_device = resolve_device(device)
    model = load_model(card, artifact_dir, torch_device)
    dataset = LesionFolderDataset(
        data_root, split, card.taxonomy, build_eval_transform(card.preprocessing), allow_missing_classes=True
    )
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=False, num_workers=num_workers)
    logits, labels = collect_logits(model, loader, torch_device)
    y = labels.numpy()
    probs = torch.softmax(logits / card.temperature, dim=1).numpy()
    raw_probs = torch.softmax(logits, dim=1).numpy()
    metrics = compute_classification_metrics(y, probs, card.taxonomy)
    raw_ece, _ = expected_calibration_error(y, raw_probs)
    raw_nll = float(-np.mean(np.log(np.clip(raw_probs[np.arange(len(y)), y], 1e-12, 1.0))))

    # ---------------------------------------------------------- sample gallery
    samples_dir = artifact_dir / SAMPLES_DIRNAME
    if samples_dir.exists():
        shutil.rmtree(samples_dir)
    samples_dir.mkdir(parents=True)
    layer = get_spec(card.architecture).gradcam_layer(model)
    sample_records = []
    for rank, (idx, category) in enumerate(_select_samples(y, probs, n_samples)):
        sample = dataset.samples[idx]
        image = load_image_file(str(sample.path))
        image.thumbnail((384, 384))
        pred = int(probs[idx].argmax())
        with GradCAM(model, layer, reshape=get_spec(card.architecture).gradcam_reshape) as gradcam:
            _, cams = gradcam.run(preprocess(image, card.preprocessing).to(torch_device), targets=[pred])
        original_name = f"{rank:02d}_original.jpg"
        overlay_name = f"{rank:02d}_overlay.jpg"
        image.save(samples_dir / original_name, quality=90)
        render_overlay(image, cams[0].cam).save(samples_dir / overlay_name, quality=90)
        sample_records.append(
            {
                "category": category,
                "source_image": sample.path.stem,
                "true_class": card.taxonomy.classes[int(y[idx])].code,
                "predicted_class": card.taxonomy.classes[pred].code,
                "confidence": round(float(probs[idx, pred]), 4),
                "correct": bool(pred == int(y[idx])),
                "original": original_name,
                "overlay": overlay_name,
            }
        )

    report = {
        "schema_version": METRICS_SCHEMA_VERSION,
        "model_id": card.model_id,
        "weights_sha256": card.weights_sha256,
        "split": split,
        "evaluated_at": utc_now_iso(),
        "dataset_id": card.taxonomy.dataset_id,
        "class_counts": dataset.class_counts(),
        "temperature": card.temperature,
        "metrics": metrics,
        "uncalibrated": {"ece": round(raw_ece, 4), "nll": round(raw_nll, 4)},
        "samples": sample_records,
    }
    write_json(artifact_dir / METRICS_FILENAME, report)
    log.info(
        "%s on %s: accuracy=%.4f balanced_accuracy=%.4f macro_f1=%.4f auc=%s",
        card.model_id,
        split,
        metrics["accuracy"],
        metrics["balanced_accuracy"],
        metrics["macro"]["f1"],
        metrics["roc_auc_macro_ovr"],
    )
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate a MelaDx7 model artifact")
    parser.add_argument("--model", type=Path, required=True, help="artifact directory")
    parser.add_argument("--data", type=Path, default=Path("data/processed"))
    parser.add_argument("--split", default="test", choices=["validation", "test"])
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--num-workers", type=int, default=2)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--samples", type=int, default=12)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    evaluate_artifact(
        args.model,
        args.data,
        split=args.split,
        batch_size=args.batch_size,
        num_workers=args.num_workers,
        device=args.device,
        n_samples=args.samples,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
