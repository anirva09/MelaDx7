import { ToggleGroup } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface Option<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  title?: string;
}

interface SegmentedProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: Option<T>[];
  label: string;
  className?: string;
  size?: "sm" | "md";
  tone?: "default" | "stage";
  /** Hide text labels below the `sm` breakpoint (icons stay; labels remain for screen readers). */
  compactLabels?: boolean;
}

/** Single-select segmented control (a radio group with roving focus). */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  label,
  className,
  size = "md",
  tone = "default",
  compactLabels = false,
}: SegmentedProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => next && onValueChange(next as T)}
      aria-label={label}
      className={cn(
        "inline-flex max-w-full overflow-x-auto rounded-md p-0.5 [scrollbar-width:none]",
        tone === "stage" ? "bg-white/[0.06] ring-1 ring-white/10" : "bg-surface-2 ring-1 ring-line",
        className,
      )}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          title={option.title}
          className={cn(
            "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[5px] font-medium transition-colors [&_svg]:size-4",
            size === "sm" ? "h-7 px-2.5 text-2xs" : "h-8 px-3 text-xs",
            tone === "stage"
              ? "text-white/65 hover:text-white data-[state=on]:bg-white/15 data-[state=on]:text-white"
              : "text-muted hover:text-ink data-[state=on]:bg-surface data-[state=on]:text-ink data-[state=on]:shadow-[var(--shadow-card)]",
          )}
        >
          {option.icon}
          <span className={cn(compactLabels && option.icon && "sr-only sm:not-sr-only")}>{option.label}</span>
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
