import { X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { useAnalysis } from "@/api/queries";
import { formatAgo } from "@/lib/analysis";
import { formatPercent } from "@/lib/utils";

const STORAGE_KEY = "lesionlens-dismissed-latest";

function readDismissed(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * The latest result as a featured image card (reference: "Home - Featured Image": 28px
 * radius, caption over the image, close button). Dismissing hides it until a newer result.
 */
export function LatestResultCard({ analysisId }: { analysisId: string }) {
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);
  const analysis = useAnalysis(dismissed === analysisId ? undefined : analysisId);
  if (dismissed === analysisId) return null;
  const detail = analysis.data;

  const dismiss = () => {
    setDismissed(analysisId);
    try {
      localStorage.setItem(STORAGE_KEY, analysisId);
    } catch {
      // Storage unavailable: the card stays hidden for this session only.
    }
  };

  if (!detail) {
    return <div className="h-[263px] animate-pulse rounded-2xl bg-surface" aria-hidden />;
  }
  const { prediction } = detail;
  const overlay = prediction.explanation?.overlay_url;

  return (
    <section aria-label="Latest result" className="relative h-[263px] overflow-hidden rounded-2xl bg-surface">
      <Link to={`/app/analyses/${detail.id}`} className="press-soft absolute inset-0 block">
        <img
          src={overlay ?? detail.image.url}
          alt={`${overlay ? "Grad-CAM overlay" : "Image"} for the latest analysis, ${detail.original_filename}`}
          className="absolute inset-0 size-full object-cover"
          loading="lazy"
          decoding="async"
        />
        <span
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(to_bottom,rgb(31_31_31/0)_30%,rgb(31_31_31/0.85)_68%,#1f1f1f)]"
        />
        <span className="absolute inset-x-4 bottom-5 flex flex-col gap-1">
          <span className="text-xs text-white/70">
            Latest result · {overlay ? "Grad-CAM overlay" : "uploaded image"} · {formatAgo(detail.created_at)}
          </span>
          <span className="text-lg font-semibold leading-[1.35] tracking-[-0.02em] text-[#d4d4d4]">
            {prediction.predicted_class.name}, {formatPercent(prediction.confidence)} probability
            {prediction.uncertainty.uncertain ? ". Flagged uncertain" : ""}
            {!prediction.model.trained ? ". Untrained model" : ""}
          </span>
        </span>
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Hide latest result card"
        className="press absolute right-1.5 top-1.5 flex size-11 items-center justify-center rounded-full text-white"
      >
        <X className="size-5 drop-shadow" strokeWidth={1.8} aria-hidden />
      </button>
    </section>
  );
}
