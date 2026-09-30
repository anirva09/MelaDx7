"""Dashboard and model-page statistics, computed only from stored data."""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.models import User
from app.repositories.stats import HISTOGRAM_BINS, StatsRepository
from app.schemas.model import (
    ClassCount,
    DailyCount,
    HistogramBin,
    InferenceStats,
    OverviewStats,
    RecentPrediction,
)
from app.services import presenters
from app.services.model_service import ModelService

ACTIVITY_DAYS = 30


def _histogram(counts: dict[int, int]) -> list[HistogramBin]:
    return [
        HistogramBin(
            lower=round(i / HISTOGRAM_BINS, 2),
            upper=round((i + 1) / HISTOGRAM_BINS, 2),
            count=counts.get(i, 0),
        )
        for i in range(HISTOGRAM_BINS)
    ]


class StatsService:
    def __init__(self, session: AsyncSession, models: ModelService) -> None:
        self.repo = StatsRepository(session)
        self.models = models

    async def overview(self, user: User, tz: ZoneInfo) -> OverviewStats:
        now = utcnow()
        summary = await self.repo.user_summary(user.id, now - timedelta(days=7))
        names = await self.repo.class_names()
        distribution = await self.repo.user_class_distribution(user.id)
        histogram = await self.repo.user_confidence_histogram(user.id)

        most_recent = None
        if (pair := await self.repo.user_most_recent(user.id)) is not None:
            analysis, prediction = pair
            most_recent = RecentPrediction(
                analysis_id=analysis.id,
                created_at=analysis.created_at,
                predicted_class=presenters.class_info(
                    prediction.model_version, prediction.predicted_class_index
                ),
                confidence=prediction.confidence,
                uncertain=prediction.uncertain,
            )

        today = datetime.now(tz).date()
        start = today - timedelta(days=ACTIVITY_DAYS - 1)
        since = datetime.combine(start, datetime.min.time(), tzinfo=tz)
        per_day: Counter[date] = Counter(
            ts.astimezone(tz).date() for ts in await self.repo.user_created_since(user.id, since)
        )
        activity = [
            DailyCount(
                date=(start + timedelta(days=i)).isoformat(), count=per_day.get(start + timedelta(days=i), 0)
            )
            for i in range(ACTIVITY_DAYS)
        ]
        return OverviewStats(
            total_analyses=summary["total"],
            analyses_last_7_days=summary["last_7_days"],
            average_confidence=summary["average_confidence"],
            uncertain_count=summary["uncertain"],
            most_recent=most_recent,
            class_distribution=[ClassCount(code=c, name=names.get(c, c), count=n) for c, n in distribution],
            confidence_histogram=_histogram(histogram),
            activity=activity,
        )

    async def inference(self, user: User, scope: str) -> InferenceStats:
        loaded = self.models.loaded
        effective_scope = "all" if scope == "all" and user.is_admin else "mine"
        empty = InferenceStats(
            scope=effective_scope,  # type: ignore[arg-type]
            model_version_id=None,
            model_label=None,
            predictions=0,
            average_confidence=None,
            uncertain_rate=None,
            average_inference_ms=None,
            average_explain_ms=None,
            gradcam_failures=0,
            class_distribution=[],
            confidence_histogram=_histogram({}),
        )
        if loaded is None or loaded.model_version_id is None:
            return empty
        data = await self.repo.model_inference(
            loaded.model_version_id, None if effective_scope == "all" else user.id
        )
        card = loaded.engine.card
        names = {c.code: c.name for c in card.taxonomy.classes}
        count = data["count"]
        return InferenceStats(
            scope=effective_scope,  # type: ignore[arg-type]
            model_version_id=loaded.model_version_id,
            model_label=f"{card.display_name} v{card.version}",
            predictions=count,
            average_confidence=data["average_confidence"],
            uncertain_rate=(data["uncertain"] / count) if count else None,
            average_inference_ms=data["average_inference_ms"],
            average_explain_ms=data["average_explain_ms"],
            gradcam_failures=data["gradcam_failures"],
            class_distribution=[
                ClassCount(code=c, name=names.get(c, c), count=n)
                for c, n in sorted(data["distribution"], key=lambda x: -x[1])
            ],
            confidence_histogram=_histogram(data["histogram"]),
        )
