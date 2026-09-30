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
        "no-scrollbar inline-flex max-w-full overflow-x-auto rounded-full p-1",
        tone === "stage" ? "bg-white/[0.11] backdrop-blur-md" : "bg-surface-2 dark:bg-[#242424]",
        className,
      )}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          title={option.title}
          className={cn(
            "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full transition-colors [&_svg]:size-[18px] [&_svg]:stroke-[1.5]",
            size === "sm" ? "h-8 px-3 text-sm" : "h-9 px-4 text-md",
            tone === "stage"
              ? "text-white/70 hover:text-white data-[state=on]:bg-white/15 data-[state=on]:text-white"
              : "text-muted hover:text-ink data-[state=on]:bg-active data-[state=on]:text-ink",
          )}
        >
          {option.icon}
          <span className={cn(compactLabels && option.icon && "sr-only sm:not-sr-only")}>{option.label}</span>
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
