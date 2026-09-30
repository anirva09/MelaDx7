import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-line bg-surface-2 text-ink-2",
        accent: "border-transparent bg-accent-soft text-accent-ink",
        caution: "border-caution-line bg-caution-soft text-caution",
        danger: "border-danger-line bg-danger-soft text-danger",
        good: "border-transparent bg-good-soft text-good",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
