import { Check } from "lucide-react";
import { DropdownMenu as Menu } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({ className, ...props }: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={8}
        align="end"
        collisionPadding={12}
        className={cn(
          // Reference "Note - Keyboard Menu": translucent, blurred, radius 19, 12px padding.
          "glass-menu data-open-pop z-50 min-w-[215px] origin-[var(--radix-dropdown-menu-content-transform-origin)] rounded-[19px] p-1.5",
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof Menu.Item>) {
  return (
    <Menu.Item
      className={cn(
        "flex min-h-11 cursor-default select-none items-center gap-2 rounded-[13px] px-2.5 text-base font-medium tracking-ref text-ink outline-none",
        "data-[highlighted]:bg-active data-[disabled]:opacity-40 [&_svg]:size-6 [&_svg]:stroke-[1.5] [&_svg]:text-ink",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Menu.Label>) {
  return <Menu.Label className={cn("px-2.5 py-2 text-xs text-muted", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn("mx-2.5 my-1 h-px bg-[var(--menu-line)]", className)} {...props} />;
}

export const DropdownMenuRadioGroup = Menu.RadioGroup;

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.RadioItem>) {
  return (
    <Menu.RadioItem
      className={cn(
        "flex min-h-11 cursor-default select-none items-center gap-2 rounded-[13px] px-2.5 text-base font-medium tracking-ref text-ink outline-none",
        "data-[highlighted]:bg-active data-[state=checked]:bg-active [&_svg]:size-6 [&_svg]:stroke-[1.5]",
        className,
      )}
      {...props}
    >
      {children}
      <Menu.ItemIndicator className="ml-auto">
        <Check aria-hidden className="!size-5 text-accent" />
      </Menu.ItemIndicator>
    </Menu.RadioItem>
  );
}
