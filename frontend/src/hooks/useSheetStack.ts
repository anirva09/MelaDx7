import { useEffect } from "react";

let openSheets = 0;

/**
 * While a sheet is open on a phone, the page behind recedes like a stacked card
 * (reference: "Note - Templates"). CSS keys off html[data-sheet-open]; the scroll offset
 * is passed so the page scales from the top of the visible area, not the document.
 */
export function useSheetStack(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    openSheets += 1;
    root.style.setProperty("--sheet-origin", `${window.scrollY}px`);
    root.setAttribute("data-sheet-open", "");
    return () => {
      openSheets -= 1;
      if (openSheets <= 0) {
        openSheets = 0;
        root.removeAttribute("data-sheet-open");
      }
    };
  }, [open]);
}
