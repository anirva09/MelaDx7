import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

/**
 * Floating chrome (top controls, tab bar, page toolbars) is rendered outside the scrolling
 * content so it stays anchored to the viewport even while the content recedes behind a sheet.
 */
export function FixedChrome({ children, className }: { children: ReactNode; className?: string }) {
  if (typeof document === "undefined") return null;
  return createPortal(<div className={cn("fixed-chrome", className)}>{children}</div>, document.body);
}
