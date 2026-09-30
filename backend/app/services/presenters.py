"""ORM -> API schema conversion (with signed image URLs)."""

from __future__ import annotations

import uuid
from typing import Any

from app.core.signing import UrlSigner
from app.models import Analysis, ModelVersion, Prediction
from app.repositories import AnalysisRow
from app.schemas.analysis import (
    AnalysisDetail,
    AnalysisListItem,
    ClassInfo,
    ClassProbability,
    ConcernAggregate,
    ExplanationOut,
    ImageOut,
    ModelRef,
    PredictionOut,
    PredictionSummary,
    QualityOut,
    Timing,
    Uncertainty,
)
from ml.inference import LOW_CONFIDENCE_THRESHOLD, LOW_MARGIN_THRESHOLD, PredictionResult
from ml.taxonomy import CONCERN_GROUPS

STORAGE_NS = "s"
MODEL_NS = "m"


def class_info(model_version: ModelVersion, index: int) -> ClassInfo:
    spec = model_version.class_lookup().get(index)
    if spec is None:  # pragma: no cover - guarded by DB constraints on write
        return ClassInfo(index=index, code=f"class_{index}", name=f"Class {index}", group="other")
    return ClassInfo(index=index, code=spec["code"], name=spec["name"], group=spec.get("group", "other"))


def model_ref(model_version: ModelVersion) -> ModelRef:
    return ModelRef(
        id=model_version.id,
        architecture=model_version.architecture,
        display_name=model_version.display_name,
        version=model_version.version,
        trained=model_version.trained,
        weights_sha256=model_version.weights_sha256,
        dataset_id=model_version.dataset_id,
        preprocessing_version=model_version.preprocessing_version,
        input_size=model_version.input_size,
        gradcam_layer=model_version.gradcam_layer,
    )


def _uncertainty(uncertain: bool, reasons: list[Any], margin: float, entropy: float) -> Uncertainty:
    return Uncertainty(
        uncertain=uncertain,
        reasons=[str(r) for r in reasons],
        margin=margin,
        normalized_entropy=entropy,
        low_confidence_threshold=LOW_CONFIDENCE_THRESHOLD,
        low_margin_threshold=LOW_MARGIN_THRESHOLD,
    )


def _concern(model_version: ModelVersion, probability: float) -> ConcernAggregate:
    codes = [c["code"] for c in model_version.classes if c.get("group") in CONCERN_GROUPS]
    return ConcernAggregate(probability=min(max(probability, 0.0), 1.0), classes=codes)


def prediction_out(prediction: Prediction, signer: UrlSigner) -> PredictionOut:
    mv = prediction.model_version
    lookup = mv.class_lookup()
    probabilities = sorted(
        (
            ClassProbability(
                index=score.class_index,
                code=score.class_code,
                name=lookup.get(score.class_index, {}).get("name", score.class_code),
                group=lookup.get(score.class_index, {}).get("group", "other"),
                probability=score.probability,
            )
            for score in prediction.scores
        ),
        key=lambda p: p.probability,
        reverse=True,
    )
    explanation = ExplanationOut(
        status=prediction.gradcam_status,  # type: ignore[arg-type]
        layer=mv.gradcam_layer,
        target_class=(
            class_info(mv, prediction.gradcam_target_index)
            if prediction.gradcam_target_index is not None
            else None
        ),
        heatmap_url=signer.url(STORAGE_NS, prediction.heatmap_key) if prediction.heatmap_key else None,
        overlay_url=signer.url(STORAGE_NS, prediction.overlay_key) if prediction.overlay_key else None,
        cam_url=signer.url(STORAGE_NS, prediction.cam_key) if prediction.cam_key else None,
        explain_ms=prediction.explain_ms,
        degenerate=(prediction.gradcam_raw_max is not None and prediction.gradcam_raw_max <= 1e-8),
    )
    return PredictionOut(
        id=prediction.id,
        created_at=prediction.created_at,
        model=model_ref(mv),
        predicted_class=class_info(mv, prediction.predicted_class_index),
        confidence=prediction.confidence,
        probabilities=probabilities,
        uncertainty=_uncertainty(
            prediction.uncertain,
            prediction.uncertainty_reasons,
            prediction.margin,
            prediction.normalized_entropy,
        ),
        concern=_concern(mv, prediction.concern_probability),
        temperature=prediction.temperature,
        timing=Timing(inference_ms=prediction.inference_ms, explain_ms=prediction.explain_ms),
        explanation=explanation,
    )


def prediction_out_from_result(result: PredictionResult, model_version: ModelVersion) -> PredictionOut:
    """For stateless endpoints: an in-memory result that is not persisted."""
    probabilities = [
        ClassProbability(index=s.index, code=s.code, name=s.name, group=s.group, probability=s.probability)
        for s in result.ranked()
    ]
    return PredictionOut(
        model=model_ref(model_version),
        predicted_class=class_info(model_version, result.predicted_index),
        confidence=result.confidence,
        probabilities=probabilities,
        uncertainty=_uncertainty(
            result.uncertain, list(result.uncertainty_reasons), result.margin, result.normalized_entropy
        ),
        concern=_concern(model_version, result.concern_probability),
        temperature=result.temperature,
        timing=Timing(inference_ms=result.inference_ms),
        explanation=None,
    )


def image_out(analysis: Analysis, signer: UrlSigner) -> ImageOut:
    return ImageOut(
        url=signer.url(STORAGE_NS, analysis.image_key),
        thumbnail_url=signer.url(STORAGE_NS, analysis.thumbnail_key),
        width=analysis.image_width,
        height=analysis.image_height,
        source_format=analysis.source_format,
        source_width=analysis.source_width,
        source_height=analysis.source_height,
        file_size=analysis.file_size,
        sha256=analysis.image_sha256,
    )


def analysis_detail(
    analysis: Analysis,
    signer: UrlSigner,
    *,
    current_model_version_id: uuid.UUID | None,
    current_model_label: str | None,
) -> AnalysisDetail:
    latest = analysis.latest_prediction
    assert latest is not None, "analyses always have at least one prediction"
    history = [
        PredictionSummary(
            id=p.id,
            created_at=p.created_at,
            model_label=p.model_version.label,
            model_version_id=p.model_version_id,
            predicted_class=class_info(p.model_version, p.predicted_class_index),
            confidence=p.confidence,
        )
        for p in analysis.predictions
    ]
    return AnalysisDetail(
        id=analysis.id,
        created_at=analysis.created_at,
        original_filename=analysis.original_filename,
        image=image_out(analysis, signer),
        quality=QualityOut.model_validate(analysis.quality),
        prediction=prediction_out(latest, signer),
        prediction_history=history,
        produced_by_current_model=current_model_version_id == latest.model_version_id,
        current_model_label=current_model_label,
    )


def list_item(row: AnalysisRow, signer: UrlSigner) -> AnalysisListItem:
    p = row.latest
    return AnalysisListItem(
        id=row.analysis.id,
        created_at=row.analysis.created_at,
        original_filename=row.analysis.original_filename,
        thumbnail_url=signer.url(STORAGE_NS, row.analysis.thumbnail_key),
        predicted_class=class_info(p.model_version, p.predicted_class_index),
        confidence=p.confidence,
        uncertain=p.uncertain,
        concern_probability=p.concern_probability,
        model_label=p.model_version.label,
        prediction_count=row.prediction_count,
    )
