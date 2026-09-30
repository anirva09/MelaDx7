"""Model information, evaluation metrics and real inference statistics."""

from __future__ import annotations

from typing import Annotated, Literal

import anyio
from fastapi import APIRouter, Query, Request

from app.api.deps import AdminUser, CurrentUser, ModelsDep, SessionDep, SignerDep, StatsServiceDep
from app.schemas.common import ERROR_RESPONSES
from app.schemas.model import EvaluationReport, InferenceStats, ModelInfo, ModelMetrics, SamplePrediction
from app.services.presenters import MODEL_NS

router = APIRouter(prefix="/model", tags=["model"], responses=ERROR_RESPONSES)


@router.get("/info", response_model=ModelInfo, summary="Loaded model, classes and status")
async def model_info(_: CurrentUser, models: ModelsDep, session: SessionDep) -> ModelInfo:
    if models.loaded is not None and models.loaded.model_version_id is None:
        await models.register(session)
    return ModelInfo.model_validate(models.info())


@router.get(
    "/metrics",
    response_model=ModelMetrics,
    summary="Held-out evaluation metrics and training history of the loaded model",
    description=(
        "Returns metrics.json written by `ml.evaluation.evaluate` only if it was produced for the exact "
        "weights that are loaded (checked by SHA-256). Nothing is estimated or filled in."
    ),
)
async def model_metrics(_: CurrentUser, models: ModelsDep, signer: SignerDep) -> ModelMetrics:
    report, reason = await anyio.to_thread.run_sync(models.read_evaluation)
    history = await anyio.to_thread.run_sync(models.read_history)
    loaded = models.loaded
    evaluation = None
    if report is not None:
        samples = [
            SamplePrediction(
                **{k: v for k, v in s.items() if k not in {"original", "overlay"}},
                original_url=signer.url(MODEL_NS, s["original"]),
                overlay_url=signer.url(MODEL_NS, s["overlay"]),
            )
            for s in report.get("samples", [])
        ]
        evaluation = EvaluationReport(
            split=report["split"],
            evaluated_at=report["evaluated_at"],
            dataset_id=report.get("dataset_id", "unknown"),
            class_counts=report.get("class_counts", {}),
            temperature=report.get("temperature", 1.0),
            metrics=report["metrics"],
            uncalibrated=report.get("uncalibrated", {}),
            samples=samples,
        )
    return ModelMetrics(
        model_status=models.status,
        evaluation_available=evaluation is not None,
        evaluation_unavailable_reason=reason,
        evaluation=evaluation,
        training_history=history,
        training_summary=loaded.engine.card.training if loaded else None,
    )


@router.get(
    "/inference-stats",
    response_model=InferenceStats,
    summary="Statistics of real predictions made by the loaded model version",
)
async def inference_stats(
    user: CurrentUser,
    stats: StatsServiceDep,
    scope: Annotated[Literal["mine", "all"], Query(description="'all' requires admin")] = "mine",
) -> InferenceStats:
    return await stats.inference(user, scope)


@router.post("/reload", response_model=ModelInfo, summary="Reload the model from MODEL_PATH (admin)")
async def reload_model(_: AdminUser, request: Request, session: SessionDep) -> ModelInfo:
    models = request.app.state.models
    await anyio.to_thread.run_sync(models.load)
    await models.register(session)
    return ModelInfo.model_validate(models.info())
