import type { OverviewStats } from "@/api/types";
import { cn, formatPercent } from "@/lib/utils";

/** Key statistics as label/value rows. Every number is computed server-side from stored analyses. */
export function SummaryRows({ stats, className }: { stats: OverviewStats; className?: string }) {
  const rows: [string, string][] = [
    ["Total analyses", stats.total_analyses.toLocaleString()],
    ["Last 7 days", stats.analyses_last_7_days.toLocaleString()],
    ["Average top-class probability", formatPercent(stats.average_confidence)],
    [
      "Flagged uncertain",
      `${stats.uncertain_count.toLocaleString()}${stats.total_analyses ? ` (${formatPercent(stats.uncertain_count / stats.total_analyses, 0)})` : ""}`,
    ],
  ];
  return (
    <dl className={cn("flex flex-col", className)}>
      {rows.map(([label, value], i) => (
        <div
          key={label}
          className={cn("flex items-center justify-between gap-4 py-2.5", i > 0 && "border-t border-line")}
        >
          <dt className="text-base text-ink-2">{label}</dt>
          <dd className="tabular text-base font-semibold text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
