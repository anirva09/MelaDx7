import { CircleUser, FileText, History, Plus } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

import { OverviewIcon } from "@/components/icons";
import { useComposer } from "@/components/shell/Composer";
import { FixedChrome } from "@/components/shell/FixedChrome";
import { GlassCircle } from "@/components/shell/Glass";
import { cn } from "@/lib/utils";

export const TABS = [
  { to: "/app", label: "Home", icon: OverviewIcon, end: true },
  { to: "/app/analyses", label: "History", icon: History, end: true },
  { to: "/app/reports", label: "Reports", icon: FileText, end: true },
  { to: "/app/profile", label: "Profile", icon: CircleUser, end: true },
] as const;

export function isTabRoute(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return TABS.some((tab) => tab.to === path);
}

/**
 * Floating bottom navigation (reference: glass pill with four destinations and a separate
 * circular action button). The action button starts a new analysis and carries the most
 * visual weight; a blurred strip keeps scrolled content legible behind the bar.
 */
export function MobileTabBar() {
  const { pathname } = useLocation();
  const { openComposer } = useComposer();
  const path = pathname.replace(/\/+$/, "") || "/";
  const activeIndex = TABS.findIndex((tab) => tab.to === path);

  return (
    <FixedChrome>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 backdrop-blur-[16px] [mask-image:linear-gradient(to_bottom,transparent,#000_40%)] lg:hidden"
        style={{ height: "calc(var(--tabbar-bottom) + var(--tabbar-height) + 30px)" }}
      />
      <div
        className="fixed left-1/2 z-40 flex w-[min(calc(100vw-32px),440px)] -translate-x-1/2 items-center gap-4 lg:hidden"
        style={{ bottom: "var(--tabbar-bottom)" }}
      >
        <nav aria-label="Main" className="glass relative flex h-[59px] min-w-0 flex-1 rounded-full p-1.5">
          {activeIndex >= 0 && (
            <span
              aria-hidden
              className="absolute inset-y-1.5 left-1.5 rounded-full bg-active transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
              style={{
                width: `calc((100% - 12px) / ${TABS.length})`,
                transform: `translateX(${activeIndex * 100}%)`,
              }}
            />
          )}
          {TABS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "press relative flex h-[47px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full",
                  isActive ? "text-ink" : "text-ink/80 hover:text-ink",
                )
              }
            >
              <Icon className="size-6 shrink-0" strokeWidth={1.5} aria-hidden />
              <span className="max-w-full truncate px-1 text-2xs">{label}</span>
            </NavLink>
          ))}
        </nav>
        <GlassCircle label="New analysis" size="lg" onClick={openComposer} aria-haspopup="dialog">
          <Plus aria-hidden />
        </GlassCircle>
      </div>
    </FixedChrome>
  );
}
