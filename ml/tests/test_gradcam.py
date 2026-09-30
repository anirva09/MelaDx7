from __future__ import annotations

import numpy as np
import pytest
import torch
from torch import nn

from ml.explainability import GradCAM, colorize, render_heatmap, render_overlay
from ml.models import REGISTRY, build_model, get_spec

from .conftest import make_image


class LocalizedToy(nn.Module):
    """Class 0 evidence = red channel, class 1 evidence = green channel.

    With a known spatial layout of red and green, a correct Grad-CAM must put the
    class-0 map on the red region and the class-1 map on the green region.
    """

    def __init__(self) -> None:
        super().__init__()
        self.features = nn.Conv2d(3, 2, kernel_size=1, bias=False)
        with torch.no_grad():
            self.features.weight.zero_()
            self.features.weight[0, 0] = 1.0  # red -> channel 0
            self.features.weight[1, 1] = 1.0  # green -> channel 1
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.fc = nn.Linear(2, 2, bias=False)
        with torch.no_grad():
            self.fc.weight.copy_(torch.eye(2))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.fc(self.pool(torch.relu(self.features(x))).flatten(1))


def _toy_input() -> torch.Tensor:
    x = torch.zeros(1, 3, 32, 32)
    x[0, 0, :8, :8] = 1.0  # red patch top-left
    x[0, 1, 24:, 24:] = 1.0  # green patch bottom-right
    return x


class TestGradCAMCorrectness:
    def test_localizes_class_evidence(self) -> None:
        model = LocalizedToy()
        with GradCAM(model, model.features) as cam:
            _, (red_map, green_map) = cam.run(_toy_input(), targets=[0, 1])
        assert red_map.cam.shape == (32, 32)
        assert red_map.cam[:8, :8].mean() > 0.9
        assert red_map.cam[24:, 24:].mean() < 0.05
        assert green_map.cam[24:, 24:].mean() > 0.9
        assert green_map.cam[:8, :8].mean() < 0.05

    def test_default_target_is_argmax(self) -> None:
        model = LocalizedToy()
        x = _toy_input()
        x[0, 1] = 0  # only red evidence remains
        with GradCAM(model, model.features) as cam:
            logits, (result,) = cam.run(x)
        assert int(logits.argmax()) == 0
        assert result.target_index == 0

    def test_degenerate_map_when_no_positive_evidence(self) -> None:
        model = LocalizedToy()
        x = torch.zeros(1, 3, 32, 32)
        x[0, 0, :8, :8] = 1.0
        with GradCAM(model, model.features) as cam:
            _, (green,) = cam.run(x, targets=[1])
        assert green.is_degenerate
        assert float(green.cam.max()) == 0.0


@pytest.fixture(scope="module")
def resnet() -> nn.Module:
    torch.manual_seed(0)
    return build_model("resnet18", 4).eval()


class TestGradCAMMechanics:
    def test_output_range_and_shape(self, resnet: nn.Module) -> None:
        layer = get_spec("resnet18").gradcam_layer(resnet)
        with GradCAM(resnet, layer) as cam:
            _, results = cam.run(torch.randn(1, 3, 96, 96), targets=[0, 3])
        for result in results:
            assert result.cam.shape == (96, 96)
            assert result.cam.dtype == np.float32
            assert result.cam.min() >= 0.0 and result.cam.max() <= 1.0
            if not result.is_degenerate:
                assert np.isclose(result.cam.max(), 1.0)

    def test_hooks_removed_and_grads_cleared(self, resnet: nn.Module) -> None:
        layer = get_spec("resnet18").gradcam_layer(resnet)
        with GradCAM(resnet, layer) as cam:
            cam.run(torch.randn(1, 3, 64, 64))
        assert len(layer._forward_hooks) == 0
        assert all(p.grad is None for p in resnet.parameters())

    def test_requires_context_manager(self, resnet: nn.Module) -> None:
        with pytest.raises(RuntimeError):
            GradCAM(resnet, get_spec("resnet18").gradcam_layer(resnet)).run(torch.randn(1, 3, 64, 64))

    def test_rejects_bad_input(self, resnet: nn.Module) -> None:
        with GradCAM(resnet, get_spec("resnet18").gradcam_layer(resnet)) as cam:
            with pytest.raises(ValueError):
                cam.run(torch.randn(2, 3, 64, 64))
            with pytest.raises(ValueError):
                cam.run(torch.randn(1, 3, 64, 64), targets=[99])

    def test_works_with_frozen_parameters(self, resnet: nn.Module) -> None:
        for p in resnet.parameters():
            p.requires_grad_(False)
        try:
            with GradCAM(resnet, get_spec("resnet18").gradcam_layer(resnet)) as cam:
                _, (result,) = cam.run(torch.randn(1, 3, 64, 64))
            assert result.cam.shape == (64, 64)
        finally:
            for p in resnet.parameters():
                p.requires_grad_(True)


@pytest.mark.parametrize("name", sorted(REGISTRY))
def test_every_architecture_supports_gradcam(name: str) -> None:
    model = build_model(name, 5).eval()
    spec = get_spec(name)
    with GradCAM(model, spec.gradcam_layer(model), reshape=spec.gradcam_reshape) as cam:
        logits, (result,) = cam.run(torch.randn(1, 3, 64, 64))
    assert logits.shape == (1, 5)
    assert result.cam.shape == (64, 64)


def test_vit_gradcam_uses_the_patch_grid() -> None:
    from ml.models.registry import _vit_reshape

    tokens = torch.arange(2 * 17 * 3, dtype=torch.float32).reshape(2, 17, 3)  # [CLS] + 4x4 patches
    grid = _vit_reshape(tokens)
    assert grid.shape == (2, 3, 4, 4)
    assert torch.equal(grid[0, :, 0, 0], tokens[0, 1, :])  # first patch, not the [CLS] token
    assert torch.equal(grid[0, :, 3, 3], tokens[0, 16, :])


class TestRendering:
    def test_overlay_and_heatmap_sizes(self) -> None:
        image = make_image(300, 200)
        cam = np.random.default_rng(0).random((7, 7)).astype(np.float32)
        assert render_heatmap(cam, image.size).size == image.size
        overlay = render_overlay(image, cam, alpha=0.5)
        assert overlay.size == image.size and overlay.mode == "RGB"

    def test_zero_alpha_returns_original(self) -> None:
        image = make_image(64, 64)
        overlay = render_overlay(image, np.ones((8, 8), dtype=np.float32), alpha=0.0)
        assert np.array_equal(np.asarray(overlay), np.asarray(image))

    def test_colormap_endpoints(self) -> None:
        cool, warm = colorize(np.array([[0.2, 1.0]], dtype=np.float32))[0]
        assert cool[2] > cool[0]  # blue at low attribution
        assert warm[0] > warm[2]  # red at maximum attribution
        assert colorize(np.zeros((1, 1), dtype=np.float32)).sum() < 150  # dark at zero

    def test_invalid_alpha(self) -> None:
        with pytest.raises(ValueError):
            render_overlay(make_image(64, 64), np.zeros((4, 4), dtype=np.float32), alpha=1.5)
