/** Presentation helpers for analyses: day grouping, short times and class-group colours. */

import type { ClassGroup } from "@/api/types";

export function groupColor(group: ClassGroup): string {
  return `var(--group-${group})`;
}

const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const weekdayDate = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" });
const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const longDate = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });

export function formatTime(iso: string): string {
  return time.format(new Date(iso));
}

export function formatLongDate(date: Date = new Date()): string {
  return longDate.format(date);
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "WEDNESDAY, SEP 30" for today, "YESTERDAY", or the weekday and date. */
export function dayLabel(iso: string, now: Date = new Date()): { text: string; today: boolean } {
  const diff = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / 86_400_000);
  if (diff === 0) return { text: weekdayDate.format(new Date(iso)).toUpperCase(), today: true };
  if (diff === 1) return { text: "YESTERDAY", today: false };
  return { text: weekdayDate.format(new Date(iso)).toUpperCase(), today: false };
}

export function groupByDay<T extends { created_at: string }>(
  items: T[],
): { key: string; iso: string; items: T[] }[] {
  const groups: { key: string; iso: string; items: T[] }[] = [];
  for (const item of items) {
    const key = dayKey(item.created_at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, iso: item.created_at, items: [item] });
  }
  return groups;
}

/** Compact age: "now", "5m ago", "3h ago", "2d ago", or a short date. */
export function formatAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86_400 * 7) return `${Math.floor(seconds / 86_400)}d ago`;
  return shortDate.format(new Date(iso));
}

export function greeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
