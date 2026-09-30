"""Heuristic image-quality checks.

These are simple, transparent heuristics that flag images the model is likely to
handle poorly. They do not block analysis; they surface as warnings next to the
prediction. Thresholds were chosen conservatively and are documented in
docs/model.md - they are not validated clinical image-quality criteria.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
from PIL import Image

MIN_RECOMMENDED_SIDE = 224
DARK_MEAN = 0.15
BRIGHT_MEAN = 0.92
LOW_CONTRAST_STD = 0.04
BLUR_LAPLACIAN_VAR = 12.0  # on a 512 px long-side grayscale image scaled to 0-255


@dataclass(frozen=True, slots=True)
class QualityWarning:
    code: str
    message: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class QualityReport:
    width: int
    height: int
    mean_brightness: float
    contrast: float
    sharpness: float
    warnings: tuple[QualityWarning, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "width": self.width,
            "height": self.height,
            "mean_brightness": round(self.mean_brightness, 4),
            "contrast": round(self.contrast, 4),
            "sharpness": round(self.sharpness, 2),
            "warnings": [w.to_dict() for w in self.warnings],
        }


def _laplacian_variance(gray: np.ndarray) -> float:
    """Variance of a 4-neighbour Laplacian - a standard focus/blur measure."""
    g = gray.astype(np.float64)
    lap = -4.0 * g[1:-1, 1:-1] + g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
    return float(lap.var())


def assess_quality(image: Image.Image) -> QualityReport:
    work = image.convert("L")
    if max(work.size) > 512:
        work = work.copy()
        work.thumbnail((512, 512), Image.Resampling.BILINEAR)
    gray = np.asarray(work, dtype=np.float64)
    norm = gray / 255.0
    mean = float(norm.mean())
    std = float(norm.std())
    sharp = _laplacian_variance(gray) if min(gray.shape) >= 3 else 0.0

    warnings: list[QualityWarning] = []
    if min(image.size) < MIN_RECOMMENDED_SIDE:
        warnings.append(
            QualityWarning(
                "low_resolution",
                f"Resolution is below {MIN_RECOMMENDED_SIDE} px on one side; fine lesion "
                "structures may be lost.",
            )
        )
    if mean < DARK_MEAN:
        warnings.append(QualityWarning("underexposed", "The image is very dark."))
    elif mean > BRIGHT_MEAN:
        warnings.append(QualityWarning("overexposed", "The image is very bright or washed out."))
    if std < LOW_CONTRAST_STD:
        warnings.append(QualityWarning("low_contrast", "The image has very low contrast."))
    if sharp < BLUR_LAPLACIAN_VAR:
        warnings.append(QualityWarning("possibly_blurred", "The image may be out of focus."))

    return QualityReport(
        width=image.width,
        height=image.height,
        mean_brightness=mean,
        contrast=std,
        sharpness=sharp,
        warnings=tuple(warnings),
    )
