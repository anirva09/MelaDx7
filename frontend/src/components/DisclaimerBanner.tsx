import { ShieldCheck } from "lucide-react";

import { MEDICAL_DISCLAIMER } from "@/lib/copy";
import { cn } from "@/lib/utils";

/** The medical-safety statement. Shown wherever model output is shown. */
export function DisclaimerBanner({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <aside
      aria-label="Medical disclaimer"
      className={cn(
        "flex items-start gap-3 rounded-lg bg-surface text-ink-2",
        compact ? "px-3 py-3 text-xs leading-relaxed" : "p-4 text-md leading-relaxed",
        className,
      )}
    >
      <ShieldCheck
        className={cn("shrink-0 text-muted", compact ? "size-4" : "mt-px size-5")}
        strokeWidth={1.5}
        aria-hidden
      />
      <p>{MEDICAL_DISCLAIMER}</p>
    </aside>
  );
}
