import { useCallback, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";

const PRESS_MS = 450;
const MOVE_TOLERANCE = 10;

/**
 * Long-press (touch/pen), right-click (mouse) and Shift+F10 / ContextMenu key (keyboard)
 * all open the same contextual menu. The click that ends a long press is swallowed so the
 * underlying link does not also navigate.
 */
export function useLongPress(onTrigger: (element: HTMLElement) => void) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);

  const fire = useCallback(
    (element: HTMLElement) => {
      fired.current = true;
      navigator.vibrate?.(8);
      onTrigger(element);
    },
    [onTrigger],
  );

  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      fired.current = false;
      if (event.pointerType === "mouse") return;
      const element = event.currentTarget;
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fire(element);
      }, PRESS_MS);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (!start.current) return;
      if (
        Math.abs(event.clientX - start.current.x) > MOVE_TOLERANCE ||
        Math.abs(event.clientY - start.current.y) > MOVE_TOLERANCE
      ) {
        clear();
      }
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      if (!fired.current) fire(event.currentTarget);
    },
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (fired.current) {
        event.preventDefault();
        event.stopPropagation();
        fired.current = false;
      }
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        fire(event.currentTarget);
      }
    },
  };
}
