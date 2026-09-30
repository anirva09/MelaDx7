import {
  ArrowUp,
  Camera,
  CircleHelp,
  Cpu,
  Ellipsis,
  Image as ImageIcon,
  ImagePlus,
  Ruler,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { ApiError } from "@/api/client";
import { useCreateAnalysis, useModelInfo } from "@/api/queries";
import type { ModelInfo } from "@/api/types";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { ImageUploader, type ImageMeta, type ImageUploaderHandle } from "@/components/ImageUploader";
import { ModelAvailabilityNotice } from "@/components/ModelAvailabilityNotice";
import { Notice } from "@/components/Notice";
import { BottomToolbar } from "@/components/shell/BottomToolbar";
import { GlassCircle, GlassPill, PillButton } from "@/components/shell/Glass";
import { BackButton, MobileTopBar } from "@/components/shell/MobileTopBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DesktopHeader, Divider, MetaRow, Page, PageTitle } from "@/components/ui/page";
import { BottomSheet } from "@/components/ui/sheet";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { clearPendingFile, peekPendingFile } from "@/lib/pendingUpload";
import { cn, errorMessage, formatBytes } from "@/lib/utils";

type Phase = "idle" | "uploading" | "processing";

const STEPS = [
  { key: "upload", label: "Upload", detail: "Sending the image securely" },
  { key: "validate", label: "Validate", detail: "Checking format, size and integrity; removing metadata" },
  { key: "predict", label: "Classify", detail: "CNN inference and calibrated probabilities" },
  { key: "explain", label: "Explain", detail: "Grad-CAM for the predicted class" },
  { key: "save", label: "Save", detail: "Storing the result with its model version" },
];

const TIPS = [
  {
    title: "Use a dermoscopic image",
    body: "The model was built for dermatoscope images of a single lesion, not general photos.",
  },
  {
    title: "Centre and fill the frame",
    body: "Keep the whole lesion in view with a little surrounding skin; avoid heavy cropping.",
  },
  {
    title: "Focus and light evenly",
    body: "Blur, glare and under- or over-exposure are flagged and make results less reliable.",
  },
  {
    title: "Remove identifying details",
    body: "No faces, names, tattoos or labels. Metadata (EXIF, GPS) is stripped on upload.",
  },
];

function hintFor(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  switch (error.code) {
    case "unsupported_format":
      return "Only JPEG, PNG and WebP images are accepted. Convert the file and try again.";
    case "corrupted_image":
      return "The file appears damaged. Export the image again from its source.";
    case "file_too_large":
    case "payload_too_large":
      return "Reduce the file size (for example, export as JPEG) and try again.";
    case "model_unavailable":
      return "A trained model must be loaded before images can be analysed.";
    case "rate_limited":
      return error.retryAfter ? `Wait ${error.retryAfter} seconds before trying again.` : null;
    default:
      return null;
  }
}

function modelBadge(info: ModelInfo | undefined) {
  if (!info) return <span className="text-muted">Checking</span>;
  if (info.status === "unavailable") return <Badge tone="danger">Not loaded</Badge>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate">{info.display_name}</span>
      {info.status === "untrained" ? <Badge tone="danger">Untrained</Badge> : <Badge tone="tag">Ready</Badge>}
    </span>
  );
}

/** Processing state drawn over the preview: a scan line, progress and the current stage. */
function ProcessingOverlay({ phase, progress }: { phase: Phase; progress: number }) {
  if (phase === "idle") return null;
  const label =
    phase === "uploading" ? `Uploading ${Math.round(progress * 100)}%` : "Classifying and computing Grad-CAM";
  return (
    <div className="absolute inset-0 overflow-hidden bg-black/45" role="status" aria-live="polite">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-1/3 bg-[linear-gradient(to_bottom,transparent,rgb(41_149_255/0.28),transparent)] [animation:scan_1.8s_ease-in-out_infinite_alternate]"
      />
      <div className="absolute inset-x-0 bottom-4 flex justify-center px-4">
        <span className="glass flex items-center gap-3 rounded-full py-2 pl-2 pr-4 text-md font-medium text-white">
          <svg viewBox="0 0 36 36" className="size-8 -rotate-90" aria-hidden>
            <circle cx="18" cy="18" r="15" fill="none" stroke="rgb(255 255 255 / 0.18)" strokeWidth="3" />
            {phase === "uploading" ? (
              <circle
                cx="18"
                cy="18"
                r="15"
                fill="none"
                stroke="#2995ff"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${progress * 94.2} 94.2`}
                className="transition-[stroke-dasharray]"
              />
            ) : (
              <circle
                cx="18"
                cy="18"
                r="15"
                fill="none"
                stroke="#2995ff"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="30 94.2"
                className="origin-center animate-spin"
              />
            )}
          </svg>
          {label}
        </span>
      </div>
    </div>
  );
}

export function AnalyzePage() {
  useDocumentTitle("New analysis");
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const model = useModelInfo();
  const create = useCreateAnalysis();
  // A file picked from the "+" composer arrives here for an immediate preview.
  const [file, setFile] = useState<File | null>(peekPendingFile);
  const [meta, setMeta] = useState<ImageMeta | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [tips, setTips] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const uploader = useRef<ImageUploaderHandle>(null);

  useEffect(() => clearPendingFile(), []);

  const modelBlocked = model.data?.status === "unavailable";
  const busy = phase !== "idle";

  const choose = (next: File | null) => {
    setError(null);
    setFile(next);
  };

  const start = async () => {
    if (!file) return;
    setError(null);
    setProgress(0);
    setPhase("uploading");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const detail = await create.mutateAsync({
        file,
        signal: controller.signal,
        onProgress: (fraction) => {
          setProgress(fraction);
          if (fraction >= 1) setPhase("processing");
        },
      });
      navigator.vibrate?.(12);
      toast.success("Analysis saved", { description: detail.prediction.predicted_class.name });
      navigate(`/app/analyses/${detail.id}`, { replace: !desktop });
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") setError(err);
      setPhase("idle");
    } finally {
      abortRef.current = null;
    }
  };

  const errorNotice = error !== null && (
    <Notice tone="danger" title="The analysis could not be completed" announce>
      <p>{errorMessage(error)}</p>
      {hintFor(error) && <p className="mt-1">{hintFor(error)}</p>}
    </Notice>
  );

  const uploaderEl = (
    <ImageUploader
      ref={uploader}
      file={file}
      onFileChange={choose}
      onMeta={setMeta}
      disabled={busy}
      variant={desktop ? "pointer" : "touch"}
      overlay={<ProcessingOverlay phase={phase} progress={progress} />}
    />
  );

  const tipsSheet = (
    <BottomSheet
      open={tips}
      onOpenChange={setTips}
      title="Image tips"
      description="How to take an image the model can use."
      size="auto"
    >
      <ol className="flex flex-col gap-3 pb-2">
        {TIPS.map((tip, i) => (
          <li key={tip.title} className="flex gap-3 rounded-[16px] bg-paper p-4 dark:bg-[#1d1d1d]">
            <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full border-[1.2px] border-line-strong text-xs text-ink-2">
              {i + 1}
            </span>
            <span>
              <span className="block text-base font-medium tracking-ref text-ink">{tip.title}</span>
              <span className="mt-1 block text-md leading-relaxed text-ink-2">{tip.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </BottomSheet>
  );

  if (!desktop) {
    return (
      <>
        <MobileTopBar
          left={<BackButton fallback="/app" />}
          right={
            <GlassPill aria-label="Image options">
              <PillButton label="Image tips" onClick={() => setTips(true)}>
                <CircleHelp aria-hidden />
              </PillButton>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <PillButton label="More" disabled={busy}>
                    <Ellipsis aria-hidden />
                  </PillButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => uploader.current?.open("library")}>
                    <ImageIcon aria-hidden /> Choose from photos
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => uploader.current?.open("camera")}>
                    <Camera aria-hidden /> Take a photo
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!file} onSelect={() => uploader.current?.clear()}>
                    <Trash2 aria-hidden /> Remove image
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </GlassPill>
          }
        />
        <Page className="gap-0">
          <PageTitle>New analysis</PageTitle>
          <div className="mt-5 flex flex-col gap-4">
            <MetaRow icon={<ImageIcon aria-hidden />} label="Image">
              {file ? (
                <span className="block truncate">{file.name}</span>
              ) : (
                <span className="text-muted">None selected</span>
              )}
            </MetaRow>
            <MetaRow icon={<Ruler aria-hidden />} label="Size">
              {file && meta ? (
                <span className="tabular">
                  {meta.width}×{meta.height} · {formatBytes(file.size)}
                </span>
              ) : (
                <span className="text-muted">n/a</span>
              )}
            </MetaRow>
            <MetaRow icon={<Cpu aria-hidden />} label="Model">
              {modelBadge(model.data)}
            </MetaRow>
          </div>
          <Divider className="mb-5 mt-4" />
          <div className="flex flex-col gap-5">
            {modelBlocked && <ModelAvailabilityNotice info={model.data} />}
            {model.data?.status === "untrained" && (
              <p className="text-md leading-relaxed text-caution">
                An untrained pipeline-verification model is loaded: results will not be meaningful.
              </p>
            )}
            {uploaderEl}
            {errorNotice}
            <p className="text-md leading-relaxed text-ink-2">
              The model returns a probability for every class and a Grad-CAM map showing which regions drove
              its prediction. Images are re-encoded without metadata before storage.
            </p>
            <DisclaimerBanner compact />
          </div>
        </Page>
        <BottomToolbar
          left={
            // Without an image the inline composer already offers every source.
            file && (
              <GlassPill aria-label="Image source">
                <PillButton
                  label="Choose another image"
                  onClick={() => uploader.current?.open("library")}
                  disabled={busy}
                >
                  <ImagePlus aria-hidden />
                </PillButton>
                <PillButton
                  label="Take a photo"
                  onClick={() => uploader.current?.open("camera")}
                  disabled={busy}
                >
                  <Camera aria-hidden />
                </PillButton>
                <PillButton
                  label="Remove image"
                  onClick={() => uploader.current?.clear()}
                  disabled={busy || !file}
                >
                  <Trash2 aria-hidden />
                </PillButton>
              </GlassPill>
            )
          }
          right={
            <>
              {phase === "uploading" ? (
                <GlassCircle label="Cancel upload" onClick={() => abortRef.current?.abort()}>
                  <X aria-hidden />
                </GlassCircle>
              ) : (
                <GlassCircle
                  label="Analyse image"
                  tone="accent"
                  onClick={() => void start()}
                  disabled={!file || busy || modelBlocked}
                  aria-busy={busy || undefined}
                  className={cn(busy && "animate-pulse")}
                >
                  <ArrowUp aria-hidden />
                </GlassCircle>
              )}
            </>
          }
        />
        {tipsSheet}
      </>
    );
  }

  return (
    <Page>
      <DesktopHeader
        title="New analysis"
        subtitle="Upload one dermoscopic image. The model returns a probability for every class and a Grad-CAM map showing which regions drove its prediction."
        actions={
          <Button variant="secondary" size="sm" onClick={() => setTips(true)}>
            <CircleHelp aria-hidden /> Image tips
          </Button>
        }
      />
      <ModelAvailabilityNotice info={model.data} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          {uploaderEl}
          {file && meta && (
            <p className="tabular text-sm text-muted">
              {file.name} · {meta.width}×{meta.height} px · {formatBytes(file.size)}
            </p>
          )}
          {errorNotice}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              onClick={() => void start()}
              disabled={!file || busy || modelBlocked}
              loading={busy}
            >
              {busy ? "Analysing" : "Analyse image"}
            </Button>
            {file && !busy && (
              <Button variant="secondary" onClick={() => uploader.current?.open()}>
                <ImagePlus aria-hidden /> Replace
              </Button>
            )}
            {file && !busy && (
              <Button variant="ghost" onClick={() => uploader.current?.clear()}>
                <Trash2 aria-hidden /> Remove
              </Button>
            )}
            {phase === "uploading" && (
              <Button variant="ghost" onClick={() => abortRef.current?.abort()}>
                Cancel
              </Button>
            )}
            {!file && !busy && <span className="text-base text-muted">Select an image to continue.</span>}
          </div>
        </div>

        <aside className="flex flex-col gap-4">
          <section className="rounded-lg bg-surface px-5 pb-5 pt-3.5" aria-labelledby="steps-heading">
            <h2 id="steps-heading" className="text-lg font-semibold tracking-ref text-ink">
              What happens next
            </h2>
            <ol className="mt-4 flex flex-col gap-3">
              {STEPS.map((step, i) => {
                // The server runs steps 2-5 in one request, so they are shown as one active phase.
                const state =
                  phase === "idle"
                    ? "todo"
                    : phase === "uploading"
                      ? i === 0
                        ? "active"
                        : "todo"
                      : i === 0
                        ? "done"
                        : "active";
                return (
                  <li key={step.key} className="flex gap-3">
                    <span
                      className={cn(
                        "tabular flex size-6 shrink-0 items-center justify-center rounded-full text-xs",
                        state === "done" && "bg-accent text-white",
                        state === "active" && "border-[1.2px] border-accent text-accent",
                        state === "todo" && "border-[1.2px] border-line-strong text-muted",
                      )}
                      aria-hidden
                    >
                      {i + 1}
                    </span>
                    <div>
                      <p
                        className={cn(
                          "text-base font-medium tracking-ref",
                          state === "active" ? "text-accent" : "text-ink",
                        )}
                      >
                        {step.label}
                      </p>
                      <p className="text-sm text-muted">{step.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
          <Notice tone="info" title="Privacy">
            Images are re-encoded without metadata (EXIF, GPS) before storage. Do not upload images that show
            faces, names or other identifying details.
          </Notice>
        </aside>
      </div>

      <DisclaimerBanner />
      {tipsSheet}
    </Page>
  );
}
