"""Blocking image/ML work executed in worker threads by the analysis service.

Order of operations (see docs/architecture.md):

    validate & decode -> strip metadata, re-encode (stored copy) -> quality checks
    -> predict (no-grad) -> Grad-CAM for the predicted class -> render PNG/JPEG

Inference always runs on the *stored* re-encoded image, so any stored analysis can
be reproduced bit-for-bit from its stored file and model version.
"""

from __future__ import annotations

import hashlib
import io
import logging
import re
import unicodedata
from dataclasses import dataclass

from PIL import Image

from app.core.config import Settings
from ml.explainability import cam_to_grayscale, render_heatmap, render_overlay
from ml.inference import ExplanationResult, InferenceEngine, PredictionResult
from ml.preprocessing import QualityReport, assess_quality, decode_image, encode_png, sanitize_for_storage

log = logging.getLogger("app.imaging")

THUMBNAIL_SIDE = 320
_UNSAFE_CHARS = re.compile(r"[^A-Za-z0-9 ._()-]+")


def sanitize_filename(name: str | None) -> str:
    """Display-only filename: basename, printable ASCII subset, bounded length."""
    if not name:
        return "image"
    base = re.split(r"[\\/]", name)[-1]
    base = unicodedata.normalize("NFKD", base).encode("ascii", "ignore").decode("ascii")
    base = _UNSAFE_CHARS.sub("_", base).strip(" ._") or "image"
    if len(base) > 120:
        stem, dot, ext = base.rpartition(".")
        base = (stem[:110] + dot + ext[:8]) if dot else base[:120]
    return base


@dataclass(frozen=True)
class PreparedImage:
    stored_bytes: bytes
    image: Image.Image
    thumbnail_bytes: bytes
    sha256: str
    source_format: str
    source_width: int
    source_height: int
    quality: QualityReport


def prepare_upload(data: bytes, settings: Settings) -> PreparedImage:
    """Validate, sanitise and re-encode an upload. Raises ImageValidationError."""
    decoded = decode_image(data, max_pixels=settings.max_image_pixels, min_side=settings.min_image_side)
    stored, image = sanitize_for_storage(decoded.image, max_side=settings.storage_max_side)
    thumb = image.copy()
    thumb.thumbnail((THUMBNAIL_SIDE, THUMBNAIL_SIDE), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    thumb.save(buffer, format="JPEG", quality=85, optimize=True)
    return PreparedImage(
        stored_bytes=stored,
        image=image,
        thumbnail_bytes=buffer.getvalue(),
        sha256=hashlib.sha256(stored).hexdigest(),
        source_format=decoded.source_format,
        source_width=decoded.original_width,
        source_height=decoded.original_height,
        quality=assess_quality(image),
    )


def cam_is_empty(cam_png: bytes) -> bool:
    """True when a stored grayscale CAM has no positive attribution anywhere."""
    with Image.open(io.BytesIO(cam_png)) as cam:
        return cam.convert("L").getextrema()[1] == 0


def load_stored_image(data: bytes) -> Image.Image:
    image = Image.open(io.BytesIO(data))
    image.load()
    return image.convert("RGB")


@dataclass(frozen=True)
class RenderedExplanation:
    explanation: ExplanationResult
    heatmap_png: bytes
    overlay_jpg: bytes
    cam_png: bytes


@dataclass(frozen=True)
class InferenceOutcome:
    prediction: PredictionResult
    rendered: RenderedExplanation | None
    explain_error: str | None


def render_explanation(image: Image.Image, explanation: ExplanationResult) -> RenderedExplanation:
    cam = explanation.cam.cam
    overlay = io.BytesIO()
    render_overlay(image, cam).save(overlay, format="JPEG", quality=90)
    return RenderedExplanation(
        explanation=explanation,
        heatmap_png=encode_png(render_heatmap(cam, image.size)),
        overlay_jpg=overlay.getvalue(),
        cam_png=encode_png(cam_to_grayscale(cam)),
    )


def explain_class(engine: InferenceEngine, image: Image.Image, target_index: int) -> RenderedExplanation:
    return render_explanation(image, engine.explain(image, target_index))


def run_inference(engine: InferenceEngine, image: Image.Image, *, explain: bool = True) -> InferenceOutcome:
    """Predict, then explain the predicted class. A Grad-CAM failure is recorded, not raised."""
    prediction = engine.predict(image)
    if not explain:
        return InferenceOutcome(prediction=prediction, rendered=None, explain_error=None)
    try:
        rendered = explain_class(engine, image, prediction.predicted_index)
    except Exception as exc:
        log.exception("grad-cam generation failed", extra={"model_id": engine.model_id})
        return InferenceOutcome(prediction=prediction, rendered=None, explain_error=type(exc).__name__)
    return InferenceOutcome(prediction=prediction, rendered=rendered, explain_error=None)
