import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Page container. Phones: safe-area-aware padding that clears the floating top controls
 * and bottom navigation. Desktop: the dashboard frame's 60px gutters.
 */
export function Page({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "page-mobile mx-auto flex w-full max-w-[1480px] flex-col gap-6",
        "lg:!px-8 lg:!pb-14 lg:!pt-8 xl:!px-[60px]",
        className,
      )}
      {...props}
    />
  );
}

/** Large page title on phones (reference note title: 24px bold, -3%). */
export function PageTitle({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <h1 id={id} className={cn("text-2xl font-bold tracking-title text-ink", className)}>
      {children}
    </h1>
  );
}

interface DesktopHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

/** Desktop page header (reference: "Good morning, Kole" 32px, date 15px, pill buttons). */
export function DesktopHeader({ title, subtitle, actions }: DesktopHeaderProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold tracking-display text-ink">{title}</h1>
        {subtitle && <p className="mt-2 text-[1.0625rem] text-subtle">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3 pt-4">{actions}</div>}
    </header>
  );
}

/** A property row under a page title (reference: "Status  [In progress]"). */
export function MetaRow({
  icon,
  label,
  children,
  className,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-[26px] items-center gap-4", className)}>
      <span className="flex w-[124px] shrink-0 items-center gap-4 text-base font-medium tracking-title text-muted [&_svg]:size-5 [&_svg]:stroke-[1.5]">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <div className="min-w-0 flex-1 text-base tracking-ref text-ink">{children}</div>
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("border-0 border-t border-line", className)} />;
}
