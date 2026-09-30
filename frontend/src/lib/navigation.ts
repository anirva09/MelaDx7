import { CircleUser, FileText, History } from "lucide-react";

import { OverviewIcon } from "@/components/icons";

/** The four destinations of the phone tab bar (new analysis is the separate action button). */
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
