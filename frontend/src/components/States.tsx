import { CircleAlert, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, errorMessage } from "@/lib/utils";

export function LoadingState({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("flex flex-col gap-3", className)}>
      <span className="sr-only">{label}</span>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-full max-w-lg" />
      <Skeleton className="h-4 w-full max-w-md" />
    </div>
  );
}

interface ErrorStateProps {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  error,
  title = "This could not be loaded",
  onRetry,
  className,
}: ErrorStateProps) {
  const requestId = error instanceof ApiError ? error.requestId : null;
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-start gap-3 rounded-lg bg-danger-soft p-4", className)}
    >
      <div className="flex items-start gap-3">
        <CircleAlert className="mt-px size-5 shrink-0 text-danger" strokeWidth={1.5} aria-hidden />
        <div>
          <p className="text-base font-medium tracking-ref text-ink">{title}</p>
          <p className="mt-1 text-md text-ink-2">{errorMessage(error)}</p>
          {requestId && <p className="mt-1 font-mono text-xs text-ink-2">Reference {requestId}</p>}
        </div>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="ml-8">
          <RefreshCw aria-hidden /> Try again
        </Button>
      )}
    </div>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg bg-surface px-6 py-12 text-center",
        className,
      )}
    >
      {icon && <div className="text-muted [&_svg]:size-8 [&_svg]:stroke-[1.5]">{icon}</div>}
      <div className="max-w-md">
        <p className="text-lg font-semibold tracking-ref text-ink">{title}</p>
        {description && <div className="mt-1 text-md text-subtle">{description}</div>}
      </div>
      {action}
    </div>
  );
}
