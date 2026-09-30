import { TriangleAlert } from "lucide-react";

import type { Prediction } from "@/api/types";
import { ClassGroupBadge } from "@/components/ClassGroupBadge";
import { Tooltip } from "@/components/ui/tooltip";
import { UNCERTAINTY_TEXT } from "@/lib/copy";
import { cn, formatPercent } from "@/lib/utils";

/**
 * The model's answer: predicted class, calibrated probability and an uncertainty read-out.
 * Language is deliberately non-diagnostic ("model output", "probability").
 */
export function PredictionCard({
  prediction,
  className,
  showHeadline = true,
}: {
  prediction: Prediction;
  className?: string;
  /** The phone layout shows class and probability in the page title instead. */
  showHeadline?: boolean;
}) {
  const { predicted_class: cls, confidence, uncertainty, concern } = prediction;
  return (
    <section
      aria-labelledby={showHeadline ? "prediction-heading" : undefined}
      aria-label={showHeadline ? undefined : "Uncertainty"}
      className={cn("flex flex-col gap-4", className)}
    >
      {showHeadline && (
        <div>
          <p id="prediction-heading" className="text-md text-muted">
            Predicted class
          </p>
          <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
            <h2 className="text-2xl font-bold tracking-title text-ink" data-testid="predicted-class">
              {cls.name}
            </h2>
            <p
              className="tabular text-2xl font-bold tracking-title text-ink"
              data-testid="predicted-confidence"
            >
              {formatPercent(confidence)}
            </p>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted">{cls.code}</span>
            <ClassGroupBadge group={cls.group} />
            <Tooltip
              content={`Softmax probability after temperature scaling (T = ${prediction.temperature.toFixed(2)}). A probability is not a measure of clinical certainty.`}
            >
              <button
                type="button"
                className="text-xs text-muted underline decoration-dotted underline-offset-2"
              >
                Calibrated probability
              </button>
            </Tooltip>
          </div>
        </div>
      )}

      {uncertainty.uncertain && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-[14px] bg-caution-soft px-3.5 py-3 text-md"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-caution" aria-hidden />
          <div>
            <p className="font-medium text-ink">Uncertain prediction</p>
            <ul className="mt-0.5 text-ink-2">
              {uncertainty.reasons.map((reason) => (
                <li key={reason}>
                  {UNCERTAINTY_TEXT[reason]?.({
                    conf: uncertainty.low_confidence_threshold,
                    margin: uncertainty.low_margin_threshold,
                  }) ?? reason}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[14px] bg-line text-md">
        <div className="bg-surface-2 px-3.5 py-2.5 dark:bg-[#242424]">
          <dt className="text-xs text-muted">Margin to 2nd class</dt>
          <dd className="tabular mt-0.5 font-medium text-ink">{formatPercent(uncertainty.margin)}</dd>
        </div>
        <div className="bg-surface-2 px-3.5 py-2.5 dark:bg-[#242424]">
          <dt className="text-xs text-muted">Normalised entropy</dt>
          <dd className="tabular mt-0.5 font-medium text-ink">
            {uncertainty.normalized_entropy.toFixed(2)}
            <span className="ml-1 text-xs font-normal text-muted">0 certain · 1 uniform</span>
          </dd>
        </div>
        <div className="col-span-2 bg-surface-2 px-3.5 py-2.5 dark:bg-[#242424]">
          <dt className="flex items-center justify-between text-xs text-muted">
            <span>Malignant or pre-malignant classes combined</span>
            <span className="font-mono">{concern.classes.join(" + ")}</span>
          </dt>
          <dd className="mt-1.5 flex items-center gap-3">
            <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-field" aria-hidden>
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-[var(--group-malignant)]"
                style={{ width: `${concern.probability * 100}%` }}
              />
            </span>
            <span className="tabular w-14 text-right font-medium text-ink">
              {formatPercent(concern.probability)}
            </span>
          </dd>
          <p className="mt-1.5 text-xs text-muted">
            Sum of model probabilities for these classes. Not a risk score.
          </p>
        </div>
      </dl>
    </section>
  );
}
