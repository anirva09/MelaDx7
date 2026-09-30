import { Trash2 } from "lucide-react";
import { useRef, useState, type PointerEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const ACTION_WIDTH = 88;

interface SwipeRowProps {
  children: ReactNode;
  onDelete: () => void;
  /** e.g. "Delete analysis of lesion.jpg" */
  deleteLabel: string;
  className?: string;
}

/**
 * Swipe left to reveal a delete action (touch). The same action is always available from
 * the row's long-press menu, so nothing depends on the gesture.
 */
export function SwipeRow({ children, onDelete, deleteLabel, className }: SwipeRowProps) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; base: number; locked: "x" | "y" | null } | null>(null);
  const moved = useRef(false);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return;
    start.current = { x: event.clientX, y: event.clientY, base: offset, locked: null };
    moved.current = false;
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    const dx = event.clientX - s.x;
    const dy = event.clientY - s.y;
    if (!s.locked) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      s.locked = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (s.locked === "x") {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }
    }
    if (s.locked !== "x") return;
    moved.current = true;
    setOffset(Math.max(-ACTION_WIDTH * 1.4, Math.min(0, s.base + dx)));
  };
  const onPointerUp = () => {
    if (start.current?.locked === "x") setOffset((o) => (o < -ACTION_WIDTH / 2 ? -ACTION_WIDTH : 0));
    start.current = null;
    setDragging(false);
  };

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <button
        type="button"
        onClick={() => {
          setOffset(0);
          onDelete();
        }}
        tabIndex={offset ? 0 : -1}
        aria-hidden={offset ? undefined : true}
        aria-label={deleteLabel}
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-danger text-white"
        style={{ width: ACTION_WIDTH }}
      >
        <Trash2 className="size-6" strokeWidth={1.5} aria-hidden />
      </button>
      <div
        className="relative touch-pan-y bg-surface"
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging ? "none" : "transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={(event) => {
          if (moved.current || offset) {
            event.preventDefault();
            event.stopPropagation();
            moved.current = false;
            if (offset) setOffset(0);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
