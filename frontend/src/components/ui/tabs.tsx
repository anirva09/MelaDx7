import { Tabs as RadixTabs } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const Tabs = RadixTabs.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof RadixTabs.List>) {
  return (
    <RadixTabs.List
      className={cn("no-scrollbar flex gap-5 overflow-x-auto", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        // Text tabs as in the reference ("Recents  Suggested", "Today  Week  Month").
        "whitespace-nowrap py-2 text-sm text-muted transition-colors hover:text-ink data-[state=active]:text-ink",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof RadixTabs.Content>) {
  return <RadixTabs.Content className={cn("pt-4 focus-visible:outline-none lg:pt-6", className)} {...props} />;
}
