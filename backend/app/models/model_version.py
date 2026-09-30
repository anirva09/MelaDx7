"""Registered model versions (a snapshot of each model card)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    Float,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPrimaryKey, utcnow


class ModelVersion(UUIDPrimaryKey, Base):
    __tablename__ = "model_versions"

    architecture: Mapped[str] = mapped_column(String(64))
    display_name: Mapped[str] = mapped_column(String(128))
    version: Mapped[str] = mapped_column(String(64))
    weights_sha256: Mapped[str] = mapped_column(String(64), unique=True)
    trained: Mapped[bool] = mapped_column(Boolean)
    dataset_id: Mapped[str] = mapped_column(String(64))
    num_classes: Mapped[int] = mapped_column(Integer)
    classes: Mapped[list[Any]]
    preprocessing_version: Mapped[str] = mapped_column(String(16))
    input_size: Mapped[int] = mapped_column(Integer)
    temperature: Mapped[float] = mapped_column(Float)
    gradcam_layer: Mapped[str] = mapped_column(String(64))
    trained_at: Mapped[str | None] = mapped_column(String(40), default=None)
    card: Mapped[dict[str, Any]]
    registered_at: Mapped[datetime] = mapped_column(default=utcnow)

    @property
    def label(self) -> str:
        return f"{self.display_name} v{self.version}"

    def class_lookup(self) -> dict[int, dict[str, Any]]:
        return {int(c["index"]): c for c in self.classes}
