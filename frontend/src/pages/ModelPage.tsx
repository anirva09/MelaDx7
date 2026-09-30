import { Cpu, FlaskConical, Terminal } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { useInferenceStats, useModelInfo, useModelMetrics } from "@/api/queries";
import type { EvaluationReport, ModelInfo, SamplePrediction } from "@/api/types";
import { ConfusionMatrix } from "@/components/charts/ConfusionMatrix";
import { CountBars } from "@/components/charts/CountBars";
import { HistogramChart } from "@/components/charts/HistogramChart";
import { ReliabilityChart } from "@/components/charts/ReliabilityChart";
import { RocChart } from "@/components/charts/RocChart";
import { TrainingCurves } from "@/components/charts/TrainingCurves";
import { ClassGroupBadge } from "@/components/ClassGroupBadge";
import { MetricCard } from "@/components/MetricCard";
import { ModelAvailabilityNotice } from "@/components/ModelAvailabilityNotice";
import { Notice } from "@/components/Notice";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { BackButton, MobileTopBar } from "@/components/shell/MobileTopBar";
import { DefinitionList } from "@/components/ui/definition-list";
import { DesktopHeader, Page, PageTitle } from "@/components/ui/page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useAuth } from "@/context/AuthContext";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { cn, formatDateTime, formatMs, formatNumber, formatPercent, titleCase } from "@/lib/utils";

function Command({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-[12px] bg-stage px-3 py-2.5 font-mono text-xs leading-relaxed text-white/85">
      <code>{children}</code>
    </pre>
  );
}

function SetupSteps() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="size-5 text-accent" strokeWidth={1.5} aria-hidden /> Train and load a model
        </CardTitle>
        <CardDescription>
          Run from the repository root. See docs/training.md for dataset download, GPU notes and a
          Kaggle/Colab workflow.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-md text-ink-2">
        <p>1. Prepare HAM10000 with a lesion-grouped split (no lesion appears in two splits):</p>
        <Command>{`python -m ml.datasets.prepare_ham10000 \\
  --metadata data/raw/HAM10000_metadata.csv \\
  --images data/raw/HAM10000_images_part_1 data/raw/HAM10000_images_part_2 \\
  --output data/processed`}</Command>
        <p>2. Train (writes weights, model card, history and held-out metrics):</p>
        <Command>{"python -m ml.training.train --config ml/configs/efficientnet_b0.yaml"}</Command>
        <p>3. Point the API at the artifact and reload:</p>
        <Command>{"MODEL_PATH=models/efficientnet_b0-v1.0.0"}</Command>
      </CardContent>
    </Card>
  );
}

function Definition({ rows }: { rows: [string, ReactNode][] }) {
  return <DefinitionList rows={rows.map(([label, value]) => [label, value ?? "n/a"])} />;
}

function str(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function ModelCardTab({ info }: { info: ModelInfo }) {
  const dataset = info.dataset ?? {};
  const training = info.training ?? {};
  const best = (training.best_validation ?? {}) as Record<string, number>;
  const source = str(dataset.source);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Model</CardTitle>
          </CardHeader>
          <CardContent>
            <Definition
              rows={[
                ["Architecture", info.display_name],
                ["Version", info.version],
                [
                  "Status",
                  info.trained ? <Badge tone="good">Trained</Badge> : <Badge tone="danger">Untrained</Badge>,
                ],
                ["Created", formatDateTime(info.created_at)],
                ["Parameters", info.parameter_count?.toLocaleString()],
                ["Device", info.device],
                [
                  "Weights SHA-256",
                  <span className="break-all font-mono text-xs">{info.weights_sha256}</span>,
                ],
                ["Loaded", formatDateTime(info.loaded_at)],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <Definition
              rows={[
                [
                  "Preprocessing",
                  info.preprocessing &&
                    `v${info.preprocessing.version}, ${info.preprocessing.input_size}×${info.preprocessing.input_size} px`,
                ],
                ["Resize", info.preprocessing?.resize],
                [
                  "Normalisation",
                  info.preprocessing &&
                    `mean ${info.preprocessing.mean.map((v) => v.toFixed(3)).join(", ")}; std ${info.preprocessing.std.map((v) => v.toFixed(3)).join(", ")}`,
                ],
                [
                  "Calibration",
                  info.calibration &&
                    `${titleCase(info.calibration.method)} scaling, T = ${info.calibration.temperature.toFixed(3)}`,
                ],
                [
                  "Explanation",
                  info.explainability &&
                    `${info.explainability.method === "grad-cam" ? "Grad-CAM" : info.explainability.method} at layer ${info.explainability.target_layer}`,
                ],
                [
                  "Uncertain if",
                  `top probability < ${formatPercent(info.thresholds.low_confidence, 0)} or margin < ${formatPercent(info.thresholds.low_margin, 0)}`,
                ],
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Training data</CardTitle>
          </CardHeader>
          <CardContent>
            <Definition
              rows={[
                ["Dataset", info.trained ? (str(dataset.name) ?? str(dataset.id)) : "None (untrained model)"],
                ["Class set", str(dataset.id)],
                [
                  "Source",
                  source && /^https?:\/\//.test(source) ? (
                    <a
                      href={source}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent underline-offset-2 hover:underline"
                    >
                      {source}
                    </a>
                  ) : (
                    source
                  ),
                ],
                ["License", str(dataset.license)],
                ["Split strategy", str(dataset.split_strategy)],
                ["Citation", str(dataset.citation)],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Training run</CardTitle>
          </CardHeader>
          <CardContent>
            {info.trained ? (
              <Definition
                rows={[
                  ["Epochs completed", str(training.epochs_completed)],
                  ["Best epoch", str(training.best_epoch)],
                  ["Selection metric", str(training.monitor)],
                  [
                    "Best validation macro F1",
                    best.val_macro_f1 !== undefined ? formatPercent(best.val_macro_f1) : null,
                  ],
                  [
                    "Stopped early",
                    training.stopped_early === undefined ? null : training.stopped_early ? "Yes" : "No",
                  ],
                  ["Class imbalance", str(training.imbalance_strategy)],
                  ["Seed", str(training.seed)],
                  ["Finished", formatDateTime(str(training.finished_at))],
                ]}
              />
            ) : (
              <p className="text-md text-muted">This artifact has not been trained.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Classes</CardTitle>
          <CardDescription>Output classes in logit order, as recorded in the model card.</CardDescription>
        </CardHeader>
        <ul className="mt-2 flex flex-col px-4 pb-2 lg:hidden" aria-label="Classes">
          {info.classes.map((c, i) => (
            <li key={c.code} className={cn("flex flex-col gap-1.5 py-3", i > 0 && "border-t border-line")}>
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-base font-medium tracking-ref text-ink">{c.name}</span>
                <span className="font-mono text-xs text-muted">{c.code}</span>
              </span>
              <ClassGroupBadge group={c.group} className="self-start" />
              {c.description && <span className="text-md text-ink-2">{c.description}</span>}
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto lg:block">
          <table className="mt-3 w-full text-left text-md">
            <thead className="border-y border-line text-sm text-muted">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">
                  Code
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Name
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Group
                </th>
                <th scope="col" className="px-5 py-2 font-medium">
                  Description
                </th>
              </tr>
            </thead>
            <tbody>
              {info.classes.map((c) => (
                <tr key={c.code} className="border-b border-line last:border-0">
                  <td className="px-5 py-2.5 font-mono text-xs text-ink-2">{c.code}</td>
                  <td className="px-3 py-2.5 text-ink">{c.name}</td>
                  <td className="px-3 py-2.5">
                    <ClassGroupBadge group={c.group} />
                  </td>
                  <td className="max-w-xl px-5 py-2.5 text-sm text-muted">{c.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function SampleCard({ sample }: { sample: SamplePrediction }) {
  const [showOverlay, setShowOverlay] = useState(true);
  return (
    <figure className="overflow-hidden rounded-lg bg-surface-2">
      <button
        type="button"
        onClick={() => setShowOverlay((v) => !v)}
        className="block w-full bg-stage"
        aria-label={showOverlay ? "Show original image" : "Show Grad-CAM overlay"}
      >
        <img
          src={showOverlay ? sample.overlay_url : sample.original_url}
          alt={`Test set sample ${sample.source_image}`}
          loading="lazy"
          className="aspect-square w-full object-cover"
        />
      </button>
      <figcaption className="flex flex-col gap-1 p-3 text-xs">
        <span className="flex items-center justify-between gap-2">
          <span className="font-mono text-muted">{sample.source_image}</span>
          <Badge tone={sample.correct ? "good" : "danger"}>
            {sample.correct ? "Correct" : "Misclassified"}
          </Badge>
        </span>
        <span className="text-ink-2">
          True <span className="font-mono text-ink">{sample.true_class}</span>, predicted{" "}
          <span className="font-mono text-ink">{sample.predicted_class}</span>{" "}
          <span className="tabular">({formatPercent(sample.confidence)})</span>
        </span>
        <span className="text-muted">{titleCase(sample.category)}</span>
      </figcaption>
    </figure>
  );
}

function EvaluationView({ report, info }: { report: EvaluationReport; info: ModelInfo }) {
  const m = report.metrics;
  const names = useMemo(() => Object.fromEntries(info.classes.map((c) => [c.code, c.name])), [info.classes]);
  const rocCodes = Object.keys(m.roc_curves);
  const [rocClass, setRocClass] = useState(rocCodes.includes("mel") ? "mel" : (rocCodes[0] ?? ""));
  const aucs = Object.fromEntries(m.per_class.map((row) => [row.code, row.roc_auc]));

  return (
    <div className="flex flex-col gap-4">
      <Notice tone="info" title="Held-out test set, computed offline">
        {m.n_samples.toLocaleString()} {report.dataset_id} images from the <b>{report.split}</b> split, never
        used for training or model selection. Evaluated {formatDateTime(report.evaluated_at)} by{" "}
        <code>ml.evaluation</code> for these exact weights.
      </Notice>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Accuracy" value={formatPercent(m.accuracy)} />
        <MetricCard
          label="Balanced accuracy"
          value={formatPercent(m.balanced_accuracy)}
          hint="Mean per-class recall"
        />
        <MetricCard label="Macro F1" value={formatPercent(m.macro.f1)} />
        <MetricCard label="Macro ROC-AUC" value={formatNumber(m.roc_auc_macro_ovr)} hint="One-vs-rest" />
        <MetricCard label="Top-2 accuracy" value={formatPercent(m.top2_accuracy)} />
        <MetricCard
          label="Calibration error"
          value={formatNumber(m.calibration.ece)}
          hint={
            report.uncalibrated.ece !== undefined
              ? `ECE; ${formatNumber(report.uncalibrated.ece)} before scaling`
              : "ECE"
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Per-class performance</CardTitle>
          <CardDescription>Sensitivity is recall. Specificity and AUC are one-vs-rest.</CardDescription>
        </CardHeader>
        <ul className="mt-2 flex flex-col px-4 pb-2 lg:hidden" aria-label="Per-class performance">
          {m.per_class.map((row, i) => (
            <li key={row.code} className={cn("py-3", i > 0 && "border-t border-line")}>
              <p className="flex items-baseline justify-between gap-2">
                <span className="text-base font-medium tracking-ref text-ink">
                  {row.name} <span className="font-mono text-xs text-muted">{row.code}</span>
                </span>
                <span className="tabular text-xs text-muted">n = {row.support}</span>
              </p>
              <dl className="tabular mt-2 grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-5">
                {(
                  [
                    ["Precision", formatPercent(row.precision)],
                    ["Sensitivity", formatPercent(row.recall)],
                    ["Specificity", formatPercent(row.specificity)],
                    ["F1", formatPercent(row.f1)],
                    ["ROC-AUC", formatNumber(row.roc_auc)],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="text-md text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
        <div className="mt-3 hidden overflow-x-auto lg:block">
          <table className="w-full text-left text-md">
            <thead className="border-y border-line text-sm text-muted">
              <tr>
                {["Class", "Support", "Precision", "Sensitivity", "Specificity", "F1", "ROC-AUC"].map(
                  (h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={cn(
                        "px-3 py-2 font-medium",
                        i === 0 ? "pl-5" : "text-right",
                        i === 6 && "pr-5",
                      )}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="tabular">
              {m.per_class.map((row) => (
                <tr key={row.code} className="border-b border-line last:border-0">
                  <th scope="row" className="py-2.5 pl-5 pr-3 font-normal text-ink">
                    {row.name} <span className="font-mono text-xs text-muted">{row.code}</span>
                  </th>
                  <td className="px-3 text-right text-ink-2">{row.support}</td>
                  <td className="px-3 text-right">{formatPercent(row.precision)}</td>
                  <td className="px-3 text-right">{formatPercent(row.recall)}</td>
                  <td className="px-3 text-right">{formatPercent(row.specificity)}</td>
                  <td className="px-3 text-right">{formatPercent(row.f1)}</td>
                  <td className="py-2.5 pl-3 pr-5 text-right">{formatNumber(row.roc_auc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Confusion matrix</CardTitle>
          </CardHeader>
          <CardContent>
            <ConfusionMatrix
              labels={m.confusion_matrix.labels}
              matrix={m.confusion_matrix.matrix}
              names={names}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>ROC curves</CardTitle>
              <CardDescription>One class highlighted at a time</CardDescription>
            </div>
            <label>
              <span className="sr-only">Class to highlight</span>
              <NativeSelect
                value={rocClass}
                onChange={(e) => setRocClass(e.target.value)}
                className="w-full sm:w-44 [&_select]:h-10"
              >
                {rocCodes.map((code) => (
                  <option key={code} value={code}>
                    {names[code] ?? code}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </CardHeader>
          <CardContent>
            {rocCodes.length ? (
              <RocChart curves={m.roc_curves} selected={rocClass} aucs={aucs} />
            ) : (
              <p className="text-md text-muted">Not enough classes present to draw ROC curves.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Reliability</CardTitle>
            <CardDescription>
              Calibrated probabilities (T = {report.temperature.toFixed(3)}). NLL{" "}
              {formatNumber(m.calibration.nll)}, Brier {formatNumber(m.calibration.brier)}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReliabilityChart bins={m.calibration.reliability} />
          </CardContent>
        </Card>
        {m.concern_screening && (
          <Card>
            <CardHeader>
              <CardTitle>Malignant or pre-malignant vs. other</CardTitle>
              <CardDescription>
                Derived binary task: probabilities of {m.concern_screening.classes.join(", ")} summed.
                Positives {m.concern_screening.positives}, negatives {m.concern_screening.negatives}.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3">
              <MetricCard label="ROC-AUC" value={formatNumber(m.concern_screening.roc_auc)} />
              <MetricCard
                label="Sensitivity"
                value={formatPercent(m.concern_screening.sensitivity)}
                hint="at 0.5"
              />
              <MetricCard
                label="Specificity"
                value={formatPercent(m.concern_screening.specificity)}
                hint="at 0.5"
              />
              <p className="col-span-3 text-xs text-muted">
                An offline research metric. The threshold was not tuned for clinical use.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {report.samples.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Sample test predictions</CardTitle>
            <CardDescription>
              Confident correct, misclassified and least confident examples with Grad-CAM overlays. Select an
              image to toggle the overlay.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {report.samples.map((sample) => (
              <SampleCard key={sample.overlay_url} sample={sample} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function InferenceView() {
  const { user } = useAuth();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const stats = useInferenceStats(scope);
  const data = stats.data;
  return (
    <div className="flex flex-col gap-4">
      <Notice tone="info" title="Real inference results, not accuracy">
        Statistics of predictions made in this application by the loaded model version. Uploaded images have
        no ground-truth labels, so these numbers describe how the model behaves in use. They do not measure
        how often it is right.
      </Notice>
      {user?.role === "admin" && (
        <Segmented
          size="sm"
          label="Scope"
          value={scope}
          onValueChange={setScope}
          className="self-start"
          options={[
            { value: "mine", label: "My analyses" },
            { value: "all", label: "All users" },
          ]}
        />
      )}
      {stats.isError ? (
        <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
      ) : !data ? (
        <LoadingState />
      ) : data.predictions === 0 ? (
        <EmptyState
          icon={<Cpu />}
          title="No predictions from this model version yet"
          description="Run an analysis to see how the loaded model behaves on your images."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard
              label="Predictions"
              value={data.predictions.toLocaleString()}
              hint={data.model_label ?? undefined}
            />
            <MetricCard label="Average top probability" value={formatPercent(data.average_confidence)} />
            <MetricCard label="Flagged uncertain" value={formatPercent(data.uncertain_rate)} />
            <MetricCard
              label="Inference time"
              value={formatMs(data.average_inference_ms)}
              hint="Mean, CNN forward pass"
            />
            <MetricCard label="Grad-CAM time" value={formatMs(data.average_explain_ms)} hint="Mean" />
            <MetricCard label="Grad-CAM failures" value={data.gradcam_failures.toLocaleString()} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Predicted classes</CardTitle>
              </CardHeader>
              <CardContent>
                <CountBars items={data.class_distribution} total={data.predictions} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Top-class probability</CardTitle>
              </CardHeader>
              <CardContent>
                <HistogramChart bins={data.confidence_histogram} label="Predictions" />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

const TABS = ["card", "evaluation", "training", "inference"] as const;
type Tab = (typeof TABS)[number];

export function ModelPage() {
  useDocumentTitle("Model");
  const desktop = useIsDesktop();
  const info = useModelInfo();
  const metrics = useModelMetrics();
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : "card";

  const chrome = !desktop && <MobileTopBar left={<BackButton fallback="/app/profile" />} />;
  if (info.isPending)
    return (
      <>
        {chrome}
        <Page>
          <LoadingState label="Loading model information" />
        </Page>
      </>
    );
  if (info.isError)
    return (
      <>
        {chrome}
        <Page>
          <ErrorState error={info.error} onRetry={() => void info.refetch()} />
        </Page>
      </>
    );
  const model = info.data;
  const title = model.status === "unavailable" ? "Model" : `${model.display_name} v${model.version}`;
  const description =
    "The model card, its held-out evaluation, the training run, and how the model behaves in this application.";

  return (
    <>
      {chrome}
      <Page>
        {desktop ? (
          <DesktopHeader title={title} subtitle={description} />
        ) : (
          <div>
            <PageTitle>{title}</PageTitle>
            <p className="mt-1.5 text-md text-subtle">{description}</p>
          </div>
        )}
        <ModelAvailabilityNotice info={model} />

        {model.status === "unavailable" ? (
          <SetupSteps />
        ) : (
          <Tabs
            value={tab}
            onValueChange={(value) => {
              const next = new URLSearchParams(params);
              if (value === "card") next.delete("tab");
              else next.set("tab", value);
              setParams(next, { replace: true });
            }}
          >
            <TabsList aria-label="Model information" className="-mx-4 px-4 lg:mx-0 lg:px-0">
              <TabsTrigger value="card">Model card</TabsTrigger>
              <TabsTrigger value="evaluation">Held-out evaluation</TabsTrigger>
              <TabsTrigger value="training">Training metrics</TabsTrigger>
              <TabsTrigger value="inference">Real inference results</TabsTrigger>
            </TabsList>
            <TabsContent value="card">
              <ModelCardTab info={model} />
            </TabsContent>
            <TabsContent value="evaluation">
              {metrics.isPending ? (
                <LoadingState />
              ) : metrics.isError ? (
                <ErrorState error={metrics.error} onRetry={() => void metrics.refetch()} />
              ) : metrics.data.evaluation ? (
                <EvaluationView report={metrics.data.evaluation} info={model} />
              ) : (
                <div className="flex flex-col gap-4">
                  <EmptyState
                    icon={<FlaskConical strokeWidth={1.5} />}
                    title="No evaluation results for this model"
                    description={metrics.data.evaluation_unavailable_reason}
                    className="border-none bg-surface"
                  />
                  {!model.trained && <SetupSteps />}
                </div>
              )}
            </TabsContent>
            <TabsContent value="training">
              {metrics.data?.training_history.length ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Training curves</CardTitle>
                    <CardDescription>
                      Per-epoch metrics from the training run. Validation data was used for model selection;
                      see the held-out tab for unbiased estimates.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <TrainingCurves history={metrics.data.training_history} />
                  </CardContent>
                </Card>
              ) : (
                <EmptyState
                  icon={<FlaskConical strokeWidth={1.5} />}
                  title="No training history"
                  description={
                    model.trained
                      ? "history.jsonl was not found next to the model weights."
                      : "This model has not been trained."
                  }
                  className="border-none bg-surface"
                />
              )}
            </TabsContent>
            <TabsContent value="inference">
              <InferenceView />
            </TabsContent>
          </Tabs>
        )}
      </Page>
    </>
  );
}
