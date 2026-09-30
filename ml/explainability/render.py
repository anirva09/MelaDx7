"""Heatmap and overlay rendering for Grad-CAM maps.

Colour map: polynomial approximation of Google's "Turbo" colormap (Apache-2.0,
Mikhailov 2019). Turbo keeps the familiar blue-to-red "jet" ordering while being
far more perceptually uniform, so intensity steps are not exaggerated.
"""

from __future__ import annotations

import numpy as np
from PIL import Image

_RED = np.array([0.13572138, 4.61539260, -42.66032258, 132.13108234, -152.94239396, 59.28637943])
_GREEN = np.array([0.09140261, 2.19418839, 4.84296658, -14.18503333, 4.27729857, 2.82956604])
_BLUE = np.array([0.10667330, 12.64194608, -60.58204836, 110.36276771, -89.90310912, 27.34824973])


def _build_turbo_lut() -> np.ndarray:
    x = np.linspace(0.0, 1.0, 256)
    powers = np.stack([x**p for p in range(6)], axis=1)
    rgb = np.stack([powers @ _RED, powers @ _GREEN, powers @ _BLUE], axis=1)
    return (np.clip(rgb, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)


TURBO_LUT: np.ndarray = _build_turbo_lut()  # (256, 3) uint8

DEFAULT_OVERLAY_ALPHA = 0.45


def resize_cam(cam: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """Resize a float CAM in [0,1] to ``size`` = (width, height) with bilinear filtering."""
    if cam.ndim != 2:
        raise ValueError("cam must be a 2-D array")
    image = Image.fromarray(np.ascontiguousarray(cam, dtype=np.float32))
    resized = image.resize(size, Image.Resampling.BILINEAR)
    return np.clip(np.asarray(resized, dtype=np.float32), 0.0, 1.0)


def colorize(cam: np.ndarray) -> np.ndarray:
    """Map a float CAM in [0,1] to an (H, W, 3) uint8 Turbo image."""
    indices = np.clip((cam * 255.0 + 0.5).astype(np.int32), 0, 255)
    return TURBO_LUT[indices]


def render_heatmap(cam: np.ndarray, size: tuple[int, int]) -> Image.Image:
    """Opaque colour heatmap at ``size`` (width, height)."""
    return Image.fromarray(colorize(resize_cam(cam, size)))


def render_overlay(image: Image.Image, cam: np.ndarray, alpha: float = DEFAULT_OVERLAY_ALPHA) -> Image.Image:
    """Alpha-blend the heatmap over the original image: (1-a)*image + a*heatmap."""
    if not 0.0 <= alpha <= 1.0:
        raise ValueError("alpha must be in [0, 1]")
    base = np.asarray(image.convert("RGB"), dtype=np.float32)
    heat = colorize(resize_cam(cam, image.size)).astype(np.float32)
    blended = (1.0 - alpha) * base + alpha * heat
    return Image.fromarray(np.clip(blended + 0.5, 0, 255).astype(np.uint8))


def cam_to_grayscale(cam: np.ndarray, size: tuple[int, int] | None = None) -> Image.Image:
    """8-bit grayscale copy of the raw normalised map (for archival/re-rendering)."""
    data = resize_cam(cam, size) if size else cam
    return Image.fromarray((np.clip(data, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8))


def render_colorbar(width: int = 256, height: int = 12) -> Image.Image:
    gradient = np.tile(np.linspace(0.0, 1.0, width, dtype=np.float32), (height, 1))
    return Image.fromarray(colorize(gradient))
