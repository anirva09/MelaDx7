/**
 * API types mirroring the backend's Pydantic schemas (backend/app/schemas).
 * The UI never computes or invents model outputs; everything shown comes from these payloads.
 */

export type Role = "user" | "admin";

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  user: User;
}

export type ClassGroup = "malignant" | "premalignant" | "benign" | "other";

export interface ClassInfo {
  index: number;
  code: string;
  name: string;
  group: ClassGroup;
}

export interface ClassProbability extends ClassInfo {
  probability: number;
}

export interface ModelRef {
  id: string;
  architecture: string;
  display_name: string;
  version: string;
  trained: boolean;
  weights_sha256: string;
  dataset_id: string;
  preprocessing_version: string;
  input_size: number;
  gradcam_layer: string;
}

export type UncertaintyReason = "low_top_probability" | "small_margin_between_top_classes" | string;

export interface Uncertainty {
  uncertain: boolean;
  reasons: UncertaintyReason[];
  margin: number;
  normalized_entropy: number;
  low_confidence_threshold: number;
  low_margin_threshold: number;
}

export interface ConcernAggregate {
  probability: number;
  classes: string[];
  description: string;
}

export interface Explanation {
  status: "completed" | "failed" | "skipped";
  method: string;
  target_class: ClassInfo | null;
  layer: string | null;
  heatmap_url: string | null;
  overlay_url: string | null;
  cam_url: string | null;
  explain_ms: number | null;
  degenerate: boolean;
}

export interface Prediction {
  id: string | null;
  created_at: string | null;
  model: ModelRef;
  predicted_class: ClassInfo;
  confidence: number;
  probabilities: ClassProbability[];
  uncertainty: Uncertainty;
  concern: ConcernAggregate;
  temperature: number;
  timing: { inference_ms: number; explain_ms: number | null };
  explanation: Explanation | null;
}

export interface QualityWarning {
  code: string;
  message: string;
}

export interface Quality {
  width: number;
  height: number;
  mean_brightness: number;
  contrast: number;
  sharpness: number;
  warnings: QualityWarning[];
}

export interface ImageInfo {
  url: string;
  thumbnail_url: string;
  width: number;
  height: number;
  source_format: string;
  source_width: number;
  source_height: number;
  file_size: number;
  sha256: string;
}

export interface PredictionSummary {
  id: string;
  created_at: string;
  model_label: string;
  model_version_id: string;
  predicted_class: ClassInfo;
  confidence: number;
}

export interface AnalysisDetail {
  id: string;
  created_at: string;
  original_filename: string;
  image: ImageInfo;
  quality: Quality;
  prediction: Prediction;
  prediction_history: PredictionSummary[];
  produced_by_current_model: boolean;
  current_model_label: string | null;
}

export interface AnalysisListItem {
  id: string;
  created_at: string;
  original_filename: string;
  thumbnail_url: string;
  predicted_class: ClassInfo;
  confidence: number;
  uncertain: boolean;
  concern_probability: number;
  model_label: string;
  prediction_count: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface ClassExplanation {
  analysis_id: string;
  prediction_id: string;
  target_class: ClassInfo;
  probability: number;
  heatmap_url: string;
  overlay_url: string;
  cam_url: string;
  degenerate: boolean;
}

export type ModelStatus = "ready" | "untrained" | "unavailable";

export interface ModelClass extends ClassInfo {
  description: string;
}

export interface ModelInfo {
  status: ModelStatus;
  message: string;
  model_version_id: string | null;
  architecture: string | null;
  display_name: string | null;
  version: string | null;
  trained: boolean | null;
  weights_sha256: string | null;
  created_at: string | null;
  dataset: Record<string, unknown> | null;
  preprocessing: {
    version: string;
    input_size: number;
    mean: number[];
    std: number[];
    resize: string;
  } | null;
  calibration: { method: string; temperature: number } | null;
  explainability: { method: string; target_layer: string } | null;
  training: Record<string, unknown> | null;
  classes: ModelClass[];
  parameter_count: number | null;
  device: string | null;
  loaded_at: string | null;
  thresholds: { low_confidence?: number; low_margin?: number };
  notes: string | null;
}

export interface PerClassMetric {
  index: number;
  code: string;
  name: string;
  group: ClassGroup;
  support: number;
  precision: number | null;
  recall: number | null;
  specificity: number | null;
  f1: number | null;
  roc_auc: number | null;
}

export interface Curve {
  fpr: number[];
  tpr: number[];
}

export interface ReliabilityBin {
  bin_lower: number;
  bin_upper: number;
  confidence: number;
  accuracy: number;
  count: number;
}

export interface ClassificationMetrics {
  n_samples: number;
  accuracy: number | null;
  balanced_accuracy: number | null;
  top2_accuracy: number | null;
  macro: { precision: number | null; recall: number | null; f1: number | null };
  weighted: { precision: number | null; recall: number | null; f1: number | null };
  roc_auc_macro_ovr: number | null;
  per_class: PerClassMetric[];
  confusion_matrix: { labels: string[]; matrix: number[][] };
  roc_curves: Record<string, Curve>;
  calibration: {
    ece: number | null;
    nll: number | null;
    brier: number | null;
    reliability: ReliabilityBin[];
  };
  concern_screening: {
    description: string;
    classes: string[];
    positives: number;
    negatives: number;
    roc_auc: number | null;
    threshold: number;
    sensitivity: number | null;
    specificity: number | null;
    roc_curve: Curve | null;
  } | null;
}

export interface SamplePrediction {
  category: "confident_correct" | "misclassified" | "least_confident" | string;
  source_image: string;
  true_class: string;
  predicted_class: string;
  confidence: number;
  correct: boolean;
  original_url: string;
  overlay_url: string;
}

export interface EvaluationReport {
  split: string;
  evaluated_at: string;
  dataset_id: string;
  class_counts: Record<string, number>;
  temperature: number;
  metrics: ClassificationMetrics;
  uncalibrated: { ece?: number; nll?: number };
  samples: SamplePrediction[];
}

export interface TrainingEpoch {
  epoch: number;
  lr_head?: number;
  backbone_frozen?: boolean;
  train_loss: number;
  train_accuracy: number;
  val_loss: number;
  val_accuracy: number;
  val_balanced_accuracy: number;
  val_macro_f1: number;
  is_best?: boolean;
  epoch_seconds?: number;
}

export interface ModelMetrics {
  model_status: ModelStatus;
  evaluation_available: boolean;
  evaluation_unavailable_reason: string | null;
  evaluation: EvaluationReport | null;
  training_history: TrainingEpoch[];
  training_summary: Record<string, unknown> | null;
}

export interface ClassCount {
  code: string;
  name: string;
  count: number;
}

export interface HistogramBin {
  lower: number;
  upper: number;
  count: number;
}

export interface OverviewStats {
  total_analyses: number;
  analyses_last_7_days: number;
  average_confidence: number | null;
  uncertain_count: number;
  most_recent: {
    analysis_id: string;
    created_at: string;
    predicted_class: ClassInfo;
    confidence: number;
    uncertain: boolean;
  } | null;
  class_distribution: ClassCount[];
  confidence_histogram: HistogramBin[];
  activity: { date: string; count: number }[];
}

export interface InferenceStats {
  scope: "mine" | "all";
  model_version_id: string | null;
  model_label: string | null;
  predictions: number;
  average_confidence: number | null;
  uncertain_rate: number | null;
  average_inference_ms: number | null;
  average_explain_ms: number | null;
  gradcam_failures: number;
  class_distribution: ClassCount[];
  confidence_histogram: HistogramBin[];
}

export interface HealthStatus {
  status: "ok" | "degraded";
  version: string;
  environment: string;
  checks: Record<string, string>;
}

export interface AnalysisQuery {
  q?: string;
  predicted_class?: string;
  min_confidence?: number;
  max_confidence?: number;
  uncertain?: boolean;
  date_from?: string;
  date_to?: string;
  sort?: "created_at" | "confidence" | "predicted_class";
  order?: "asc" | "desc";
  page?: number;
  page_size?: number;
}
