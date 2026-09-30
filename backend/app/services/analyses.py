"""Analysis workflow: upload -> validate -> infer -> explain -> store -> persist.

Storage writes happen before the database commit; if the commit fails, the files
written for this request are removed again (compensating action), so storage never
accumulates orphaned medical images.
"""

from __future__ import annotations

import base64
import logging
import math
import uuid

import anyio
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import (
    ConflictError,
    InferenceError,
    NotFoundError,
    UnprocessableError,
    UnsupportedMediaTypeError,
)
from app.core.signing import UrlSigner
from app.models import Analysis, ModelVersion, Prediction, PredictionScore, User
from app.repositories import AnalysisFilters, AnalysisRepository, ModelVersionRepository
from app.repositories.analyses import SortField, SortOrder
from app.schemas.analysis import (
    AnalysisDetail,
    AnalysisListItem,
    ClassExplanationOut,
    PredictionOut,
    StatelessExplainResponse,
    StatelessExplanation,
)
from app.schemas.common import Page
from app.services import presenters
from app.services.imaging import (
    InferenceOutcome,
    PreparedImage,
    cam_is_empty,
    explain_class,
    load_stored_image,
    prepare_upload,
    run_inference,
    sanitize_filename,
)
from app.services.model_service import LoadedModel, ModelService
from app.storage import StorageBackend
from ml.preprocessing import ImageValidationError

log = logging.getLogger("app.analysis")


def validation_error(exc: ImageValidationError) -> Exception:
    if exc.code in {"unsupported_format", "animated_image"}:
        return UnsupportedMediaTypeError(exc.message, code=exc.code)
    return UnprocessableError(exc.message, code=exc.code)


class AnalysisService:
    def __init__(
        self,
        session: AsyncSession,
        storage: StorageBackend,
        models: ModelService,
        signer: UrlSigner,
        settings: Settings,
    ) -> None:
        self.session = session
        self.storage = storage
        self.models = models
        self.signer = signer
        self.settings = settings
        self.repo = AnalysisRepository(session)

    # ------------------------------------------------------------- helpers
    async def _current_model(self) -> tuple[LoadedModel, ModelVersion]:
        loaded = self.models.require()
        if loaded.model_version_id is None:
            await self.models.register(self.session)
            loaded = self.models.require()
        mv = (
            await ModelVersionRepository(self.session).get(loaded.model_version_id)
            if loaded.model_version_id is not None
            else None
        )
        if mv is None:  # pragma: no cover - registration guarantees a row
            raise InferenceError("The model version is not registered.")
        return loaded, mv

    async def _prepare(self, data: bytes) -> PreparedImage:
        try:
            return await anyio.to_thread.run_sync(prepare_upload, data, self.settings)
        except ImageValidationError as exc:
            raise validation_error(exc) from exc

    async def _infer(
        self, loaded: LoadedModel, image: Image.Image, *, explain: bool = True
    ) -> InferenceOutcome:
        try:
            return await self.models.run(lambda: run_inference(loaded.engine, image, explain=explain))
        except Exception as exc:
            log.exception("inference failed", extra={"model_id": loaded.engine.model_id})
            raise InferenceError() from exc

    async def _load_image(self, key: str) -> Image.Image:
        data = await anyio.to_thread.run_sync(self.storage.get, key)
        return await anyio.to_thread.run_sync(load_stored_image, data)

    async def _put(self, key: str, data: bytes, written: list[str]) -> None:
        await anyio.to_thread.run_sync(self.storage.put, key, data)
        written.append(key)

    async def _cleanup(self, keys: list[str]) -> None:
        for key in keys:
            try:
                await anyio.to_thread.run_sync(self.storage.delete, key)
            except Exception:
                log.exception("failed to remove orphaned object", extra={"key": key})

    def _build_prediction(
        self, analysis_id: uuid.UUID, mv: ModelVersion, outcome: InferenceOutcome
    ) -> tuple[Prediction, dict[str, bytes]]:
        result = outcome.prediction
        prediction_id = uuid.uuid4()
        base = f"analyses/{analysis_id}/predictions/{prediction_id}"
        files: dict[str, bytes] = {}
        prediction = Prediction(
            id=prediction_id,
            analysis_id=analysis_id,
            model_version_id=mv.id,
            predicted_class_index=result.predicted_index,
            predicted_class_code=result.predicted.code,
            confidence=result.confidence,
            margin=result.margin,
            normalized_entropy=result.normalized_entropy,
            concern_probability=result.concern_probability,
            uncertain=result.uncertain,
            uncertainty_reasons=list(result.uncertainty_reasons),
            temperature=result.temperature,
            inference_ms=round(result.inference_ms, 2),
            gradcam_status="skipped",
            scores=[
                PredictionScore(class_index=s.index, class_code=s.code, probability=s.probability)
                for s in result.scores
            ],
        )
        if outcome.rendered is not None:
            rendered = outcome.rendered
            prediction.gradcam_status = "completed"
            prediction.gradcam_target_index = rendered.explanation.cam.target_index
            prediction.gradcam_raw_max = rendered.explanation.cam.raw_max
            prediction.explain_ms = round(rendered.explanation.explain_ms, 2)
            prediction.heatmap_key = f"{base}/heatmap.png"
            prediction.overlay_key = f"{base}/overlay.jpg"
            prediction.cam_key = f"{base}/cam.png"
            files = {
                prediction.heatmap_key: rendered.heatmap_png,
                prediction.overlay_key: rendered.overlay_jpg,
                prediction.cam_key: rendered.cam_png,
            }
        elif outcome.explain_error is not None:
            prediction.gradcam_status = "failed"
        prediction.model_version = mv
        return prediction, files

    async def _detail(self, analysis_id: uuid.UUID, user: User) -> AnalysisDetail:
        analysis = await self.repo.get_for_user(analysis_id, user.id)
        if analysis is None:
            raise NotFoundError("Analysis not found.")
        loaded = self.models.loaded
        current_label = f"{loaded.engine.card.display_name} v{loaded.engine.card.version}" if loaded else None
        return presenters.analysis_detail(
            analysis,
            self.signer,
            current_model_version_id=loaded.model_version_id if loaded else None,
            current_model_label=current_label,
        )

    # ------------------------------------------------------------ workflow
    async def create(self, user: User, filename: str | None, data: bytes) -> AnalysisDetail:
        loaded, mv = await self._current_model()  # fail fast (503) before any heavy work
        prepared = await self._prepare(data)
        outcome = await self._infer(loaded, prepared.image)

        analysis_id = uuid.uuid4()
        analysis = Analysis(
            id=analysis_id,
            user_id=user.id,
            original_filename=sanitize_filename(filename),
            image_key=f"analyses/{analysis_id}/original.jpg",
            thumbnail_key=f"analyses/{analysis_id}/thumbnail.jpg",
            image_sha256=prepared.sha256,
            image_width=prepared.image.width,
            image_height=prepared.image.height,
            source_format=prepared.source_format,
            source_width=prepared.source_width,
            source_height=prepared.source_height,
            file_size=len(prepared.stored_bytes),
            quality=prepared.quality.to_dict(),
        )
        prediction, derived = self._build_prediction(analysis_id, mv, outcome)

        written: list[str] = []
        try:
            await self._put(analysis.image_key, prepared.stored_bytes, written)
            await self._put(analysis.thumbnail_key, prepared.thumbnail_bytes, written)
            for key, payload in derived.items():
                await self._put(key, payload, written)
            await self.repo.add(analysis)
            await self.repo.add_prediction(prediction)
            await self.session.commit()
        except BaseException:
            await self.session.rollback()
            await self._cleanup(written)
            raise

        log.info(
            "analysis created",
            extra={
                "analysis_id": str(analysis_id),
                "model_id": loaded.engine.model_id,
                "inference_ms": prediction.inference_ms,
                "explain_ms": prediction.explain_ms,
                "gradcam_status": prediction.gradcam_status,
            },
        )
        return await self._detail(analysis_id, user)

    async def rerun(self, user: User, analysis_id: uuid.UUID) -> AnalysisDetail:
        """Re-analyse a stored image with the currently loaded model version."""
        analysis = await self.repo.get_for_user(analysis_id, user.id)
        if analysis is None:
            raise NotFoundError("Analysis not found.")
        loaded, mv = await self._current_model()
        latest = analysis.latest_prediction
        if latest is not None and latest.model_version_id == mv.id:
            raise ConflictError(
                "This analysis was already produced by the current model version.", code="already_current"
            )
        image = await self._load_image(analysis.image_key)
        outcome = await self._infer(loaded, image)
        prediction, derived = self._build_prediction(analysis.id, mv, outcome)
        written: list[str] = []
        try:
            for key, payload in derived.items():
                await self._put(key, payload, written)
            await self.repo.add_prediction(prediction)
            await self.session.commit()
        except BaseException:
            await self.session.rollback()
            await self._cleanup(written)
            raise
        log.info(
            "analysis re-run", extra={"analysis_id": str(analysis.id), "model_id": loaded.engine.model_id}
        )
        return await self._detail(analysis.id, user)

    async def get(self, user: User, analysis_id: uuid.UUID) -> AnalysisDetail:
        return await self._detail(analysis_id, user)

    async def list(
        self,
        user: User,
        filters: AnalysisFilters,
        *,
        sort: SortField,
        order: SortOrder,
        page: int,
        page_size: int,
    ) -> Page[AnalysisListItem]:
        rows, total = await self.repo.list_for_user(
            user.id, filters, sort=sort, order=order, page=page, page_size=page_size
        )
        return Page[AnalysisListItem](
            items=[presenters.list_item(row, self.signer) for row in rows],
            total=total,
            page=page,
            page_size=page_size,
            pages=max(1, math.ceil(total / page_size)) if total else 0,
        )

    async def delete(self, user: User, analysis_id: uuid.UUID) -> None:
        analysis = await self.repo.get_for_user(analysis_id, user.id)
        if analysis is None:
            raise NotFoundError("Analysis not found.")
        await self.repo.delete(analysis)
        await self.session.commit()
        try:
            removed = await anyio.to_thread.run_sync(self.storage.delete_prefix, f"analyses/{analysis_id}")
        except Exception:
            log.exception("failed to delete stored files", extra={"analysis_id": str(analysis_id)})
        else:
            log.info("analysis deleted", extra={"analysis_id": str(analysis_id), "files_removed": removed})

    async def explain_for_class(
        self, user: User, analysis_id: uuid.UUID, class_code: str
    ) -> ClassExplanationOut:
        """Grad-CAM for any class of the latest prediction (cached in storage)."""
        analysis = await self.repo.get_for_user(analysis_id, user.id)
        if analysis is None or analysis.latest_prediction is None:
            raise NotFoundError("Analysis not found.")
        prediction = analysis.latest_prediction
        mv = prediction.model_version
        target = next((c for c in mv.classes if c["code"] == class_code), None)
        if target is None:
            raise NotFoundError(f"Class '{class_code}' is not produced by this model.", code="unknown_class")
        index = int(target["index"])
        loaded = self.models.require()
        if loaded.engine.card.weights_sha256 != mv.weights_sha256:
            raise ConflictError(
                "This analysis was produced by a different model version than the one currently loaded, "
                "so new explanations cannot be generated for it. Re-run the analysis with the current model.",
                code="model_version_mismatch",
            )
        base = f"analyses/{analysis.id}/predictions/{prediction.id}/classes/{class_code}"
        keys = {"heatmap": f"{base}/heatmap.png", "overlay": f"{base}/overlay.jpg", "cam": f"{base}/cam.png"}
        if (
            index == prediction.gradcam_target_index
            and prediction.heatmap_key
            and prediction.overlay_key
            and prediction.cam_key
        ):
            keys = {
                "heatmap": prediction.heatmap_key,
                "overlay": prediction.overlay_key,
                "cam": prediction.cam_key,
            }
            degenerate = (prediction.gradcam_raw_max or 0.0) <= 1e-8
        elif await anyio.to_thread.run_sync(self.storage.exists, keys["cam"]):
            cam_png = await anyio.to_thread.run_sync(self.storage.get, keys["cam"])
            degenerate = await anyio.to_thread.run_sync(cam_is_empty, cam_png)
        else:
            image = await self._load_image(analysis.image_key)
            try:
                rendered = await self.models.run(explain_class, loaded.engine, image, index)
            except Exception as exc:
                log.exception("class explanation failed", extra={"analysis_id": str(analysis.id)})
                raise InferenceError("Grad-CAM could not be generated for this class.") from exc
            degenerate = rendered.explanation.cam.is_degenerate
            written: list[str] = []
            try:
                await self._put(keys["heatmap"], rendered.heatmap_png, written)
                await self._put(keys["overlay"], rendered.overlay_jpg, written)
                await self._put(keys["cam"], rendered.cam_png, written)
            except BaseException:
                await self._cleanup(written)
                raise
        probability = next((s.probability for s in prediction.scores if s.class_index == index), 0.0)
        return ClassExplanationOut(
            analysis_id=analysis.id,
            prediction_id=prediction.id,
            target_class=presenters.class_info(mv, index),
            probability=probability,
            heatmap_url=self.signer.url(presenters.STORAGE_NS, keys["heatmap"]),
            overlay_url=self.signer.url(presenters.STORAGE_NS, keys["overlay"]),
            cam_url=self.signer.url(presenters.STORAGE_NS, keys["cam"]),
            degenerate=degenerate,
        )

    async def load_for_report(self, user: User, analysis_id: uuid.UUID) -> tuple[Analysis, dict[str, bytes]]:
        analysis = await self.repo.get_for_user(analysis_id, user.id)
        if analysis is None or analysis.latest_prediction is None:
            raise NotFoundError("Analysis not found.")
        prediction = analysis.latest_prediction
        images: dict[str, bytes] = {
            "original": await anyio.to_thread.run_sync(self.storage.get, analysis.image_key)
        }
        for name, key in (("overlay", prediction.overlay_key), ("heatmap", prediction.heatmap_key)):
            if key:
                try:
                    images[name] = await anyio.to_thread.run_sync(self.storage.get, key)
                except Exception:  # noqa: BLE001 - the report is still useful without it
                    log.warning("explanation image missing for report", extra={"key": key})
        return analysis, images

    # --------------------------------------------------------- stateless API
    async def predict_only(self, data: bytes) -> PredictionOut:
        loaded, mv = await self._current_model()
        prepared = await self._prepare(data)
        outcome = await self._infer(loaded, prepared.image, explain=False)
        return presenters.prediction_out_from_result(outcome.prediction, mv)

    async def explain_only(self, data: bytes, class_code: str | None) -> StatelessExplainResponse:
        loaded, mv = await self._current_model()
        prepared = await self._prepare(data)
        outcome = await self._infer(loaded, prepared.image, explain=False)
        index = outcome.prediction.predicted_index
        if class_code:
            try:
                index = loaded.engine.card.taxonomy.index_of(class_code)
            except KeyError as exc:
                raise NotFoundError(
                    f"Class '{class_code}' is not produced by this model.", code="unknown_class"
                ) from exc
        try:
            rendered = await self.models.run(explain_class, loaded.engine, prepared.image, index)
        except Exception as exc:
            log.exception("stateless explanation failed")
            raise InferenceError("Grad-CAM could not be generated.") from exc
        return StatelessExplainResponse(
            prediction=presenters.prediction_out_from_result(outcome.prediction, mv),
            explanation=StatelessExplanation(
                target_class=presenters.class_info(mv, index),
                heatmap_png_base64=base64.b64encode(rendered.heatmap_png).decode("ascii"),
                overlay_jpeg_base64=base64.b64encode(rendered.overlay_jpg).decode("ascii"),
                explain_ms=round(rendered.explanation.explain_ms, 2),
                degenerate=rendered.explanation.cam.is_degenerate,
            ),
        )
