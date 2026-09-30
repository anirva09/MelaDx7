import type { ClassGroup } from "@/api/types";
import { GROUP_LABEL } from "@/lib/copy";
import { cn } from "@/lib/utils";

const DOT: Record<ClassGroup, string> = {
  malignant: "bg-[var(--group-malignant)]",
  premalignant: "bg-[var(--group-premalignant)]",
  benign: "bg-[var(--group-benign)]",
  other: "bg-line-strong",
};

/** Class grouping from the model card. The label carries the meaning; the dot is secondary. */
export function ClassGroupBadge({ group, className }: { group: ClassGroup; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-2xs font-medium text-ink-2",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOT[group])} aria-hidden />
      {GROUP_LABEL[group] ?? group}
    </span>
  );
}

export function GroupDot({ group }: { group: ClassGroup }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", DOT[group])} aria-hidden />;
}
