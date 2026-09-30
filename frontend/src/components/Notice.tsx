import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const tones = {
  info: { icon: Info, iconClass: "text-accent", bar: "bg-accent" },
  caution: { icon: TriangleAlert, iconClass: "text-caution", bar: "bg-caution" },
  danger: { icon: CircleAlert, iconClass: "text-danger", bar: "bg-danger" },
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

/** Inline callout in the reference's card language. Colour is always paired with an icon and a title. */
export function Notice({ tone = "info", title, children, action, className, announce = false }: NoticeProps) {
  const { icon: Icon, iconClass } = tones[tone];
  return (
    <div
      role={announce ? "alert" : "note"}
      className={cn("flex flex-col gap-3 rounded-lg bg-surface p-4 sm:flex-row sm:items-start", className)}
    >
      <div className="flex flex-1 items-start gap-3">
        <Icon className={cn("mt-px size-5 shrink-0", iconClass)} strokeWidth={1.5} aria-hidden />
        <div className="min-w-0">
          <p className="text-base font-medium tracking-ref text-ink">{title}</p>
          {children && <div className="mt-1 text-md leading-relaxed text-ink-2">{children}</div>}
        </div>
      </div>
      {action && <div className="shrink-0 pl-8 sm:pl-0">{action}</div>}
    </div>
  );
}
