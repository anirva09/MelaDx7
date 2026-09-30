import { ChevronLeft, ChevronRight, History, ScanSearch, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useAnalyses, useModelInfo } from "@/api/queries";
import type { AnalysisQuery } from "@/api/types";
import { AnalysisTable, type SortKey } from "@/components/AnalysisTable";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorState } from "@/components/States";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { cn } from "@/lib/utils";

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

function sortKeyFor(sort: SortKey, order: "asc" | "desc"): string {
  return Object.entries(SORT_OPTIONS).find(([, o]) => o.sort === sort && o.order === order)?.[0] ?? "newest";
}

export function HistoryPage() {
  useDocumentTitle("History");
  const [params, setParams] = useSearchParams();
  const model = useModelInfo();

  const q = params.get("q") ?? "";
  const cls = params.get("class") ?? "";
  const confidence = params.get("confidence") ?? "any";
  const uncertain = params.get("uncertain") ?? "all";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const sortKey = params.get("sort") ?? "newest";
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);

  const [search, setSearch] = useState(q);
  const debounced = useDebouncedValue(search.trim(), 350);

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

  useEffect(() => {
    if (debounced !== q) update({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const sortOption = SORT_OPTIONS[sortKey] ?? SORT_OPTIONS.newest!;
  const confidenceOption = CONFIDENCE_OPTIONS[confidence] ?? CONFIDENCE_OPTIONS.any!;
  const query: AnalysisQuery = useMemo(
    () => ({
      q: q || undefined,
      predicted_class: cls || undefined,
      min_confidence: confidenceOption.min,
      max_confidence: confidenceOption.max,
      uncertain: uncertain === "yes" ? true : uncertain === "no" ? false : undefined,
      date_from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
      date_to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
      sort: sortOption.sort,
      order: sortOption.order,
      page,
      page_size: PAGE_SIZE,
    }),
    [q, cls, confidenceOption, uncertain, from, to, sortOption, page],
  );
  const result = useAnalyses(query);
  const filtersActive = Boolean(q || cls || confidence !== "any" || uncertain !== "all" || from || to);
  const data = result.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="History"
        description="Every analysis you have run, with the model version that produced it."
        actions={
          <Button asChild>
            <Link to="/app/analyze">
              <ScanSearch aria-hidden /> New analysis
            </Link>
          </Button>
        }
      />

      <Card>
        <form
          role="search"
          aria-label="Filter analyses"
          onSubmit={(event) => event.preventDefault()}
          className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]"
        >
          <label className="relative sm:col-span-2 lg:col-span-1">
            <span className="sr-only">Search by file name, analysis ID or class code</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search file name, ID or class code"
              className="pl-9"
              type="search"
            />
          </label>
          <label>
            <span className="sr-only">Predicted class</span>
            <NativeSelect value={cls} onChange={(event) => update({ class: event.target.value })}>
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
            <NativeSelect value={confidence} onChange={(event) => update({ confidence: event.target.value })}>
              {Object.entries(CONFIDENCE_OPTIONS).map(([key, option]) => (
                <option key={key} value={key}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label>
            <span className="sr-only">Uncertainty flag</span>
            <NativeSelect value={uncertain} onChange={(event) => update({ uncertain: event.target.value })}>
              <option value="all">Any certainty</option>
              <option value="yes">Flagged uncertain</option>
              <option value="no">Not flagged</option>
            </NativeSelect>
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
            <label className="flex items-center gap-2 text-xs text-muted">
              From
              <Input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(event) => update({ from: event.target.value })}
                className="h-9 w-40"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-muted">
              To
              <Input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(event) => update({ to: event.target.value })}
                className="h-9 w-40"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-muted sm:ml-auto">
              Sort
              <NativeSelect
                value={sortKey}
                onChange={(event) => update({ sort: event.target.value }, false)}
                className="w-48 [&_select]:h-9"
              >
                {Object.entries(SORT_OPTIONS).map(([key, option]) => (
                  <option key={key} value={key}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {filtersActive && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setParams(new URLSearchParams(), { replace: true });
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
            filtersActive ? (
              <EmptyState
                icon={<Search />}
                title="No analyses match these filters"
                description="Try a broader search or clear the filters."
                className="m-4 border-none"
              />
            ) : (
              <EmptyState
                icon={<History />}
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
                className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm"
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
      </Card>
    </div>
  );
}
