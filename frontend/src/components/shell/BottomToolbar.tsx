import type { ReactNode } from "react";

import { FixedChrome } from "@/components/shell/FixedChrome";

/**
 * Floating bottom toolbar for detail screens (reference "Note": a glass pill of tools on the
 * left, a circular action on the right), over the same blurred strip as the tab bar.
 */
export function BottomToolbar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <FixedChrome>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 backdrop-blur-[16px] [mask-image:linear-gradient(to_bottom,transparent,#000_40%)] lg:hidden"
        style={{ height: "calc(var(--tabbar-bottom) + 48px + 34px)" }}
      />
      <div
        className="pointer-events-none fixed inset-x-4 z-40 flex items-center justify-between lg:hidden [&>*]:pointer-events-auto"
        style={{ bottom: "var(--tabbar-bottom)" }}
      >
        <div>{left}</div>
        <div>{right}</div>
      </div>
    </FixedChrome>
  );
}
