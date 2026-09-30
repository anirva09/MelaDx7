from __future__ import annotations

import pytest
import torch

from ml.models import (
    REGISTRY,
    UnknownArchitectureError,
    build_model,
    count_parameters,
    get_spec,
    set_backbone_trainable,
)


@pytest.mark.parametrize("name", sorted(REGISTRY))
def test_forward_shape(name: str) -> None:
    model = build_model(name, 7).eval()
    with torch.no_grad():
        out = model(torch.randn(2, 3, 64, 64))
    assert out.shape == (2, 7)


def test_backbone_freezing() -> None:
    model = build_model("efficientnet_b0", 3)
    set_backbone_trainable(model, "efficientnet_b0", False)
    counts = count_parameters(model)
    head = sum(p.numel() for p in get_spec("efficientnet_b0").head_parameters(model))
    assert counts["trainable"] == head
    set_backbone_trainable(model, "efficientnet_b0", True)
    assert count_parameters(model)["trainable"] == counts["total"]


def test_unknown_architecture() -> None:
    with pytest.raises(UnknownArchitectureError):
        build_model("vgg_from_the_future", 3)


def test_rejects_single_class() -> None:
    with pytest.raises(ValueError):
        build_model("resnet18", 1)
