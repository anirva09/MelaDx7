import { ArrowDown, ArrowUp, ArrowUpDown, TriangleAlert } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import type { AnalysisListItem } from "@/api/types";
import { GroupDot } from "@/components/ClassGroupBadge";
import { Badge } from "@/components/ui/badge";
import { cn, formatDateTime, formatPercent, formatRelative, shortId } from "@/lib/utils";

export type SortKey = "created_at" | "confidence" | "predicted_class";

interface AnalysisTableProps {
  items: AnalysisListItem[];
  sort?: SortKey;
  order?: "asc" | "desc";
  onSortChange?: (sort: SortKey, order: "asc" | "desc") => void;
  compact?: boolean;
  caption: string;
}

function SortButton({
  label,
  column,
  sort,
  order,
  onSortChange,
}: {
  label: string;
  column: SortKey;
  sort?: SortKey;
  order?: "asc" | "desc";
  onSortChange?: AnalysisTableProps["onSortChange"];
}) {
  if (!onSortChange) return <>{label}</>;
  const active = sort === column;
  const Icon = !active ? ArrowUpDown : order === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSortChange(column, active && order === "desc" ? "asc" : "desc")}
      className={cn("inline-flex items-center gap-1 hover:text-ink", active && "text-ink")}
    >
      {label}
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}

function ConfidenceCell({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-field" aria-hidden>
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-series-1"
          style={{ width: `${value * 100}%` }}
        />
      </span>
      <span className="tabular">{formatPercent(value)}</span>
    </span>
  );
}

/** History table for the desktop layout (phones use grouped rows). Rows link to the full result. */
export function AnalysisTable({
  items,
  sort,
  order,
  onSortChange,
  compact = false,
  caption,
}: AnalysisTableProps) {
  const navigate = useNavigate();
  const ariaSort = (column: SortKey) =>
    sort === column ? (order === "asc" ? "ascending" : "descending") : ("none" as const);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-md">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-line text-sm text-muted">
            <tr>
              <th scope="col" className="w-14 px-4 py-2.5 font-medium">
                <span className="sr-only">Thumbnail</span>
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                Image
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium" aria-sort={ariaSort("predicted_class")}>
                <SortButton
                  label="Predicted class"
                  column="predicted_class"
                  {...{ sort, order, onSortChange }}
                />
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium" aria-sort={ariaSort("confidence")}>
                <SortButton label="Probability" column="confidence" {...{ sort, order, onSortChange }} />
              </th>
              {!compact && (
                <th scope="col" className="px-3 py-2.5 font-medium">
                  Model
                </th>
              )}
              <th
                scope="col"
                className="px-4 py-2.5 text-right font-medium"
                aria-sort={ariaSort("created_at")}
              >
                <SortButton label="Date" column="created_at" {...{ sort, order, onSortChange }} />
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                onClick={() => navigate(`/app/analyses/${item.id}`)}
                className="cursor-pointer border-b border-line last:border-0 hover:bg-active"
              >
                <td className="px-4 py-2.5">
                  <img
                    src={item.thumbnail_url}
                    alt=""
                    loading="lazy"
                    className="size-10 rounded-[10px] bg-stage object-cover"
                  />
                </td>
                <td className="max-w-56 px-3 py-2.5">
                  <Link
                    to={`/app/analyses/${item.id}`}
                    onClick={(event) => event.stopPropagation()}
                    className="block truncate font-medium text-ink hover:text-accent"
                  >
                    {item.original_filename}
                  </Link>
                  <span className="font-mono text-xs text-muted">{shortId(item.id)}</span>
                </td>
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-2">
                    <GroupDot group={item.predicted_class.group} />
                    <span className="font-medium text-ink">{item.predicted_class.name}</span>
                    {item.uncertain && (
                      <Badge tone="caution" title="Uncertain prediction">
                        <TriangleAlert className="size-3.5" aria-hidden /> Uncertain
                      </Badge>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <ConfidenceCell value={item.confidence} />
                </td>
                {!compact && <td className="px-3 py-2.5 text-sm text-muted">{item.model_label}</td>}
                <td className="whitespace-nowrap px-4 py-2.5 text-right text-sm text-muted">
                  <time dateTime={item.created_at} title={formatDateTime(item.created_at)}>
                    {compact ? formatRelative(item.created_at) : formatDateTime(item.created_at)}
                  </time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
