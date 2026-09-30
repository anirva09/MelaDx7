"""Post-hoc probability calibration with temperature scaling.

Reference: Guo et al., "On Calibration of Modern Neural Networks", ICML 2017.

A single scalar T > 0 is fitted on validation logits by minimising the negative
log-likelihood of softmax(logits / T). T does not change the arg-max prediction or
Grad-CAM maps; it only makes the reported probabilities better reflect observed
accuracy. The fitted T is stored in the model card and applied at inference.
"""

from __future__ import annotations

import torch
import torch.nn.functional as F


def fit_temperature(
    logits: torch.Tensor, labels: torch.Tensor, *, max_iter: int = 200
) -> tuple[float, float, float]:
    """Return ``(temperature, nll_before, nll_after)``."""
    logits = logits.detach().double().cpu()
    labels = labels.detach().long().cpu()
    nll_before = float(F.cross_entropy(logits, labels))

    log_t = torch.zeros(1, dtype=torch.float64, requires_grad=True)
    optimizer = torch.optim.LBFGS([log_t], lr=0.1, max_iter=max_iter, line_search_fn="strong_wolfe")

    def closure() -> torch.Tensor:
        optimizer.zero_grad()
        loss = F.cross_entropy(logits / log_t.exp(), labels)
        loss.backward()
        return loss

    optimizer.step(closure)
    temperature = float(log_t.detach().exp().clamp(0.05, 20.0))
    nll_after = float(F.cross_entropy(logits / temperature, labels))
    if nll_after > nll_before:  # never make calibration worse than identity
        return 1.0, nll_before, nll_before
    return temperature, nll_before, nll_after
