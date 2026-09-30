"""Analysis, prediction and explanation schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import APIModel


class ModelRef(APIModel):
    id: uuid.UUID
    architecture: str
    display_name: str
    version: str
    trained: bool
    weights_sha256: str
    dataset_id: str
    preprocessing_version: str
    input_size: int
    gradcam_layer: str


class ClassInfo(BaseModel):
    index: int
    code: str
    name: str
    group: str


class ClassProbability(ClassInfo):
    probability: float = Field(ge=0, le=1)


class QualityWarningOut(BaseModel):
    code: str
    message: str


class QualityOut(BaseModel):
    width: int
    height: int
    mean_brightness: float
    contrast: float
    sharpness: float
    warnings: list[QualityWarningOut]


class ImageOut(BaseModel):
    url: str
    thumbnail_url: str
    width: int
    height: int
    source_format: str
    source_width: int
    source_height: int
    file_size: int
    sha256: str


class Uncertainty(BaseModel):
    uncertain: bool
    reasons: list[str]
    margin: float = Field(description="Top-1 minus top-2 probability")
    normalized_entropy: float = Field(description="Shannon entropy / log(K); 0 = certain, 1 = uniform")
    low_confidence_threshold: float
    low_margin_threshold: float


class ConcernAggregate(BaseModel):
    probability: float = Field(ge=0, le=1)
    classes: list[str]
    description: str = (
        "Sum of model probabilities for classes grouped as malignant or pre-malignant. "
        "A model output aggregate, not a clinical risk score."
    )


class ExplanationOut(BaseModel):
    status: Literal["completed", "failed", "skipped"]
    method: str = "grad-cam"
    target_class: ClassInfo | None = None
    layer: str | None = None
    heatmap_url: str | None = None
    overlay_url: str | None = None
    cam_url: str | None = Field(
        default=None,
        description="Raw normalised Grad-CAM map as 8-bit grayscale PNG at model input resolution",
    )
    explain_ms: float | None = None
    degenerate: bool = Field(
        default=False, description="True when the map is empty (no positive evidence for the class)"
    )


class Timing(BaseModel):
    inference_ms: float
    explain_ms: float | None = None


class PredictionOut(BaseModel):
    id: uuid.UUID | None = None
    created_at: datetime | None = None
    model: ModelRef
    predicted_class: ClassInfo
    confidence: float = Field(ge=0, le=1)
    probabilities: list[ClassProbability] = Field(description="All classes, highest probability first")
    uncertainty: Uncertainty
    concern: ConcernAggregate
    temperature: float
    timing: Timing
    explanation: ExplanationOut | None = None


class PredictionSummary(BaseModel):
    id: uuid.UUID
    created_at: datetime
    model_label: str
    model_version_id: uuid.UUID
    predicted_class: ClassInfo
    confidence: float


class AnalysisDetail(BaseModel):
    id: uuid.UUID
    created_at: datetime
    original_filename: str
    image: ImageOut
    quality: QualityOut
    prediction: PredictionOut
    prediction_history: list[PredictionSummary]
    produced_by_current_model: bool
    current_model_label: str | None = None


class AnalysisListItem(BaseModel):
    id: uuid.UUID
    created_at: datetime
    original_filename: str
    thumbnail_url: str
    predicted_class: ClassInfo
    confidence: float
    uncertain: bool
    concern_probability: float
    model_label: str
    prediction_count: int


class ClassExplanationOut(BaseModel):
    analysis_id: uuid.UUID
    prediction_id: uuid.UUID
    target_class: ClassInfo
    probability: float
    heatmap_url: str
    overlay_url: str
    cam_url: str
    degenerate: bool


class StatelessExplanation(BaseModel):
    target_class: ClassInfo
    heatmap_png_base64: str
    overlay_jpeg_base64: str
    explain_ms: float
    degenerate: bool


class StatelessExplainResponse(BaseModel):
    prediction: PredictionOut
    explanation: StatelessExplanation
