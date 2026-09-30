import { Cpu, History, LayoutDashboard, LogOut, Menu, ScanSearch, Settings, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { Logo } from "@/components/brand/Logo";
import { ModelStatusBadge } from "@/components/ModelStatusBadge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/app", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/app/analyze", label: "New analysis", icon: ScanSearch },
  { to: "/app/analyses", label: "History", icon: History },
  { to: "/app/model", label: "Model", icon: Cpu },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors [&_svg]:size-[18px]",
              isActive
                ? "bg-accent-soft font-medium text-accent-ink"
                : "text-ink-2 hover:bg-surface-2 hover:text-ink",
            )
          }
        >
          <Icon aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex size-9 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-ink ring-1 ring-line hover:ring-line-strong"
          aria-label={`Account menu for ${user.full_name}`}
        >
          {initials(user.full_name) || "?"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>
          <span className="block font-medium text-ink">{user.full_name}</span>
          <span className="block truncate">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/app/settings")}>
          <Settings aria-hidden /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void logout().then(() => navigate("/login", { replace: true }));
          }}
        >
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppLayout() {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-paper">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow-[var(--shadow-pop)]"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-16 items-center px-5">
          <NavLink to="/app" aria-label="LesionLens overview">
            <Logo />
          </NavLink>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          <NavItems />
        </div>
        <div className="border-t border-line p-4">
          <p className="text-2xs leading-relaxed text-muted">
            Research and decision-support prototype. Model outputs are not a diagnosis.
          </p>
        </div>
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur lg:ml-60">
        <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
                <Menu />
              </Button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-[#05090b]/50 lg:hidden" />
              <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-line bg-surface shadow-[var(--shadow-pop)] focus:outline-none lg:hidden">
                <div className="flex h-16 items-center justify-between px-4">
                  <Dialog.Title asChild>
                    <span>
                      <Logo />
                    </span>
                  </Dialog.Title>
                  <Dialog.Description className="sr-only">Main navigation</Dialog.Description>
                  <Dialog.Close asChild>
                    <Button variant="ghost" size="icon" aria-label="Close navigation">
                      <X />
                    </Button>
                  </Dialog.Close>
                </div>
                <div className="flex-1 overflow-y-auto px-3 py-2">
                  <NavItems onNavigate={() => setOpen(false)} />
                </div>
                <div className="flex items-center justify-between border-t border-line p-4">
                  <span className="text-xs text-muted">Theme</span>
                  <ThemeToggle />
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>

          <div className="lg:hidden">
            <Logo compact />
          </div>
          <div className="min-w-0 flex-1">
            <ModelStatusBadge />
          </div>
          <ThemeToggle className="hidden sm:inline-flex" />
          <UserMenu />
        </div>
      </header>

      <main id="main" tabIndex={-1} className="focus:outline-none lg:ml-60">
        <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
