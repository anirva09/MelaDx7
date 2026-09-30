import type { ClassProbability } from "@/api/types";
import { GroupDot } from "@/components/ClassGroupBadge";
import { cn, formatPercent } from "@/lib/utils";

interface ConfidenceChartProps {
  probabilities: ClassProbability[];
  predictedCode: string;
  /** When provided, rows become buttons that select a class to explain. */
  selectedCode?: string | null;
  onSelect?: (code: string) => void;
  className?: string;
}

/**
 * Probability for every class, highest first, as horizontal bars.
 * The predicted class is emphasised; all others share one muted tone (emphasis, not rainbow).
 * Every value is printed, so nothing depends on colour or hover.
 */
export function ConfidenceChart({
  probabilities,
  predictedCode,
  selectedCode,
  onSelect,
  className,
}: ConfidenceChartProps) {
  const interactive = Boolean(onSelect);
  return (
    <ol className={cn("@container flex flex-col", className)} aria-label="Probability for each class">
      {probabilities.map((item) => {
        const predicted = item.code === predictedCode;
        const selected = selectedCode === item.code;
        const content = (
          <>
            <span className="flex min-w-0 items-center gap-2">
              <GroupDot group={item.group} />
              <span
                className={cn("truncate text-sm", predicted ? "font-semibold text-ink" : "text-ink-2")}
                title={item.name}
              >
                {item.name}
              </span>
              <span className="hidden font-mono text-2xs text-muted @[30rem]:inline">{item.code}</span>
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <span
                className="relative h-2 w-12 shrink-0 overflow-hidden rounded-r-[4px] bg-surface-2 @[24rem]:w-20 @[34rem]:w-36"
                aria-hidden
              >
                <span
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-r-[4px]",
                    predicted ? "bg-series-1" : "bg-chart-muted",
                  )}
                  style={{ width: `${Math.max(item.probability * 100, 0.8)}%` }}
                />
              </span>
              <span
                className={cn(
                  "tabular w-14 text-right text-sm",
                  predicted ? "font-semibold text-ink" : "text-ink-2",
                )}
              >
                {formatPercent(item.probability)}
              </span>
            </span>
          </>
        );
        return (
          <li key={item.code}>
            {interactive ? (
              <button
                type="button"
                onClick={() => onSelect?.(item.code)}
                aria-pressed={selected}
                aria-label={`${item.name}: ${formatPercent(item.probability)}. Show Grad-CAM for this class.`}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left transition-colors",
                  "hover:bg-surface-2",
                  selected && "bg-accent-soft ring-1 ring-accent/30 hover:bg-accent-soft",
                )}
              >
                {content}
              </button>
            ) : (
              <div className="flex items-center justify-between gap-3 px-2 py-1.5">
                <span className="sr-only">
                  {item.name}: {formatPercent(item.probability)}
                </span>
                <span aria-hidden className="contents">
                  {content}
                </span>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
