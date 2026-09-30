import { ChevronLeft, Cpu, Ellipsis, LogOut, Moon, ScanLine, ShieldCheck, Sun } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useModelInfo } from "@/api/queries";
import { AboutSheet } from "@/components/shell/AboutSheet";
import { useComposer } from "@/components/shell/Composer";
import { FixedChrome } from "@/components/shell/FixedChrome";
import { GlassCircle, GlassPill, PillButton } from "@/components/shell/Glass";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

/**
 * Floating top controls on phones (reference: 48px back circle on the left, 96x48 glass
 * pill on the right). A solid strip under the status bar keeps the clock readable.
 */
export function MobileTopBar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <FixedChrome>
      <div
        aria-hidden
        className="fixed inset-x-0 top-0 z-30 bg-paper lg:hidden"
        style={{ height: "var(--safe-top)" }}
      />
      <div
        className="pointer-events-none fixed inset-x-0 z-40 flex items-start justify-between px-4 lg:hidden [&>*]:pointer-events-auto"
        style={{ top: "var(--topbar-top)" }}
      >
        <div>{left}</div>
        <div>{right}</div>
      </div>
    </FixedChrome>
  );
}

export function BackButton({ fallback = "/app", label = "Back" }: { fallback?: string; label?: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <GlassCircle
      label={label}
      onClick={() => {
        // Go back when there is in-app history; otherwise to the section's list.
        if (location.key !== "default") navigate(-1);
        else navigate(fallback);
      }}
    >
      <ChevronLeft aria-hidden />
    </GlassCircle>
  );
}

/** Model status as a glyph with a coloured dot (replaces the reference's bell). */
export function ModelStatusButton() {
  const { data, isError } = useModelInfo();
  const status = isError ? "error" : (data?.status ?? "loading");
  const text =
    status === "ready"
      ? `${data?.display_name} v${data?.version}, ready`
      : status === "untrained"
        ? "untrained model loaded, results are not meaningful"
        : status === "unavailable"
          ? "no model weights loaded"
          : status === "error"
            ? "status unavailable"
            : "checking";
  return (
    <PillButton label={`Model: ${text}. Open model details`} asChild>
      <Link to="/app/model">
        <Cpu aria-hidden />
        <span
          aria-hidden
          className={cn(
            "absolute right-2 top-2 size-2 rounded-full ring-2 ring-[#2b2b2b]",
            status === "ready" && "bg-good",
            status === "untrained" && "bg-caution",
            (status === "unavailable" || status === "error") && "bg-danger",
            status === "loading" && "animate-pulse bg-muted",
          )}
        />
      </Link>
    </PillButton>
  );
}

export function MoreMenu() {
  const { openComposer } = useComposer();
  const { resolved, setPreference } = useTheme();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [about, setAbout] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <PillButton label="More">
            <Ellipsis aria-hidden />
          </PillButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={openComposer}>
            <ScanLine aria-hidden /> New analysis
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate("/app/model")}>
            <Cpu aria-hidden /> Model card
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPreference(resolved === "dark" ? "light" : "dark")}>
            {resolved === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
            {resolved === "dark" ? "Light appearance" : "Dark appearance"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setAbout(true)}>
            <ShieldCheck aria-hidden /> About &amp; safety
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => void logout().then(() => navigate("/login", { replace: true }))}
          >
            <LogOut aria-hidden /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AboutSheet open={about} onOpenChange={setAbout} />
    </>
  );
}

/** The top bar shared by the four tab screens. */
export function TabTopBar() {
  return (
    <MobileTopBar
      right={
        <GlassPill aria-label="Status and more">
          <ModelStatusButton />
          <MoreMenu />
        </GlassPill>
      }
    />
  );
}
