"""Training configuration: typed dataclasses loaded from YAML with CLI overrides.

Unknown keys are rejected so a typo in a config file fails fast instead of being
silently ignored.
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, get_type_hints

import yaml


@dataclass
class DataConfig:
    root: str = "data/processed"
    classes_file: str = "ml/configs/classes/ham10000.yaml"
    batch_size: int = 32
    num_workers: int = 4
    #: Free-form provenance copied into the model card (name, source, licence...).
    provenance: dict[str, Any] = field(default_factory=dict)


@dataclass
class ModelConfig:
    architecture: str = "efficientnet_b0"
    version: str = "1.0.0"
    pretrained: bool = True
    dropout: float = 0.3
    input_size: int | None = None  # defaults to the architecture's native size


@dataclass
class OptimConfig:
    lr: float = 3.0e-4
    backbone_lr_multiplier: float = 0.1
    weight_decay: float = 1.0e-4
    label_smoothing: float = 0.05
    grad_clip_norm: float | None = 1.0


@dataclass
class ScheduleConfig:
    warmup_epochs: int = 1
    min_lr_ratio: float = 0.01


@dataclass
class TrainingConfig:
    epochs: int = 30
    freeze_backbone_epochs: int = 1
    early_stopping_patience: int = 6
    monitor: str = "val_macro_f1"  # val_macro_f1 | val_balanced_accuracy | val_loss
    amp: bool = True
    device: str = "auto"  # auto | cpu | cuda | mps
    deterministic: bool = False


@dataclass
class ImbalanceConfig:
    strategy: str = "weighted_loss"  # weighted_loss | weighted_sampler | none
    #: 1.0 = inverse frequency, 0.5 = inverse square root (gentler), 0 = uniform.
    power: float = 0.5


@dataclass
class OutputConfig:
    dir: str = "models"
    evaluate_on_test: bool = True
    sample_predictions: int = 12


@dataclass
class ExperimentConfig:
    experiment_name: str = "efficientnet_b0_ham10000"
    seed: int = 42
    calibrate_temperature: bool = True
    data: DataConfig = field(default_factory=DataConfig)
    model: ModelConfig = field(default_factory=ModelConfig)
    optim: OptimConfig = field(default_factory=OptimConfig)
    schedule: ScheduleConfig = field(default_factory=ScheduleConfig)
    training: TrainingConfig = field(default_factory=TrainingConfig)
    imbalance: ImbalanceConfig = field(default_factory=ImbalanceConfig)
    augmentation: dict[str, Any] = field(default_factory=dict)
    output: OutputConfig = field(default_factory=OutputConfig)

    def to_dict(self) -> dict[str, Any]:
        return dataclasses.asdict(self)

    def validate(self) -> None:
        if self.training.monitor not in {"val_macro_f1", "val_balanced_accuracy", "val_loss"}:
            raise ValueError(f"unsupported monitor metric {self.training.monitor!r}")
        if self.imbalance.strategy not in {"weighted_loss", "weighted_sampler", "none"}:
            raise ValueError(f"unsupported imbalance strategy {self.imbalance.strategy!r}")
        if self.training.epochs < 1:
            raise ValueError("training.epochs must be >= 1")
        if not 0 <= self.optim.label_smoothing < 1:
            raise ValueError("optim.label_smoothing must be in [0, 1)")


def _build(cls: type, data: dict[str, Any], path: str) -> Any:
    hints = get_type_hints(cls)
    known = {f.name for f in dataclasses.fields(cls)}
    unknown = set(data) - known
    if unknown:
        raise ValueError(f"unknown config keys at '{path or 'root'}': {sorted(unknown)}")
    kwargs = {}
    for name, value in data.items():
        target = hints[name]
        if isinstance(target, type) and dataclasses.is_dataclass(target) and isinstance(value, dict):
            kwargs[name] = _build(target, value, f"{path}.{name}" if path else name)
        else:
            kwargs[name] = value
    return cls(**kwargs)


def _coerce(raw: str) -> Any:
    return yaml.safe_load(raw)


def apply_overrides(data: dict[str, Any], overrides: list[str]) -> dict[str, Any]:
    """Apply ``a.b.c=value`` overrides (values parsed as YAML scalars)."""
    for item in overrides:
        if "=" not in item:
            raise ValueError(f"override must look like key.path=value, got {item!r}")
        key, raw = item.split("=", 1)
        node = data
        parts = key.strip().split(".")
        for part in parts[:-1]:
            node = node.setdefault(part, {})
            if not isinstance(node, dict):
                raise ValueError(f"cannot override {key!r}: {part!r} is not a mapping")
        node[parts[-1]] = _coerce(raw)
    return data


def load_config(path: str | Path | None, overrides: list[str] | None = None) -> ExperimentConfig:
    data: dict[str, Any] = {}
    if path:
        with open(path, encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
    data = apply_overrides(data, overrides or [])
    config = _build(ExperimentConfig, data, "")
    config.validate()
    return config
