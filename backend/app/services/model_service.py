"""Model lifecycle: load the artifact, expose status, register the version in the DB.

The API keeps running when no model is available. Every inference endpoint then
returns ``503 model_unavailable`` with an actionable message, and the frontend
shows the same status, so the application never fabricates a prediction.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import partial
from pathlib import Path
from typing import Any, Literal, TypeVar

import anyio
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import ModelUnavailableError
from app.models import ModelVersion
from app.repositories import ModelVersionRepository
from ml.inference import (
    HISTORY_FILENAME,
    LOW_CONFIDENCE_THRESHOLD,
    LOW_MARGIN_THRESHOLD,
    METRICS_FILENAME,
    SAMPLES_DIRNAME,
    ArtifactError,
    InferenceEngine,
)
from ml.models import get_spec

log = logging.getLogger("app.model")
T = TypeVar("T")
Status = Literal["ready", "untrained", "unavailable"]
_SAMPLE_NAME = re.compile(r"^\d{2}_(original|overlay)\.jpg$")


@dataclass(frozen=True)
class LoadedModel:
    engine: InferenceEngine
    loaded_at: datetime
    model_version_id: uuid.UUID | None = None


class ModelService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._loaded: LoadedModel | None = None
        self._status: Status = "unavailable"
        self._message = "The model has not been loaded yet."
        self._lock = threading.Lock()
        self.limiter = anyio.CapacityLimiter(settings.max_concurrent_inferences)

    # ------------------------------------------------------------ loading
    @property
    def artifact_path(self) -> Path:
        return self.settings.resolve_path(self.settings.model_path)

    def load(self) -> Status:
        """(Re)load the artifact at MODEL_PATH. Blocking; call from a worker thread."""
        path = self.artifact_path
        started = time.perf_counter()
        try:
            engine = InferenceEngine.from_path(
                path, device=self.settings.model_device, num_threads=self.settings.model_num_threads
            )
        except ArtifactError as exc:
            self._set_unavailable(f"Model weights are not available: {exc}")
            log.warning("model unavailable", extra={"model_path": str(path), "reason": str(exc)})
            return self._status
        except Exception:
            self._set_unavailable("The model artifact could not be loaded. See server logs for details.")
            log.exception("model failed to load", extra={"model_path": str(path)})
            return self._status

        if not engine.is_trained and not self.settings.allow_untrained_model:
            self._set_unavailable(
                "The artifact at MODEL_PATH is an untrained pipeline-verification model. Train a model "
                "(see docs/training.md) or, for local development only, set ALLOW_UNTRAINED_MODEL=true."
            )
            log.warning("refusing untrained model artifact", extra={"model_id": engine.model_id})
            return self._status

        with self._lock:
            self._loaded = LoadedModel(engine=engine, loaded_at=datetime.now(UTC))
            if engine.is_trained:
                self._status = "ready"
                self._message = f"{engine.card.display_name} v{engine.card.version} is loaded."
            else:
                self._status = "untrained"
                self._message = (
                    "UNTRAINED pipeline-verification model loaded. Predictions and heatmaps are "
                    "meaningless and must not be interpreted."
                )
        log.info(
            "model loaded",
            extra={
                "model_id": engine.model_id,
                "trained": engine.is_trained,
                "load_ms": round((time.perf_counter() - started) * 1000, 1),
                "device": str(engine.device),
            },
        )
        return self._status

    def _set_unavailable(self, message: str) -> None:
        with self._lock:
            self._loaded = None
            self._status = "unavailable"
            self._message = message

    async def register(self, session: AsyncSession) -> None:
        """Ensure a ``model_versions`` row exists for the loaded weights."""
        loaded = self._loaded
        if loaded is None or loaded.model_version_id is not None:
            return
        card = loaded.engine.card
        info = card.to_dict()
        candidate = ModelVersion(
            architecture=card.architecture,
            display_name=card.display_name,
            version=card.version,
            weights_sha256=card.weights_sha256,
            trained=card.trained,
            dataset_id=card.taxonomy.dataset_id,
            num_classes=card.taxonomy.num_classes,
            classes=info["classes"],
            preprocessing_version=card.preprocessing.version,
            input_size=card.preprocessing.input_size,
            temperature=card.temperature,
            gradcam_layer=get_spec(card.architecture).gradcam_layer_name,
            trained_at=card.created_at if card.trained else None,
            card=info,
        )
        row = await ModelVersionRepository(session).get_or_create(candidate)
        await session.commit()
        with self._lock:
            if self._loaded is loaded:
                self._loaded = LoadedModel(
                    engine=loaded.engine, loaded_at=loaded.loaded_at, model_version_id=row.id
                )

    # ------------------------------------------------------------- access
    @property
    def status(self) -> Status:
        return self._status

    @property
    def message(self) -> str:
        return self._message

    @property
    def loaded(self) -> LoadedModel | None:
        return self._loaded

    def require(self) -> LoadedModel:
        loaded = self._loaded
        if loaded is None:
            raise ModelUnavailableError(self._message)
        return loaded

    async def run(self, fn: Callable[..., T], *args: Any) -> T:
        """Run blocking model work in a worker thread, bounded by the concurrency limit."""
        return await anyio.to_thread.run_sync(partial(fn, *args), limiter=self.limiter)

    def info(self) -> dict[str, Any]:
        loaded = self._loaded
        base: dict[str, Any] = {
            "status": self._status,
            "message": self._message,
            "thresholds": {
                "low_confidence": LOW_CONFIDENCE_THRESHOLD,
                "low_margin": LOW_MARGIN_THRESHOLD,
            },
        }
        if loaded is None:
            return base
        described = loaded.engine.describe()
        return {
            **base,
            "model_version_id": loaded.model_version_id,
            "architecture": described["architecture"],
            "display_name": described["display_name"],
            "version": described["version"],
            "trained": described["trained"],
            "weights_sha256": described["weights"]["sha256"],
            "created_at": described["created_at"],
            "dataset": described["dataset"],
            "preprocessing": described["preprocessing"],
            "calibration": described["calibration"],
            "explainability": {**described["explainability"], "target_layer": described["gradcam_layer"]},
            "training": described["training"],
            "classes": described["classes"],
            "parameter_count": described["parameter_count"],
            "device": described["device"],
            "loaded_at": loaded.loaded_at,
            "notes": described.get("notes") or None,
        }

    # ------------------------------------------------------ evaluation data
    def read_evaluation(self) -> tuple[dict[str, Any] | None, str | None]:
        """Return (metrics.json, None) or (None, reason). Metrics must match the loaded weights."""
        loaded = self._loaded
        if loaded is None:
            return None, "No model is loaded."
        path = loaded.engine.artifact_dir / METRICS_FILENAME
        if not path.is_file():
            if not loaded.engine.is_trained:
                return None, "The loaded model is untrained, so there are no evaluation results."
            return None, (
                "No evaluation report found for this model. Run "
                "`python -m ml.evaluation.evaluate --model <artifact dir>` to generate metrics.json."
            )
        try:
            report = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            log.exception("could not read metrics file")
            return None, "The evaluation report could not be read."
        if report.get("weights_sha256") != loaded.engine.card.weights_sha256:
            return None, (
                "metrics.json was produced for different model weights and is not shown. "
                "Re-run the evaluation for the loaded model."
            )
        return report, None

    def read_history(self) -> list[dict[str, Any]]:
        loaded = self._loaded
        if loaded is None:
            return []
        path = loaded.engine.artifact_dir / HISTORY_FILENAME
        if not path.is_file():
            return []
        records = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return records

    def sample_path(self, name: str) -> Path | None:
        loaded = self._loaded
        if loaded is None or not _SAMPLE_NAME.match(name):
            return None
        path = loaded.engine.artifact_dir / SAMPLES_DIRNAME / name
        return path if path.is_file() else None
