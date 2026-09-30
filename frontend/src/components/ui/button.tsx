import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { Slot } from "radix-ui";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "press inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium tracking-ref " +
    "disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:stroke-[1.5] select-none",
  {
    variants: {
      variant: {
        primary: "bg-accent-fill text-accent-contrast hover:brightness-110",
        secondary: "bg-surface-2 text-ink hover:bg-field dark:bg-[#242424] dark:hover:bg-[#2c2c2c]",
        glass: "glass text-ink hover:brightness-125",
        ghost: "text-ink-2 hover:bg-active hover:text-ink",
        danger: "bg-danger text-white hover:brightness-110",
        "danger-ghost": "text-danger hover:bg-danger-soft",
        link: "text-accent underline-offset-4 hover:underline px-0 h-auto active:scale-100",
      },
      size: {
        sm: "h-[30px] px-3 text-sm font-normal [&_svg]:size-[18px]",
        md: "h-11 px-5 text-base",
        lg: "h-12 px-6 text-base font-semibold",
        icon: "size-11 [&_svg]:size-6",
        "icon-sm": "size-9 [&_svg]:size-5",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={asChild ? undefined : disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && <LoaderCircle className="animate-spin" aria-hidden />}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

// eslint-disable-next-line react-refresh/only-export-components
export { buttonVariants };
