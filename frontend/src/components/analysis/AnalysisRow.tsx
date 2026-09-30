import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

import type { AnalysisListItem } from "@/api/types";
import { AnalysisMenu } from "@/components/analysis/AnalysisMenu";
import { SwipeRow } from "@/components/ui/swipe-row";
import { formatTime, groupColor } from "@/lib/analysis";
import { formatPercent } from "@/lib/utils";

/**
 * One analysis in a grouped list: thumbnail, class, probability and file, time on the right.
 * Swipe left to delete; long-press for the full action menu.
 */
export function AnalysisRow({
  item,
  onDelete,
}: {
  item: AnalysisListItem;
  onDelete: (item: AnalysisListItem) => void;
}) {
  const color = groupColor(item.predicted_class.group);
  return (
    <SwipeRow onDelete={() => onDelete(item)} deleteLabel={`Delete analysis of ${item.original_filename}`}>
      <AnalysisMenu item={item}>
        <Link
          to={`/app/analyses/${item.id}`}
          className="press-soft flex min-h-16 items-center gap-3 px-3 py-2.5 hover:bg-active"
        >
          <span className="relative shrink-0">
            <img
              src={item.thumbnail_url}
              alt=""
              loading="lazy"
              decoding="async"
              width={44}
              height={44}
              className="size-11 rounded-[10px] bg-stage object-cover"
            />
            <span
              aria-hidden
              className="absolute -left-1 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full"
              style={{ background: color }}
            />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-base font-medium tracking-ref text-ink">
              {item.predicted_class.name}
            </span>
            <span className="truncate text-xs text-muted">
              <span className="tabular">{formatPercent(item.confidence)}</span>
              {item.uncertain && <span className="text-caution"> · uncertain</span>} ·{" "}
              {item.original_filename}
            </span>
          </span>
          <span className="tabular shrink-0 text-xs text-muted">{formatTime(item.created_at)}</span>
          <ChevronRight className="size-4 shrink-0 text-faint" strokeWidth={1.5} aria-hidden />
        </Link>
      </AnalysisMenu>
    </SwipeRow>
  );
}
