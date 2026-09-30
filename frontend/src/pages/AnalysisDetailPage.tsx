import {
  CalendarDays,
  ChartBar,
  CircleGauge,
  Copy,
  Cpu,
  Download,
  Ellipsis,
  FileDown,
  Layers,
  Maximize2,
  Percent,
  RefreshCw,
  Share,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { ApiError } from "@/api/client";
import {
  useAnalysis,
  useClassExplanation,
  useDeleteAnalysis,
  useModelInfo,
  useRerunAnalysis,
} from "@/api/queries";
import type { AnalysisDetail, ClassProbability } from "@/api/types";
import { DeleteAnalysisDialog } from "@/components/analysis/AnalysisMenu";
import { ClassGroupBadge } from "@/components/ClassGroupBadge";
import { ConfidenceChart } from "@/components/ConfidenceChart";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import {
  GradCAMStage,
  GradCAMViewer,
  ViewerControls,
  ViewerFullscreen,
  ViewerNotes,
} from "@/components/GradCAMViewer";
import { ModelInfoCard } from "@/components/ModelInfoCard";
import { Notice } from "@/components/Notice";
import { PredictionCard } from "@/components/PredictionCard";
import { BottomToolbar } from "@/components/shell/BottomToolbar";
import { GlassCircle, GlassPill, PillButton } from "@/components/shell/Glass";
import { BackButton, MobileTopBar } from "@/components/shell/MobileTopBar";
import { ErrorState } from "@/components/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DefinitionList } from "@/components/ui/definition-list";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DesktopHeader, Divider, MetaRow, Page, PageTitle } from "@/components/ui/page";
import { BottomSheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { groupColor } from "@/lib/analysis";
import { GRADCAM_NOTE, QUALITY_TITLE, UNTRAINED_WARNING } from "@/lib/copy";
import { downloadReport } from "@/lib/reports";
import { cn, errorMessage, formatBytes, formatDateTime, formatPercent, shortHash } from "@/lib/utils";
import {
  effectiveMode,
  exportView,
  useViewerState,
  VIEW_OPTIONS,
  type ViewerSources,
  type ViewMode,
} from "@/lib/viewer";

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
      className="press inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-active hover:text-ink"
      aria-label={`Copy ${label}`}
    >
      <Copy className="size-4" strokeWidth={1.5} aria-hidden />
    </button>
  );
}

function RecordCard({ detail }: { detail: AnalysisDetail }) {
  const utc = new Date(detail.created_at).toISOString().replace("T", " ").slice(0, 19);
  const rows: [string, ReactNode][] = [
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
      <CardContent className="pt-2">
        <DefinitionList rows={rows} />
      </CardContent>
    </Card>
  );
}

function HistoryCard({ detail }: { detail: AnalysisDetail }) {
  return (
    <Card id="history" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>Prediction history</CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        <ol className="flex flex-col">
          {detail.prediction_history.map((item, index) => (
            <li
              key={item.id}
              className={cn("flex flex-col gap-0.5 py-2.5", index > 0 && "border-t border-line")}
            >
              <span className="text-base">
                <span className="font-medium text-ink">{item.predicted_class.name}</span>
                <span className="tabular text-ink-2"> {formatPercent(item.confidence)}</span>
                {index === 0 && <span className="ml-2 text-xs text-accent">shown above</span>}
              </span>
              <span className="text-xs text-muted">
                {item.model_label}, {formatDateTime(item.created_at)}
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function DetailSkeleton({ desktop }: { desktop: boolean }) {
  return (
    <Page role="status" aria-label="Loading analysis">
      <Skeleton className="h-8 w-64" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-6 w-48" />
      </div>
      <div className={cn("grid gap-6", desktop && "grid-cols-[minmax(0,7fr)_minmax(0,5fr)]")}>
        <Skeleton className="h-[380px] rounded-lg" />
        {desktop && <Skeleton className="h-[380px] rounded-lg" />}
      </div>
    </Page>
  );
}

/** Pick a class to explain (reference: the two-column "Templates" sheet). */
function ClassSheet({
  open,
  onOpenChange,
  probabilities,
  selected,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  probabilities: ClassProbability[];
  selected: string;
  onSelect: (code: string) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = probabilities.filter((p) =>
    `${p.name} ${p.code}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Explain a class"
      description="Choose a class to see the regions that supported it."
      search={{ value: query, onChange: setQuery, placeholder: "Search classes" }}
    >
      <ul className="grid grid-cols-2 gap-x-3 gap-y-4">
        {shown.map((p) => {
          const color = groupColor(p.group);
          const active = p.code === selected;
          return (
            <li key={p.code}>
              <button
                type="button"
                onClick={() => {
                  onSelect(p.code);
                  onOpenChange(false);
                }}
                aria-pressed={active}
                className="press-soft flex w-full flex-col gap-2 text-left"
              >
                <span
                  className={cn(
                    "flex h-[132px] w-full flex-col justify-between rounded-[17px] bg-paper p-3 dark:bg-[#1d1d1d]",
                    active && "ring-2 ring-accent",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-xs" style={{ color }}>
                    <span className="h-3.5 w-[3px] rounded-full" style={{ background: color }} aria-hidden />
                    <span className="font-mono">{p.code}</span>
                  </span>
                  <span className="tabular text-3xl font-semibold tracking-display text-ink">
                    {formatPercent(p.probability)}
                  </span>
                  <span className="h-1.5 w-full overflow-hidden rounded-full bg-field" aria-hidden>
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${Math.max(p.probability * 100, 1)}%`, background: color }}
                    />
                  </span>
                </span>
                <span className="truncate text-md font-medium tracking-ref text-muted">{p.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}

export function AnalysisDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const desktop = useIsDesktop();
  const analysis = useAnalysis(id);
  const model = useModelInfo();
  const detail = analysis.data;
  useDocumentTitle(
    detail ? `${detail.prediction.predicted_class.name} – ${detail.original_filename}` : "Analysis",
  );

  const viewer = useViewerState({ mode: desktop ? "overlay" : "compare" });
  const [zoom, setZoom] = useState(1);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sheet, setSheet] = useState<null | "details" | "adjust" | "classes">(null);
  const [fullscreen, setFullscreen] = useState(false);
  const remove = useDeleteAnalysis();
  const rerun = useRerunAnalysis();

  const predictedCode = detail?.prediction.predicted_class.code ?? null;
  const explainCode = selectedCode && selectedCode !== predictedCode ? selectedCode : null;
  const classExplanation = useClassExplanation(id, detail?.produced_by_current_model ? explainCode : null);

  const refetch = analysis.refetch;
  const onImageError = useCallback(() => void refetch(), [refetch]);

  // Deep link from a card's "Prediction history" action.
  useEffect(() => {
    if (detail && location.hash === "#history") {
      document.getElementById("history")?.scrollIntoView({ behavior: "smooth" });
    }
  }, [detail, location.hash]);

  if (analysis.isPending) return <DetailSkeleton desktop={desktop} />;
  if (analysis.isError || !detail) {
    const notFound = analysis.error instanceof ApiError && analysis.error.status === 404;
    return (
      <>
        {!desktop && <MobileTopBar left={<BackButton fallback="/app/analyses" />} />}
        <Page>
          {desktop && (
            <Link to="/app/analyses" className="text-md text-muted hover:text-ink">
              ‹ History
            </Link>
          )}
          <ErrorState
            title={notFound ? "Analysis not found" : "The analysis could not be loaded"}
            error={analysis.error}
            onRetry={notFound ? undefined : () => void analysis.refetch()}
          />
        </Page>
      </>
    );
  }

  const { prediction } = detail;
  const explanation = prediction.explanation;
  const viewing = explainCode
    ? prediction.probabilities.find((p) => p.code === explainCode)
    : prediction.probabilities.find((p) => p.code === predictedCode);
  const classView = explainCode && classExplanation.data ? classExplanation.data : null;
  const sources: ViewerSources = {
    imageUrl: detail.image.url,
    camUrl: classView ? classView.cam_url : explainCode ? null : explanation?.cam_url,
    heatmapUrl: classView ? classView.heatmap_url : explainCode ? null : explanation?.heatmap_url,
    targetLabel: viewing?.name ?? null,
    degenerate: classView ? classView.degenerate : (explanation?.degenerate ?? false),
    onImageError,
  };
  const downloadName = `meladx7-${detail.id.slice(0, 8)}-${viewing?.code ?? "image"}.png`;
  const canRerun = !detail.produced_by_current_model && model.data?.status !== "unavailable";

  const report = async () => {
    setDownloading(true);
    await downloadReport(detail.id);
    setDownloading(false);
  };
  const doRerun = () =>
    rerun.mutate(detail.id, {
      onSuccess: () => {
        setSelectedCode(null);
        toast.success("Re-analysed with the current model");
      },
      onError: (error) => toast.error("Re-analysis failed", { description: errorMessage(error) }),
    });
  const selectClass = (code: string) => setSelectedCode(code === predictedCode ? null : code);

  const notices = (
    <>
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
    </>
  );

  const attributionStatus = (
    <div className="flex flex-col gap-2 text-md">
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
          Explanations for other classes need the model version that produced this result. Re-run the analysis
          with the current model first.
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
  );

  const probabilities = (
    <ConfidenceChart
      probabilities={prediction.probabilities}
      predictedCode={prediction.predicted_class.code}
      selectedCode={selectedCode ?? predictedCode}
      onSelect={selectClass}
    />
  );

  const deleteDialog = (
    <DeleteAnalysisDialog
      open={confirmDelete}
      onOpenChange={setConfirmDelete}
      filename={detail.original_filename}
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
  );

  const hasHeat = Boolean(sources.camUrl || sources.heatmapUrl);
  const mode = effectiveMode(viewer.mode, sources);

  if (!desktop) {
    return (
      <>
        <MobileTopBar
          left={<BackButton fallback="/app/analyses" />}
          right={
            <GlassPill aria-label="Result actions">
              <PillButton label="Download PDF report" onClick={() => void report()} disabled={downloading}>
                <Share aria-hidden />
              </PillButton>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <PillButton label="More actions">
                    <Ellipsis aria-hidden />
                  </PillButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => setSheet("classes")}>
                    <Sparkles aria-hidden /> Explain another class
                  </DropdownMenuItem>
                  {canRerun && (
                    <DropdownMenuItem onSelect={doRerun} disabled={rerun.isPending}>
                      <RefreshCw aria-hidden /> Re-run with current model
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => exportView(sources, viewer, downloadName)}>
                    <Download aria-hidden /> Save current view
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      void navigator.clipboard?.writeText(detail.id).then(
                        () => toast.success("Analysis ID copied"),
                        () => toast.error("Copy failed"),
                      )
                    }
                  >
                    <Copy aria-hidden /> Copy analysis ID
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => setConfirmDelete(true)}
                    className="text-danger [&_svg]:text-danger"
                  >
                    <Trash2 aria-hidden /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </GlassPill>
          }
        />
        <Page className="gap-0">
          <PageTitle>
            <span data-testid="predicted-class">{prediction.predicted_class.name}</span>
          </PageTitle>
          <div className="mt-5 flex flex-col gap-4">
            <MetaRow icon={<Tag aria-hidden />} label="Group">
              <ClassGroupBadge group={prediction.predicted_class.group} />
            </MetaRow>
            <MetaRow icon={<Percent aria-hidden />} label="Probability">
              <span className="tabular font-medium" data-testid="predicted-confidence">
                {formatPercent(prediction.confidence)}
              </span>
              <span className="text-muted"> calibrated</span>
            </MetaRow>
            <MetaRow icon={<CircleGauge aria-hidden />} label="Certainty">
              {prediction.uncertainty.uncertain ? (
                <Badge tone="caution">Uncertain</Badge>
              ) : (
                <Badge tone="tag">Within thresholds</Badge>
              )}
            </MetaRow>
            <MetaRow icon={<Cpu aria-hidden />} label="Model">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">
                  {prediction.model.display_name} v{prediction.model.version}
                </span>
                {!prediction.model.trained && <Badge tone="danger">Untrained</Badge>}
              </span>
            </MetaRow>
            <MetaRow icon={<CalendarDays aria-hidden />} label="Analysed">
              <span className="block truncate">{formatDateTime(detail.created_at)}</span>
            </MetaRow>
          </div>
          <Divider className="mb-5 mt-4" />

          <div className="flex flex-col gap-6">
            {notices}
            <section aria-label="Image and Grad-CAM explanation viewer" className="flex flex-col gap-3">
              <GradCAMStage
                sources={sources}
                state={viewer}
                zoom={zoom}
                onZoomChange={setZoom}
                className="rounded-lg"
              />
              <ViewerNotes sources={sources} />
              {attributionStatus}
            </section>

            <section aria-labelledby="probabilities-heading" className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 id="probabilities-heading" className="text-lg font-semibold tracking-ref text-ink">
                  Class probabilities
                </h2>
                <span className="text-xs text-muted">Tap a class to explain it</span>
              </div>
              <div className="rounded-lg bg-surface p-1.5">{probabilities}</div>
            </section>

            <section aria-labelledby="uncertainty-heading" className="flex flex-col gap-3">
              <h2 id="uncertainty-heading" className="text-lg font-semibold tracking-ref text-ink">
                Uncertainty
              </h2>
              <div className="rounded-lg bg-surface p-4">
                <PredictionCard prediction={prediction} showHeadline={false} />
              </div>
            </section>

            <ModelInfoCard
              model={prediction.model}
              temperature={prediction.temperature}
              inferenceMs={prediction.timing.inference_ms}
              explainMs={prediction.timing.explain_ms}
            />
            <RecordCard detail={detail} />
            {detail.prediction_history.length > 1 && <HistoryCard detail={detail} />}
            <DisclaimerBanner />
          </div>
        </Page>

        <BottomToolbar
          left={
            <GlassPill aria-label="Viewer controls">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <PillButton
                    label={`View: ${VIEW_OPTIONS.find((o) => o.value === mode)?.label}`}
                    disabled={!hasHeat}
                  >
                    <Layers aria-hidden />
                  </PillButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start">
                  <DropdownMenuLabel>View</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={mode}
                    onValueChange={(value) => {
                      viewer.set({ mode: value as ViewMode });
                      setZoom(1);
                    }}
                  >
                    {VIEW_OPTIONS.map((option) => (
                      <DropdownMenuRadioItem key={option.value} value={option.value}>
                        {option.icon}
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <PillButton label="Adjust heatmap" onClick={() => setSheet("adjust")} disabled={!hasHeat}>
                <SlidersHorizontal aria-hidden />
              </PillButton>
              <PillButton label="Full screen" onClick={() => setFullscreen(true)}>
                <Maximize2 aria-hidden />
              </PillButton>
            </GlassPill>
          }
          right={
            <>
              <GlassCircle label="Result details" onClick={() => setSheet("details")}>
                <ChartBar aria-hidden />
              </GlassCircle>
            </>
          }
        />

        <BottomSheet
          open={sheet === "details"}
          onOpenChange={(open) => setSheet(open ? "details" : null)}
          title="Result details"
          description="Predicted class, calibrated probabilities and uncertainty."
          size="auto"
        >
          <div className="flex flex-col gap-5 pb-2">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-2xl font-bold tracking-title text-ink">{prediction.predicted_class.name}</p>
              <p className="tabular text-2xl font-bold tracking-title text-ink">
                {formatPercent(prediction.confidence)}
              </p>
            </div>
            <div className="rounded-[16px] bg-paper p-1.5 dark:bg-[#1d1d1d]">
              <ConfidenceChart
                probabilities={prediction.probabilities}
                predictedCode={prediction.predicted_class.code}
                selectedCode={selectedCode ?? predictedCode}
                onSelect={(code) => {
                  selectClass(code);
                  setSheet(null);
                }}
              />
            </div>
            <Button variant="secondary" onClick={() => void report()} loading={downloading}>
              <FileDown aria-hidden /> Download PDF report
            </Button>
            <p className="text-xs leading-relaxed text-muted">
              Choosing a class shows its Grad-CAM map. Probabilities are model outputs after temperature
              scaling, not clinical certainty.
            </p>
          </div>
        </BottomSheet>
        <BottomSheet
          open={sheet === "adjust"}
          onOpenChange={(open) => setSheet(open ? "adjust" : null)}
          title="Adjust heatmap"
          description="Overlay opacity, threshold and colour map."
          size="auto"
        >
          <ViewerControls sources={sources} state={viewer} tone="sheet" className="pb-3" />
        </BottomSheet>
        <ClassSheet
          open={sheet === "classes"}
          onOpenChange={(open) => setSheet(open ? "classes" : null)}
          probabilities={prediction.probabilities}
          selected={selectedCode ?? predictedCode ?? ""}
          onSelect={selectClass}
        />
        <ViewerFullscreen open={fullscreen} onOpenChange={setFullscreen} sources={sources} state={viewer} />
        {deleteDialog}
      </>
    );
  }

  return (
    <Page>
      <div>
        <Link to="/app/analyses" className="text-md text-muted hover:text-ink">
          ‹ History
        </Link>
        <div className="mt-3">
          <DesktopHeader
            title={prediction.predicted_class.name}
            subtitle={`${detail.original_filename} · analysed ${formatDateTime(detail.created_at)} with ${prediction.model.display_name} v${prediction.model.version}`}
            actions={
              <>
                <Button variant="secondary" size="sm" onClick={() => void report()} loading={downloading}>
                  <FileDown aria-hidden /> Download report
                </Button>
                {canRerun && (
                  <Button variant="secondary" size="sm" loading={rerun.isPending} onClick={doRerun}>
                    <RefreshCw aria-hidden /> Re-run with current model
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  className="text-danger"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 aria-hidden /> Delete
                </Button>
              </>
            }
          />
        </div>
      </div>

      {notices}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <GradCAMViewer {...sources} state={viewer} downloadName={downloadName} />
          {attributionStatus}
        </div>
        <Card className="xl:sticky xl:top-8">
          <CardContent className="flex flex-col gap-6 py-5">
            <PredictionCard prediction={prediction} />
            <div>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="text-base font-semibold tracking-ref text-ink">Class probabilities</h3>
                <span className="text-xs text-muted">Select a class to explain it</span>
              </div>
              {probabilities}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <ModelInfoCard
          model={prediction.model}
          temperature={prediction.temperature}
          inferenceMs={prediction.timing.inference_ms}
          explainMs={prediction.timing.explain_ms}
        />
        <RecordCard detail={detail} />
      </div>

      {detail.prediction_history.length > 1 && <HistoryCard detail={detail} />}

      <DisclaimerBanner />
      {deleteDialog}
    </Page>
  );
}
