"""Explainability: Grad-CAM attribution maps and their visual rendering."""

from ml.explainability.gradcam import CAMResult, GradCAM
from ml.explainability.render import (
    DEFAULT_OVERLAY_ALPHA,
    TURBO_LUT,
    cam_to_grayscale,
    colorize,
    render_colorbar,
    render_heatmap,
    render_overlay,
    resize_cam,
)

__all__ = [
    "DEFAULT_OVERLAY_ALPHA",
    "TURBO_LUT",
    "CAMResult",
    "GradCAM",
    "cam_to_grayscale",
    "colorize",
    "render_colorbar",
    "render_heatmap",
    "render_overlay",
    "resize_cam",
]
