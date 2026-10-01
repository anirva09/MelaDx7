import {
  BarChart3,
  ChevronsUpDown,
  CircleUser,
  Cpu,
  FileText,
  Gauge,
  Headset,
  History,
  LogOut,
  Moon,
  ScanLine,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import { useState, type ComponentType, type SVGProps } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

import { OverviewIcon } from "@/components/icons";
import { AboutSheet } from "@/components/shell/AboutSheet";
import { QuickSearch } from "@/components/shell/QuickSearch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

type Icon = ComponentType<SVGProps<SVGSVGElement> & { strokeWidth?: number }>;

interface Item {
  to: string;
  label: string;
  icon: Icon;
  end?: boolean;
  /** Search params that must match for the item to be active (model page tabs). */
  tab?: string;
}

const PRIMARY: Item[] = [
  { to: "/app", label: "Overview", icon: OverviewIcon, end: true },
  { to: "/app/analyze", label: "New analysis", icon: ScanLine },
  { to: "/app/analyses", label: "History", icon: History },
  { to: "/app/reports", label: "Reports", icon: FileText },
];

const MODEL: Item[] = [
  { to: "/app/model", label: "Model card", icon: Cpu, tab: "card" },
  { to: "/app/model?tab=evaluation", label: "Evaluation", icon: Gauge, tab: "evaluation" },
  { to: "/app/model?tab=inference", label: "Inference results", icon: BarChart3, tab: "inference" },
];

function itemClass(active: boolean, small = false) {
  return cn(
    "press-soft flex h-[30px] items-center gap-2 rounded-[10px] px-1.5 transition-colors",
    "[&_svg]:size-[18px] [&_svg]:shrink-0",
    small ? "text-xs" : "text-sm",
    active ? "bg-[var(--surface)] text-ink dark:bg-[#1f1f1f]" : "text-subtle hover:bg-active hover:text-ink",
  );
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function UserSwitcher() {
  const { user, logout } = useAuth();
  const { resolved, setPreference } = useTheme();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="press-soft flex w-full items-center gap-2.5 rounded-[10px] p-1 text-left hover:bg-active"
          aria-label={`Account: ${user.full_name}`}
        >
          <span className="relative flex size-[30px] shrink-0 items-center justify-center rounded-[8px] bg-[#262626] text-base font-bold text-white">
            {initial(user.full_name)}
            <span
              className="absolute -bottom-[3px] -right-[3px] size-1.5 rounded-full bg-good ring-2 ring-sidebar"
              aria-hidden
            />
          </span>
          <span className="min-w-0 flex-1 truncate text-base font-bold text-ink">{user.full_name}</span>
          <ChevronsUpDown className="size-5 shrink-0 text-subtle" strokeWidth={1.5} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[240px]">
        <DropdownMenuLabel>
          <span className="block truncate text-md font-medium text-ink">{user.full_name}</span>
          <span className="block truncate">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/app/profile")}>
          <CircleUser aria-hidden /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setPreference(resolved === "dark" ? "light" : "dark")}>
          {resolved === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
          {resolved === "dark" ? "Light appearance" : "Dark appearance"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout().then(() => navigate("/login", { replace: true }))}>
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Desktop sidebar (reference: "Dashboard" frame): account switcher, quick search with a
 * shortcut badge, primary navigation, a secondary group, and settings/help at the bottom.
 */
export function Sidebar() {
  const location = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const modelTab = new URLSearchParams(location.search).get("tab") ?? "card";
  const onModel = location.pathname === "/app/model";
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <aside
      aria-label="Sidebar"
      className="fixed inset-y-0 left-0 z-30 hidden w-[220px] flex-col bg-sidebar px-4 pb-6 pt-[21px] lg:flex"
    >
      <UserSwitcher />

      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="press-soft mt-[25px] flex min-h-[31px] w-full items-center gap-2 rounded-[9px] border border-sidebar-line bg-[var(--surface)] pl-1.5 pr-1.5 text-left text-sm text-subtle hover:text-ink dark:bg-[#1f1f1f]"
        aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
      >
        <Search className="size-[17px]" strokeWidth={1.5} aria-hidden />
        <span className="min-w-0 flex-1 truncate whitespace-nowrap">Quick Search</span>
        <kbd className="shrink-0 whitespace-nowrap rounded-[7px] border border-[#444] px-1.5 py-0.5 font-sans text-2xs leading-none text-subtle">
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>

      <hr className="mt-5 border-0 border-t border-sidebar-line" />

      <nav aria-label="Main" className="mt-[14px] flex flex-col gap-1.5">
        {PRIMARY.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => itemClass(isActive)}>
            <Icon strokeWidth={1.5} aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>

      <hr className="mt-5 border-0 border-t border-sidebar-line" />

      <nav aria-label="Model" className="mt-[14px] flex flex-col gap-1.5">
        {MODEL.map(({ to, label, icon: Icon, tab }) => {
          const active = onModel && modelTab === tab;
          return (
            <NavLink
              key={to}
              to={to}
              className={() => itemClass(active, true)}
              aria-current={active ? "page" : undefined}
            >
              <Icon strokeWidth={1.5} aria-hidden />
              {label}
            </NavLink>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-1.5">
        <NavLink to="/app/profile" className={({ isActive }) => itemClass(isActive, true)}>
          <Settings strokeWidth={1.5} aria-hidden />
          Settings
        </NavLink>
        <button type="button" className={itemClass(false, true)} onClick={() => setAboutOpen(true)}>
          <Headset strokeWidth={1.5} aria-hidden />
          Help &amp; safety
        </button>
      </div>

      <QuickSearch open={searchOpen} onOpenChange={setSearchOpen} />
      <AboutSheet open={aboutOpen} onOpenChange={setAboutOpen} />
    </aside>
  );
}
