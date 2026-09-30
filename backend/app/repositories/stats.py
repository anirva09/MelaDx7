"""Aggregate queries for the dashboard and the model page (SQL-side aggregation)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Integer, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute, aliased
from sqlalchemy.sql.elements import ColumnElement

from app.models import Analysis, ModelVersion, Prediction
from app.repositories.analyses import latest_prediction_ids

HISTOGRAM_BINS = 10


def _bin_expr(column: ColumnElement[float] | InstrumentedAttribute[float]) -> ColumnElement[int]:
    """Portable bucketing of a [0,1] value into HISTOGRAM_BINS equal-width bins."""
    whens = [(column < (i + 1) / HISTOGRAM_BINS, i) for i in range(HISTOGRAM_BINS - 1)]
    return case(*whens, else_=HISTOGRAM_BINS - 1).cast(Integer)


class StatsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    def _latest(self, user_id: uuid.UUID):
        ids = latest_prediction_ids().subquery("latest_ids")
        latest = aliased(Prediction, name="latest")
        base = (
            select()
            .select_from(Analysis)
            .join(ids, ids.c.analysis_id == Analysis.id)
            .join(latest, latest.id == ids.c.prediction_id)
            .where(Analysis.user_id == user_id)
        )
        return base, latest

    async def user_summary(self, user_id: uuid.UUID, since_7d: datetime) -> dict[str, Any]:
        base, latest = self._latest(user_id)
        row = (
            await self.session.execute(
                base.add_columns(
                    func.count(Analysis.id),
                    func.sum(case((Analysis.created_at >= since_7d, 1), else_=0)),
                    func.avg(latest.confidence),
                    func.sum(case((latest.uncertain.is_(True), 1), else_=0)),
                )
            )
        ).one()
        return {
            "total": int(row[0] or 0),
            "last_7_days": int(row[1] or 0),
            "average_confidence": float(row[2]) if row[2] is not None else None,
            "uncertain": int(row[3] or 0),
        }

    async def user_class_distribution(self, user_id: uuid.UUID) -> list[tuple[str, int]]:
        base, latest = self._latest(user_id)
        rows = await self.session.execute(
            base.add_columns(latest.predicted_class_code, func.count())
            .group_by(latest.predicted_class_code)
            .order_by(func.count().desc())
        )
        return [(code, int(n)) for code, n in rows.all()]

    async def user_confidence_histogram(self, user_id: uuid.UUID) -> dict[int, int]:
        base, latest = self._latest(user_id)
        bucket = _bin_expr(latest.confidence).label("bucket")
        rows = await self.session.execute(base.add_columns(bucket, func.count()).group_by(bucket))
        return {int(b): int(n) for b, n in rows.all()}

    async def user_most_recent(self, user_id: uuid.UUID) -> tuple[Analysis, Prediction] | None:
        ids = latest_prediction_ids().subquery("latest_ids")
        latest = aliased(Prediction, name="latest")
        row = (
            await self.session.execute(
                select(Analysis, latest)
                .join(ids, ids.c.analysis_id == Analysis.id)
                .join(latest, latest.id == ids.c.prediction_id)
                .where(Analysis.user_id == user_id)
                .order_by(Analysis.created_at.desc())
                .limit(1)
            )
        ).first()
        return (row[0], row[1]) if row else None

    async def user_created_since(self, user_id: uuid.UUID, since: datetime) -> list[datetime]:
        rows = await self.session.execute(
            select(Analysis.created_at).where(Analysis.user_id == user_id, Analysis.created_at >= since)
        )
        return [r[0] for r in rows.all()]

    async def class_names(self) -> dict[str, str]:
        """code -> display name, from every registered model version (newest wins)."""
        rows = await self.session.execute(select(ModelVersion.classes).order_by(ModelVersion.registered_at))
        names: dict[str, str] = {}
        for (classes,) in rows.all():
            for spec in classes:
                names[spec["code"]] = spec["name"]
        return names

    # --------------------------------------------------- per-model inference
    async def model_inference(self, model_version_id: uuid.UUID, user_id: uuid.UUID | None) -> dict[str, Any]:
        def scoped(stmt):
            stmt = stmt.where(Prediction.model_version_id == model_version_id)
            if user_id is not None:
                stmt = stmt.join(Analysis, Analysis.id == Prediction.analysis_id).where(
                    Analysis.user_id == user_id
                )
            return stmt

        summary = (
            await self.session.execute(
                scoped(
                    select(
                        func.count(Prediction.id),
                        func.avg(Prediction.confidence),
                        func.sum(case((Prediction.uncertain.is_(True), 1), else_=0)),
                        func.avg(Prediction.inference_ms),
                        func.avg(Prediction.explain_ms),
                        func.sum(case((Prediction.gradcam_status == "failed", 1), else_=0)),
                    ).select_from(Prediction)
                )
            )
        ).one()
        distribution = await self.session.execute(
            scoped(
                select(Prediction.predicted_class_code, func.count())
                .select_from(Prediction)
                .group_by(Prediction.predicted_class_code)
            )
        )
        bucket = _bin_expr(Prediction.confidence).label("bucket")
        histogram = await self.session.execute(
            scoped(select(bucket, func.count()).select_from(Prediction).group_by(bucket))
        )
        return {
            "count": int(summary[0] or 0),
            "average_confidence": float(summary[1]) if summary[1] is not None else None,
            "uncertain": int(summary[2] or 0),
            "average_inference_ms": float(summary[3]) if summary[3] is not None else None,
            "average_explain_ms": float(summary[4]) if summary[4] is not None else None,
            "gradcam_failures": int(summary[5] or 0),
            "distribution": [(code, int(n)) for code, n in distribution.all()],
            "histogram": {int(b): int(n) for b, n in histogram.all()},
        }
