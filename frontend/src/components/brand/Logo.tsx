import { cn } from "@/lib/utils";

/** Wordmark: a dermatoscope field-of-view ring with a centred lesion mark. */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight text-ink", className)}>
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" className="fill-stage" />
        <circle cx="16" cy="16" r="10" fill="none" stroke="var(--accent)" strokeWidth="2.5" />
        <circle cx="16" cy="16" r="4.5" fill="var(--accent)" />
      </svg>
      {!compact && <span className="text-[1.05rem]">LesionLens</span>}
    </span>
  );
}
