"""Folder-based dataset for training and evaluation.

Expected layout (class folder names must equal the taxonomy ``code`` values)::

    <root>/
        train/<code>/*.jpg
        validation/<code>/*.jpg
        test/<code>/*.jpg

The dataset never invents labels: it fails loudly if a class folder is missing,
if an unknown folder is present, or if a split is empty.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import torch
from PIL import Image
from torch.utils.data import Dataset

from ml.preprocessing.image_io import load_image_file
from ml.taxonomy import ClassTaxonomy

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
SPLITS = ("train", "validation", "test")


class DatasetLayoutError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class Sample:
    path: Path
    label: int


def scan_split(
    root: Path, split: str, taxonomy: ClassTaxonomy, *, allow_missing_classes: bool = False
) -> list[Sample]:
    split_dir = root / split
    if not split_dir.is_dir():
        raise DatasetLayoutError(
            f"missing dataset split directory '{split_dir}'. See docs/training.md for the layout."
        )
    present = {p.name for p in split_dir.iterdir() if p.is_dir() and not p.name.startswith(".")}
    unknown = present - set(taxonomy.codes)
    if unknown:
        raise DatasetLayoutError(
            f"'{split_dir}' contains folders that are not in the class taxonomy: {sorted(unknown)}"
        )
    missing = set(taxonomy.codes) - present
    if missing and not allow_missing_classes:
        raise DatasetLayoutError(f"'{split_dir}' is missing class folders: {sorted(missing)}")

    samples: list[Sample] = []
    for spec in taxonomy.classes:
        class_dir = split_dir / spec.code
        if not class_dir.is_dir():
            continue
        for path in sorted(class_dir.iterdir()):
            if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS:
                samples.append(Sample(path=path, label=spec.index))
    if not samples:
        raise DatasetLayoutError(f"no images found under '{split_dir}'")
    return samples


class LesionFolderDataset(Dataset[tuple[torch.Tensor, int]]):
    def __init__(
        self,
        root: str | Path,
        split: str,
        taxonomy: ClassTaxonomy,
        transform: Callable[[Image.Image], torch.Tensor],
        *,
        allow_missing_classes: bool = False,
    ) -> None:
        if split not in SPLITS:
            raise ValueError(f"split must be one of {SPLITS}")
        self.root = Path(root)
        self.split = split
        self.taxonomy = taxonomy
        self.transform = transform
        self.samples = scan_split(self.root, split, taxonomy, allow_missing_classes=allow_missing_classes)

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, int]:
        sample = self.samples[index]
        image = load_image_file(str(sample.path))
        return self.transform(image), sample.label

    @property
    def labels(self) -> list[int]:
        return [s.label for s in self.samples]

    def class_counts(self) -> dict[str, int]:
        counts = Counter(self.labels)
        return {spec.code: counts.get(spec.index, 0) for spec in self.taxonomy.classes}
