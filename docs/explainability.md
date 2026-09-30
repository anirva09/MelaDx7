# Explainability

## Method: Grad-CAM

Gradient-weighted Class Activation Mapping (Selvaraju et al., ICCV 2017) explains a CNN
prediction for class `c` using the feature maps `A^k` of a convolutional layer:

```
alpha_k^c = (1 / Z) * sum_ij  d y^c / d A^k_ij        channel importance (global-average gradient)
L^c       = ReLU( sum_k alpha_k^c * A^k )               class activation map
```

`y^c` is the pre-softmax score (logit), so temperature scaling does not affect the map.
The map is upsampled bilinearly to the model input size, clipped at zero and divided by
its own maximum.

Implementation: `ml/explainability/gradcam.py`. It is written from scratch (no Grad-CAM
library) with a forward hook on the target layer and a tensor hook for its gradient. Hooks
are removed in a context manager, gradients are cleared afterwards, and the model's
parameters do not need `requires_grad` (the input tensor carries the graph).

| Architecture | Target layer | Map resolution |
|---|---|---|
| EfficientNet-B0 | `features.8` (final 1x1 conv block) | 7 x 7 |
| ResNet-50 / ResNet-18 | `layer4[-1]` | 7 x 7 |
| EfficientNet-B3 | `features.8` | 10 x 10 at 300 px |

## Correctness tests

`ml/tests/test_gradcam.py` includes a model with known evidence: class 0 responds to the
red channel, class 1 to green. With a red patch top-left and a green patch bottom-right,
the class-0 map must peak top-left and the class-1 map bottom-right (and vice versa near
zero). Further tests check value range, shape, hook removal, the degenerate (all-zero)
case, frozen parameters and every registered architecture.

## Pipeline in the application

1. Prediction runs first, without gradients. A Grad-CAM failure can never block or alter
   the prediction; it is recorded as `gradcam_status = "failed"`.
2. Grad-CAM runs a second forward/backward pass for the predicted class.
3. Three artefacts are stored per explanation:
   * `cam.png`: the raw normalised map, 8-bit grayscale at model input resolution;
   * `heatmap.png`: Turbo colour map at the image's resolution;
   * `overlay.jpg`: 45% blend with the original (used in reports).
4. Maps for other classes are generated on demand
   (`GET /api/analyses/{id}/explanations/{class}`) and cached. They are only generated
   with the exact model version that produced the analysis (otherwise `409`).

## Viewer

The browser loads `cam.png` and colourises it on a canvas:

* **Views:** overlay, heatmap only, original, side by side, and a draggable comparison.
* **Opacity** of the overlay (0-100%).
* **Hide below**: makes attribution under a fraction of the peak transparent.
* **Colour map:** Turbo (the conventional Grad-CAM palette; the JavaScript polynomial
  matches the Python one, verified by a unit test) or Ember, a single-hue, perceptually
  ordered ramp that avoids rainbow artefacts.
* **Zoom and pan** with buttons, drag, and keyboard (+, -, arrows, 0).
* **Download** of the current view as PNG.
* The viewer surround is always dark and neutral, in light and dark theme alike, so map
  colours read the same way.

## How to read the maps (and how not to)

The UI and reports state:

> The highlighted regions indicate areas that contributed strongly to the model's
> prediction. They are model-attribution visualizations and should not be interpreted as
> definitive clinical evidence.

Specifically:

* Maps are **relative within one image**. Because each map is scaled to its own maximum,
  the same colour in two images does not mean the same strength.
* Maps are **coarse**: a 7 x 7 grid upsampled to the image. They cannot outline lesion
  borders or fine dermoscopic structures.
* Maps show **where** evidence was found, not **why**, and do not establish causation.
* An **empty map** (all zero) means the class had no positive evidence anywhere; the UI
  says so instead of showing a misleading colour field.
* Maps are useful for **auditing** the model: attention on rulers, ink markings, hair,
  vignetting or the image border suggests shortcut learning and is worth reporting.

## Possible extensions

Grad-CAM++, Score-CAM or integrated gradients for comparison; sanity checks by weight
randomisation (Adebayo et al., 2018); quantitative localisation against lesion
segmentation masks (e.g. ISIC 2018 Task 1).
