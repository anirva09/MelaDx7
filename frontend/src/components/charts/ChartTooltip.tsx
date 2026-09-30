import type { ReactNode } from "react";

/** Shared tooltip body: text in ink tokens, identity carried by a small swatch. */
export function TooltipCard({
  title,
  rows,
}: {
  title: ReactNode;
  rows: { label: string; value: string; color?: string }[];
}) {
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-[var(--shadow-pop)]">
      <p className="mb-1 font-medium text-ink">{title}</p>
      {rows.map((row) => (
        <p key={row.label} className="flex items-center gap-2 text-ink-2">
          {row.color && (
            <span className="size-2 rounded-full" style={{ background: row.color }} aria-hidden />
          )}
          <span>{row.label}</span>
          <span className="tabular ml-auto pl-3 font-medium text-ink">{row.value}</span>
        </p>
      ))}
    </div>
  );
}
