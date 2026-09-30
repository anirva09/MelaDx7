"""Inference engine: the only ML entry point used by the web backend.

The engine is architecture-agnostic: everything it needs (network, classes,
preprocessing, calibration temperature, Grad-CAM layer) comes from the model card.
Prediction and explanation are separate calls, so a Grad-CAM failure can never
prevent a prediction from being returned.
"""

from __future__ import annotations

import math
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import torch
from PIL import Image

from ml.explainability import CAMResult, GradCAM
from ml.inference.artifact import (
    ModelCard,
    load_model,
    load_model_card,
    resolve_artifact_dir,
)
from ml.models import get_spec
from ml.preprocessing import preprocess

#: Heuristic thresholds for flagging an uncertain prediction (see docs/model.md).
LOW_CONFIDENCE_THRESHOLD = 0.60
LOW_MARGIN_THRESHOLD = 0.15


@dataclass(frozen=True)
class ClassScore:
    index: int
    code: str
    name: str
    group: str
    probability: float


@dataclass(frozen=True)
class PredictionResult:
    scores: tuple[ClassScore, ...]  # in class-index order
    predicted_index: int
    confidence: float
    margin: float
    normalized_entropy: float
    concern_probability: float
    concern_classes: tuple[str, ...]
    temperature: float
    inference_ms: float
    uncertain: bool
    uncertainty_reasons: tuple[str, ...] = field(default_factory=tuple)

    @property
    def predicted(self) -> ClassScore:
        return self.scores[self.predicted_index]

    @property
    def probabilities(self) -> list[float]:
        return [s.probability for s in self.scores]

    def ranked(self) -> list[ClassScore]:
        return sorted(self.scores, key=lambda s: s.probability, reverse=True)


@dataclass(frozen=True)
class ExplanationResult:
    cam: CAMResult
    explain_ms: float
    target_code: str


def summarize_probabilities(
    probs: np.ndarray, card: ModelCard, *, temperature: float, inference_ms: float
) -> PredictionResult:
    """Turn a probability vector into a :class:`PredictionResult` (pure function)."""
    probs = probs.astype(np.float64)
    order = np.argsort(-probs)
    top, second = float(probs[order[0]]), float(probs[order[1]])
    k = probs.shape[0]
    entropy = float(-(probs * np.log(np.clip(probs, 1e-12, 1.0))).sum())
    normalized_entropy = entropy / math.log(k)
    concern_idx = card.taxonomy.concern_indices()

    reasons = []
    if top < LOW_CONFIDENCE_THRESHOLD:
        reasons.append("low_top_probability")
    if top - second < LOW_MARGIN_THRESHOLD:
        reasons.append("small_margin_between_top_classes")

    scores = tuple(
        ClassScore(
            index=spec.index,
            code=spec.code,
            name=spec.name,
            group=spec.group,
            probability=float(probs[spec.index]),
        )
        for spec in card.taxonomy.classes
    )
    return PredictionResult(
        scores=scores,
        predicted_index=int(order[0]),
        confidence=top,
        margin=top - second,
        normalized_entropy=normalized_entropy,
        concern_probability=float(probs[concern_idx].sum()) if concern_idx else 0.0,
        concern_classes=tuple(card.taxonomy.classes[i].code for i in concern_idx),
        temperature=temperature,
        inference_ms=inference_ms,
        uncertain=bool(reasons),
        uncertainty_reasons=tuple(reasons),
    )


class InferenceEngine:
    """Thread-safe wrapper around a loaded model artifact.

    A lock serialises access to the network: Grad-CAM installs hooks on the shared
    module, and PyTorch already parallelises each forward pass across CPU cores.
    """

    def __init__(
        self,
        card: ModelCard,
        model: torch.nn.Module,
        artifact_dir: Path,
        device: torch.device,
    ) -> None:
        self.card = card
        self.model = model
        self.artifact_dir = artifact_dir
        self.device = device
        self._spec = get_spec(card.architecture)
        self._lock = threading.Lock()

    # --------------------------------------------------------------- loading
    @classmethod
    def from_path(
        cls, model_path: str | Path, *, device: str = "cpu", num_threads: int | None = None
    ) -> InferenceEngine:
        if num_threads:
            torch.set_num_threads(num_threads)
        artifact_dir = resolve_artifact_dir(model_path)
        card = load_model_card(artifact_dir)
        torch_device = torch.device(device)
        model = load_model(card, artifact_dir, torch_device)
        return cls(card, model, artifact_dir, torch_device)

    # ------------------------------------------------------------ prediction
    def _tensor(self, image: Image.Image) -> torch.Tensor:
        return preprocess(image, self.card.preprocessing).to(self.device)

    def predict(self, image: Image.Image) -> PredictionResult:
        x = self._tensor(image)
        with self._lock, torch.inference_mode():
            start = time.perf_counter()
            logits = self.model(x)
            probs = torch.softmax(logits / self.card.temperature, dim=1)[0]
            elapsed = (time.perf_counter() - start) * 1000.0
        return summarize_probabilities(
            probs.cpu().numpy(),
            self.card,
            temperature=self.card.temperature,
            inference_ms=elapsed,
        )

    def explain(self, image: Image.Image, target_index: int) -> ExplanationResult:
        """Grad-CAM for ``target_index`` (usually the predicted class)."""
        if not 0 <= target_index < self.card.taxonomy.num_classes:
            raise ValueError(f"target class index {target_index} is out of range")
        x = self._tensor(image)
        layer = self._spec.gradcam_layer(self.model)
        with self._lock:
            start = time.perf_counter()
            with GradCAM(self.model, layer, reshape=self._spec.gradcam_reshape) as gradcam:
                _logits, cams = gradcam.run(x, targets=[target_index])
            elapsed = (time.perf_counter() - start) * 1000.0
        return ExplanationResult(
            cam=cams[0],
            explain_ms=elapsed,
            target_code=self.card.taxonomy.classes[target_index].code,
        )

    # ----------------------------------------------------------------- info
    @property
    def model_id(self) -> str:
        return self.card.model_id

    @property
    def is_trained(self) -> bool:
        return self.card.trained

    def describe(self) -> dict[str, Any]:
        info = self.card.to_dict()
        info["gradcam_layer"] = self._spec.gradcam_layer_name
        info["device"] = str(self.device)
        info["parameter_count"] = sum(p.numel() for p in self.model.parameters())
        return info
