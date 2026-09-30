import { CircleUser, Cpu, FileText, History, ScanLine, Search } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { useAnalyses } from "@/api/queries";
import { OverviewIcon } from "@/components/icons";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { cn, formatDateTime, formatPercent } from "@/lib/utils";

interface Result {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  to: string;
}

const PAGES: Result[] = [
  { id: "p-home", label: "Overview", icon: <OverviewIcon />, to: "/app" },
  { id: "p-new", label: "New analysis", icon: <ScanLine />, to: "/app/analyze" },
  { id: "p-history", label: "History", icon: <History />, to: "/app/analyses" },
  { id: "p-reports", label: "Reports", icon: <FileText />, to: "/app/reports" },
  { id: "p-model", label: "Model card", icon: <Cpu />, to: "/app/model" },
  { id: "p-profile", label: "Profile and settings", icon: <CircleUser />, to: "/app/profile" },
];

/** Command palette: jump to a page or find an analysis by file name, ID or class code. */
export function QuickSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="data-open-fade fixed inset-0 z-50 bg-black/50 backdrop-blur-[16px]" />
        <Dialog.Content className="data-open-pop fixed left-1/2 top-[14vh] z-50 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-[20px] bg-surface-2 shadow-[var(--shadow-pop)] focus:outline-none dark:bg-[#242424]">
          <Dialog.Title className="sr-only">Quick search</Dialog.Title>
          <Dialog.Description className="sr-only">
            Type to find a page or an analysis. Use the arrow keys to choose and Enter to open.
          </Dialog.Description>
          <Panel onDone={() => onOpenChange(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Mounted only while the palette is open, so nothing is fetched until it is used. */
function Panel({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const query = useDebouncedValue(text.trim(), 250);
  const listId = useId();
  const analyses = useAnalyses({
    q: query || undefined,
    page: 1,
    page_size: 6,
    sort: "created_at",
    order: "desc",
  });

  const results = useMemo<{ group: string; items: Result[] }[]>(() => {
    const needle = text.trim().toLowerCase();
    const pages = PAGES.filter((p) => !needle || p.label.toLowerCase().includes(needle));
    const found: Result[] = (analyses.data?.items ?? []).map((a) => ({
      id: `a-${a.id}`,
      label: a.predicted_class.name,
      hint: `${a.original_filename} · ${formatPercent(a.confidence)} · ${formatDateTime(a.created_at)}`,
      icon: <img src={a.thumbnail_url} alt="" className="size-6 rounded-[6px] object-cover" loading="lazy" />,
      to: `/app/analyses/${a.id}`,
    }));
    return [
      { group: "Go to", items: pages },
      { group: query ? "Matching analyses" : "Recent analyses", items: found },
    ].filter((g) => g.items.length > 0);
  }, [text, query, analyses.data]);

  const flat = results.flatMap((g) => g.items);
  const current = Math.min(active, Math.max(0, flat.length - 1));

  const go = (result: Result | undefined) => {
    if (!result) return;
    onDone();
    navigate(result.to);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActive((current + delta + flat.length) % Math.max(flat.length, 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(flat[current]);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search className="size-6 shrink-0 text-muted" strokeWidth={1.5} aria-hidden />
        <input
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search pages and analyses"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={flat[current] ? `${listId}-${flat[current].id}` : undefined}
          aria-autocomplete="list"
          className="h-14 flex-1 bg-transparent text-[17px] text-ink placeholder:text-muted focus:outline-none"
        />
      </div>
      <div id={listId} role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto p-2">
        {results.length === 0 && (
          <p className="px-3 py-6 text-center text-md text-muted">No pages or analyses match.</p>
        )}
        {results.map((group) => (
          <div key={group.group} role="group" aria-label={group.group} className="pb-1">
            <p className="px-3 pb-1 pt-2 text-xs text-muted" aria-hidden>
              {group.group}
            </p>
            {group.items.map((item) => {
              const index = flat.indexOf(item);
              return (
                <div
                  key={item.id}
                  id={`${listId}-${item.id}`}
                  role="option"
                  aria-selected={index === current}
                  tabIndex={-1}
                  onMouseMove={() => setActive(index)}
                  onClick={() => go(item)}
                  onKeyDown={undefined}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-[12px] px-3 py-2.5 [&_svg]:size-5 [&_svg]:stroke-[1.5] [&_svg]:text-subtle",
                    index === current && "bg-active",
                  )}
                >
                  {item.icon}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-ink">{item.label}</span>
                    {item.hint && <span className="block truncate text-xs text-muted">{item.hint}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}
