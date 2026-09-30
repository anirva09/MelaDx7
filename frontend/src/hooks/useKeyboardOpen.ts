import { useEffect, useState } from "react";

const EDITABLE =
  "input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]),textarea,select,[contenteditable=true]";

/**
 * True while a text field has focus on a touch device, i.e. while the on-screen keyboard is
 * up. Floating bottom chrome hides then so it never sits on top of the field being edited.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    if (!coarse) return;
    const onIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.matches?.(EDITABLE)) return;
      setOpen(true);
      // Keep the focused field clear of the keyboard once the viewport has resized.
      window.setTimeout(() => target.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
    };
    const onOut = () =>
      window.setTimeout(() => setOpen(Boolean(document.activeElement?.matches?.(EDITABLE))), 0);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);
  return open;
}
