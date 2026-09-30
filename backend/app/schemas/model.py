"""Model information, evaluation and statistics schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.analysis import ClassInfo


class ModelClassOut(ClassInfo):
    description: str = ""


class ModelInfo(BaseModel):
    status: Literal["ready", "untrained", "unavailable"]
    message: str
    model_version_id: uuid.UUID | None = None
    architecture: str | None = None
    display_name: str | None = None
    version: str | None = None
    trained: bool | None = None
    weights_sha256: str | None = None
    created_at: str | None = None
    dataset: dict[str, Any] | None = None
    preprocessing: dict[str, Any] | None = None
    calibration: dict[str, Any] | None = None
    explainability: dict[str, Any] | None = None
    training: dict[str, Any] | None = None
    classes: list[ModelClassOut] = Field(default_factory=list)
    parameter_count: int | None = None
    device: str | None = None
    loaded_at: datetime | None = None
    thresholds: dict[str, float] = Field(default_factory=dict)
    notes: str | None = None


class SamplePrediction(BaseModel):
    category: str
    source_image: str
    true_class: str
    predicted_class: str
    confidence: float
    correct: bool
    original_url: str
    overlay_url: str


class EvaluationReport(BaseModel):
    split: str
    evaluated_at: str
    dataset_id: str
    class_counts: dict[str, int]
    temperature: float
    metrics: dict[str, Any]
    uncalibrated: dict[str, Any]
    samples: list[SamplePrediction]


class ModelMetrics(BaseModel):
    model_status: Literal["ready", "untrained", "unavailable"]
    evaluation_available: bool
    evaluation_unavailable_reason: str | None = None
    evaluation: EvaluationReport | None = None
    training_history: list[dict[str, Any]] = Field(default_factory=list)
    training_summary: dict[str, Any] | None = None


class ClassCount(BaseModel):
    code: str
    name: str
    count: int


class HistogramBin(BaseModel):
    lower: float
    upper: float
    count: int


class DailyCount(BaseModel):
    date: str
    count: int


class RecentPrediction(BaseModel):
    analysis_id: uuid.UUID
    created_at: datetime
    predicted_class: ClassInfo
    confidence: float
    uncertain: bool


class OverviewStats(BaseModel):
    total_analyses: int
    analyses_last_7_days: int
    average_confidence: float | None
    uncertain_count: int
    most_recent: RecentPrediction | None
    class_distribution: list[ClassCount]
    confidence_histogram: list[HistogramBin]
    activity: list[DailyCount]


class InferenceStats(BaseModel):
    scope: Literal["mine", "all"]
    model_version_id: uuid.UUID | None
    model_label: str | None
    predictions: int
    average_confidence: float | None
    uncertain_rate: float | None
    average_inference_ms: float | None
    average_explain_ms: float | None
    gradcam_failures: int
    class_distribution: list[ClassCount]
    confidence_histogram: list[HistogramBin]


class HealthOut(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    environment: str
    checks: dict[str, str]
