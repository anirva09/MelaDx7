/**
 * Copy that must appear consistently wherever model output is shown.
 * Keeping it in one place guarantees the disclaimer never drifts between screens.
 */

export const MEDICAL_DISCLAIMER =
  "This AI system provides an assistive prediction and visualization. It is not a medical diagnosis and should not replace evaluation by a qualified healthcare professional.";

export const GRADCAM_NOTE =
  "The highlighted regions indicate areas that contributed strongly to the model's prediction. They are model-attribution visualizations and should not be interpreted as definitive clinical evidence.";

export const UNTRAINED_WARNING =
  "The loaded model is an untrained pipeline-verification artifact. Its predictions and heatmaps are meaningless. Train a model before interpreting any output.";

export const GROUP_LABEL: Record<string, string> = {
  malignant: "Malignant class",
  premalignant: "Pre-malignant class",
  benign: "Benign class",
  other: "Other",
};

export const UNCERTAINTY_TEXT: Record<string, (t: { conf: number; margin: number }) => string> = {
  low_top_probability: ({ conf }) => `The top class has less than ${Math.round(conf * 100)}% probability.`,
  small_margin_between_top_classes: ({ margin }) =>
    `The two most likely classes are within ${Math.round(margin * 100)} percentage points of each other.`,
};

export const QUALITY_TITLE: Record<string, string> = {
  low_resolution: "Low resolution",
  underexposed: "Underexposed",
  overexposed: "Overexposed",
  low_contrast: "Low contrast",
  possibly_blurred: "Possibly out of focus",
};
