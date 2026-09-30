import { Outlet, useLocation } from "react-router-dom";

import { ComposerProvider } from "@/components/shell/Composer";
import { MobileTabBar } from "@/components/shell/MobileTabBar";
import { Sidebar } from "@/components/shell/Sidebar";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { isTabRoute } from "@/lib/navigation";

/**
 * Signed-in shell.
 *
 * Desktop: the reference dashboard frame, a 220px sidebar beside a rounded main panel.
 * Phones and tablets: a separate touch design. Each screen draws its own floating top
 * controls; the four tab screens share a floating glass tab bar with a circular "new
 * analysis" button, and detail screens replace it with their own toolbar.
 */
export function AppLayout() {
  const desktop = useIsDesktop();
  const { pathname } = useLocation();

  return (
    <ComposerProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-full focus:bg-surface-2 focus:px-4 focus:py-2 focus:text-md"
      >
        Skip to content
      </a>
      <div id="app-content" className="min-h-dvh bg-paper lg:bg-sidebar">
        {desktop && <Sidebar />}
        <main
          id="main"
          tabIndex={-1}
          className="min-h-dvh bg-paper focus:outline-none lg:ml-[220px] lg:mt-[7px] lg:min-h-[calc(100dvh-7px)] lg:rounded-tl-[10px] lg:border-l lg:border-t lg:border-sidebar-line"
        >
          <Outlet />
        </main>
      </div>
      {!desktop && isTabRoute(pathname) && <MobileTabBar />}
    </ComposerProvider>
  );
}
