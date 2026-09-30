import type { ClassGroup } from "@/api/types";
import { GROUP_LABEL } from "@/lib/copy";
import { cn } from "@/lib/utils";

const DOT: Record<ClassGroup, string> = {
  malignant: "bg-[var(--group-malignant)]",
  premalignant: "bg-[var(--group-premalignant)]",
  benign: "bg-[var(--group-benign)]",
  other: "bg-[var(--group-other)]",
};

/**
 * Class grouping from the model card, as a reference-style tag tinted with the group colour.
 * The label carries the meaning; colour is secondary.
 */
export function ClassGroupBadge({ group, className }: { group: ClassGroup; className?: string }) {
  const color = `var(--group-${group})`;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-[10px] px-2 py-1 text-md font-medium leading-[18px] tracking-title",
        className,
      )}
      style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}
    >
      {GROUP_LABEL[group] ?? group}
    </span>
  );
}

export function GroupDot({ group }: { group: ClassGroup }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", DOT[group])} aria-hidden />;
}
