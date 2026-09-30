"""Stateless inference endpoints for API clients (nothing is stored)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile

from app.api.deps import AnalysisServiceDep, CurrentUser, LimiterDep, SettingsDep
from app.api.routers.analyses import UPLOAD_ERRORS
from app.api.uploads import read_upload
from app.schemas.analysis import PredictionOut, StatelessExplainResponse
from app.schemas.common import ERROR_RESPONSES

router = APIRouter(tags=["inference"], responses=ERROR_RESPONSES)


@router.post(
    "/predict",
    response_model=PredictionOut,
    summary="Classify an image without storing it",
    responses=UPLOAD_ERRORS,
)
async def predict(
    file: Annotated[UploadFile, File(description="JPEG, PNG or WebP dermoscopic image")],
    user: CurrentUser,
    service: AnalysisServiceDep,
    settings: SettingsDep,
    limiter: LimiterDep,
) -> PredictionOut:
    limiter.hit(f"inference:{user.id}", settings.rate_limit_inference_per_minute)
    return await service.predict_only(await read_upload(file, settings.max_upload_bytes))


@router.post(
    "/explain",
    response_model=StatelessExplainResponse,
    summary="Classify an image and return a Grad-CAM heatmap (base64), without storing it",
    responses=UPLOAD_ERRORS,
)
async def explain(
    file: Annotated[UploadFile, File(description="JPEG, PNG or WebP dermoscopic image")],
    user: CurrentUser,
    service: AnalysisServiceDep,
    settings: SettingsDep,
    limiter: LimiterDep,
    target_class: Annotated[
        str | None, Form(max_length=32, description="Class code to explain; defaults to the predicted class")
    ] = None,
) -> StatelessExplainResponse:
    limiter.hit(f"inference:{user.id}", settings.rate_limit_inference_per_minute)
    return await service.explain_only(
        await read_upload(file, settings.max_upload_bytes), target_class or None
    )
