import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Label/value rows: stacked on narrow phones, two columns from 640px. */
export function DefinitionList({ rows, className }: { rows: [string, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("flex flex-col", className)}>
      {rows.map(([label, value], i) => (
        <div
          key={label}
          className={cn(
            "grid grid-cols-1 gap-0.5 py-2.5 sm:grid-cols-[minmax(0,10rem)_1fr] sm:gap-4",
            i > 0 && "border-t border-line",
          )}
        >
          <dt className="text-md text-muted">{label}</dt>
          <dd className="min-w-0 break-words text-md text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
