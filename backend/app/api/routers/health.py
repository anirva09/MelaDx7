"""Health checks for load balancers and the UI status indicator."""

from __future__ import annotations

import anyio
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.schemas.model import HealthOut

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live", summary="Liveness probe")
async def live() -> dict[str, str]:
    return {"status": "ok"}


@router.get(
    "",
    response_model=HealthOut,
    summary="Readiness: database, storage and model status",
    responses={503: {"model": HealthOut}},
)
async def health(request: Request) -> JSONResponse:
    state = request.app.state
    checks: dict[str, str] = {}
    try:
        async with state.sessionmaker() as session:
            await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception:  # noqa: BLE001 - any failure means the database is unavailable
        checks["database"] = "unavailable"
    checks["storage"] = "ok" if await anyio.to_thread.run_sync(state.storage.healthcheck) else "unavailable"
    checks["model"] = state.models.status  # ready | untrained | unavailable (app still serves)
    healthy = checks["database"] == "ok" and checks["storage"] == "ok"
    body = HealthOut(
        status="ok" if healthy and checks["model"] == "ready" else "degraded",
        version=state.settings.app_version,
        environment=state.settings.environment,
        checks=checks,
    )
    return JSONResponse(body.model_dump(), status_code=200 if healthy else 503)
