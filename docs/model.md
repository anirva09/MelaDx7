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

## Architecture: ViT-Base/16 (release model)

The release model is a Vision Transformer, **ViT-Base/16** (Dosovitskiy et al., 2021;
85.8 M parameters), fine-tuned on the lesion-grouped HAM10000 split from Google's public
ImageNet-21k weights (`google/vit-base-patch16-224-in21k`, Apache-2.0). The [CLS] token is
read through a `Dropout -> Linear(768, K)` head. It runs on CPU inside the API process.

| | ViT-Base/16 (release) | EfficientNet-B0 | ResNet-50 |
|---|---|---|---|
| Parameters (7-class head) | 85.8 M | 4.0 M | 23.5 M |
| Input | 224 px, mean/std 0.5 | 224 px, ImageNet stats | 224 px, ImageNet stats |
| Grad-CAM target | last block `layernorm_before` (14 x 14 patch grid) | `features.8` (7 x 7) | `layer4` (7 x 7) |

Every architecture lives in one registry (`ml/models/registry.py`) and is selected by the
model card, so a different backbone needs no API or UI change. EfficientNet-B0/B3 and
ResNet-18/50 configs are kept for comparison (`ml/configs/`).

**ViT Grad-CAM.** The classifier reads only the [CLS] token, so gradients reach the patch
tokens through the last block's attention. Grad-CAM is taken at that block's input, the
patch tokens are reshaped to a 14 x 14 grid and the usual gradient-weighted sum is applied.
The resulting maps are blocky (16 px patches) and are attributions of the model, not
evidence about the lesion.

**Experiment log.** An earlier EfficientNet-B0 run on the same split (Kaggle draft session)
reported accuracy 0.8304, balanced accuracy 0.7633, macro-F1 0.7173 and macro ROC-AUC 0.9566
on the same 1,675 test images. Its weights were not retained, so it is not part of the
release and those figures cannot be re-verified from an artifact.

## Preprocessing (version 1.0)

Recorded in every model card and re-applied from it at inference:

1. Decode with validation (magic bytes, integrity, pixel limit), apply EXIF orientation,
   convert to RGB (alpha flattened on white).
2. For uploads: re-encode as metadata-free JPEG (quality 95, long side <= 2048 px);
   inference runs on the re-decoded stored image.
3. Resize directly to `input_size x input_size` (bilinear, antialiased). No centre crop:
   lesions are not always centred, and a direct resize keeps Grad-CAM coordinates a pure
   rescale of the original image.
4. Normalise with the mean/std recorded in the model card (ImageNet statistics for the CNNs,
   0.5 / 0.5 for the ViT).

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
  "architecture": "vit_base_patch16_224",
  "display_name": "ViT-Base/16",
  "version": "1.0.0",
  "trained": true,
  "created_at": "...",
  "classes": [{ "index": 0, "code": "akiec", "name": "...", "group": "premalignant", "description": "..." }],
  "dataset": { "id": "HAM10000", "name": "...", "source": "...", "license": "CC BY-NC 4.0", "split_counts": {} },
  "preprocessing": { "version": "1.0", "input_size": 224, "mean": [0.5, 0.5, 0.5], "std": [0.5, 0.5, 0.5], "resize": "..." },
  "calibration": { "method": "temperature", "temperature": 0.702 },
  "explainability": { "method": "grad-cam", "target_layer": "backbone.encoder.layer.11.layernorm_before" },
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

Release model: **ViT-Base/16 v1.0.0**, evaluated once on the held-out, lesion-grouped test
split (1,675 images that were never used for training, checkpoint selection or
calibration). Every figure below is copied from `metrics.json` of the released artifact
(weights SHA-256 `62eaf9a7a67d11ac...`).

| Metric | Value |
|---|---|
| Accuracy | 0.8245 |
| Balanced accuracy | 0.7395 |
| Top-2 accuracy | 0.9319 |
| Macro precision / recall / F1 | 0.7433 / 0.7395 / 0.7352 |
| Weighted F1 | 0.8290 |
| Macro ROC-AUC (one-vs-rest) | 0.9188 |
| Calibration: ECE / NLL / Brier (after temperature scaling, T = 0.702) | 0.0829 / 0.6474 / 0.2796 |
| Malignant or pre-malignant classes combined vs. rest (akiec + bcc + mel, 329 positives): sensitivity / specificity at 0.5, ROC-AUC | 0.766 / 0.904, 0.918 |

| Class | Test images | Recall (sensitivity) | Precision | Specificity | F1 | ROC-AUC |
|---|---|---|---|---|---|---|
| akiec (Actinic keratosis / intraepithelial carcinoma) | 54 | 0.667 | 0.581 | 0.984 | 0.621 | 0.941 |
| bcc (Basal cell carcinoma) | 89 | 0.685 | 0.753 | 0.987 | 0.718 | 0.955 |
| bkl (Benign keratosis-like lesion) | 192 | 0.656 | 0.700 | 0.964 | 0.677 | 0.917 |
| df (Dermatofibroma) | 23 | 0.565 | 0.812 | 0.998 | 0.667 | 0.728 |
| mel (Melanoma) | 186 | 0.710 | 0.532 | 0.922 | 0.608 | 0.935 |
| nv (Melanocytic nevus) | 1106 | 0.893 | 0.932 | 0.874 | 0.912 | 0.955 |
| vasc (Vascular lesion) | 25 | 1.000 | 0.893 | 0.998 | 0.943 | 1.000 |

Training run: 12 epochs (early stopping, best epoch 8) on a
Kaggle GPU, about 22 minutes, seed 42, class-weighted loss. Fine-tuned from Google's
public ImageNet-21k ViT-Base/16 weights.

**How to read these numbers.**

* They are evaluation results on one public dataset, not guarantees about any individual
  image, patient or clinic.
* Melanoma recall is 0.71 but its precision is only 0.53: about half of the images
  the model calls melanoma are not, and 36 of 186 true melanomas were called
  nevus. 81 nevi were called melanoma.
* Dermatofibroma (23 images), vascular lesion (25) and akiec (54) have very few
  test images, so their per-class numbers are noisy.
* Probabilities are over-confident in the highest bin: among the 306 test images with
  confidence above 0.93, top-1 accuracy was 0.82.
* The gap between training accuracy (97.6% in the last epoch) and validation accuracy
  (82.6%) shows the model overfits; more data, stronger augmentation or ensembling would
  be the next steps.
* Latency, measured on the production Docker stack (CPU only, 8-core laptop, idle): analysing
  an image (prediction, Grad-CAM, storing) 1.1 to 2.0 s; Grad-CAM for another class 0.6 s; PDF
  report 0.4 s. Under heavy concurrency this grows several-fold (inference is limited by
  `MAX_CONCURRENT_INFERENCES`).
* Not clinically validated. Not a medical device. Outputs are never a diagnosis.

## Known limitations

* Trained on one public dataset; performance on other populations, Fitzpatrick skin
  types, devices and clinical settings is unknown. HAM10000 is predominantly from
  lighter-skinned populations. The weights inherit the dataset's **CC BY-NC 4.0**
  (non-commercial) terms.
* Closed-set classifier: an image of any other lesion type (or not a lesion at all) is
  still assigned to one of the known classes. The uncertainty flags help but are not an
  out-of-distribution detector.
* Probabilities are calibrated on the validation split of the same dataset; calibration
  may not transfer to new data.
* Not a medical device, not clinically validated, and not intended for diagnosis.
