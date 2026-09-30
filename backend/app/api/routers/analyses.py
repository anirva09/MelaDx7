"""Analysis endpoints: create, history, detail, delete, re-run, per-class explanation, report."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

import anyio
from fastapi import APIRouter, File, Path, Query, Response, UploadFile, status

from app.api.deps import AnalysisServiceDep, CurrentUser, LimiterDep, SettingsDep, TimezoneDep
from app.api.uploads import read_upload
from app.db.base import utcnow
from app.repositories import AnalysisFilters
from app.repositories.analyses import SortField, SortOrder
from app.schemas.analysis import AnalysisDetail, AnalysisListItem, ClassExplanationOut
from app.schemas.common import ERROR_RESPONSES, ErrorResponse, Page
from app.services.report import build_report

router = APIRouter(prefix="/analyses", tags=["analyses"], responses=ERROR_RESPONSES)

AnalysisId = Annotated[uuid.UUID, Path(description="Analysis ID")]

UPLOAD_ERRORS: dict[int | str, dict[str, Any]] = {
    413: {"model": ErrorResponse, "description": "File exceeds the upload size limit"},
    415: {"model": ErrorResponse, "description": "Not a JPEG, PNG or WebP image"},
    429: {"model": ErrorResponse, "description": "Rate limit exceeded"},
    503: {"model": ErrorResponse, "description": "Model weights not available"},
}


@router.post(
    "",
    response_model=AnalysisDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a dermoscopic image and analyse it",
    description=(
        "Validates the image, strips metadata, runs the CNN, computes a Grad-CAM explanation for the "
        "predicted class, stores everything and returns the full result. The prediction is an assistive "
        "model output, not a diagnosis."
    ),
    responses=UPLOAD_ERRORS,
)
async def create_analysis(
    file: Annotated[UploadFile, File(description="JPEG, PNG or WebP dermoscopic image")],
    user: CurrentUser,
    service: AnalysisServiceDep,
    settings: SettingsDep,
    limiter: LimiterDep,
) -> AnalysisDetail:
    limiter.hit(f"inference:{user.id}", settings.rate_limit_inference_per_minute)
    data = await read_upload(file, settings.max_upload_bytes)
    return await service.create(user, file.filename, data)


@router.get("", response_model=Page[AnalysisListItem], summary="Analysis history (search, filter, sort)")
async def list_analyses(
    user: CurrentUser,
    service: AnalysisServiceDep,
    q: Annotated[str | None, Query(max_length=100, description="Filename, analysis ID or class code")] = None,
    predicted_class: Annotated[str | None, Query(max_length=32)] = None,
    min_confidence: Annotated[float | None, Query(ge=0, le=1)] = None,
    max_confidence: Annotated[float | None, Query(ge=0, le=1)] = None,
    uncertain: bool | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    model_version_id: uuid.UUID | None = None,
    sort: SortField = "created_at",
    order: SortOrder = "desc",
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> Page[AnalysisListItem]:
    filters = AnalysisFilters(
        q=q or None,
        predicted_class=predicted_class or None,
        min_confidence=min_confidence,
        max_confidence=max_confidence,
        uncertain=uncertain,
        date_from=date_from,
        date_to=date_to,
        model_version_id=model_version_id,
    )
    return await service.list(user, filters, sort=sort, order=order, page=page, page_size=page_size)


@router.get(
    "/{analysis_id}",
    response_model=AnalysisDetail,
    summary="Full analysis result",
    responses={404: {"model": ErrorResponse}},
)
async def get_analysis(
    analysis_id: AnalysisId, user: CurrentUser, service: AnalysisServiceDep
) -> AnalysisDetail:
    return await service.get(user, analysis_id)


@router.delete(
    "/{analysis_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an analysis and its stored images",
    responses={404: {"model": ErrorResponse}},
)
async def delete_analysis(
    analysis_id: AnalysisId, user: CurrentUser, service: AnalysisServiceDep
) -> Response:
    await service.delete(user, analysis_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{analysis_id}/predictions",
    response_model=AnalysisDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Re-run the stored image with the currently loaded model version",
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
)
async def rerun_analysis(
    analysis_id: AnalysisId,
    user: CurrentUser,
    service: AnalysisServiceDep,
    settings: SettingsDep,
    limiter: LimiterDep,
) -> AnalysisDetail:
    limiter.hit(f"inference:{user.id}", settings.rate_limit_inference_per_minute)
    return await service.rerun(user, analysis_id)


@router.get(
    "/{analysis_id}/explanations/{class_code}",
    response_model=ClassExplanationOut,
    summary="Grad-CAM for any class of the latest prediction",
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
)
async def explain_class(
    analysis_id: AnalysisId,
    class_code: Annotated[str, Path(max_length=32, pattern=r"^[A-Za-z0-9_-]+$")],
    user: CurrentUser,
    service: AnalysisServiceDep,
    settings: SettingsDep,
    limiter: LimiterDep,
) -> ClassExplanationOut:
    limiter.hit(f"inference:{user.id}", settings.rate_limit_inference_per_minute)
    return await service.explain_for_class(user, analysis_id, class_code)


@router.get(
    "/{analysis_id}/report",
    summary="Download a PDF report",
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}}, 404: {"model": ErrorResponse}},
)
async def download_report(
    analysis_id: AnalysisId, user: CurrentUser, service: AnalysisServiceDep, tz: TimezoneDep
) -> Response:
    analysis, images = await service.load_for_report(user, analysis_id)
    pdf = await anyio.to_thread.run_sync(lambda: build_report(analysis, images, tz=tz, generated_at=utcnow()))
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="meladx7-report-{str(analysis_id)[:8]}.pdf"',
            "Cache-Control": "no-store",
        },
    )
