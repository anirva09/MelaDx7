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
    <div className={cn("rounded-lg bg-surface px-4 py-3.5", className)}>
      <p className="text-sm text-muted">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold tracking-title text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}
