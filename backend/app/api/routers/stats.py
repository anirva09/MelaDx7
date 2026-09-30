"""Dashboard statistics."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import CurrentUser, StatsServiceDep, TimezoneDep
from app.schemas.common import ERROR_RESPONSES
from app.schemas.model import OverviewStats

router = APIRouter(prefix="/stats", tags=["stats"], responses=ERROR_RESPONSES)


@router.get(
    "/overview",
    response_model=OverviewStats,
    summary="Your analysis statistics (all values come from stored analyses)",
)
async def overview(user: CurrentUser, stats: StatsServiceDep, tz: TimezoneDep) -> OverviewStats:
    return await stats.overview(user, tz)
