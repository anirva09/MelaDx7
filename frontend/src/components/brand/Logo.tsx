import { cn } from "@/lib/utils";

/** Wordmark: a dermatoscope field-of-view ring with a centred lesion mark. */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-semibold tracking-ref text-ink", className)}>
      <svg viewBox="0 0 32 32" className="size-[30px] shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#262626" />
        <circle cx="16" cy="16" r="9.5" fill="none" stroke="#fff" strokeWidth="2" />
        <circle cx="16" cy="16" r="4.2" fill="#2995ff" />
      </svg>
      {!compact && <span className="text-base font-bold">LesionLens</span>}
    </span>
  );
}
