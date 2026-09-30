"""Analysis and prediction persistence, including history search/filter/sort."""

from __future__ import annotations

import contextlib
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, raiseload, selectinload
from sqlalchemy.sql.elements import ColumnElement

from app.models import Analysis, Prediction

SortField = Literal["created_at", "confidence", "predicted_class"]
SortOrder = Literal["asc", "desc"]


@dataclass(frozen=True, slots=True)
class AnalysisFilters:
    q: str | None = None
    predicted_class: str | None = None
    min_confidence: float | None = None
    max_confidence: float | None = None
    uncertain: bool | None = None
    date_from: datetime | None = None
    date_to: datetime | None = None
    model_version_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class AnalysisRow:
    analysis: Analysis
    latest: Prediction
    prediction_count: int


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def latest_prediction_ids() -> Select[tuple[uuid.UUID, uuid.UUID]]:
    """Latest prediction per analysis (window function; works on PostgreSQL and SQLite)."""
    ranked = select(
        Prediction.id.label("prediction_id"),
        Prediction.analysis_id.label("analysis_id"),
        func.row_number()
        .over(
            partition_by=Prediction.analysis_id,
            order_by=(Prediction.created_at.desc(), Prediction.id.desc()),
        )
        .label("rn"),
    ).subquery("ranked")
    return select(ranked.c.prediction_id, ranked.c.analysis_id).where(ranked.c.rn == 1)


class AnalysisRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add(self, analysis: Analysis) -> Analysis:
        self.session.add(analysis)
        await self.session.flush()
        return analysis

    async def add_prediction(self, prediction: Prediction) -> Prediction:
        self.session.add(prediction)
        await self.session.flush()
        return prediction

    async def get_for_user(self, analysis_id: uuid.UUID, user_id: uuid.UUID) -> Analysis | None:
        result = await self.session.execute(
            select(Analysis)
            .where(Analysis.id == analysis_id, Analysis.user_id == user_id)
            .options(selectinload(Analysis.predictions).selectinload(Prediction.scores))
            .execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    async def ids_for_user(self, user_id: uuid.UUID) -> list[uuid.UUID]:
        result = await self.session.execute(select(Analysis.id).where(Analysis.user_id == user_id))
        return list(result.scalars().all())

    async def delete(self, analysis: Analysis) -> None:
        await self.session.delete(analysis)
        await self.session.flush()

    async def list_for_user(
        self,
        user_id: uuid.UUID,
        filters: AnalysisFilters,
        *,
        sort: SortField = "created_at",
        order: SortOrder = "desc",
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[AnalysisRow], int]:
        latest_ids = latest_prediction_ids().subquery("latest_ids")
        latest = aliased(Prediction, name="latest")
        counts = (
            select(Prediction.analysis_id.label("analysis_id"), func.count(Prediction.id).label("n"))
            .group_by(Prediction.analysis_id)
            .subquery("counts")
        )
        stmt = (
            select(Analysis, latest, counts.c.n)
            .join(latest_ids, latest_ids.c.analysis_id == Analysis.id)
            .join(latest, latest.id == latest_ids.c.prediction_id)
            .join(counts, counts.c.analysis_id == Analysis.id)
            .where(Analysis.user_id == user_id)
            .options(raiseload(latest.scores), raiseload(Analysis.predictions))
        )

        conditions = []
        if filters.q:
            term = filters.q.strip()
            options: list[ColumnElement[bool]] = [
                Analysis.original_filename.ilike(f"%{_escape_like(term)}%", escape="\\")
            ]
            with contextlib.suppress(ValueError):
                options.append(Analysis.id == uuid.UUID(term))
            options.append(latest.predicted_class_code == term.lower())
            conditions.append(or_(*options))
        if filters.predicted_class:
            conditions.append(latest.predicted_class_code == filters.predicted_class)
        if filters.min_confidence is not None:
            conditions.append(latest.confidence >= filters.min_confidence)
        if filters.max_confidence is not None:
            conditions.append(latest.confidence <= filters.max_confidence)
        if filters.uncertain is not None:
            conditions.append(latest.uncertain.is_(filters.uncertain))
        if filters.date_from is not None:
            conditions.append(Analysis.created_at >= filters.date_from)
        if filters.date_to is not None:
            conditions.append(Analysis.created_at <= filters.date_to)
        if filters.model_version_id is not None:
            conditions.append(latest.model_version_id == filters.model_version_id)
        if conditions:
            stmt = stmt.where(and_(*conditions))

        total = int(await self.session.scalar(select(func.count()).select_from(stmt.subquery())) or 0)

        column = {
            "created_at": Analysis.created_at,
            "confidence": latest.confidence,
            "predicted_class": latest.predicted_class_code,
        }[sort]
        ordering = column.asc() if order == "asc" else column.desc()
        stmt = (
            stmt.order_by(ordering, Analysis.created_at.desc(), Analysis.id)
            .limit(page_size)
            .offset((page - 1) * page_size)
        )
        rows = (await self.session.execute(stmt)).all()
        return [AnalysisRow(analysis=a, latest=p, prediction_count=int(n)) for a, p, n in rows], total

    async def latest_predictions_for_user(
        self, user_id: uuid.UUID | None, *, since: datetime | None = None
    ) -> list[tuple[Analysis, Prediction]]:
        """(analysis, latest prediction) pairs for statistics; ``user_id=None`` = all users."""
        latest_ids = latest_prediction_ids().subquery("latest_ids")
        latest = aliased(Prediction, name="latest")
        stmt = (
            select(Analysis, latest)
            .join(latest_ids, latest_ids.c.analysis_id == Analysis.id)
            .join(latest, latest.id == latest_ids.c.prediction_id)
            .order_by(Analysis.created_at.desc())
            .options(raiseload(latest.scores), raiseload(Analysis.predictions))
        )
        if user_id is not None:
            stmt = stmt.where(Analysis.user_id == user_id)
        if since is not None:
            stmt = stmt.where(Analysis.created_at >= since)
        return [(a, p) for a, p in (await self.session.execute(stmt)).all()]

    async def predictions_for_model(
        self, model_version_id: uuid.UUID, user_id: uuid.UUID | None
    ) -> list[Prediction]:
        stmt = (
            select(Prediction)
            .where(Prediction.model_version_id == model_version_id)
            .options(raiseload(Prediction.scores))
        )
        if user_id is not None:
            stmt = stmt.join(Analysis, Analysis.id == Prediction.analysis_id).where(
                Analysis.user_id == user_id
            )
        return list((await self.session.execute(stmt)).scalars().all())
