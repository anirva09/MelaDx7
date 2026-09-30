import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const tones = {
  info: { box: "border-line bg-surface-2", icon: Info, iconClass: "text-accent" },
  caution: { box: "border-caution-line bg-caution-soft", icon: TriangleAlert, iconClass: "text-caution" },
  danger: { box: "border-danger-line bg-danger-soft", icon: CircleAlert, iconClass: "text-danger" },
} as const;

interface NoticeProps {
  tone?: keyof typeof tones;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  /**
   * Announce immediately to screen readers (role="alert"). Use only for the result of
   * something the user just did; persistent page banners stay role="note".
   */
  announce?: boolean;
}

/** Inline callout. Colour is always paired with an icon and a text title. */
export function Notice({ tone = "info", title, children, action, className, announce = false }: NoticeProps) {
  const { box, icon: Icon, iconClass } = tones[tone];
  return (
    <div
      role={announce ? "alert" : "note"}
      className={cn(
        "flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-start",
        box,
        className,
      )}
    >
      <div className="flex flex-1 items-start gap-3">
        <Icon className={cn("mt-0.5 size-5 shrink-0", iconClass)} aria-hidden />
        <div className="min-w-0 text-sm">
          <p className="font-medium text-ink">{title}</p>
          {children && <div className="mt-0.5 text-ink-2">{children}</div>}
        </div>
      </div>
      {action && <div className="shrink-0 pl-8 sm:pl-0">{action}</div>}
    </div>
  );
}
