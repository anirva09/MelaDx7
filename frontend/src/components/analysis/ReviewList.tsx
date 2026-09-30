import { Check } from "lucide-react";
import { Fragment } from "react";
import { Link } from "react-router-dom";

import type { AnalysisListItem } from "@/api/types";
import { AnalysisMenu } from "@/components/analysis/AnalysisMenu";
import { cn, formatPercent } from "@/lib/utils";

interface ReviewListProps {
  items: AnalysisListItem[];
  /** How many recent analyses were checked (for the "all clear" row). */
  checked: number;
  onNew: () => void;
  className?: string;
}

/**
 * Results flagged as uncertain, as a checklist (reference: "Daily Tasks"). The last row is
 * the placeholder that starts a new analysis ("Add task" in the reference).
 */
export function ReviewList({ items, checked, onNew, className }: ReviewListProps) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg bg-surface p-4", className)}>
      {items.length === 0 && checked > 0 && (
        <>
          <div className="flex gap-3">
            <span
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-white"
              aria-hidden
            >
              <Check className="size-[14px]" strokeWidth={2.4} />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-base font-medium tracking-ref text-muted line-through">
                No results need review
              </span>
              <span className="text-xs font-medium text-muted">
                from: <span className="underline underline-offset-2">latest {checked} analyses</span>
              </span>
            </span>
          </div>
          <hr className="ml-[34px] border-0 border-t border-line" />
        </>
      )}
      {items.map((item) => (
        <Fragment key={item.id}>
          <AnalysisMenu item={item}>
            <Link to={`/app/analyses/${item.id}`} className="press-soft flex gap-3">
              <span className="size-6 shrink-0 rounded-full border-[1.2px] border-line-strong" aria-hidden />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-base font-medium tracking-ref text-ink">
                  Review {item.predicted_class.name}{" "}
                  <span className="tabular text-ink-2">{formatPercent(item.confidence, 0)}</span>
                </span>
                <span className="truncate text-xs font-medium text-muted">
                  from: <span className="underline underline-offset-2">{item.original_filename}</span>
                </span>
              </span>
            </Link>
          </AnalysisMenu>
          <hr className="ml-[34px] border-0 border-t border-line" />
        </Fragment>
      ))}
      <button type="button" onClick={onNew} className="press-soft flex items-center gap-3 text-left">
        <span className="size-6 shrink-0 rounded-full border-[1.2px] border-line" aria-hidden />
        <span className="text-base font-medium text-faint">Start a new analysis</span>
      </button>
    </div>
  );
}
