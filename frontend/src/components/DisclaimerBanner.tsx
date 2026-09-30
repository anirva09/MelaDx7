import { ShieldCheck } from "lucide-react";

import { MEDICAL_DISCLAIMER } from "@/lib/copy";
import { cn } from "@/lib/utils";

/** The medical-safety statement. Shown wherever model output is shown. */
export function DisclaimerBanner({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <aside
      aria-label="Medical disclaimer"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-line bg-surface-2 text-ink-2",
        compact ? "px-3 py-2.5 text-xs" : "px-4 py-3 text-sm",
        className,
      )}
    >
      <ShieldCheck
        className={cn("shrink-0 text-accent", compact ? "mt-px size-4" : "mt-0.5 size-5")}
        aria-hidden
      />
      <p>{MEDICAL_DISCLAIMER}</p>
    </aside>
  );
}
