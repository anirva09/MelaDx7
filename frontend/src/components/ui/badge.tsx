import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  // Reference tag ("In progress"): radius 10, 14px medium, 4/8 padding.
  "inline-flex items-center gap-1.5 rounded-[10px] px-2 py-1 text-md leading-[18px] font-medium tracking-title whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-surface-2 text-ink-2 dark:bg-[#2a2a2a]",
        tag: "bg-tag text-tag-ink",
        accent: "bg-accent-soft text-accent-ink",
        caution: "bg-caution-soft text-caution",
        danger: "bg-danger-soft text-danger",
        good: "bg-good-soft text-good",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
