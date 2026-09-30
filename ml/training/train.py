"""Train a skin-lesion classifier and write a versioned model artifact.

Usage (from the repository root)::

    python -m ml.training.train --config ml/configs/efficientnet_b0.yaml
    python -m ml.training.train --config ml/configs/efficientnet_b0.yaml \
        --set training.epochs=5 --set data.batch_size=16
    python -m ml.training.train --config ml/configs/efficientnet_b0.yaml --resume

Pipeline: dataset -> augmentation -> transfer-learning CNN -> staged fine-tuning
(head first, then full network) with warm-up + cosine LR -> early stopping on the
validation monitor -> best weights -> temperature calibration on validation ->
held-out test evaluation (ml.evaluation) -> model card.
"""

from __future__ import annotations

import argparse
import json
import logging
import platform
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import torch
import torchvision
from torch import nn
from torch.utils.data import DataLoader, WeightedRandomSampler

from ml.datasets import LesionFolderDataset
from ml.inference.artifact import (
    HISTORY_FILENAME,
    ModelCard,
    save_model_card,
    save_weights,
    utc_now_iso,
)
from ml.models import build_model, count_parameters, get_spec, parameter_groups, set_backbone_trainable
from ml.preprocessing import (
    AugmentationConfig,
    PreprocessingSpec,
    build_eval_transform,
    build_train_transform,
)
from ml.taxonomy import ClassTaxonomy
from ml.training.calibration import fit_temperature
from ml.training.config import ExperimentConfig, load_config
from ml.training.engine import (
    EarlyStopping,
    class_weights,
    evaluate_loader,
    sample_weights,
    train_one_epoch,
    warmup_cosine,
)
from ml.training.reproducibility import resolve_device, seed_everything, worker_init_fn

log = logging.getLogger("ml.training")


def _git_commit() -> str | None:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, timeout=5, check=True
        )
        return out.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def artifact_dir_for(config: ExperimentConfig) -> Path:
    return Path(config.output.dir) / f"{config.model.architecture}-v{config.model.version}"


def train(config: ExperimentConfig, *, resume: bool = False) -> Path:
    """Run a full training job and return the artifact directory."""
    generator = seed_everything(config.seed, deterministic=config.training.deterministic)
    device = resolve_device(config.training.device)
    spec = get_spec(config.model.architecture)
    taxonomy = ClassTaxonomy.from_yaml(config.data.classes_file)
    preprocessing = PreprocessingSpec(input_size=config.model.input_size or spec.default_input_size)
    augmentation = AugmentationConfig.from_dict(config.augmentation)
    out_dir = artifact_dir_for(config)
    ckpt_dir = out_dir / "checkpoints"
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "training_config.json").write_text(json.dumps(config.to_dict(), indent=2), encoding="utf-8")

    # ------------------------------------------------------------------ data
    train_ds = LesionFolderDataset(
        config.data.root, "train", taxonomy, build_train_transform(preprocessing, augmentation)
    )
    val_ds = LesionFolderDataset(
        config.data.root, "validation", taxonomy, build_eval_transform(preprocessing)
    )
    log.info("train=%d validation=%d images; classes=%s", len(train_ds), len(val_ds), taxonomy.codes)
    log.info("train class counts: %s", train_ds.class_counts())

    loader_kwargs: dict[str, Any] = {
        "batch_size": config.data.batch_size,
        "num_workers": config.data.num_workers,
        "pin_memory": device.type == "cuda",
        "worker_init_fn": worker_init_fn,
        "persistent_workers": config.data.num_workers > 0,
    }
    weights = None
    if config.imbalance.strategy == "weighted_sampler":
        sampler = WeightedRandomSampler(
            sample_weights(train_ds.labels, taxonomy.num_classes, config.imbalance.power).tolist(),
            num_samples=len(train_ds),
            replacement=True,
            generator=generator,
        )
        train_loader = DataLoader(train_ds, sampler=sampler, **loader_kwargs)
    else:
        train_loader = DataLoader(
            train_ds,
            shuffle=True,
            generator=generator,
            drop_last=len(train_ds) > config.data.batch_size,
            **loader_kwargs,
        )
        if config.imbalance.strategy == "weighted_loss":
            weights = class_weights(train_ds.labels, taxonomy.num_classes, config.imbalance.power)
    val_loader = DataLoader(val_ds, shuffle=False, **loader_kwargs)

    # ----------------------------------------------------------------- model
    model = build_model(
        config.model.architecture,
        taxonomy.num_classes,
        pretrained=config.model.pretrained,
        dropout=config.model.dropout,
    ).to(device)
    criterion = nn.CrossEntropyLoss(
        weight=weights.to(device) if weights is not None else None,
        label_smoothing=config.optim.label_smoothing,
    )
    optimizer = torch.optim.AdamW(
        parameter_groups(
            model, config.model.architecture, config.optim.lr, config.optim.backbone_lr_multiplier
        ),
        weight_decay=config.optim.weight_decay,
    )
    steps_per_epoch = max(1, len(train_loader))
    scheduler = torch.optim.lr_scheduler.LambdaLR(
        optimizer,
        warmup_cosine(
            total_steps=config.training.epochs * steps_per_epoch,
            warmup_steps=config.schedule.warmup_epochs * steps_per_epoch,
            min_ratio=config.schedule.min_lr_ratio,
        ),
    )
    use_amp = config.training.amp and device.type == "cuda"
    scaler = torch.amp.GradScaler("cuda") if use_amp else None
    mode = "min" if config.training.monitor == "val_loss" else "max"
    stopper = EarlyStopping(patience=config.training.early_stopping_patience, mode=mode)
    history: list[dict[str, Any]] = []
    start_epoch = 0
    started_at = utc_now_iso()

    last_path = ckpt_dir / "last.pt"
    if resume:
        if not last_path.is_file():
            raise FileNotFoundError(f"--resume requested but {last_path} does not exist")
        state = torch.load(last_path, map_location=device, weights_only=False)  # own checkpoint
        model.load_state_dict(state["model"])
        optimizer.load_state_dict(state["optimizer"])
        scheduler.load_state_dict(state["scheduler"])
        if scaler is not None and state.get("scaler"):
            scaler.load_state_dict(state["scaler"])
        stopper = EarlyStopping(**state["early_stopping"])
        history = state["history"]
        start_epoch = state["epoch"] + 1
        started_at = state.get("started_at", started_at)
        log.info("resumed from epoch %d", start_epoch)

    # ------------------------------------------------------------- training
    history_path = out_dir / HISTORY_FILENAME
    if not resume:
        history_path.unlink(missing_ok=True)
    stopped_early = False
    for epoch in range(start_epoch, config.training.epochs):
        frozen = epoch < config.training.freeze_backbone_epochs
        set_backbone_trainable(model, config.model.architecture, not frozen)
        t0 = time.perf_counter()
        train_res = train_one_epoch(
            model,
            train_loader,
            criterion,
            optimizer,
            scheduler,
            device,
            scaler=scaler,
            grad_clip_norm=config.optim.grad_clip_norm,
        )
        val_res = evaluate_loader(model, val_loader, device, taxonomy.num_classes)
        monitor_value = {
            "val_macro_f1": val_res.macro_f1,
            "val_balanced_accuracy": val_res.balanced_accuracy,
            "val_loss": val_res.loss,
        }[config.training.monitor]
        improved = stopper.step(monitor_value, epoch)
        record = {
            "epoch": epoch + 1,
            "lr_head": optimizer.param_groups[1]["lr"],
            "backbone_frozen": frozen,
            "train_loss": round(train_res.loss, 5),
            "train_accuracy": round(train_res.accuracy, 5),
            "val_loss": round(val_res.loss, 5),
            "val_accuracy": round(val_res.accuracy, 5),
            "val_balanced_accuracy": round(val_res.balanced_accuracy, 5),
            "val_macro_f1": round(val_res.macro_f1, 5),
            "is_best": improved,
            "epoch_seconds": round(time.perf_counter() - t0, 2),
        }
        history.append(record)
        with open(history_path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(record) + "\n")
        log.info(
            "epoch %d/%d train_loss=%.4f val_loss=%.4f val_bal_acc=%.4f val_macro_f1=%.4f%s",
            epoch + 1,
            config.training.epochs,
            train_res.loss,
            val_res.loss,
            val_res.balanced_accuracy,
            val_res.macro_f1,
            " *best*" if improved else "",
        )
        if improved:
            torch.save({k: v.detach().cpu() for k, v in model.state_dict().items()}, ckpt_dir / "best.pt")
        torch.save(
            {
                "model": model.state_dict(),
                "optimizer": optimizer.state_dict(),
                "scheduler": scheduler.state_dict(),
                "scaler": scaler.state_dict() if scaler is not None else None,
                "early_stopping": {
                    "patience": stopper.patience,
                    "mode": stopper.mode,
                    "best": stopper.best,
                    "best_epoch": stopper.best_epoch,
                    "bad_epochs": stopper.bad_epochs,
                },
                "history": history,
                "epoch": epoch,
                "started_at": started_at,
            },
            last_path,
        )
        if stopper.should_stop:
            stopped_early = True
            log.info("early stopping: no improvement in %d epochs", stopper.patience)
            break

    # ----------------------------------------------- best weights + calibration
    best_state = torch.load(ckpt_dir / "best.pt", map_location=device, weights_only=True)
    model.load_state_dict(best_state)
    set_backbone_trainable(model, config.model.architecture, True)
    temperature, nll_before, nll_after = 1.0, None, None
    if config.calibrate_temperature:
        val_eval = evaluate_loader(model, val_loader, device, taxonomy.num_classes)
        assert val_eval.logits is not None and val_eval.labels is not None
        temperature, nll_before, nll_after = fit_temperature(val_eval.logits, val_eval.labels)
        log.info("temperature scaling: T=%.3f (val NLL %.4f -> %.4f)", temperature, nll_before, nll_after)

    sha = save_weights(model, out_dir)
    best_record = next(r for r in history if r["epoch"] == stopper.best_epoch + 1)
    card = ModelCard(
        architecture=config.model.architecture,
        display_name=spec.display_name,
        version=config.model.version,
        trained=True,
        created_at=utc_now_iso(),
        taxonomy=taxonomy,
        preprocessing=preprocessing,
        weights_sha256=sha,
        temperature=temperature,
        dataset={
            **config.data.provenance,
            "split_counts": {
                "train": train_ds.class_counts(),
                "validation": val_ds.class_counts(),
            },
        },
        training={
            "experiment_name": config.experiment_name,
            "started_at": started_at,
            "finished_at": utc_now_iso(),
            "epochs_completed": len(history),
            "epochs_configured": config.training.epochs,
            "stopped_early": stopped_early,
            "best_epoch": stopper.best_epoch + 1,
            "monitor": config.training.monitor,
            "best_validation": {
                k: best_record[k]
                for k in ("val_loss", "val_accuracy", "val_balanced_accuracy", "val_macro_f1")
            },
            "calibration": {
                "temperature": temperature,
                "val_nll_before": nll_before,
                "val_nll_after": nll_after,
            },
            "seed": config.seed,
            "device": str(device),
            "pretrained_backbone": config.model.pretrained,
            "imbalance_strategy": config.imbalance.strategy,
            "class_weights": [round(float(w), 4) for w in weights] if weights is not None else None,
            "parameters": count_parameters(model),
            "environment": {
                "python": platform.python_version(),
                "torch": torch.__version__,
                "torchvision": torchvision.__version__,
                "git_commit": _git_commit(),
            },
        },
        explainability={"method": "grad-cam", "target_layer": spec.gradcam_layer_name},
    )
    save_model_card(card, out_dir)
    log.info("saved model artifact to %s (sha256 %s)", out_dir, sha[:12])

    if config.output.evaluate_on_test:
        from ml.evaluation.evaluate import evaluate_artifact  # local import: optional step

        evaluate_artifact(
            out_dir,
            config.data.root,
            split="test",
            batch_size=config.data.batch_size,
            num_workers=config.data.num_workers,
            device=str(device),
            n_samples=config.output.sample_predictions,
        )
    return out_dir


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Train a LesionLens classifier")
    parser.add_argument("--config", type=Path, default=Path("ml/configs/efficientnet_b0.yaml"))
    parser.add_argument("--set", dest="overrides", action="append", default=[], metavar="KEY=VALUE")
    parser.add_argument("--resume", action="store_true", help="continue from checkpoints/last.pt")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    config = load_config(args.config, args.overrides)
    out = train(config, resume=args.resume)
    print(f"Model artifact written to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
