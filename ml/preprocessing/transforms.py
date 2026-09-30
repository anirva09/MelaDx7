"""Tensor transforms for training and inference.

The preprocessing contract is versioned (``PreprocessingSpec.version``) and saved
in each model card. Inference always rebuilds the transform from the model card,
so a checkpoint is served with exactly the preprocessing it was trained with.

Design choice: images are resized directly to a square (no centre crop). Dermoscopic
lesions are not always centred, and a crop would discard lesion borders. A direct
resize also keeps the mapping from Grad-CAM coordinates back to the original image
a pure rescale, with no offsets.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

import torch
from PIL import Image
from torchvision.transforms import v2 as T

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)
PREPROCESSING_VERSION = "1.0"


@dataclass(frozen=True)
class PreprocessingSpec:
    input_size: int = 224
    mean: tuple[float, float, float] = IMAGENET_MEAN
    std: tuple[float, float, float] = IMAGENET_STD
    resize: str = "direct-square-bilinear-antialias"
    version: str = PREPROCESSING_VERSION

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["mean"] = list(self.mean)
        data["std"] = list(self.std)
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PreprocessingSpec:
        version = str(data.get("version", PREPROCESSING_VERSION))
        if version != PREPROCESSING_VERSION:
            raise ValueError(
                f"model card uses preprocessing version {version!r}, "
                f"this code implements {PREPROCESSING_VERSION!r}"
            )
        return cls(
            input_size=int(data["input_size"]),
            mean=tuple(float(v) for v in data["mean"]),  # type: ignore[arg-type]
            std=tuple(float(v) for v in data["std"]),  # type: ignore[arg-type]
            resize=str(data.get("resize", cls.resize)),
            version=version,
        )


@dataclass(frozen=True)
class AugmentationConfig:
    random_resized_crop_scale: tuple[float, float] = (0.75, 1.0)
    random_resized_crop_ratio: tuple[float, float] = (0.8, 1.25)
    horizontal_flip: bool = True
    vertical_flip: bool = True
    #: Dermoscopic images have no canonical orientation, so full rotation is valid.
    rotation_degrees: float = 180.0
    color_jitter: dict[str, float] = field(
        default_factory=lambda: {
            "brightness": 0.15,
            "contrast": 0.15,
            "saturation": 0.10,
            "hue": 0.02,
        }
    )

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> AugmentationConfig:
        if not data:
            return cls()
        base = cls()
        return cls(
            random_resized_crop_scale=tuple(
                data.get("random_resized_crop_scale", base.random_resized_crop_scale)
            ),
            random_resized_crop_ratio=tuple(
                data.get("random_resized_crop_ratio", base.random_resized_crop_ratio)
            ),
            horizontal_flip=bool(data.get("horizontal_flip", base.horizontal_flip)),
            vertical_flip=bool(data.get("vertical_flip", base.vertical_flip)),
            rotation_degrees=float(data.get("rotation_degrees", base.rotation_degrees)),
            color_jitter=dict(data.get("color_jitter", base.color_jitter)),
        )


def _to_normalized_tensor(spec: PreprocessingSpec) -> list[T.Transform]:
    return [
        T.ToImage(),
        T.ToDtype(torch.float32, scale=True),
        T.Normalize(mean=list(spec.mean), std=list(spec.std)),
    ]


def build_eval_transform(spec: PreprocessingSpec) -> T.Compose:
    """Deterministic transform used for validation, testing and inference."""
    return T.Compose(
        [
            T.Resize(
                (spec.input_size, spec.input_size),
                interpolation=T.InterpolationMode.BILINEAR,
                antialias=True,
            ),
            *_to_normalized_tensor(spec),
        ]
    )


def build_train_transform(spec: PreprocessingSpec, aug: AugmentationConfig) -> T.Compose:
    ops: list[T.Transform] = [
        T.RandomResizedCrop(
            spec.input_size,
            scale=aug.random_resized_crop_scale,
            ratio=aug.random_resized_crop_ratio,
            antialias=True,
        )
    ]
    if aug.horizontal_flip:
        ops.append(T.RandomHorizontalFlip())
    if aug.vertical_flip:
        ops.append(T.RandomVerticalFlip())
    if aug.rotation_degrees > 0:
        ops.append(T.RandomRotation(aug.rotation_degrees, fill=0))
    if aug.color_jitter:
        ops.append(T.ColorJitter(**aug.color_jitter))
    ops.extend(_to_normalized_tensor(spec))
    return T.Compose(ops)


def preprocess(image: Image.Image, spec: PreprocessingSpec) -> torch.Tensor:
    """PIL RGB image -> normalized ``(1, 3, S, S)`` float tensor."""
    if image.mode != "RGB":
        raise ValueError(f"expected an RGB image, got mode {image.mode!r}")
    tensor = build_eval_transform(spec)(image)
    return tensor.unsqueeze(0)


def denormalize(tensor: torch.Tensor, spec: PreprocessingSpec) -> torch.Tensor:
    """Inverse of the normalisation step (useful for debugging/visualisation)."""
    mean = torch.tensor(spec.mean, dtype=tensor.dtype).view(-1, 1, 1)
    std = torch.tensor(spec.std, dtype=tensor.dtype).view(-1, 1, 1)
    return (tensor * std + mean).clamp(0.0, 1.0)
