"""Training primitives: epoch loops, class weighting, LR schedule, early stopping."""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass, field

import numpy as np
import torch
import torch.nn.functional as F
from sklearn.metrics import balanced_accuracy_score, f1_score
from torch import nn
from torch.utils.data import DataLoader


def class_weights(labels: Iterable[int], num_classes: int, power: float) -> torch.Tensor:
    """Inverse-frequency class weights ``(N / (K * n_c)) ** power``, mean-normalised to 1."""
    counts = np.bincount(np.asarray(list(labels), dtype=np.int64), minlength=num_classes).astype(np.float64)
    if (counts == 0).any():
        missing = np.where(counts == 0)[0].tolist()
        raise ValueError(f"classes {missing} have no training samples")
    weights = (counts.sum() / (num_classes * counts)) ** power
    weights = weights / weights.mean()
    return torch.tensor(weights, dtype=torch.float32)


def sample_weights(labels: list[int], num_classes: int, power: float) -> torch.Tensor:
    per_class = class_weights(labels, num_classes, power)
    return per_class[torch.tensor(labels)]


def warmup_cosine(total_steps: int, warmup_steps: int, min_ratio: float):
    """LR multiplier: linear warm-up then cosine decay to ``min_ratio``."""

    def factor(step: int) -> float:
        if warmup_steps > 0 and step < warmup_steps:
            return (step + 1) / warmup_steps
        progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
        progress = min(max(progress, 0.0), 1.0)
        return min_ratio + (1.0 - min_ratio) * 0.5 * (1.0 + math.cos(math.pi * progress))

    return factor


@dataclass
class EarlyStopping:
    patience: int
    mode: str = "max"
    best: float | None = None
    best_epoch: int = -1
    bad_epochs: int = 0

    def step(self, value: float, epoch: int) -> bool:
        """Record a new value; returns True if it is the best so far."""
        improved = (
            self.best is None
            or (self.mode == "max" and value > self.best)
            or (self.mode == "min" and value < self.best)
        )
        if improved:
            self.best, self.best_epoch, self.bad_epochs = value, epoch, 0
        else:
            self.bad_epochs += 1
        return improved

    @property
    def should_stop(self) -> bool:
        return self.bad_epochs >= self.patience


@dataclass
class EpochResult:
    loss: float
    accuracy: float
    balanced_accuracy: float = 0.0
    macro_f1: float = 0.0
    logits: torch.Tensor | None = field(default=None, repr=False)
    labels: torch.Tensor | None = field(default=None, repr=False)


def train_one_epoch(
    model: nn.Module,
    loader: DataLoader,
    criterion: nn.Module,
    optimizer: torch.optim.Optimizer,
    scheduler: torch.optim.lr_scheduler.LRScheduler,
    device: torch.device,
    *,
    scaler: torch.amp.GradScaler | None = None,
    grad_clip_norm: float | None = None,
) -> EpochResult:
    model.train()
    total_loss, correct, seen = 0.0, 0, 0
    use_amp = scaler is not None
    for images, labels in loader:
        images = images.to(device, non_blocking=True)
        labels = labels.to(device, non_blocking=True)
        optimizer.zero_grad(set_to_none=True)
        with torch.autocast(device_type=device.type, dtype=torch.float16, enabled=use_amp):
            logits = model(images)
            loss = criterion(logits, labels)
        if scaler is not None:
            scaler.scale(loss).backward()
            if grad_clip_norm:
                scaler.unscale_(optimizer)
                nn.utils.clip_grad_norm_(model.parameters(), grad_clip_norm)
            scaler.step(optimizer)
            scaler.update()
        else:
            loss.backward()
            if grad_clip_norm:
                nn.utils.clip_grad_norm_(model.parameters(), grad_clip_norm)
            optimizer.step()
        scheduler.step()
        batch = labels.size(0)
        total_loss += float(loss.detach()) * batch
        correct += int((logits.detach().argmax(1) == labels).sum())
        seen += batch
    return EpochResult(loss=total_loss / max(seen, 1), accuracy=correct / max(seen, 1))


@torch.no_grad()
def collect_logits(
    model: nn.Module, loader: DataLoader, device: torch.device
) -> tuple[torch.Tensor, torch.Tensor]:
    model.eval()
    all_logits, all_labels = [], []
    for images, labels in loader:
        all_logits.append(model(images.to(device, non_blocking=True)).float().cpu())
        all_labels.append(labels)
    return torch.cat(all_logits), torch.cat(all_labels)


def evaluate_loader(
    model: nn.Module, loader: DataLoader, device: torch.device, num_classes: int
) -> EpochResult:
    logits, labels = collect_logits(model, loader, device)
    loss = float(F.cross_entropy(logits, labels))  # unweighted, comparable across runs
    preds = logits.argmax(1).numpy()
    y = labels.numpy()
    return EpochResult(
        loss=loss,
        accuracy=float((preds == y).mean()),
        balanced_accuracy=float(balanced_accuracy_score(y, preds)),
        macro_f1=float(f1_score(y, preds, labels=list(range(num_classes)), average="macro", zero_division=0)),
        logits=logits,
        labels=labels,
    )
