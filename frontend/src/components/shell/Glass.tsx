import { Slot } from "radix-ui";
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

interface CircleProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name; the control shows only an icon. */
  label: string;
  tone?: "glass" | "accent";
  size?: "md" | "lg";
  asChild?: boolean;
}

/**
 * Circular floating button (reference: back 48px, action 59px). "accent" is the filled blue
 * circle used for confirm and send actions.
 */
export const GlassCircle = forwardRef<HTMLButtonElement, CircleProps>(
  ({ label, tone = "glass", size = "md", asChild, className, children, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : "button"}
        aria-label={label}
        title={label}
        className={cn(
          "press inline-flex shrink-0 items-center justify-center rounded-full text-ink [&_svg]:stroke-[1.5]",
          size === "md" ? "size-12 [&_svg]:size-6" : "size-[59px] [&_svg]:size-[26px]",
          tone === "glass"
            ? "glass hover:brightness-125"
            : "bg-accent text-white shadow-[0_4px_4px_rgb(0_0_0/0.25)] hover:brightness-110",
          "disabled:opacity-45",
          className,
        )}
        {...props}
      >
        {children}
      </Comp>
    );
  },
);
GlassCircle.displayName = "GlassCircle";

/** Pill that groups icon buttons (reference: 96x48 top-right controls, 144x48 toolbar). */
export function GlassPill({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="group"
      className={cn("glass inline-flex h-12 items-center gap-2 rounded-full p-1", className)}
      {...props}
    />
  );
}

interface PillButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  asChild?: boolean;
}

/** 40px hit area, 24px icon: four of these make the reference's 144px pill. */
export const PillButton = forwardRef<HTMLButtonElement, PillButtonProps>(
  ({ label, asChild, className, children, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : "button"}
        aria-label={label}
        title={label}
        className={cn(
          "press relative inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink",
          "hover:bg-active data-[state=open]:bg-active aria-pressed:bg-active disabled:opacity-40",
          "[&_svg]:size-6 [&_svg]:stroke-[1.5]",
          className,
        )}
        {...props}
      >
        {children}
      </Comp>
    );
  },
);
PillButton.displayName = "PillButton";
