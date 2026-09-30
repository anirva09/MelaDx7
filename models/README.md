# Model artifacts

Trained models live here, one directory per version (the release model is ViT-Base/16, see docs/model.md). Nothing in this folder is committed
(see `.gitignore`); artifacts are produced by the training pipeline.

```
models/
  vit_base_patch16_224-v1.0.0/
    model_card.json     architecture, version, classes, preprocessing, calibration,
                        dataset provenance, training summary, weights SHA-256
    model.pt            state_dict (loaded with torch.load(weights_only=True))
    metrics.json        held-out test-set evaluation for these exact weights
    history.jsonl       per-epoch training metrics
    samples/            sample test predictions with Grad-CAM overlays
    checkpoints/        best.pt / last.pt for resuming (not needed for serving)
```

Create one with:

```bash
python -m ml.training.train --config ml/configs/vit_base.yaml
```

Point the API at it with `MODEL_PATH=models/vit_base_patch16_224-v1.0.0` (or, with Docker
Compose, `MODEL_DIR=vit_base_patch16_224-v1.0.0`).

For local UI development before training, an **untrained** pipeline-verification
artifact can be created with `python -m ml.scripts.create_untrained_artifact`. It is
refused unless `ALLOW_UNTRAINED_MODEL=true`, is never accepted in production, and every
screen and report marks its output as meaningless.
