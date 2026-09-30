/**
 * Test fixtures shaped exactly like backend responses.
 * These values exist only to exercise UI code paths in unit tests; they are never
 * shown to users and are not model outputs.
 */
import type { AnalysisDetail, ModelInfo, Prediction, User } from "@/api/types";

export const user: User = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "tester@example.org",
  full_name: "Test Researcher",
  role: "user",
  is_active: true,
  created_at: "2026-09-01T10:00:00Z",
  last_login_at: "2026-09-29T10:00:00Z",
};

const classes = [
  {
    index: 0,
    code: "akiec",
    name: "Actinic keratosis / intraepithelial carcinoma",
    group: "premalignant" as const,
  },
  { index: 1, code: "bcc", name: "Basal cell carcinoma", group: "malignant" as const },
  { index: 2, code: "bkl", name: "Benign keratosis-like lesion", group: "benign" as const },
  { index: 3, code: "df", name: "Dermatofibroma", group: "benign" as const },
  { index: 4, code: "mel", name: "Melanoma", group: "malignant" as const },
  { index: 5, code: "nv", name: "Melanocytic nevus", group: "benign" as const },
  { index: 6, code: "vasc", name: "Vascular lesion", group: "benign" as const },
];

const probs = [0.02, 0.03, 0.05, 0.01, 0.21, 0.66, 0.02];

export function makePrediction(overrides: Partial<Prediction> = {}): Prediction {
  const probabilities = classes
    .map((c) => ({ ...c, probability: probs[c.index]! }))
    .sort((a, b) => b.probability - a.probability);
  return {
    id: "22222222-2222-2222-2222-222222222222",
    created_at: "2026-09-29T12:00:00Z",
    model: {
      id: "33333333-3333-3333-3333-333333333333",
      architecture: "efficientnet_b0",
      display_name: "EfficientNet-B0",
      version: "1.0.0",
      trained: true,
      weights_sha256: "a".repeat(64),
      dataset_id: "HAM10000",
      preprocessing_version: "1.0",
      input_size: 224,
      gradcam_layer: "features.8",
    },
    predicted_class: classes[5]!,
    confidence: 0.66,
    probabilities,
    uncertainty: {
      uncertain: false,
      reasons: [],
      margin: 0.45,
      normalized_entropy: 0.52,
      low_confidence_threshold: 0.6,
      low_margin_threshold: 0.15,
    },
    concern: { probability: 0.26, classes: ["akiec", "bcc", "mel"], description: "" },
    temperature: 1.21,
    timing: { inference_ms: 48.2, explain_ms: 120.5 },
    explanation: {
      status: "completed",
      method: "grad-cam",
      target_class: classes[5]!,
      layer: "features.8",
      heatmap_url: "/api/files/heatmap-token",
      overlay_url: "/api/files/overlay-token",
      cam_url: "/api/files/cam-token",
      explain_ms: 120.5,
      degenerate: false,
    },
    ...overrides,
  };
}

export function makeAnalysis(overrides: Partial<AnalysisDetail> = {}): AnalysisDetail {
  const prediction = makePrediction();
  return {
    id: "44444444-4444-4444-4444-444444444444",
    created_at: "2026-09-29T12:00:00Z",
    original_filename: "case-001.jpg",
    image: {
      url: "/api/files/original-token",
      thumbnail_url: "/api/files/thumb-token",
      width: 600,
      height: 450,
      source_format: "JPEG",
      source_width: 600,
      source_height: 450,
      file_size: 48000,
      sha256: "b".repeat(64),
    },
    quality: { width: 600, height: 450, mean_brightness: 0.5, contrast: 0.2, sharpness: 80, warnings: [] },
    prediction,
    prediction_history: [
      {
        id: prediction.id!,
        created_at: prediction.created_at!,
        model_label: "EfficientNet-B0 v1.0.0",
        model_version_id: prediction.model.id,
        predicted_class: prediction.predicted_class,
        confidence: prediction.confidence,
      },
    ],
    produced_by_current_model: true,
    current_model_label: "EfficientNet-B0 v1.0.0",
    ...overrides,
  };
}

export const modelInfo: ModelInfo = {
  status: "ready",
  message: "EfficientNet-B0 v1.0.0 is loaded.",
  model_version_id: "33333333-3333-3333-3333-333333333333",
  architecture: "efficientnet_b0",
  display_name: "EfficientNet-B0",
  version: "1.0.0",
  trained: true,
  weights_sha256: "a".repeat(64),
  created_at: "2026-09-20T10:00:00Z",
  dataset: { id: "HAM10000" },
  preprocessing: {
    version: "1.0",
    input_size: 224,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
    resize: "direct",
  },
  calibration: { method: "temperature", temperature: 1.21 },
  explainability: { method: "grad-cam", target_layer: "features.8" },
  training: {},
  classes: classes.map((c) => ({ ...c, description: "" })),
  parameter_count: 4016515,
  device: "cpu",
  loaded_at: "2026-09-29T10:00:00Z",
  thresholds: { low_confidence: 0.6, low_margin: 0.15 },
  notes: null,
};
