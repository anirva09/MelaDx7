import { useEffect, useRef, useState } from "react";

const THRESHOLD = 72;
const MAX_PULL = 120;

export type PullState = { distance: number; refreshing: boolean };

/**
 * Pull-to-refresh on the window scroller for touch devices. Returns the current pull
 * distance and whether a refresh is running, for a visual indicator.
 */
export function usePullToRefresh(onRefresh: () => Promise<unknown>, enabled = true): PullState {
  const [state, setState] = useState<PullState>({ distance: 0, refreshing: false });
  const startY = useRef<number | null>(null);
  const distanceRef = useRef(0);
  const refreshing = useRef(false);
  const callback = useRef(onRefresh);

  useEffect(() => {
    callback.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return;
    const onStart = (event: TouchEvent) => {
      if (refreshing.current || window.scrollY > 0 || event.touches.length !== 1) return;
      if (document.documentElement.hasAttribute("data-sheet-open")) return;
      startY.current = event.touches[0]!.clientY;
    };
    const onMove = (event: TouchEvent) => {
      if (startY.current === null) return;
      const dy = event.touches[0]!.clientY - startY.current;
      if (dy <= 0 || window.scrollY > 0) {
        distanceRef.current = 0;
        setState((s) => (s.distance ? { ...s, distance: 0 } : s));
        return;
      }
      // Rubber-band resistance, like native scroll views.
      const distance = Math.min(MAX_PULL, dy * 0.5);
      distanceRef.current = distance;
      setState((s) => ({ ...s, distance }));
    };
    const onEnd = () => {
      if (startY.current === null) return;
      startY.current = null;
      const pulled = distanceRef.current;
      distanceRef.current = 0;
      if (pulled >= THRESHOLD) {
        refreshing.current = true;
        navigator.vibrate?.(10);
        setState({ distance: THRESHOLD * 0.75, refreshing: true });
        void callback.current().finally(() => {
          refreshing.current = false;
          setState({ distance: 0, refreshing: false });
        });
      } else {
        setState({ distance: 0, refreshing: false });
      }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled]);

  return state;
}

export const PULL_THRESHOLD = THRESHOLD;
