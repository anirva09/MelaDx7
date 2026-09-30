"""Shared fixtures for ML tests.

All images here are synthetic, generated on the fly (coloured shapes and noise).
They exercise code paths only; they are not, and are never presented as, medical
data.
"""

from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parents[2]
HAM_CLASSES = REPO_ROOT / "ml" / "configs" / "classes" / "ham10000.yaml"


def make_image(width: int = 320, height: int = 240, seed: int = 0) -> Image.Image:
    rng = np.random.default_rng(seed)
    base = rng.integers(60, 200, size=(height, width, 3), dtype=np.uint8)
    image = Image.fromarray(base)
    draw = ImageDraw.Draw(image)
    draw.ellipse((width * 0.3, height * 0.3, width * 0.7, height * 0.7), fill=(90, 50, 40))
    return image


def encode(image: Image.Image, fmt: str, **kwargs: object) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format=fmt, **kwargs)
    return buffer.getvalue()


def shape_image(kind: str, size: int, rng: np.random.Generator) -> Image.Image:
    """Distinct synthetic 'classes' used only to verify that training learns."""
    noise = rng.integers(0, 40, size=(size, size, 3), dtype=np.uint8)
    image = Image.fromarray(noise + 100)
    draw = ImageDraw.Draw(image)
    jitter = int(rng.integers(-4, 5))
    if kind == "alpha":
        draw.ellipse((12 + jitter, 12, size - 12 + jitter, size - 12), fill=(220, 40, 40))
    elif kind == "beta":
        draw.rectangle((10, 10 + jitter, size - 10, size - 10 + jitter), fill=(40, 200, 60))
    else:
        for x in range(0, size, 8):
            draw.line((x + jitter, 0, x + jitter, size), fill=(40, 60, 220), width=3)
    return image


@pytest.fixture
def rgb_image() -> Image.Image:
    return make_image()


@pytest.fixture
def jpeg_bytes(rgb_image: Image.Image) -> bytes:
    return encode(rgb_image, "JPEG", quality=92)


@pytest.fixture
def png_bytes(rgb_image: Image.Image) -> bytes:
    return encode(rgb_image, "PNG")


@pytest.fixture
def synthetic_dataset(tmp_path: Path) -> tuple[Path, Path]:
    """A tiny 3-class folder dataset plus its taxonomy YAML."""
    root = tmp_path / "data"
    rng = np.random.default_rng(7)
    per_split = {"train": 12, "validation": 6, "test": 6}
    for split, count in per_split.items():
        for kind in ("alpha", "beta", "gamma"):
            folder = root / split / kind
            folder.mkdir(parents=True)
            for i in range(count):
                shape_image(kind, 64, rng).save(folder / f"{kind}_{i:03d}.png")
    taxonomy = tmp_path / "classes.yaml"
    taxonomy.write_text(
        "dataset_id: synthetic-shapes\n"
        "classes:\n"
        "  - {index: 0, code: alpha, name: Alpha, group: malignant}\n"
        "  - {index: 1, code: beta, name: Beta, group: benign}\n"
        "  - {index: 2, code: gamma, name: Gamma, group: benign}\n",
        encoding="utf-8",
    )
    return root, taxonomy


@pytest.fixture(scope="session")
def untrained_artifact(tmp_path_factory: pytest.TempPathFactory) -> Path:
    from ml.scripts.create_untrained_artifact import create_untrained_artifact

    out = tmp_path_factory.mktemp("artifact") / "resnet18-untrained"
    return create_untrained_artifact(out, architecture="resnet18", classes_file=HAM_CLASSES, seed=1)
