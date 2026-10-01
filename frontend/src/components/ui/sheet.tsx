import { Check, Search, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useRef, useState, type PointerEvent, type ReactNode } from "react";

import { GlassCircle } from "@/components/shell/Glass";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useSheetStack } from "@/hooks/useSheetStack";
import { cn } from "@/lib/utils";

interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Read by screen readers when the sheet opens. */
  description: string;
  children: ReactNode;
  /** Shows the blue confirm circle (reference: templates sheet check button). */
  onConfirm?: () => void;
  confirmLabel?: string;
  search?: { value: string; onChange: (value: string) => void; placeholder: string };
  /** "full" reaches the top controls like the reference; "auto" fits the content. */
  size?: "full" | "auto";
  className?: string;
}

const DISMISS_DISTANCE = 110;

/**
 * Bottom sheet (reference: "Note - Templates"). On phones it slides up over a receding page,
 * with close and confirm circles above it and a centred muted title; dragging the header
 * down dismisses it. On desktop it is a centred dialog with the same content.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  onConfirm,
  confirmLabel = "Done",
  search,
  size = "full",
  className,
}: BottomSheetProps) {
  const desktop = useIsDesktop();
  useSheetStack(open && !desktop);
  const [drag, setDrag] = useState(0);
  const dragStart = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (desktop || (event.target as HTMLElement).closest("input,button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = event.clientY;
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStart.current === null) return;
    setDrag(Math.max(0, event.clientY - dragStart.current));
  };
  const onPointerUp = () => {
    if (dragStart.current === null) return;
    dragStart.current = null;
    if (drag > DISMISS_DISTANCE) onOpenChange(false);
    setDrag(0);
  };

  const closeButton = (
    <Dialog.Close asChild>
      <GlassCircle label="Close">
        <X aria-hidden />
      </GlassCircle>
    </Dialog.Close>
  );
  const confirmButton = onConfirm && (
    <GlassCircle label={confirmLabel} tone="accent" onClick={onConfirm}>
      <Check aria-hidden />
    </GlassCircle>
  );

  const searchField = search && (
    <label className="relative block">
      <span className="sr-only">{search.placeholder}</span>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-6 -translate-y-1/2 text-muted"
        strokeWidth={1.5}
        aria-hidden
      />
      <input
        type="search"
        value={search.value}
        onChange={(event) => search.onChange(event.target.value)}
        placeholder={search.placeholder}
        className="h-9 w-full rounded-[12px] bg-field pl-12 pr-3 text-[17px] text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent"
      />
    </label>
  );

  if (desktop) {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="data-open-fade fixed inset-0 z-50 bg-black/50 backdrop-blur-[16px]" />
          <Dialog.Content
            className={cn(
              "data-open-pop fixed left-1/2 top-1/2 z-50 flex max-h-[84vh] w-[min(600px,calc(100vw-4rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[20px] bg-surface-2 shadow-[var(--shadow-pop)] focus:outline-none dark:bg-[#242424]",
              className,
            )}
          >
            <div className="flex items-center justify-between gap-4 px-4 pb-2 pt-4">
              {closeButton}
              <Dialog.Title className="text-lg font-medium tracking-ref text-subtle">{title}</Dialog.Title>
              {confirmButton ?? <span className="size-12" aria-hidden />}
            </div>
            <Dialog.Description className="sr-only">{description}</Dialog.Description>
            {searchField && <div className="px-4 pb-2">{searchField}</div>}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-3">{children}</div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="data-open-fade fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content
          className="sheet-host fixed inset-0 z-50 flex flex-col focus:outline-none"
          onPointerDownOutside={(event) => event.preventDefault()}
          // Focus the sheet itself (as native sheets do); Tab then reaches its controls.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            panelRef.current?.focus();
          }}
        >
          {size === "full" && (
            <div
              className="data-open-fade flex items-center justify-between px-4"
              data-state={open ? "open" : "closed"}
              style={{ paddingTop: "var(--topbar-top)" }}
            >
              {closeButton}
              {confirmButton}
            </div>
          )}
          {/* Tapping the dimmed area closes the sheet, as on native platforms. */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            className="min-h-4 flex-1 cursor-default"
            onClick={() => onOpenChange(false)}
          />
          <div
            ref={panelRef}
            tabIndex={-1}
            className={cn(
              "data-open-sheet flex flex-col overflow-hidden rounded-t-[24px] outline-none bg-surface-2 dark:bg-[#242424]",
              size === "full" ? "h-[calc(100dvh-var(--topbar-top)-64px)]" : "max-h-[85dvh]",
              className,
            )}
            data-state={open ? "open" : "closed"}
            style={{
              transform: drag ? `translateY(${drag}px)` : undefined,
              transition: drag ? "none" : "transform 260ms cubic-bezier(0.32,0.72,0,1)",
            }}
          >
            <div
              className="shrink-0 touch-none px-4 pb-2 pt-2"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <span className="mx-auto mb-2 block h-1 w-9 rounded-full bg-[var(--grabber)]" aria-hidden />
              {size === "auto" ? (
                <div className="flex items-center justify-between gap-3">
                  <Dialog.Title className="text-lg font-medium tracking-ref text-subtle">
                    {title}
                  </Dialog.Title>
                  <div className="flex items-center gap-2">
                    {confirmButton}
                    {closeButton}
                  </div>
                </div>
              ) : (
                <Dialog.Title className="text-center text-lg font-medium tracking-ref text-subtle">
                  {title}
                </Dialog.Title>
              )}
              <Dialog.Description className="sr-only">{description}</Dialog.Description>
              {searchField && <div className="mt-3">{searchField}</div>}
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3"
              style={{ paddingBottom: "calc(var(--safe-bottom) + 24px)" }}
            >
              {children}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
