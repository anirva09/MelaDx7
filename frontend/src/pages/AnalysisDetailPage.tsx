import { ArrowLeft, Copy, FileDown, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { ApiError } from "@/api/client";
import { analysisApi } from "@/api/endpoints";
import {
  useAnalysis,
  useClassExplanation,
  useDeleteAnalysis,
  useModelInfo,
  useRerunAnalysis,
} from "@/api/queries";
import type { AnalysisDetail } from "@/api/types";
import { ConfidenceChart } from "@/components/ConfidenceChart";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { GradCAMViewer } from "@/components/GradCAMViewer";
import { ModelInfoCard } from "@/components/ModelInfoCard";
import { Notice } from "@/components/Notice";
import { PredictionCard } from "@/components/PredictionCard";
import { ErrorState } from "@/components/States";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { GRADCAM_NOTE, QUALITY_TITLE, UNTRAINED_WARNING } from "@/lib/copy";
import { errorMessage, formatBytes, formatDateTime, formatPercent, shortHash } from "@/lib/utils";

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => toast.success(`${label} copied`),
          () => toast.error("Copy failed"),
        );
      }}
      className="inline-flex size-6 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-ink"
      aria-label={`Copy ${label}`}
    >
      <Copy className="size-3.5" aria-hidden />
    </button>
  );
}

function RecordCard({ detail }: { detail: AnalysisDetail }) {
  const utc = new Date(detail.created_at).toISOString().replace("T", " ").slice(0, 19);
  const rows: [string, React.ReactNode][] = [
    [
      "Analysis ID",
      <span key="id" className="flex items-center gap-1">
        <span className="break-all font-mono text-xs">{detail.id}</span>
        <CopyButton value={detail.id} label="Analysis ID" />
      </span>,
    ],
    [
      "Analysis timestamp",
      <span key="ts">
        {formatDateTime(detail.created_at)} <span className="text-muted">({utc} UTC)</span>
      </span>,
    ],
    [
      "Stored image",
      `${detail.image.width}×${detail.image.height} px JPEG, ${formatBytes(detail.image.file_size)}`,
    ],
    [
      "Uploaded as",
      `${detail.image.source_format}, ${detail.image.source_width}×${detail.image.source_height} px`,
    ],
    [
      "Image SHA-256",
      <span key="sha" className="flex items-center gap-1">
        <span className="font-mono text-xs" title={detail.image.sha256}>
          {shortHash(detail.image.sha256, 16)}…
        </span>
        <CopyButton value={detail.image.sha256} label="Image hash" />
      </span>,
    ],
    [
      "Image quality",
      detail.quality.warnings.length
        ? detail.quality.warnings.map((w) => QUALITY_TITLE[w.code] ?? w.code).join(", ")
        : "No issues detected by heuristic checks",
    ],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Analysis record</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd className="min-w-0 text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading analysis">
      <Skeleton className="h-8 w-72" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Skeleton className="h-[480px] rounded-lg" />
        <Skeleton className="h-[480px] rounded-lg" />
      </div>
    </div>
  );
}

export function AnalysisDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const analysis = useAnalysis(id);
  const model = useModelInfo();
  const detail = analysis.data;
  useDocumentTitle(
    detail ? `${detail.prediction.predicted_class.name} – ${detail.original_filename}` : "Analysis",
  );

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const remove = useDeleteAnalysis();
  const rerun = useRerunAnalysis();

  const predictedCode = detail?.prediction.predicted_class.code ?? null;
  const explainCode = selectedCode && selectedCode !== predictedCode ? selectedCode : null;
  const classExplanation = useClassExplanation(id, detail?.produced_by_current_model ? explainCode : null);

  const refetch = analysis.refetch;
  const onImageError = useCallback(() => void refetch(), [refetch]);

  if (analysis.isPending) return <DetailSkeleton />;
  if (analysis.isError || !detail) {
    const notFound = analysis.error instanceof ApiError && analysis.error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        <Link to="/app/analyses" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> History
        </Link>
        <ErrorState
          title={notFound ? "Analysis not found" : "The analysis could not be loaded"}
          error={analysis.error}
          onRetry={notFound ? undefined : () => void analysis.refetch()}
        />
      </div>
    );
  }

  const { prediction } = detail;
  const explanation = prediction.explanation;
  const viewing = explainCode
    ? prediction.probabilities.find((p) => p.code === explainCode)
    : prediction.probabilities.find((p) => p.code === predictedCode);
  const classView = explainCode && classExplanation.data ? classExplanation.data : null;
  const camUrl = classView ? classView.cam_url : explainCode ? null : explanation?.cam_url;
  const heatmapUrl = classView ? classView.heatmap_url : explainCode ? null : explanation?.heatmap_url;
  const degenerate = classView ? classView.degenerate : (explanation?.degenerate ?? false);
  const canRerun = !detail.produced_by_current_model && model.data?.status !== "unavailable";

  const downloadReport = async () => {
    setDownloading(true);
    try {
      await analysisApi.downloadReport(detail.id);
    } catch (error) {
      toast.error("The report could not be generated", { description: errorMessage(error) });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/app/analyses" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> History
        </Link>
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold text-ink" title={detail.original_filename}>
              {detail.original_filename}
            </h1>
            <p className="mt-1 text-sm text-muted">
              Analysed {formatDateTime(detail.created_at)} with {prediction.model.display_name} v
              {prediction.model.version}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void downloadReport()} loading={downloading}>
              <FileDown aria-hidden /> Download report
            </Button>
            {canRerun && (
              <Button
                variant="secondary"
                loading={rerun.isPending}
                onClick={() =>
                  rerun.mutate(detail.id, {
                    onSuccess: () => {
                      setSelectedCode(null);
                      toast.success("Re-analysed with the current model");
                    },
                    onError: (error) =>
                      toast.error("Re-analysis failed", { description: errorMessage(error) }),
                  })
                }
              >
                <RefreshCw aria-hidden /> Re-run with current model
              </Button>
            )}
            <Button variant="danger-ghost" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden /> Delete
            </Button>
          </div>
        </div>
      </div>

      {!prediction.model.trained && (
        <Notice tone="danger" title="Produced by an untrained model">
          {UNTRAINED_WARNING}
        </Notice>
      )}
      {!detail.produced_by_current_model && (
        <Notice tone="info" title="Produced by an earlier model version">
          This result comes from {prediction.model.display_name} v{prediction.model.version}.
          {detail.current_model_label
            ? ` The loaded model is ${detail.current_model_label}. Re-run to compare; both results are kept.`
            : " No model is currently loaded."}
        </Notice>
      )}
      {detail.quality.warnings.length > 0 && (
        <Notice tone="caution" title="Image quality checks">
          <ul className="list-disc pl-4">
            {detail.quality.warnings.map((w) => (
              <li key={w.code}>{w.message}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs">
            Heuristic checks. The prediction may be less reliable for this image.
          </p>
        </Notice>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <GradCAMViewer
            imageUrl={detail.image.url}
            camUrl={camUrl}
            heatmapUrl={heatmapUrl}
            targetLabel={viewing?.name ?? null}
            degenerate={degenerate}
            onImageError={onImageError}
            downloadName={`lesionlens-${detail.id.slice(0, 8)}-${viewing?.code ?? "image"}.png`}
          />
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-ink">
              Showing attribution for <span className="font-medium">{viewing?.name}</span>
              <span className="tabular text-muted"> ({formatPercent(viewing?.probability)})</span>
              {explainCode && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="text-accent underline-offset-2 hover:underline"
                    onClick={() => setSelectedCode(null)}
                  >
                    back to predicted class
                  </button>
                </>
              )}
            </p>
            {explainCode && classExplanation.isFetching && (
              <p className="text-xs text-muted" role="status">
                Computing Grad-CAM for this class
              </p>
            )}
            {explainCode && !detail.produced_by_current_model && (
              <p className="text-xs text-caution">
                Explanations for other classes need the model version that produced this result. Re-run the
                analysis with the current model first.
              </p>
            )}
            {classExplanation.isError && (
              <p className="text-xs text-danger" role="alert">
                {errorMessage(classExplanation.error)}
              </p>
            )}
            {explanation?.status === "failed" && !explainCode && (
              <p className="text-xs text-danger" role="alert">
                Grad-CAM generation failed for this analysis. The prediction itself is unaffected.
              </p>
            )}
            <p className="text-xs leading-relaxed text-muted">{GRADCAM_NOTE}</p>
          </div>
        </div>

        <Card className="lg:sticky lg:top-24">
          <CardContent className="flex flex-col gap-6 py-5">
            <PredictionCard prediction={prediction} />
            <div>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">Class probabilities</h3>
                <span className="text-2xs text-muted">Select a class to explain it</span>
              </div>
              <ConfidenceChart
                probabilities={prediction.probabilities}
                predictedCode={prediction.predicted_class.code}
                selectedCode={selectedCode ?? predictedCode}
                onSelect={(code) => setSelectedCode(code === predictedCode ? null : code)}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ModelInfoCard
          model={prediction.model}
          temperature={prediction.temperature}
          inferenceMs={prediction.timing.inference_ms}
          explainMs={prediction.timing.explain_ms}
        />
        <RecordCard detail={detail} />
      </div>

      {detail.prediction_history.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Prediction history</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col divide-y divide-line text-sm">
              {detail.prediction_history.map((item, index) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span>
                    <span className="font-medium text-ink">{item.predicted_class.name}</span>
                    <span className="tabular text-muted"> {formatPercent(item.confidence)}</span>
                    {index === 0 && <span className="ml-2 text-2xs text-accent">shown above</span>}
                  </span>
                  <span className="text-xs text-muted">
                    {item.model_label}, {formatDateTime(item.created_at)}
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <DisclaimerBanner />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this analysis?"
        description="The stored image, its Grad-CAM maps and all predictions for it will be permanently deleted."
        confirmLabel="Delete analysis"
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(detail.id, {
            onSuccess: () => {
              toast.success("Analysis deleted");
              navigate("/app/analyses", { replace: true });
            },
            onError: (error) => {
              setConfirmDelete(false);
              toast.error("The analysis could not be deleted", { description: errorMessage(error) });
            },
          })
        }
      />
    </div>
  );
}
