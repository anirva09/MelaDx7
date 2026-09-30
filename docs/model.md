# Model

## Task

Multi-class classification of a single dermoscopic image into the classes defined by a
taxonomy file (`ml/configs/classes/ham10000.yaml` by default: the seven HAM10000
diagnostic categories). Two read-outs are derived from the same softmax output:

* **Subtype classification**: the probability of each class.
* **Detection-style aggregate**: the sum of probabilities of classes grouped as
  malignant or pre-malignant in the taxonomy (`mel`, `bcc`, `akiec`). It is labelled as
  a sum of model outputs everywhere, never as a risk score, and is evaluated as its own
  derived binary task (ROC-AUC, sensitivity and specificity at 0.5) on the test split.

| Code | Name | Group | HAM10000 images* |
|---|---|---|---|
| akiec | Actinic keratosis / intraepithelial carcinoma | pre-malignant | 327 |
| bcc | Basal cell carcinoma | malignant | 514 |
| bkl | Benign keratosis-like lesion | benign | 1,099 |
| df | Dermatofibroma | benign | 115 |
| mel | Melanoma | malignant | 1,113 |
| nv | Melanocytic nevus | benign | 6,705 |
| vasc | Vascular lesion | benign | 142 |

\* Counts of the 10,015-image HAM10000 training release (Tschandl et al., 2018). The
dataset is heavily imbalanced: `nv` is about 67% of images.

## Architecture choice: EfficientNet-B0

| | EfficientNet-B0 | ResNet-50 |
|---|---|---|
| Parameters (7-class head) | 4.0 M | 23.5 M |
| ImageNet top-1 of the torchvision weights | 77.7% | 80.9% (V2 weights) |
| Measured CPU latency, 1 image at 224 px (2 vCPU) | ~31 ms | ~79 ms |
| Grad-CAM target | `features.8` (1280 x 7 x 7) | `layer4` (2048 x 7 x 7) |

EfficientNet-B0 was chosen as the default because it transfers well to dermoscopy in the
literature, is small enough for CPU serving inside the API process, and its final feature
map is a standard Grad-CAM target. ResNet-50, ResNet-18 and EfficientNet-B3 are available
through the same registry (`ml/models/registry.py`), selected by the model card, so a
different backbone needs no API or UI change.

The classifier head is replaced with `Dropout(p) -> Linear(1280, K)`.

## Preprocessing (version 1.0)

Recorded in every model card and re-applied from it at inference:

1. Decode with validation (magic bytes, integrity, pixel limit), apply EXIF orientation,
   convert to RGB (alpha flattened on white).
2. For uploads: re-encode as metadata-free JPEG (quality 95, long side <= 2048 px);
   inference runs on the re-decoded stored image.
3. Resize directly to `input_size x input_size` (bilinear, antialiased). No centre crop:
   lesions are not always centred, and a direct resize keeps Grad-CAM coordinates a pure
   rescale of the original image.
4. Normalise with ImageNet mean/std.

Training augmentation (train split only): random resized crop (scale 0.75-1.0, ratio
0.8-1.25), horizontal and vertical flips, rotation up to 180 degrees (dermoscopic images
have no canonical orientation), mild colour jitter.

## Calibration and uncertainty

* **Temperature scaling** (Guo et al., 2017): one scalar `T` fitted on validation logits by
  minimising NLL, stored in the model card, applied at inference. It never changes the
  predicted class or Grad-CAM, and falls back to `T = 1` if it would not improve NLL.
* **Uncertainty flags** (heuristic, shown in the UI and report):
  * top-class probability below **0.60**, or
  * margin between the top two classes below **0.15**.
  The normalised entropy `H(p) / log K` is reported as well.

These thresholds are conservative UX defaults, not clinically validated operating points.

## Image-quality heuristics

Non-blocking warnings (`ml/preprocessing/quality.py`): short side under 224 px, mean
brightness under 0.15 or over 0.92, contrast (std) under 0.04, and focus measured by the
variance of a 4-neighbour Laplacian on a 512 px grayscale copy (under 12). They are simple
signal checks, documented as such.

## Model card

Every artifact carries `model_card.json` (schema version 1):

```json
{
  "schema_version": 1,
  "architecture": "efficientnet_b0",
  "display_name": "EfficientNet-B0",
  "version": "1.0.0",
  "trained": true,
  "created_at": "...",
  "classes": [{ "index": 0, "code": "akiec", "name": "...", "group": "premalignant", "description": "..." }],
  "dataset": { "id": "HAM10000", "name": "...", "source": "...", "license": "CC BY-NC 4.0", "split_counts": {} },
  "preprocessing": { "version": "1.0", "input_size": 224, "mean": [], "std": [], "resize": "..." },
  "calibration": { "method": "temperature", "temperature": 1.19 },
  "explainability": { "method": "grad-cam", "target_layer": "features.8" },
  "training": { "epochs_completed": 0, "best_epoch": 0, "monitor": "val_macro_f1", "seed": 42, "environment": {} },
  "weights": { "file": "model.pt", "sha256": "..." }
}
```

The API stores a snapshot of the card in `model_versions` and links every prediction to it.

## Evaluation

`python -m ml.evaluation.evaluate --model <artifact> --data data/processed` computes, on the
held-out test split: accuracy, balanced accuracy, top-2 accuracy, macro and weighted
precision/recall/F1, per-class precision, recall (sensitivity), specificity, F1 and
one-vs-rest ROC-AUC with curves, the confusion matrix, calibration (ECE with 15 bins, NLL,
Brier score, reliability table, ECE before scaling), the derived malignant/pre-malignant
screening task, and a sample gallery (confident correct, misclassified and least
confident, balanced across classes) with Grad-CAM overlays.

The API only shows `metrics.json` if its `weights_sha256` equals the loaded weights, so
metrics can never be attributed to the wrong model.

## Results

No trained weights are shipped with this repository, and no results are claimed. Train
the model (see [training.md](training.md)); the Model page then shows the real held-out
metrics for your weights.

## Known limitations

* Trained on one public dataset; performance on other populations, Fitzpatrick skin
  types, devices and clinical settings is unknown. HAM10000 is predominantly from
  lighter-skinned populations.
* Closed-set classifier: an image of any other lesion type (or not a lesion at all) is
  still assigned to one of the known classes. The uncertainty flags help but are not an
  out-of-distribution detector.
* Probabilities are calibrated on the validation split of the same dataset; calibration
  may not transfer to new data.
* Not a medical device, not clinically validated, and not intended for diagnosis.
