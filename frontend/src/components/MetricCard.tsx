import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}

/** Stat tile: sentence-case label, proportional-figure value, optional one-line context. */
export function MetricCard({ label, value, hint, className }: MetricCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface px-4 py-3.5 shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-2xs text-muted">{hint}</p>}
    </div>
  );
}
