from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np
import pytest

from ml.datasets import DatasetLayoutError, assert_no_group_leakage, grouped_stratified_split, scan_split
from ml.datasets.prepare_ham10000 import main as prepare_main
from ml.taxonomy import ClassTaxonomy

from .conftest import make_image


def _synthetic_metadata(n_lesions: int = 400, seed: int = 0) -> tuple[list[str], list[str]]:
    rng = np.random.default_rng(seed)
    classes = np.array(["nv", "mel", "bkl", "bcc", "akiec", "vasc", "df"])
    weights = np.array([0.67, 0.11, 0.11, 0.05, 0.03, 0.015, 0.015])
    labels, groups = [], []
    for lesion in range(n_lesions):
        dx = rng.choice(classes, p=weights / weights.sum())
        for _ in range(int(rng.integers(1, 4))):  # 1-3 images per lesion
            labels.append(str(dx))
            groups.append(f"L{lesion:05d}")
    return labels, groups


def test_grouped_split_has_no_leakage_and_covers_everything() -> None:
    labels, groups = _synthetic_metadata()
    splits = grouped_stratified_split(labels, groups, val_fraction=0.15, test_fraction=0.15, seed=1)
    all_idx = np.concatenate(list(splits.values()))
    assert sorted(all_idx.tolist()) == list(range(len(labels)))
    assert_no_group_leakage(splits, np.array(groups))
    n = len(labels)
    assert 0.10 < len(splits["test"]) / n < 0.20
    assert 0.10 < len(splits["validation"]) / n < 0.20
    # the majority class appears in every split
    for idx in splits.values():
        assert "nv" in {labels[i] for i in idx}


def test_split_is_reproducible() -> None:
    labels, groups = _synthetic_metadata()
    a = grouped_stratified_split(labels, groups, seed=3)
    b = grouped_stratified_split(labels, groups, seed=3)
    assert all(np.array_equal(a[k], b[k]) for k in a)


def test_leakage_detector() -> None:
    splits = {"train": np.array([0, 1]), "test": np.array([2])}
    with pytest.raises(AssertionError, match="leakage"):
        assert_no_group_leakage(splits, np.array(["x", "y", "x"]))


def test_scan_split_validates_layout(synthetic_dataset: tuple[Path, Path]) -> None:
    root, taxonomy_file = synthetic_dataset
    taxonomy = ClassTaxonomy.from_yaml(taxonomy_file)
    assert len(scan_split(root, "train", taxonomy)) == 36
    (root / "train" / "unexpected").mkdir()
    with pytest.raises(DatasetLayoutError, match="not in the class taxonomy"):
        scan_split(root, "train", taxonomy)
    with pytest.raises(DatasetLayoutError, match="missing dataset split"):
        scan_split(root, "holdout", taxonomy)


def test_prepare_ham10000_end_to_end(tmp_path: Path) -> None:
    images = tmp_path / "raw" / "images"
    images.mkdir(parents=True)
    labels, groups = _synthetic_metadata(n_lesions=120, seed=4)
    rows = []
    for i, (dx, lesion) in enumerate(zip(labels, groups, strict=True)):
        image_id = f"ISIC_{i:07d}"
        make_image(80, 64, seed=i).save(images / f"{image_id}.jpg")
        rows.append({"lesion_id": lesion, "image_id": image_id, "dx": dx})
    metadata = tmp_path / "raw" / "metadata.csv"
    with open(metadata, "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["lesion_id", "image_id", "dx"])
        writer.writeheader()
        writer.writerows(rows)

    out = tmp_path / "processed"
    assert (
        prepare_main(
            ["--metadata", str(metadata), "--images", str(images), "--output", str(out), "--mode", "copy"]
        )
        == 0
    )
    summary = json.loads((out / "split_summary.json").read_text())
    assert sum(s["images"] for s in summary["splits"].values()) == len(rows)
    with open(out / "split_manifest.csv") as handle:
        manifest = list(csv.DictReader(handle))
    lesion_split: dict[str, str] = {}
    for row in manifest:
        assert lesion_split.setdefault(row["lesion_id"], row["split"]) == row["split"]
        assert (out / row["split"] / row["dx"] / f"{row['image_id']}.jpg").is_file()


def _isic_row(image_id: str, lesion: str, d2: str, d3: str, **extra: str) -> dict[str, str]:
    base = {
        "isic_id": image_id,
        "lesion_id": lesion,
        "diagnosis_2": d2,
        "diagnosis_3": d3,
        "image_type": "dermoscopic",
        "image_manipulation": "",
    }
    return base | extra


def test_convert_isic_archive_maps_labels_and_excludes_synthetic() -> None:
    from ml.datasets.prepare_ham10000 import convert_isic_archive

    rows = [
        _isic_row("A", "L1", "Benign melanocytic proliferations", "Nevus"),
        _isic_row("B", "L2", "Malignant melanocytic proliferations (Melanoma)", "Melanoma, NOS"),
        _isic_row("C", "L3", "Malignant epidermal proliferations", "Squamous cell carcinoma, NOS"),
        _isic_row("D", "L4", "Indeterminate epidermal proliferations", "Solar or actinic keratosis"),
        _isic_row("E", "L5", "Benign soft tissue proliferations - Vascular", ""),
        _isic_row("F", "L6", "Benign melanocytic proliferations", "Nevus", image_manipulation="synthetic"),
    ]
    usable, excluded = convert_isic_archive(rows)
    assert {r["image_id"]: r["dx"] for r in usable} == {
        "A": "nv", "B": "mel", "C": "akiec", "D": "akiec", "E": "vasc",
    }
    assert excluded == [{"image_id": "F", "reason": "synthetic"}]


def test_convert_isic_archive_rejects_unknown_diagnosis() -> None:
    from ml.datasets.prepare_ham10000 import convert_isic_archive

    with pytest.raises(SystemExit, match="unmapped diagnosis"):
        convert_isic_archive([_isic_row("A", "L1", "Something", "Else")])
