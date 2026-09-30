import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useAnalyses } from "@/api/queries";
import type { AnalysisListItem } from "@/api/types";
import { TextTabs } from "@/components/ui/section";
import { formatTime, groupColor } from "@/lib/analysis";
import { cn, formatPercent } from "@/lib/utils";

type Range = "today" | "week" | "month";

interface Column {
  key: string;
  label: string;
  start: number;
  end: number;
  current: boolean;
}

const hourLabel = (h: number) => (h === 0 ? "12 am" : h === 12 ? "Noon" : h < 12 ? `${h} am` : `${h - 12} pm`);
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" });
const monthDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function columnsFor(range: Range, now: Date, items: AnalysisListItem[]): Column[] {
  if (range === "today") {
    const day = startOfDay(now).getTime();
    const hours = items.map((i) => new Date(i.created_at).getHours());
    const nowHour = now.getHours();
    // Seven hour columns around today's analyses, or around the current hour.
    let first = hours.length ? Math.min(...hours) : nowHour - 3;
    const last = hours.length ? Math.max(...hours, first + 6) : first + 6;
    first = Math.max(0, Math.min(first, 17, last - 6));
    const count = Math.min(24 - first, Math.max(7, last - first + 1));
    return Array.from({ length: count }, (_, i) => {
      const h = first + i;
      return {
        key: `h${h}`,
        label: hourLabel(h),
        start: day + h * 3_600_000,
        end: day + (h + 1) * 3_600_000,
        current: h === nowHour,
      };
    });
  }
  if (range === "week") {
    const today = startOfDay(now);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() - 6 + i);
      const next = new Date(d);
      next.setDate(d.getDate() + 1);
      return { key: `d${i}`, label: i === 6 ? "Today" : dayFmt.format(d), start: d.getTime(), end: next.getTime(), current: i === 6 };
    });
  }
  const today = startOfDay(now);
  return Array.from({ length: 5 }, (_, i) => {
    const end = new Date(today);
    end.setDate(today.getDate() + 1 - (4 - i) * 7);
    const start = new Date(end);
    start.setDate(end.getDate() - 7);
    const lastDay = new Date(end);
    lastDay.setDate(end.getDate() - 1);
    return {
      key: `w${i}`,
      label: `${monthDay.format(start)}–${monthDay.format(lastDay).replace(/^\w+ /, "")}`,
      start: start.getTime(),
      end: end.getTime(),
      current: i === 4,
    };
  });
}

function rangeStart(range: Range, now: Date): Date {
  const d = startOfDay(now);
  if (range === "week") d.setDate(d.getDate() - 6);
  if (range === "month") d.setDate(d.getDate() - 34);
  return d;
}

/**
 * Analyses on a time grid (reference: the desktop "Calendar" card with hour columns and
 * a Today/Week/Month switch). Every block is a stored analysis; nothing is interpolated.
 */
export function ActivityTimeline() {
  const [range, setRange] = useState<Range>("week");
  const [now] = useState(() => new Date());
  const from = useMemo(() => rangeStart(range, now).toISOString(), [range, now]);
  const query = useAnalyses({ date_from: from, page: 1, page_size: 100, sort: "created_at", order: "desc" });
  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const columns = useMemo(() => columnsFor(range, now, items), [range, now, items]);
  const byColumn = useMemo(
    () =>
      columns.map((c) =>
        items.filter((i) => {
          const t = new Date(i.created_at).getTime();
          return t >= c.start && t < c.end;
        }),
      ),
    [columns, items],
  );
  const truncated = (query.data?.total ?? 0) > items.length;

  return (
    <section aria-labelledby="activity-heading" className="overflow-hidden rounded-lg bg-surface">
      <div className="bg-[var(--surface-2)] px-5 pt-3.5 dark:bg-[#1f1f1f]">
        <div className="flex items-center justify-between gap-4">
          <h2 id="activity-heading" className="text-lg font-semibold tracking-ref text-ink">
            Activity
          </h2>
          <TextTabs
            label="Time range"
            value={range}
            onValueChange={setRange}
            options={[
              { value: "today", label: "Today" },
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
            ]}
          />
        </div>
        <div className="mt-6 grid pb-3" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
          {columns.map((c) => (
            <span key={c.key} className={cn("truncate text-center text-sm", c.current ? "text-ink" : "text-muted")}>
              {c.label}
            </span>
          ))}
        </div>
      </div>
      <div
        className="grid min-h-[165px]"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
        aria-busy={query.isFetching}
      >
        {columns.map((c, index) => {
          const list = byColumn[index] ?? [];
          return (
            <div
              key={c.key}
              className={cn("flex min-w-0 flex-col gap-1.5 p-1.5", index > 0 && "border-l border-[var(--chart-grid)]")}
              aria-label={`${c.label}: ${list.length} ${list.length === 1 ? "analysis" : "analyses"}`}
              role="group"
            >
              {list.slice(0, 2).map((item) => {
                const color = groupColor(item.predicted_class.group);
                return (
                  <Link
                    key={item.id}
                    to={`/app/analyses/${item.id}`}
                    className="press-soft flex min-w-0 gap-1.5 rounded-[6px] p-1"
                    style={{ background: `color-mix(in srgb, ${color} 10%, transparent)`, color }}
                  >
                    <span className="w-[3px] shrink-0 rounded-full" style={{ background: color }} aria-hidden />
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="line-clamp-2 text-base font-semibold leading-5 tracking-ref">
                        {item.predicted_class.name}
                      </span>
                      <span className="tabular text-xs tracking-ref">
                        {formatPercent(item.confidence, 0)} · {formatTime(item.created_at)}
                      </span>
                    </span>
                  </Link>
                );
              })}
              {list.length > 2 && (
                <Link
                  to={`/app/analyses?from=${localDate(c.start)}&to=${localDate(c.end - 1)}`}
                  className="px-1 text-xs text-muted hover:text-ink"
                >
                  +{list.length - 2} more
                </Link>
              )}
            </div>
          );
        })}
      </div>
      {truncated && (
        <p className="border-t border-[var(--chart-grid)] px-5 py-2 text-xs text-muted">
          Showing the latest 100 analyses in this range.
        </p>
      )}
    </section>
  );
}
