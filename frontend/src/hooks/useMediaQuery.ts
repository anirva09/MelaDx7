import { useSyncExternalStore } from "react";

function subscribe(query: string) {
  return (onChange: () => void) => {
    const media = window.matchMedia?.(query);
    media?.addEventListener?.("change", onChange);
    return () => media?.removeEventListener?.("change", onChange);
  };
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribe(query),
    () => Boolean(window.matchMedia?.(query).matches),
    () => false,
  );
}

/**
 * Desktop (>= 1024px) gets the sidebar dashboard; below that the app is a separate,
 * touch-first interaction design (floating tab bar, sheets, gestures), not a hidden sidebar.
 */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}

export function useCoarsePointer(): boolean {
  return useMediaQuery("(pointer: coarse)");
}
