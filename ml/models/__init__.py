"""CNN architectures available for training and inference."""

from ml.models.registry import (
    REGISTRY,
    ArchitectureSpec,
    UnknownArchitectureError,
    build_model,
    count_parameters,
    get_spec,
    parameter_groups,
    set_backbone_trainable,
)

__all__ = [
    "REGISTRY",
    "ArchitectureSpec",
    "UnknownArchitectureError",
    "build_model",
    "count_parameters",
    "get_spec",
    "parameter_groups",
    "set_backbone_trainable",
]
