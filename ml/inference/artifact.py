"""Model artifacts: a versioned directory holding weights plus a JSON model card.

Layout (see docs/model.md)::

    models/efficientnet_b0-v1.0.0/
        model_card.json      metadata: architecture, version, classes, preprocessing,
                             calibration, dataset, training summary, weights hash
        model.pt             state_dict only (loaded with torch.load(weights_only=True))
        metrics.json         held-out test-set evaluation (written by ml.evaluation)
        history.jsonl        per-epoch training metrics
        samples/             sample test-set predictions with Grad-CAM overlays

Weights are loaded with ``weights_only=True`` so a tampered checkpoint cannot
execute code through pickle, and their SHA-256 must match the model card.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import torch
from torch import nn

from ml.models import build_model, get_spec
from ml.preprocessing import PreprocessingSpec
from ml.taxonomy import ClassTaxonomy

CARD_FILENAME = "model_card.json"
WEIGHTS_FILENAME = "model.pt"
METRICS_FILENAME = "metrics.json"
HISTORY_FILENAME = "history.jsonl"
SAMPLES_DIRNAME = "samples"
CARD_SCHEMA_VERSION = 1


class ArtifactError(RuntimeError):
    """The model artifact is missing, malformed or fails integrity checks."""


@dataclass(frozen=True)
class ModelCard:
    architecture: str
    display_name: str
    version: str
    trained: bool
    created_at: str
    taxonomy: ClassTaxonomy
    preprocessing: PreprocessingSpec
    weights_sha256: str
    temperature: float = 1.0
    weights_file: str = WEIGHTS_FILENAME
    dataset: dict[str, Any] = field(default_factory=dict)
    training: dict[str, Any] = field(default_factory=dict)
    explainability: dict[str, Any] = field(default_factory=dict)
    notes: str = ""
    schema_version: int = CARD_SCHEMA_VERSION

    @property
    def model_id(self) -> str:
        return f"{self.architecture}-v{self.version}"

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "architecture": self.architecture,
            "display_name": self.display_name,
            "version": self.version,
            "trained": self.trained,
            "created_at": self.created_at,
            "classes": self.taxonomy.to_dict()["classes"],
            "dataset": {"id": self.taxonomy.dataset_id, **self.dataset},
            "preprocessing": self.preprocessing.to_dict(),
            "calibration": {"method": "temperature", "temperature": self.temperature},
            "explainability": self.explainability,
            "training": self.training,
            "weights": {"file": self.weights_file, "sha256": self.weights_sha256},
            "notes": self.notes,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ModelCard:
        try:
            schema = int(data.get("schema_version", 0))
            if schema != CARD_SCHEMA_VERSION:
                raise ArtifactError(f"unsupported model card schema version {schema}")
            dataset = dict(data.get("dataset") or {})
            dataset_id = str(dataset.pop("id", "unknown"))
            taxonomy = ClassTaxonomy.from_dict({"dataset_id": dataset_id, "classes": data["classes"]})
            temperature = float((data.get("calibration") or {}).get("temperature", 1.0))
            if not temperature > 0:
                raise ArtifactError("calibration temperature must be positive")
            weights = data["weights"]
            return cls(
                architecture=str(data["architecture"]),
                display_name=str(data.get("display_name") or data["architecture"]),
                version=str(data["version"]),
                trained=bool(data["trained"]),
                created_at=str(data.get("created_at", "")),
                taxonomy=taxonomy,
                preprocessing=PreprocessingSpec.from_dict(data["preprocessing"]),
                weights_sha256=str(weights["sha256"]),
                weights_file=_safe_filename(str(weights.get("file", WEIGHTS_FILENAME))),
                temperature=temperature,
                dataset=dataset,
                training=dict(data.get("training") or {}),
                explainability=dict(data.get("explainability") or {}),
                notes=str(data.get("notes", "")),
                schema_version=schema,
            )
        except ArtifactError:
            raise
        except (KeyError, TypeError, ValueError) as exc:
            raise ArtifactError(f"invalid model card: {exc}") from exc


def _safe_filename(name: str) -> str:
    """Model cards may only reference files inside their own directory."""
    if Path(name).name != name or name in {"", ".", ".."}:
        raise ArtifactError(f"model card references an invalid weights file name {name!r}")
    return name


def file_sha256(path: str | Path, chunk_size: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_artifact_dir(model_path: str | Path) -> Path:
    """Accept either an artifact directory or a path to its model_card.json."""
    path = Path(model_path)
    if path.is_file() and path.name == CARD_FILENAME:
        return path.parent
    if path.is_dir() and (path / CARD_FILENAME).is_file():
        return path
    raise ArtifactError(
        f"no model artifact found at '{model_path}'. Expected a directory containing "
        f"{CARD_FILENAME} and {WEIGHTS_FILENAME}. Train a model with "
        "`python -m ml.training.train` or see docs/training.md."
    )


def load_model_card(artifact_dir: str | Path) -> ModelCard:
    card_path = Path(artifact_dir) / CARD_FILENAME
    try:
        data = json.loads(card_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ArtifactError(f"model card not found: {card_path}") from exc
    except json.JSONDecodeError as exc:
        raise ArtifactError(f"model card is not valid JSON: {exc}") from exc
    return ModelCard.from_dict(data)


def load_model(card: ModelCard, artifact_dir: str | Path, device: torch.device | str = "cpu") -> nn.Module:
    """Build the architecture from the card and load verified weights."""
    get_spec(card.architecture)  # raises for unknown architectures
    weights_path = Path(artifact_dir) / card.weights_file
    if not weights_path.is_file():
        raise ArtifactError(f"model weights not found: {weights_path}")
    actual = file_sha256(weights_path)
    if actual != card.weights_sha256:
        raise ArtifactError(
            "model weights checksum mismatch - the file does not match its model card "
            f"(expected {card.weights_sha256[:12]}..., found {actual[:12]}...)"
        )
    model = build_model(card.architecture, card.taxonomy.num_classes, pretrained=False)
    try:
        state = torch.load(weights_path, map_location=device, weights_only=True)
    except Exception as exc:
        raise ArtifactError(f"could not read model weights: {exc}") from exc
    if isinstance(state, dict) and "state_dict" in state:
        state = state["state_dict"]
    try:
        model.load_state_dict(state, strict=True)
    except RuntimeError as exc:
        raise ArtifactError(f"weights do not match architecture '{card.architecture}': {exc}") from exc
    model.to(device)
    model.eval()
    for param in model.parameters():
        param.requires_grad_(False)
    return model


def _atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def write_json(path: Path, payload: dict[str, Any]) -> None:
    _atomic_write_bytes(path, json.dumps(payload, indent=2, sort_keys=False).encode("utf-8"))


def save_weights(model: nn.Module, artifact_dir: Path) -> str:
    """Save the state_dict and return its SHA-256."""
    artifact_dir.mkdir(parents=True, exist_ok=True)
    path = artifact_dir / WEIGHTS_FILENAME
    tmp = artifact_dir / f".{WEIGHTS_FILENAME}.tmp"
    state = {k: v.detach().cpu() for k, v in model.state_dict().items()}
    torch.save(state, tmp)
    os.replace(tmp, path)
    return file_sha256(path)


def save_model_card(card: ModelCard, artifact_dir: Path) -> None:
    write_json(artifact_dir / CARD_FILENAME, card.to_dict())


def utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()
