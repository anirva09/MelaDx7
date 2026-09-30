import { LoaderCircle } from "lucide-react";

import { FixedChrome } from "@/components/shell/FixedChrome";
import { PULL_THRESHOLD, type PullState } from "@/hooks/usePullToRefresh";

/** Spinner that follows a pull-to-refresh gesture and spins while refreshing. */
export function PullIndicator({ state }: { state: PullState }) {
  if (!state.distance && !state.refreshing) return null;
  const progress = Math.min(1, state.distance / PULL_THRESHOLD);
  return (
    <FixedChrome>
      <div
        className="pointer-events-none fixed inset-x-0 z-20 flex justify-center lg:hidden"
        style={{ top: `calc(var(--page-top) - 36px + ${state.distance * 0.4}px)` }}
        role="status"
        aria-live="polite"
      >
        <span
          className="glass flex size-9 items-center justify-center rounded-full"
          style={{ opacity: state.refreshing ? 1 : progress }}
        >
          <LoaderCircle
            className={state.refreshing ? "size-5 animate-spin text-ink" : "size-5 text-ink"}
            strokeWidth={1.8}
            style={state.refreshing ? undefined : { transform: `rotate(${progress * 300}deg)` }}
            aria-hidden
          />
          <span className="sr-only">{state.refreshing ? "Refreshing" : "Pull to refresh"}</span>
        </span>
      </div>
    </FixedChrome>
  );
}
