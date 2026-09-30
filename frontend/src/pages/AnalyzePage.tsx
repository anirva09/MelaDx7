import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { ApiError } from "@/api/client";
import { useCreateAnalysis, useModelInfo } from "@/api/queries";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { ImageUploader } from "@/components/ImageUploader";
import { ModelAvailabilityNotice } from "@/components/ModelAvailabilityNotice";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { cn, errorMessage } from "@/lib/utils";

type Phase = "idle" | "uploading" | "processing";

const STEPS = [
  { key: "upload", label: "Upload", detail: "Sending the image securely" },
  { key: "validate", label: "Validate", detail: "Checking format, size and integrity; removing metadata" },
  { key: "predict", label: "Classify", detail: "CNN inference and calibrated probabilities" },
  { key: "explain", label: "Explain", detail: "Grad-CAM for the predicted class" },
  { key: "save", label: "Save", detail: "Storing the result with its model version" },
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

export function AnalyzePage() {
  useDocumentTitle("New analysis");
  const navigate = useNavigate();
  const model = useModelInfo();
  const create = useCreateAnalysis();
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const abortRef = useRef<AbortController | null>(null);

  const modelBlocked = model.data?.status === "unavailable";
  const busy = phase !== "idle";

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
      toast.success("Analysis saved", { description: detail.prediction.predicted_class.name });
      navigate(`/app/analyses/${detail.id}`);
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") setError(err);
      setPhase("idle");
    } finally {
      abortRef.current = null;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New analysis"
        description="Upload one dermoscopic image. The model returns a probability for every class and a Grad-CAM map showing which regions drove its prediction."
      />
      <ModelAvailabilityNotice info={model.data} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <ImageUploader file={file} onFileChange={setFile} disabled={busy} />

          {error !== null && (
            <Notice tone="danger" title="The analysis could not be completed" announce>
              <p>{errorMessage(error)}</p>
              {hintFor(error) && <p className="mt-1">{hintFor(error)}</p>}
            </Notice>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              onClick={() => void start()}
              disabled={!file || busy || modelBlocked}
              loading={busy}
            >
              {busy ? "Analysing" : "Analyse image"}
            </Button>
            {phase === "uploading" && (
              <Button variant="ghost" onClick={() => abortRef.current?.abort()}>
                Cancel
              </Button>
            )}
            {!file && !busy && <span className="text-sm text-muted">Select an image to continue.</span>}
          </div>

          {busy && (
            <div role="status" aria-live="polite" className="rounded-lg border border-line bg-surface p-4">
              {phase === "uploading" ? (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-ink">Uploading</span>
                    <span className="tabular text-muted">{Math.round(progress * 100)}%</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-accent transition-[width]"
                      style={{ width: `${progress * 100}%` }}
                    />
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-3 text-sm">
                  <span
                    className="size-4 animate-spin rounded-full border-2 border-line border-t-accent"
                    aria-hidden
                  />
                  <span className="font-medium text-ink">
                    Running the model and generating the explanation
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <Card>
            <CardContent className="py-5">
              <h2 className="text-sm font-semibold text-ink">What happens next</h2>
              <ol className="mt-4 flex flex-col gap-4">
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
                          "tabular flex size-6 shrink-0 items-center justify-center rounded-full border text-2xs font-semibold",
                          state === "done" && "border-accent bg-accent text-accent-contrast",
                          state === "active" && "border-accent text-accent",
                          state === "todo" && "border-line-strong text-muted",
                        )}
                        aria-hidden
                      >
                        {i + 1}
                      </span>
                      <div>
                        <p
                          className={cn(
                            "text-sm font-medium",
                            state === "active" ? "text-accent" : "text-ink",
                          )}
                        >
                          {step.label}
                        </p>
                        <p className="text-xs text-muted">{step.detail}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
          <Notice tone="info" title="Privacy">
            Images are re-encoded without metadata (EXIF, GPS) before storage. Do not upload images that show
            faces, names or other identifying details.
          </Notice>
        </aside>
      </div>

      <DisclaimerBanner />
    </div>
  );
}
