import { ChevronRight, EllipsisVertical } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  title: string;
  /** Makes the title a link with the reference's trailing caret ("Calendar >"). */
  to?: string;
  right?: ReactNode;
  id?: string;
  className?: string;
}

/** Section title row: 18px semibold title with caret, and a right-hand control. */
export function SectionHeader({ title, to, right, id, className }: SectionHeaderProps) {
  const heading = (
    <h2 id={id} className="text-lg font-semibold tracking-ref text-ink">
      {title}
    </h2>
  );
  return (
    <div className={cn("flex min-h-6 items-center justify-between gap-4", className)}>
      {to ? (
        <Link
          to={to}
          className="press-soft -my-2 -ml-1 inline-flex items-center gap-1 rounded-md px-1 py-2 hover:opacity-80"
        >
          {heading}
          <ChevronRight className="size-4 text-ink" strokeWidth={1.5} aria-hidden />
        </Link>
      ) : (
        heading
      )}
      {right}
    </div>
  );
}

/** The muted vertical-dots menu at the end of a section header. */
export function SectionMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="press -m-2.5 inline-flex size-10 items-center justify-center rounded-full text-muted hover:bg-active hover:text-ink"
        >
          <EllipsisVertical className="size-5" strokeWidth={1.5} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

interface TextTabsProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: { value: T; label: string }[];
  label: string;
  className?: string;
}

/** Plain text switcher ("Recents  Suggested", "Today  Week  Month"). */
export function TextTabs<T extends string>({ value, onValueChange, options, label, className }: TextTabsProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => next && onValueChange(next as T)}
      aria-label={label}
      className={cn("flex items-center gap-3", className)}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className="-my-2 py-2 text-xs text-muted transition-colors hover:text-ink data-[state=on]:text-ink lg:text-sm"
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
