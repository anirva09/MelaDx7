"""Model registry: every supported CNN backbone in one place.

Each entry knows how to build the network with a replaced classification head,
which layer Grad-CAM should hook, and how to split parameters into backbone and
head groups (used for staged fine-tuning). Adding an architecture means adding
one ``ArchitectureSpec`` here; nothing in training, inference or the API changes.

Default choice: EfficientNet-B0 (see docs/model.md). It gives strong ImageNet
transfer performance at ~5.3M parameters, runs in well under 100 ms on a laptop
CPU, and its final 7x7 feature map is a well-behaved Grad-CAM target.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import cast

from torch import nn
from torchvision import models as tvm


@dataclass(frozen=True)
class ArchitectureSpec:
    name: str
    display_name: str
    #: Builds the model. ``pretrained`` downloads ImageNet weights via torchvision.
    builder: Callable[[int, bool, float], nn.Module]
    #: Returns the module whose output feature map Grad-CAM attributes.
    gradcam_layer: Callable[[nn.Module], nn.Module]
    #: Dotted path of the Grad-CAM layer (recorded in the model card).
    gradcam_layer_name: str
    #: Returns the classification-head parameters (trained from the first epoch).
    head_parameters: Callable[[nn.Module], Iterator[nn.Parameter]]
    default_input_size: int = 224


def _efficientnet(variant: str) -> Callable[[int, bool, float], nn.Module]:
    ctor = getattr(tvm, variant)
    weights_enum = {
        "efficientnet_b0": tvm.EfficientNet_B0_Weights,
        "efficientnet_b3": tvm.EfficientNet_B3_Weights,
    }[variant]

    def build(num_classes: int, pretrained: bool, dropout: float) -> nn.Module:
        model = ctor(weights=weights_enum.DEFAULT if pretrained else None)
        in_features = model.classifier[1].in_features
        model.classifier = nn.Sequential(
            nn.Dropout(p=dropout, inplace=False),
            nn.Linear(in_features, num_classes),
        )
        return model

    return build


def _resnet(variant: str) -> Callable[[int, bool, float], nn.Module]:
    ctor = getattr(tvm, variant)
    weights_enum = {
        "resnet18": tvm.ResNet18_Weights,
        "resnet50": tvm.ResNet50_Weights,
    }[variant]

    def build(num_classes: int, pretrained: bool, dropout: float) -> nn.Module:
        model = ctor(weights=weights_enum.DEFAULT if pretrained else None)
        in_features = model.fc.in_features
        model.fc = nn.Sequential(nn.Dropout(p=dropout), nn.Linear(in_features, num_classes))
        return model

    return build


def _efficientnet_cam_layer(model: nn.Module) -> nn.Module:
    return cast(nn.Module, cast(nn.Sequential, model.features)[-1])


def _efficientnet_head(model: nn.Module) -> Iterator[nn.Parameter]:
    return cast(nn.Module, model.classifier).parameters()


def _resnet_cam_layer(model: nn.Module) -> nn.Module:
    return cast(nn.Module, cast(nn.Sequential, model.layer4)[-1])


def _resnet_head(model: nn.Module) -> Iterator[nn.Parameter]:
    return cast(nn.Module, model.fc).parameters()


REGISTRY: dict[str, ArchitectureSpec] = {
    "efficientnet_b0": ArchitectureSpec(
        name="efficientnet_b0",
        display_name="EfficientNet-B0",
        builder=_efficientnet("efficientnet_b0"),
        gradcam_layer=_efficientnet_cam_layer,
        gradcam_layer_name="features.8",
        head_parameters=_efficientnet_head,
        default_input_size=224,
    ),
    "efficientnet_b3": ArchitectureSpec(
        name="efficientnet_b3",
        display_name="EfficientNet-B3",
        builder=_efficientnet("efficientnet_b3"),
        gradcam_layer=_efficientnet_cam_layer,
        gradcam_layer_name="features.8",
        head_parameters=_efficientnet_head,
        default_input_size=300,
    ),
    "resnet50": ArchitectureSpec(
        name="resnet50",
        display_name="ResNet-50",
        builder=_resnet("resnet50"),
        gradcam_layer=_resnet_cam_layer,
        gradcam_layer_name="layer4.2",
        head_parameters=_resnet_head,
        default_input_size=224,
    ),
    "resnet18": ArchitectureSpec(
        name="resnet18",
        display_name="ResNet-18",
        builder=_resnet("resnet18"),
        gradcam_layer=_resnet_cam_layer,
        gradcam_layer_name="layer4.1",
        head_parameters=_resnet_head,
        default_input_size=224,
    ),
}


class UnknownArchitectureError(KeyError):
    pass


def get_spec(name: str) -> ArchitectureSpec:
    try:
        return REGISTRY[name]
    except KeyError as exc:
        raise UnknownArchitectureError(
            f"unknown architecture {name!r}; available: {sorted(REGISTRY)}"
        ) from exc


def build_model(name: str, num_classes: int, *, pretrained: bool = False, dropout: float = 0.2) -> nn.Module:
    """Instantiate an architecture with a ``num_classes``-way classification head."""
    if num_classes < 2:
        raise ValueError("num_classes must be >= 2")
    return get_spec(name).builder(num_classes, pretrained, dropout)


def set_backbone_trainable(model: nn.Module, name: str, trainable: bool) -> None:
    """Freeze/unfreeze everything except the classification head."""
    head_ids = {id(p) for p in get_spec(name).head_parameters(model)}
    for param in model.parameters():
        if id(param) not in head_ids:
            param.requires_grad = trainable


def count_parameters(model: nn.Module) -> dict[str, int]:
    total = sum(p.numel() for p in model.parameters())
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    return {"total": total, "trainable": trainable}


def parameter_groups(
    model: nn.Module, name: str, lr: float, backbone_lr_multiplier: float
) -> list[dict[str, object]]:
    """Discriminative learning rates: the pretrained backbone learns more slowly."""
    head = list(get_spec(name).head_parameters(model))
    head_ids = {id(p) for p in head}
    backbone = [p for p in model.parameters() if id(p) not in head_ids]
    return [
        {"params": backbone, "lr": lr * backbone_lr_multiplier, "name": "backbone"},
        {"params": head, "lr": lr, "name": "head"},
    ]


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
