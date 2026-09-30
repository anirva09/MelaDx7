import { ChevronLeft, ChevronRight, History, ScanLine, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { useAnalyses, useAnalysisFeed, useDeleteAnalysis, useModelInfo } from "@/api/queries";
import type { AnalysisListItem, AnalysisQuery, ModelClass } from "@/api/types";
import { DeleteAnalysisDialog } from "@/components/analysis/AnalysisMenu";
import { AnalysisRow } from "@/components/analysis/AnalysisRow";
import { AnalysisTable, type SortKey } from "@/components/AnalysisTable";
import { useComposer } from "@/components/shell/Composer";
import { TabTopBar } from "@/components/shell/MobileTopBar";
import { EmptyState, ErrorState } from "@/components/States";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { DesktopHeader, Page, PageTitle } from "@/components/ui/page";
import { PullIndicator } from "@/components/ui/pull-indicator";
import { TextTabs } from "@/components/ui/section";
import { BottomSheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { dayLabel, groupByDay, groupColor } from "@/lib/analysis";
import { cn, errorMessage, formatDate } from "@/lib/utils";

const PAGE_SIZE = 20;

const CONFIDENCE_OPTIONS: Record<string, { label: string; min?: number; max?: number }> = {
  any: { label: "Any probability" },
  high: { label: "90% and above", min: 0.9 },
  mid: { label: "70% and above", min: 0.7 },
  low: { label: "Below 70%", max: 0.7 },
  vlow: { label: "Below 50%", max: 0.5 },
};

const SORT_OPTIONS: Record<string, { label: string; sort: SortKey; order: "asc" | "desc" }> = {
  newest: { label: "Newest first", sort: "created_at", order: "desc" },
  oldest: { label: "Oldest first", sort: "created_at", order: "asc" },
  "prob-desc": { label: "Highest probability", sort: "confidence", order: "desc" },
  "prob-asc": { label: "Lowest probability", sort: "confidence", order: "asc" },
  class: { label: "Class code A–Z", sort: "predicted_class", order: "asc" },
};

const CERTAINTY: Record<string, string> = {
  all: "Any certainty",
  yes: "Flagged uncertain",
  no: "Not flagged",
};

function sortKeyFor(sort: SortKey, order: "asc" | "desc"): string {
  return Object.entries(SORT_OPTIONS).find(([, o]) => o.sort === sort && o.order === order)?.[0] ?? "newest";
}

interface Filters {
  q: string;
  cls: string;
  confidence: string;
  uncertain: string;
  from: string;
  to: string;
  sort: string;
}

/** Filters live in the URL so a filtered view can be bookmarked and survives reloads. */
function useFilters() {
  const [params, setParams] = useSearchParams();
  const filters: Filters = {
    q: params.get("q") ?? "",
    cls: params.get("class") ?? "",
    confidence: params.get("confidence") ?? "any",
    uncertain: params.get("uncertain") ?? "all",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    sort: params.get("sort") ?? "newest",
  };
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);

  const update = (changes: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (
        value === null ||
        value === "" ||
        value === "any" ||
        value === "all" ||
        (key === "sort" && value === "newest")
      ) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }
    if (resetPage) next.delete("page");
    setParams(next, { replace: true });
  };
  const clear = () => setParams(new URLSearchParams(), { replace: true });

  const sortOption = SORT_OPTIONS[filters.sort] ?? SORT_OPTIONS.newest!;
  const confidenceOption = CONFIDENCE_OPTIONS[filters.confidence] ?? CONFIDENCE_OPTIONS.any!;
  const query: Omit<AnalysisQuery, "page"> = {
    q: filters.q || undefined,
    predicted_class: filters.cls || undefined,
    min_confidence: confidenceOption.min,
    max_confidence: confidenceOption.max,
    uncertain: filters.uncertain === "yes" ? true : filters.uncertain === "no" ? false : undefined,
    date_from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : undefined,
    date_to: filters.to ? new Date(`${filters.to}T23:59:59.999`).toISOString() : undefined,
    sort: sortOption.sort,
    order: sortOption.order,
    page_size: PAGE_SIZE,
  };
  const active = Boolean(
    filters.q ||
    filters.cls ||
    filters.confidence !== "any" ||
    filters.uncertain !== "all" ||
    filters.from ||
    filters.to,
  );
  return { filters, page, update, clear, query, sortOption, active };
}

function useSearchBox(q: string, update: (c: Record<string, string | null>) => void) {
  const [search, setSearch] = useState(q);
  const debounced = useDebouncedValue(search.trim(), 350);
  useEffect(() => {
    if (debounced !== q) update({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  return [search, setSearch] as const;
}

function useDeleteFlow() {
  const remove = useDeleteAnalysis();
  const [target, setTarget] = useState<AnalysisListItem | null>(null);
  const dialog = (
    <DeleteAnalysisDialog
      open={target !== null}
      onOpenChange={(open) => !open && setTarget(null)}
      filename={target?.original_filename ?? ""}
      pending={remove.isPending}
      onConfirm={() =>
        target &&
        remove.mutate(target.id, {
          onSuccess: () => {
            setTarget(null);
            toast.success("Analysis deleted");
          },
          onError: (error) => {
            setTarget(null);
            toast.error("The analysis could not be deleted", { description: errorMessage(error) });
          },
        })
      }
    />
  );
  return { ask: setTarget, dialog };
}

/** Filter sheet (reference "Templates" sheet: close and confirm circles, search, two-column grid). */
function FilterSheet({
  open,
  onOpenChange,
  filters,
  classes,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: Filters;
  classes: ModelClass[];
  onApply: (next: Partial<Filters>) => void;
}) {
  const [draft, setDraft] = useState<Filters>(filters);
  const [classQuery, setClassQuery] = useState("");
  // Start from the applied filters each time the sheet opens.
  const [openedWith, setOpenedWith] = useState<Filters | null>(null);
  if (open && openedWith === null) {
    setOpenedWith(filters);
    setDraft(filters);
  } else if (!open && openedWith !== null) {
    setOpenedWith(null);
  }
  const shownClasses = classes.filter((c) =>
    `${c.name} ${c.code}`.toLowerCase().includes(classQuery.trim().toLowerCase()),
  );

  const chip = (selected: boolean) =>
    cn(
      "press min-h-10 rounded-full px-4 text-md transition-colors",
      selected ? "bg-accent text-white" : "bg-paper text-ink-2 hover:text-ink dark:bg-[#1d1d1d]",
    );

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Filters"
      description="Filter and sort your analyses."
      onConfirm={() => {
        onApply(draft);
        onOpenChange(false);
      }}
      confirmLabel="Apply filters"
      search={{ value: classQuery, onChange: setClassQuery, placeholder: "Search classes" }}
    >
      <div className="flex flex-col gap-6">
        <fieldset>
          <legend className="mb-3 text-md font-medium text-muted">Predicted class</legend>
          <div className="grid grid-cols-2 gap-3">
            {[{ code: "", name: "All classes", group: "other" as const }, ...shownClasses].map((c) => {
              const selected = draft.cls === c.code;
              return (
                <button
                  key={c.code || "all"}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setDraft((d) => ({ ...d, cls: c.code }))}
                  className={cn(
                    "press-soft flex min-h-[76px] flex-col justify-between rounded-[17px] bg-paper p-3 text-left dark:bg-[#1d1d1d]",
                    selected && "ring-2 ring-accent",
                  )}
                >
                  <span
                    className="flex items-center gap-1.5 font-mono text-xs"
                    style={{ color: groupColor(c.group) }}
                  >
                    {c.code && (
                      <span
                        className="h-3.5 w-[3px] rounded-full"
                        style={{ background: groupColor(c.group) }}
                        aria-hidden
                      />
                    )}
                    {c.code || "any"}
                  </span>
                  <span className="text-md font-medium leading-tight tracking-ref text-ink">{c.name}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-md font-medium text-muted">Certainty</legend>
          <div className="flex flex-wrap gap-2">
            {Object.entries(CERTAINTY).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={draft.uncertain === key}
                className={chip(draft.uncertain === key)}
                onClick={() => setDraft((d) => ({ ...d, uncertain: key }))}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-md font-medium text-muted">Top-class probability</legend>
          <div className="flex flex-wrap gap-2">
            {Object.entries(CONFIDENCE_OPTIONS).map(([key, option]) => (
              <button
                key={key}
                type="button"
                aria-pressed={draft.confidence === key}
                className={chip(draft.confidence === key)}
                onClick={() => setDraft((d) => ({ ...d, confidence: key }))}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="grid grid-cols-2 gap-3">
          <legend className="mb-3 text-md font-medium text-muted">Date</legend>
          <label className="flex flex-col gap-1.5 text-sm text-muted">
            From
            <Input
              type="date"
              value={draft.from}
              max={draft.to || undefined}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">
            To
            <Input
              type="date"
              value={draft.to}
              min={draft.from || undefined}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            />
          </label>
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-md font-medium text-muted">Sort</legend>
          <div className="flex flex-wrap gap-2">
            {Object.entries(SORT_OPTIONS).map(([key, option]) => (
              <button
                key={key}
                type="button"
                aria-pressed={draft.sort === key}
                className={chip(draft.sort === key)}
                onClick={() => setDraft((d) => ({ ...d, sort: key }))}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <Button
          variant="secondary"
          onClick={() =>
            setDraft({
              q: draft.q,
              cls: "",
              confidence: "any",
              uncertain: "all",
              from: "",
              to: "",
              sort: "newest",
            })
          }
        >
          Reset filters
        </Button>
      </div>
    </BottomSheet>
  );
}

function MobileHistory() {
  const { filters, update, clear, query, active } = useFilters();
  const [search, setSearch] = useSearchBox(filters.q, update);
  const [sheet, setSheet] = useState(false);
  const model = useModelInfo();
  const feed = useAnalysisFeed(query);
  const { openComposer } = useComposer();
  const { ask, dialog } = useDeleteFlow();
  const pull = usePullToRefresh(() => feed.refetch());
  const sentinel = useRef<HTMLDivElement>(null);

  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  const total = feed.data?.pages[0]?.total ?? 0;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;

  // Infinite scroll: load the next page as the end of the list approaches.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const chips: { key: string; label: string; clear: Record<string, null> }[] = [];
  if (filters.cls)
    chips.push({
      key: "cls",
      label: model.data?.classes.find((c) => c.code === filters.cls)?.name ?? filters.cls,
      clear: { class: null },
    });
  if (filters.confidence !== "any")
    chips.push({
      key: "conf",
      label: CONFIDENCE_OPTIONS[filters.confidence]?.label ?? "",
      clear: { confidence: null },
    });
  if (filters.from || filters.to)
    chips.push({
      key: "date",
      label: `${filters.from ? formatDate(`${filters.from}T00:00:00`) : "…"} – ${filters.to ? formatDate(`${filters.to}T00:00:00`) : "…"}`,
      clear: { from: null, to: null },
    });
  if (filters.sort !== "newest")
    chips.push({ key: "sort", label: SORT_OPTIONS[filters.sort]?.label ?? "", clear: { sort: null } });

  return (
    <>
      <TabTopBar />
      <PullIndicator state={pull} />
      <Page
        className="gap-5"
        style={{ transform: pull.distance ? `translateY(${pull.distance}px)` : undefined }}
      >
        <PageTitle>History</PageTitle>

        <form
          role="search"
          aria-label="Search analyses"
          onSubmit={(e) => e.preventDefault()}
          className="flex items-center gap-2"
        >
          <label className="relative block flex-1">
            <span className="sr-only">Search by file name, analysis ID or class code</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-6 -translate-y-1/2 text-muted"
              strokeWidth={1.5}
              aria-hidden
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search analyses"
              enterKeyHint="search"
              className="h-10 w-full rounded-[12px] bg-field pl-12 pr-3 text-[17px] text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent"
            />
          </label>
          <button
            type="button"
            onClick={() => setSheet(true)}
            aria-label={`Filters${chips.length ? `, ${chips.length} active` : ""}`}
            className="press relative flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-field text-ink"
          >
            <SlidersHorizontal className="size-5" strokeWidth={1.5} aria-hidden />
            {chips.length > 0 && (
              <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent" aria-hidden />
            )}
          </button>
        </form>

        <div className="-mt-1 flex flex-wrap items-center justify-between gap-3">
          <TextTabs
            label="Certainty"
            value={filters.uncertain as "all" | "yes" | "no"}
            onValueChange={(value) => update({ uncertain: value })}
            options={[
              { value: "all", label: "All" },
              { value: "yes", label: "Flagged" },
              { value: "no", label: "Not flagged" },
            ]}
            className="[&>button]:text-md"
          />
          <p className="text-xs text-muted" aria-live="polite">
            {feed.data ? `${total.toLocaleString()} ${total === 1 ? "analysis" : "analyses"}` : ""}
          </p>
        </div>

        {chips.length > 0 && (
          <div className="no-scrollbar -mx-4 -mt-2 flex gap-2 overflow-x-auto px-4">
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => update(chip.clear)}
                className="press flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface pl-3 pr-2 text-sm text-ink"
                aria-label={`Remove filter: ${chip.label}`}
              >
                {chip.label}
                <X className="size-4 text-muted" strokeWidth={1.5} aria-hidden />
              </button>
            ))}
          </div>
        )}

        {feed.isError ? (
          <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />
        ) : !feed.data ? (
          <div className="flex flex-col gap-3" role="status" aria-label="Loading analyses">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-[260px] rounded-lg" />
          </div>
        ) : total === 0 ? (
          active ? (
            <EmptyState
              icon={<Search strokeWidth={1.5} />}
              title="No analyses match these filters"
              description="Try a broader search or clear the filters."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    clear();
                  }}
                >
                  Clear filters
                </Button>
              }
              className="border-none bg-surface"
            />
          ) : (
            <EmptyState
              icon={<History strokeWidth={1.5} />}
              title="Your history is empty"
              description="Analyses you run are saved here with their predictions, explanations and model versions."
              action={<Button onClick={openComposer}>Run your first analysis</Button>}
              className="border-none bg-surface"
            />
          )
        ) : (
          <div
            className={cn(
              "flex flex-col gap-6 transition-opacity",
              feed.isFetching && !isFetchingNextPage && "opacity-60",
            )}
          >
            {(filters.sort === "newest" || filters.sort === "oldest"
              ? groupByDay(items)
              : [{ key: "all", iso: "", items }]
            ).map((group) => {
              const label = group.iso ? dayLabel(group.iso) : null;
              return (
                <section
                  key={group.key}
                  aria-label={label?.text ?? "Results"}
                  className="flex flex-col gap-2"
                >
                  {label && (
                    <h2
                      className={cn("px-1 text-md font-semibold", label.today ? "text-today" : "text-muted")}
                    >
                      {label.text}
                    </h2>
                  )}
                  <ul className="overflow-hidden rounded-lg bg-surface">
                    {group.items.map((item, index) => (
                      <li key={item.id} className={cn(index > 0 && "border-t border-line")}>
                        <AnalysisRow item={item} onDelete={ask} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            <div ref={sentinel} aria-hidden />
            {hasNextPage && (
              <Button variant="secondary" onClick={() => void fetchNextPage()} loading={isFetchingNextPage}>
                Load more
              </Button>
            )}
            {!hasNextPage && items.length > PAGE_SIZE && (
              <p className="text-center text-xs text-muted">End of history</p>
            )}
          </div>
        )}
      </Page>
      <FilterSheet
        open={sheet}
        onOpenChange={setSheet}
        filters={filters}
        classes={model.data?.classes ?? []}
        onApply={(next) =>
          update({
            class: next.cls ?? "",
            confidence: next.confidence ?? "any",
            uncertain: next.uncertain ?? "all",
            from: next.from ?? "",
            to: next.to ?? "",
            sort: next.sort ?? "newest",
          })
        }
      />
      {dialog}
    </>
  );
}

function DesktopHistory() {
  const { filters, page, update, clear, query, sortOption, active } = useFilters();
  const [search, setSearch] = useSearchBox(filters.q, update);
  const model = useModelInfo();
  const result = useAnalyses({ ...query, page });
  const data = result.data;

  return (
    <Page>
      <DesktopHeader
        title="History"
        subtitle="Every analysis you have run, with the model version that produced it."
        actions={
          <Button variant="secondary" size="sm" asChild>
            <Link to="/app/analyze">
              <ScanLine aria-hidden /> New analysis
            </Link>
          </Button>
        }
      />

      <section className="overflow-hidden rounded-lg bg-surface">
        <form
          role="search"
          aria-label="Filter analyses"
          onSubmit={(event) => event.preventDefault()}
          className="grid gap-3 border-b border-line p-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]"
        >
          <label className="relative lg:col-span-2 xl:col-span-1">
            <span className="sr-only">Search by file name, analysis ID or class code</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted"
              strokeWidth={1.5}
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search file name, ID or class code"
              className="pl-10"
              type="search"
            />
          </label>
          <label>
            <span className="sr-only">Predicted class</span>
            <NativeSelect value={filters.cls} onChange={(e) => update({ class: e.target.value })}>
              <option value="">All classes</option>
              {model.data?.classes.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label>
            <span className="sr-only">Probability</span>
            <NativeSelect value={filters.confidence} onChange={(e) => update({ confidence: e.target.value })}>
              {Object.entries(CONFIDENCE_OPTIONS).map(([key, option]) => (
                <option key={key} value={key}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label>
            <span className="sr-only">Uncertainty flag</span>
            <NativeSelect value={filters.uncertain} onChange={(e) => update({ uncertain: e.target.value })}>
              {Object.entries(CERTAINTY).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <div className="flex flex-wrap items-center gap-3 lg:col-span-2 xl:col-span-4">
            <label className="flex items-center gap-2 text-sm text-muted">
              From
              <Input
                type="date"
                value={filters.from}
                max={filters.to || undefined}
                onChange={(e) => update({ from: e.target.value })}
                className="h-10 w-44"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted">
              To
              <Input
                type="date"
                value={filters.to}
                min={filters.from || undefined}
                onChange={(e) => update({ to: e.target.value })}
                className="h-10 w-44"
              />
            </label>
            <label className="ml-auto flex items-center gap-2 text-sm text-muted">
              Sort
              <NativeSelect
                value={filters.sort}
                onChange={(e) => update({ sort: e.target.value }, false)}
                className="w-52 [&_select]:h-10"
              >
                {Object.entries(SORT_OPTIONS).map(([key, option]) => (
                  <option key={key} value={key}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {active && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  clear();
                }}
              >
                <X aria-hidden /> Clear filters
              </Button>
            )}
          </div>
        </form>

        <div
          className={cn("transition-opacity", result.isFetching && data && "opacity-60")}
          aria-busy={result.isFetching}
        >
          {result.isError ? (
            <ErrorState error={result.error} className="m-4" onRetry={() => void result.refetch()} />
          ) : !data ? (
            <div className="flex flex-col gap-2 p-4" role="status" aria-label="Loading analyses">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : data.total === 0 ? (
            active ? (
              <EmptyState
                icon={<Search strokeWidth={1.5} />}
                title="No analyses match these filters"
                description="Try a broader search or clear the filters."
                className="m-4 border-none"
              />
            ) : (
              <EmptyState
                icon={<History strokeWidth={1.5} />}
                title="Your history is empty"
                description="Analyses you run are saved here with their predictions, explanations and model versions."
                action={
                  <Button asChild>
                    <Link to="/app/analyze">Run your first analysis</Link>
                  </Button>
                }
                className="m-4 border-none"
              />
            )
          ) : (
            <>
              <AnalysisTable
                items={data.items}
                sort={sortOption.sort}
                order={sortOption.order}
                onSortChange={(sort, order) => update({ sort: sortKeyFor(sort, order) }, false)}
                caption="Analysis history"
              />
              <nav
                aria-label="Pagination"
                className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-md"
              >
                <p className="text-muted" aria-live="polite">
                  {data.total.toLocaleString()} {data.total === 1 ? "analysis" : "analyses"}
                  {data.pages > 1 && `, page ${data.page} of ${data.pages}`}
                </p>
                {data.pages > 1 && (
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => update({ page: String(page - 1) }, false)}
                    >
                      <ChevronLeft aria-hidden /> Previous
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={page >= data.pages}
                      onClick={() => update({ page: String(page + 1) }, false)}
                    >
                      Next <ChevronRight aria-hidden />
                    </Button>
                  </div>
                )}
              </nav>
            </>
          )}
        </div>
      </section>
    </Page>
  );
}

export function HistoryPage() {
  useDocumentTitle("History");
  return useIsDesktop() ? <DesktopHistory /> : <MobileHistory />;
}
