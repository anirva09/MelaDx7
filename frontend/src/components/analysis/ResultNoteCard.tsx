import { ScanLine } from "lucide-react";
import { Link } from "react-router-dom";

import type { AnalysisListItem } from "@/api/types";
import { AnalysisMenu } from "@/components/analysis/AnalysisMenu";
import { formatAgo, groupColor } from "@/lib/analysis";
import { GROUP_LABEL } from "@/lib/copy";
import { cn, formatPercent } from "@/lib/utils";

/** A saved result as a note card (reference: 211x240 "Notebook" cards, faded at the bottom). */
export function ResultNoteCard({ item, className }: { item: AnalysisListItem; className?: string }) {
  return (
    <AnalysisMenu item={item} className="shrink-0 snap-start">
      <Link
        to={`/app/analyses/${item.id}`}
        className={cn(
          "press-soft flex h-[240px] w-[211px] flex-col gap-4 overflow-hidden rounded-lg bg-surface-2 px-4 pb-[18px] pt-4",
          className,
        )}
      >
        <span className="flex items-center justify-between gap-2 text-xs">
          <span className="flex min-w-0 items-center gap-1 text-ink">
            <ScanLine
              className="size-4 shrink-0"
              strokeWidth={1.25}
              style={{ color: groupColor(item.predicted_class.group) }}
              aria-hidden
            />
            <span className="truncate">
              {GROUP_LABEL[item.predicted_class.group] ?? item.predicted_class.group}
            </span>
          </span>
          <span className="shrink-0 text-muted">{formatAgo(item.created_at)}</span>
        </span>
        <span className="fade-bottom flex min-h-0 flex-col gap-2 overflow-hidden [&>*]:shrink-0">
          <span className="truncate text-base font-medium tracking-ref text-ink">
            {item.predicted_class.name}
          </span>
          <ul className="list-disc pl-4 text-xs leading-4 text-ink-2 marker:text-ink-2">
            <li className="tabular">{formatPercent(item.confidence)} probability</li>
            <li>{item.uncertain ? "Flagged uncertain" : "Within confidence thresholds"}</li>
            <li className="truncate">{item.model_label}</li>
          </ul>
          <img
            src={item.thumbnail_url}
            alt=""
            loading="lazy"
            decoding="async"
            width={179}
            height={112}
            className="mt-2 h-[112px] w-full shrink-0 rounded-[10px] bg-stage object-cover"
          />
        </span>
      </Link>
    </AnalysisMenu>
  );
}

export function NoteCardSkeleton() {
  return <div className="h-[240px] w-[211px] shrink-0 animate-pulse rounded-lg bg-surface-2" aria-hidden />;
}
