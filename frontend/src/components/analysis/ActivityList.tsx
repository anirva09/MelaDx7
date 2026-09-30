import { Link } from "react-router-dom";

import type { AnalysisListItem } from "@/api/types";
import { AnalysisMenu } from "@/components/analysis/AnalysisMenu";
import { dayLabel, formatTime, groupByDay, groupColor } from "@/lib/analysis";
import { cn, formatPercent } from "@/lib/utils";

/**
 * Analyses grouped by day, colour-coded by class group (reference: the "Calendar" card:
 * red date header for today, coloured bars, times on the right, latest item highlighted).
 */
export function ActivityList({ items, className }: { items: AnalysisListItem[]; className?: string }) {
  const groups = groupByDay(items);
  return (
    <div className={cn("flex flex-col gap-2.5 rounded-lg bg-surface p-3", className)}>
      {groups.map((group, groupIndex) => {
        const label = dayLabel(group.iso);
        return (
          <section key={group.key} aria-label={label.text} className="flex flex-col gap-2">
            <div className="flex flex-col gap-1 px-1">
              <h3 className={cn("text-md font-semibold", label.today ? "text-today" : "text-muted")}>{label.text}</h3>
              {label.today && <hr className="border-0 border-t border-line" />}
            </div>
            <ul className="flex flex-col gap-2">
              {group.items.map((item, index) => {
                const color = groupColor(item.predicted_class.group);
                const highlight = groupIndex === 0 && index === 0;
                return (
                  <li key={item.id}>
                    <AnalysisMenu item={item}>
                      <Link
                        to={`/app/analyses/${item.id}`}
                        aria-label={`${item.predicted_class.name}, ${formatPercent(item.confidence)} probability, ${formatTime(item.created_at)}${item.uncertain ? ", flagged uncertain" : ""}`}
                        className="press-soft relative flex min-h-[25px] items-center justify-between gap-2 rounded-[6px] px-1 py-0.5 before:absolute before:-inset-y-1 before:inset-x-0"
                        style={{
                          color,
                          background: highlight ? `color-mix(in srgb, ${color} 10%, transparent)` : undefined,
                        }}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="h-[18px] w-[3px] shrink-0 rounded-full" style={{ background: color }} aria-hidden />
                          <span className="truncate text-base font-semibold tracking-ref">{item.predicted_class.name}</span>
                          <span className="tabular shrink-0 text-xs opacity-75">{formatPercent(item.confidence, 0)}</span>
                        </span>
                        <span className="tabular shrink-0 text-xs tracking-ref">{formatTime(item.created_at)}</span>
                      </Link>
                    </AnalysisMenu>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
