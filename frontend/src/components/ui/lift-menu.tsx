import { Dialog } from "radix-ui";
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { useLongPress } from "@/hooks/useLongPress";
import { cn } from "@/lib/utils";

export interface MenuAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

interface LongPressMenuProps {
  actions: MenuAction[];
  /** Accessible name for the menu, e.g. "Actions for Melanoma, 30 Sep". */
  label: string;
  children: ReactNode;
  className?: string;
}

const MENU_WIDTH = 239;
const ROW = 44;
const EDGE = 16;
const GAP = 12;

interface Layout {
  preview: { left: number; top: number; width: number; height: number; scale: number; shift: number };
  menu: { left: number; top: number };
  origin: string;
}

function computeLayout(rect: DOMRect, rows: number): Layout {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const styles = getComputedStyle(document.documentElement);
  const safeTop = parseFloat(styles.getPropertyValue("--safe-top")) || 0;
  const safeBottom = parseFloat(styles.getPropertyValue("--safe-bottom")) || 0;
  const menuHeight = rows * ROW + 16;
  const wide = rect.width > vw * 0.7;
  // Narrow cards lift by 10% (reference 211 -> 232); full-width cards stay at their size.
  const scale = wide ? 1 : Math.min(1.1, (vw - 2 * EDGE) / rect.width);
  const origin = wide ? "center" : "left center";
  const scaledHeight = rect.height * scale;
  const growY = (scaledHeight - rect.height) / 2;
  let top = rect.top - growY;
  const minTop = safeTop + EDGE;
  const maxBottom = vh - safeBottom - EDGE;

  let menuTop: number;
  if (top + scaledHeight + GAP + menuHeight <= maxBottom) {
    menuTop = top + scaledHeight + GAP;
  } else if (top - GAP - menuHeight >= minTop) {
    menuTop = top - GAP - menuHeight;
  } else {
    // Not enough room either side: move the card up so the menu fits below it (as iOS does).
    const wanted = maxBottom - menuHeight - GAP - scaledHeight;
    top = Math.max(minTop, wanted);
    menuTop = Math.min(top + scaledHeight + GAP, maxBottom - menuHeight);
  }
  const shift = top - (rect.top - growY);
  const menuLeft = wide ? rect.left + (rect.width - MENU_WIDTH) / 2 : rect.left;
  return {
    preview: { left: rect.left, top: rect.top, width: rect.width, height: rect.height, scale, shift },
    menu: { left: Math.max(EDGE, Math.min(vw - EDGE - MENU_WIDTH, menuLeft)), top: menuTop },
    origin,
  };
}

/**
 * Contextual menu opened by long-press, right-click or the keyboard context-menu key
 * (reference: "Home - Bottom - Focused"). The pressed card lifts above a blurred page and
 * the actions appear beside it.
 */
export function LongPressMenu({ actions, label, children, className }: LongPressMenuProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [lifted, setLifted] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const onTrigger = useCallback((element: HTMLElement) => {
    triggerRef.current = element;
    setLifted(false);
    setRect(element.getBoundingClientRect());
  }, []);
  const pressHandlers = useLongPress(onTrigger);

  useLayoutEffect(() => {
    if (!rect) return;
    const frame = requestAnimationFrame(() => setLifted(true));
    return () => cancelAnimationFrame(frame);
  }, [rect]);

  const close = () => setRect(null);
  const layout = rect ? computeLayout(rect, actions.length) : null;

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? [],
    );
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const move: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };
    if (event.key in move) {
      event.preventDefault();
      items[(index + move[event.key]! + items.length) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    }
  };

  return (
    <>
      <div className={cn("select-none [-webkit-touch-callout:none]", className)} {...pressHandlers}>
        {children}
      </div>
      <Dialog.Root open={rect !== null} onOpenChange={(open) => !open && close()}>
        <Dialog.Portal>
          <Dialog.Overlay className="data-open-fade fixed inset-0 z-50 bg-[rgb(20_20_20/0.35)] backdrop-blur-[16px]" />
          <Dialog.Content
            className="fixed inset-0 z-50 focus:outline-none"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              triggerRef.current?.querySelector<HTMLElement>("a,button")?.focus();
            }}
            onClick={(event) => {
              if (event.target === event.currentTarget) close();
            }}
          >
            <Dialog.Title className="sr-only">{label}</Dialog.Title>
            <Dialog.Description className="sr-only">
              Choose an action, or press Escape to close.
            </Dialog.Description>
            {layout && (
              <>
                <div
                  inert
                  aria-hidden
                  className="pointer-events-none fixed overflow-hidden rounded-lg bg-surface shadow-[0_8px_32px_rgb(0_0_0/0.35)]"
                  style={{
                    left: layout.preview.left,
                    top: layout.preview.top,
                    width: layout.preview.width,
                    height: layout.preview.height,
                    transformOrigin: layout.origin,
                    transform: lifted
                      ? `translateY(${layout.preview.shift}px) scale(${layout.preview.scale})`
                      : "none",
                    transition: "transform 320ms cubic-bezier(0.2, 0.9, 0.3, 1.15)",
                  }}
                >
                  {children}
                </div>
                <div
                  ref={menuRef}
                  role="menu"
                  tabIndex={-1}
                  aria-label={label}
                  onKeyDown={onMenuKeyDown}
                  className="animate-pop-in glass-menu fixed overflow-hidden rounded-[16px] py-2"
                  style={{
                    left: layout.menu.left,
                    top: layout.menu.top,
                    width: MENU_WIDTH,
                    transformOrigin: "top center",
                  }}
                >
                  {actions.map((action, index) => (
                    <button
                      key={action.label}
                      type="button"
                      role="menuitem"
                      disabled={action.disabled}
                      onClick={() => {
                        close();
                        action.onSelect();
                      }}
                      className={cn(
                        "flex h-11 w-full items-center justify-between gap-3 px-4 text-left text-lg tracking-ref outline-none",
                        "focus-visible:bg-active hover:bg-active active:bg-active disabled:opacity-40",
                        "[&_svg]:size-6 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]",
                        index > 0 && "border-t border-[var(--menu-line)]",
                        action.destructive ? "text-danger" : "text-ink",
                      )}
                    >
                      <span className="truncate">{action.label}</span>
                      {action.icon}
                    </button>
                  ))}
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
