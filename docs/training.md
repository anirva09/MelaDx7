# Training

This guide goes from a downloaded dataset to a model the application can serve. Every
command runs from the repository root.

## 1. Environment

```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
# GPU: install torch/torchvision for your CUDA version first (https://pytorch.org/get-started/locally/)
pip install --extra-index-url https://download.pytorch.org/whl/cpu -r ml/requirements.txt
pip install -e .                                       # makes the `ml` package importable
```

No GPU? Use the Kaggle/Colab notebook in `notebooks/train_ham10000_kaggle.ipynb`
(free GPU; HAM10000 is available there as "Skin Cancer MNIST: HAM10000").

## 2. Dataset: HAM10000

* **Name:** HAM10000 ("Human Against Machine with 10000 training images")
* **Source:** Harvard Dataverse, https://doi.org/10.7910/DVN/DBW86T (also in the ISIC Archive)
* **Licence:** CC BY-NC 4.0 - non-commercial use only, with attribution. Check the terms
  at the source before use.
* **Citation:** Tschandl P., Rosendahl C., Kittler H. The HAM10000 dataset, a large
  collection of multi-source dermatoscopic images of common pigmented skin lesions.
  *Sci. Data* 5, 180161 (2018).
* **Content:** 10,015 dermatoscopic images, 7 diagnostic categories, metadata CSV with
  `lesion_id`, `image_id`, `dx`, `dx_type`, `age`, `sex`, `localization`.

Download and unpack so you have:

```
data/raw/HAM10000_metadata.csv
data/raw/HAM10000_images_part_1/ISIC_0024306.jpg ...
data/raw/HAM10000_images_part_2/ISIC_0029306.jpg ...
```

No dataset is bundled with this repository, and none is fabricated.

## 3. Lesion-grouped split

```bash
python -m ml.datasets.prepare_ham10000 \
  --metadata data/raw/HAM10000_metadata.csv \
  --images data/raw/HAM10000_images_part_1 data/raw/HAM10000_images_part_2 \
  --output data/processed --mode copy          # or --mode symlink / hardlink to save space
```

HAM10000 contains several images of the same lesion (shared `lesion_id`). An image-level
random split would put near-duplicates in both training and test sets and inflate test
scores. The script uses `StratifiedGroupKFold` so each lesion appears in exactly one split
while class proportions stay close to the whole dataset (default 70/15/15, seed 42). It
asserts there is no lesion overlap and writes `split_manifest.csv` and
`split_summary.json` for reproducibility.

### Using another dataset

Any folder dataset works:

```
data/processed/{train,validation,test}/<class_code>/*.jpg
```

Create a taxonomy YAML (copy `ml/configs/classes/ham10000.yaml`): codes must match folder
names, indices must be `0..K-1`, and `group` is one of `malignant`, `premalignant`,
`benign`, `other`. Then pass `--set data.classes_file=path/to/classes.yaml`. The loader
refuses unknown or missing class folders instead of guessing.

## 4. Train

```bash
python -m ml.training.train --config ml/configs/efficientnet_b0.yaml
```

Override anything from the command line (unknown keys are rejected):

```bash
python -m ml.training.train --config ml/configs/efficientnet_b0.yaml \
  --set training.epochs=40 --set data.batch_size=64 --set imbalance.strategy=weighted_sampler
```

Resume an interrupted run with `--resume` (uses `checkpoints/last.pt`).

What the pipeline does:

| Step | Default | Config key |
|---|---|---|
| Seeding | 42 for Python, NumPy, PyTorch and DataLoader workers | `seed`, `training.deterministic` |
| Transfer learning | ImageNet weights, new head | `model.pretrained`, `model.dropout` |
| Staged fine-tuning | head only for epoch 1, then the whole network | `training.freeze_backbone_epochs` |
| Discriminative LR | backbone at 0.1x the head LR | `optim.backbone_lr_multiplier` |
| Optimiser | AdamW, lr 3e-4, weight decay 1e-4, grad clip 1.0 | `optim.*` |
| Schedule | 1 warm-up epoch, cosine decay to 1% | `schedule.*` |
| Class imbalance | weighted cross-entropy, weights (N / (K n_c))^0.5 | `imbalance.strategy`, `imbalance.power` |
| Regularisation | label smoothing 0.05, dropout 0.3, augmentation | `optim.label_smoothing`, `augmentation.*` |
| Mixed precision | on CUDA | `training.amp` |
| Model selection | best validation macro-F1 | `training.monitor` |
| Early stopping | patience 6 epochs | `training.early_stopping_patience` |
| Calibration | temperature scaling on validation logits | `calibrate_temperature` |
| Final evaluation | held-out test split | `output.evaluate_on_test` |

Macro-F1 is the selection metric because accuracy is dominated by `nv` (about 67% of
images); a model predicting `nv` for everything would already reach roughly 67% accuracy.

Output (`models/efficientnet_b0-v1.0.0/`): `model.pt`, `model_card.json`,
`history.jsonl`, `training_config.json`, `metrics.json`, `samples/`, `checkpoints/`.

Bump `model.version` for every new model you intend to keep; artifacts are identified by
architecture + version, and predictions by the weights checksum.

## 5. Evaluate again (optional)

```bash
python -m ml.evaluation.evaluate --model models/efficientnet_b0-v1.0.0 --data data/processed
```

## 6. Serve it

```bash
# .env
MODEL_PATH=models/efficientnet_b0-v1.0.0
ALLOW_UNTRAINED_MODEL=false
```

Restart the API or call `POST /api/model/reload` as an admin. The Model page now shows
the model card, the held-out metrics, training curves and statistics of real use.
Existing analyses keep their original model version and can be re-run with the new one.

## Reproducibility checklist

* `split_manifest.csv` + seed reproduce the split.
* `training_config.json` records the full resolved configuration.
* `model_card.json` records versions of Python, PyTorch, torchvision and the git commit.
* `metrics.json` is bound to the weights by SHA-256.
* GPU training is not bit-for-bit deterministic unless `training.deterministic=true`
  (slower).
