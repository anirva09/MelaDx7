"""Gradient-weighted Class Activation Mapping (Grad-CAM).

Reference: Selvaraju et al., "Grad-CAM: Visual Explanations from Deep Networks via
Gradient-based Localization", ICCV 2017.

For a target class ``c`` and the feature maps ``A^k`` of a chosen convolutional
layer, Grad-CAM computes

    alpha_k^c = mean_{i,j} d y^c / d A^k_{ij}          (channel importance)
    L^c       = ReLU( sum_k alpha_k^c * A^k )           (class activation map)

where ``y^c`` is the pre-softmax score (logit) for class ``c``. The map is upsampled
to the input resolution and scaled to [0, 1] by its own maximum. Because of that
per-image normalisation, colours show *relative* attribution within one image and
cannot be compared in absolute terms across images.

The implementation is self-contained (forward hook + tensor gradient hook), so it
works with any architecture from :mod:`ml.models` given its target layer.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import torch
import torch.nn.functional as F
from torch import nn

_EPS = 1e-8


@dataclass(frozen=True)
class CAMResult:
    target_index: int
    #: float32 array in [0, 1] with shape (input_size, input_size)
    cam: np.ndarray
    #: max of the un-normalised map; 0 means no positive evidence for the class
    raw_max: float

    @property
    def is_degenerate(self) -> bool:
        return self.raw_max <= _EPS


class GradCAM:
    """Grad-CAM over one target layer. Use as a context manager so hooks are removed.

    >>> with GradCAM(model, layer) as cam:
    ...     logits, maps = cam.run(x, targets=[3])
    """

    def __init__(self, model: nn.Module, target_layer: nn.Module) -> None:
        self.model = model
        self.target_layer = target_layer
        self._activations: torch.Tensor | None = None
        self._gradients: torch.Tensor | None = None
        self._handle: torch.utils.hooks.RemovableHandle | None = None

    # ------------------------------------------------------------ hooks
    def _forward_hook(self, _module: nn.Module, _inp: object, output: torch.Tensor) -> None:
        if not isinstance(output, torch.Tensor):  # pragma: no cover - defensive
            raise TypeError("Grad-CAM target layer must output a single tensor")
        self._activations = output
        if output.requires_grad:
            output.register_hook(self._save_gradient)

    def _save_gradient(self, grad: torch.Tensor) -> None:
        self._gradients = grad

    def __enter__(self) -> GradCAM:
        self._handle = self.target_layer.register_forward_hook(self._forward_hook)
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def close(self) -> None:
        if self._handle is not None:
            self._handle.remove()
            self._handle = None
        self._activations = None
        self._gradients = None

    # ------------------------------------------------------------- core
    def run(
        self,
        input_tensor: torch.Tensor,
        targets: Sequence[int] | None = None,
    ) -> tuple[torch.Tensor, list[CAMResult]]:
        """One forward pass; one backward pass per target class.

        ``input_tensor`` must have shape ``(1, C, H, W)``. When ``targets`` is None
        the arg-max class is explained. Returns the detached logits ``(1, K)`` and
        one :class:`CAMResult` per target, in the order requested.
        """
        if self._handle is None:
            raise RuntimeError("GradCAM must be used as a context manager")
        if input_tensor.dim() != 4 or input_tensor.shape[0] != 1:
            raise ValueError("Grad-CAM expects a single image tensor of shape (1, C, H, W)")

        was_training = self.model.training
        self.model.eval()
        x = input_tensor.detach().clone().requires_grad_(True)
        try:
            with torch.enable_grad():
                logits = self.model(x)
                if self._activations is None:
                    raise RuntimeError("target layer was not executed during the forward pass")
                num_classes = logits.shape[1]
                resolved = list(targets) if targets else [int(logits.argmax(dim=1).item())]
                for t in resolved:
                    if not 0 <= t < num_classes:
                        raise ValueError(f"target class {t} out of range 0..{num_classes - 1}")

                results: list[CAMResult] = []
                for position, target in enumerate(resolved):
                    self._gradients = None
                    self.model.zero_grad(set_to_none=True)
                    retain = position < len(resolved) - 1
                    logits[0, target].backward(retain_graph=retain)
                    results.append(self._build_cam(target, x.shape[-2:]))
        finally:
            if was_training:
                self.model.train()
            self.model.zero_grad(set_to_none=True)
        return logits.detach(), results

    def _build_cam(self, target: int, size: torch.Size) -> CAMResult:
        if self._activations is None or self._gradients is None:
            raise RuntimeError("gradients were not captured; is the target layer differentiable?")
        activations = self._activations.detach()
        gradients = self._gradients.detach()
        weights = gradients.mean(dim=(2, 3), keepdim=True)  # alpha_k^c
        cam = F.relu((weights * activations).sum(dim=1, keepdim=True))
        cam = F.interpolate(cam, size=tuple(size), mode="bilinear", align_corners=False)
        cam = cam[0, 0]
        raw_max = float(cam.max().item())
        if raw_max > _EPS:
            cam = cam / raw_max
        else:
            cam = torch.zeros_like(cam)
        return CAMResult(
            target_index=target,
            cam=cam.clamp(0.0, 1.0).cpu().numpy().astype(np.float32),
            raw_max=raw_max,
        )
