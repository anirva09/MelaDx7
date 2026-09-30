"""Analyses, predictions and per-class prediction scores."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAt, UUIDPrimaryKey

if TYPE_CHECKING:
    from app.models.model_version import ModelVersion
    from app.models.user import User


class Analysis(UUIDPrimaryKey, CreatedAt, Base):
    __tablename__ = "analyses"
    __table_args__ = (Index("ix_analyses_user_created", "user_id", "created_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    original_filename: Mapped[str] = mapped_column(String(255))
    image_key: Mapped[str] = mapped_column(String(512))
    thumbnail_key: Mapped[str] = mapped_column(String(512))
    image_sha256: Mapped[str] = mapped_column(String(64))
    image_width: Mapped[int] = mapped_column(Integer)
    image_height: Mapped[int] = mapped_column(Integer)
    source_format: Mapped[str] = mapped_column(String(10))
    source_width: Mapped[int] = mapped_column(Integer)
    source_height: Mapped[int] = mapped_column(Integer)
    file_size: Mapped[int] = mapped_column(Integer)
    quality: Mapped[dict[str, Any]]

    user: Mapped[User] = relationship(back_populates="analyses")
    predictions: Mapped[list[Prediction]] = relationship(
        back_populates="analysis",
        order_by="Prediction.created_at.desc()",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    @property
    def latest_prediction(self) -> Prediction | None:
        return self.predictions[0] if self.predictions else None


class Prediction(UUIDPrimaryKey, CreatedAt, Base):
    __tablename__ = "predictions"
    __table_args__ = (
        CheckConstraint("confidence >= 0 AND confidence <= 1", name="confidence_range"),
        CheckConstraint("gradcam_status IN ('completed', 'failed', 'skipped')", name="gradcam_status_valid"),
        Index("ix_predictions_analysis_created", "analysis_id", "created_at"),
    )

    analysis_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"))
    model_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("model_versions.id", ondelete="RESTRICT"), index=True
    )
    predicted_class_index: Mapped[int] = mapped_column(Integer)
    predicted_class_code: Mapped[str] = mapped_column(String(32), index=True)
    confidence: Mapped[float] = mapped_column(Float, index=True)
    margin: Mapped[float] = mapped_column(Float)
    normalized_entropy: Mapped[float] = mapped_column(Float)
    concern_probability: Mapped[float] = mapped_column(Float)
    uncertain: Mapped[bool] = mapped_column(Boolean)
    uncertainty_reasons: Mapped[list[Any]]
    temperature: Mapped[float] = mapped_column(Float)
    inference_ms: Mapped[float] = mapped_column(Float)

    gradcam_status: Mapped[str] = mapped_column(String(16))
    gradcam_target_index: Mapped[int | None] = mapped_column(Integer, default=None)
    gradcam_raw_max: Mapped[float | None] = mapped_column(Float, default=None)
    explain_ms: Mapped[float | None] = mapped_column(Float, default=None)
    heatmap_key: Mapped[str | None] = mapped_column(String(512), default=None)
    overlay_key: Mapped[str | None] = mapped_column(String(512), default=None)
    cam_key: Mapped[str | None] = mapped_column(String(512), default=None)

    analysis: Mapped[Analysis] = relationship(back_populates="predictions")
    model_version: Mapped[ModelVersion] = relationship(lazy="joined")
    scores: Mapped[list[PredictionScore]] = relationship(
        order_by="PredictionScore.class_index",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
    )


class PredictionScore(Base):
    __tablename__ = "prediction_scores"
    __table_args__ = (
        CheckConstraint("probability >= 0 AND probability <= 1", name="probability_range"),
        UniqueConstraint("prediction_id", "class_code", name="uq_prediction_scores_prediction_code"),
    )

    prediction_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("predictions.id", ondelete="CASCADE"), primary_key=True
    )
    class_index: Mapped[int] = mapped_column(Integer, primary_key=True)
    class_code: Mapped[str] = mapped_column(String(32))
    probability: Mapped[float] = mapped_column(Float)
