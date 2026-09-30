"""Leakage-safe dataset splitting.

HAM10000 contains several images of the same lesion (shared ``lesion_id``). A
random image-level split would place near-duplicate images of one lesion in both
training and test sets and inflate test metrics. Splits are therefore made at the
lesion level (grouped) while approximately preserving class proportions
(stratified), using scikit-learn's ``StratifiedGroupKFold``.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
from sklearn.model_selection import StratifiedGroupKFold


def _one_fold(
    labels: np.ndarray, groups: np.ndarray, fraction: float, seed: int
) -> tuple[np.ndarray, np.ndarray]:
    """Return (rest_idx, held_out_idx) with held_out ~= fraction of samples."""
    n_splits = max(2, round(1.0 / fraction))
    # StratifiedGroupKFold needs at least n_splits groups per class to stratify
    # well; it still produces valid grouped folds otherwise (with a warning).
    splitter = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=seed)
    rest, held = next(splitter.split(np.zeros(len(labels)), labels, groups))
    return rest, held


def grouped_stratified_split(
    labels: Sequence[str] | Sequence[int],
    groups: Sequence[str],
    *,
    val_fraction: float = 0.15,
    test_fraction: float = 0.15,
    seed: int = 42,
) -> dict[str, np.ndarray]:
    """Split sample indices into train/validation/test with no group overlap."""
    if not (0 < val_fraction < 0.5 and 0 < test_fraction < 0.5):
        raise ValueError("val_fraction and test_fraction must be in (0, 0.5)")
    if len(labels) != len(groups):
        raise ValueError("labels and groups must have the same length")
    y = np.asarray(labels)
    g = np.asarray(groups)
    idx = np.arange(len(y))

    rest, test = _one_fold(y, g, test_fraction, seed)
    relative_val = val_fraction / (1.0 - test_fraction)
    rest_train, rest_val = _one_fold(y[rest], g[rest], relative_val, seed + 1)
    splits = {
        "train": idx[rest][rest_train],
        "validation": idx[rest][rest_val],
        "test": idx[test],
    }
    assert_no_group_leakage(splits, g)
    return splits


def assert_no_group_leakage(splits: dict[str, np.ndarray], groups: np.ndarray) -> None:
    seen: dict[str, set[str]] = {name: set(groups[ix].tolist()) for name, ix in splits.items()}
    names = list(seen)
    for i, a in enumerate(names):
        for b in names[i + 1 :]:
            overlap = seen[a] & seen[b]
            if overlap:
                raise AssertionError(f"group leakage between {a} and {b}: {len(overlap)} shared groups")
