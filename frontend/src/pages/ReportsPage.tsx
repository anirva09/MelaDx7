import { Download, FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useAnalysisFeed, useOverview } from "@/api/queries";
import type { AnalysisListItem } from "@/api/types";
import { AnalysisMenu } from "@/components/analysis/AnalysisMenu";
import { SummaryRows } from "@/components/analysis/SummaryRows";
import { ActivityChart } from "@/components/charts/ActivityChart";
import { CountBars } from "@/components/charts/CountBars";
import { HistogramChart } from "@/components/charts/HistogramChart";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { useComposer } from "@/components/shell/Composer";
import { TabTopBar } from "@/components/shell/MobileTopBar";
import { EmptyState, ErrorState } from "@/components/States";
import { Button } from "@/components/ui/button";
import { DesktopHeader, Page, PageTitle } from "@/components/ui/page";
import { PullIndicator } from "@/components/ui/pull-indicator";
import { SectionHeader } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { formatTime, groupColor } from "@/lib/analysis";
import { downloadReport } from "@/lib/reports";
import { cn, formatDate, formatPercent } from "@/lib/utils";

function ReportRow({ item }: { item: AnalysisListItem }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-2 pr-2">
      <AnalysisMenu item={item} className="min-w-0 flex-1">
        <Link
          to={`/app/analyses/${item.id}`}
          className="press-soft flex min-h-16 items-center gap-3 px-3 py-2.5 hover:bg-active"
        >
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-[10px]"
            style={{
              background: `color-mix(in srgb, ${groupColor(item.predicted_class.group)} 14%, transparent)`,
            }}
            aria-hidden
          >
            <FileText
              className="size-5"
              strokeWidth={1.5}
              style={{ color: groupColor(item.predicted_class.group) }}
            />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-base font-medium tracking-ref text-ink">
              {item.predicted_class.name}
            </span>
            <span className="truncate text-xs text-muted">
              {formatDate(item.created_at)}, {formatTime(item.created_at)} · {formatPercent(item.confidence)}{" "}
              · {item.original_filename}
            </span>
          </span>
        </Link>
      </AnalysisMenu>
      <button
        type="button"
        onClick={async () => {
          setBusy(true);
          await downloadReport(item.id);
          setBusy(false);
        }}
        disabled={busy}
        aria-label={`Download PDF report for ${item.predicted_class.name}, ${formatDate(item.created_at)}`}
        className="press glass flex size-10 shrink-0 items-center justify-center rounded-full text-ink disabled:opacity-50"
      >
        <Download className={cn("size-5", busy && "animate-pulse")} strokeWidth={1.5} aria-hidden />
      </button>
    </div>
  );
}

function useReports() {
  const overview = useOverview();
  const feed = useAnalysisFeed({ sort: "created_at", order: "desc", page_size: 20 });
  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  return { overview, feed, items };
}

function Charts({ className }: { className?: string }) {
  const { overview } = useReports();
  const stats = overview.data;
  if (!stats || stats.total_analyses === 0) return null;
  return (
    <div className={cn("grid gap-4", className)}>
      <section aria-labelledby="chart-activity" className="rounded-lg bg-surface px-4 pb-3 pt-3.5 lg:px-5">
        <h2 id="chart-activity" className="text-lg font-semibold tracking-ref text-ink">
          Activity
        </h2>
        <p className="text-xs text-muted">Analyses per day, last 30 days</p>
        <div className="mt-3">
          <ActivityChart data={stats.activity} />
        </div>
      </section>
      <section aria-labelledby="chart-classes" className="rounded-lg bg-surface px-4 pb-4 pt-3.5 lg:px-5">
        <h2 id="chart-classes" className="text-lg font-semibold tracking-ref text-ink">
          Predicted classes
        </h2>
        <p className="mb-3 text-xs text-muted">Latest prediction of each analysis</p>
        <CountBars items={stats.class_distribution} total={stats.total_analyses} />
      </section>
      <section aria-labelledby="chart-prob" className="rounded-lg bg-surface px-4 pb-3 pt-3.5 lg:px-5">
        <h2 id="chart-prob" className="text-lg font-semibold tracking-ref text-ink">
          Probability distribution
        </h2>
        <p className="text-xs text-muted">How confident the model's top class was across your analyses</p>
        <div className="mt-3">
          <HistogramChart bins={stats.confidence_histogram} label="Analyses" />
        </div>
      </section>
    </div>
  );
}

function ReportList() {
  const { feed, items } = useReports();
  const { openComposer } = useComposer();
  if (feed.isError) return <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />;
  if (!feed.data) return <Skeleton className="h-[260px] rounded-lg" />;
  if (items.length === 0)
    return (
      <EmptyState
        icon={<FileText strokeWidth={1.5} />}
        title="No reports yet"
        description="Every analysis can be exported as a PDF report with the image, Grad-CAM, probabilities and model record."
        action={<Button onClick={openComposer}>New analysis</Button>}
        className="border-none bg-surface"
      />
    );
  return (
    <div className="flex flex-col gap-3">
      <ul className="overflow-hidden rounded-lg bg-surface" aria-label="Analysis reports">
        {items.map((item, index) => (
          <li key={item.id} className={cn(index > 0 && "border-t border-line")}>
            <ReportRow item={item} />
          </li>
        ))}
      </ul>
      {feed.hasNextPage && (
        <Button
          variant="secondary"
          onClick={() => void feed.fetchNextPage()}
          loading={feed.isFetchingNextPage}
        >
          Load more
        </Button>
      )}
    </div>
  );
}

function MobileReports() {
  const { overview, feed } = useReports();
  const pull = usePullToRefresh(() => Promise.all([overview.refetch(), feed.refetch()]));
  const stats = overview.data;
  return (
    <>
      <TabTopBar />
      <PullIndicator state={pull} />
      <Page
        className="gap-8"
        style={{ transform: pull.distance ? `translateY(${pull.distance}px)` : undefined }}
      >
        <div>
          <PageTitle>Reports</PageTitle>
          <p className="mt-1.5 text-md text-subtle">
            Summary of your analyses and a PDF report for each one.
          </p>
        </div>
        <section aria-labelledby="rep-summary" className="flex flex-col gap-3">
          <SectionHeader id="rep-summary" title="Summary" />
          {overview.isError ? (
            <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
          ) : stats ? (
            <div className="rounded-lg bg-surface px-4 py-1.5">
              <SummaryRows stats={stats} />
            </div>
          ) : (
            <Skeleton className="h-[190px] rounded-lg" />
          )}
        </section>
        <Charts />
        <section aria-labelledby="rep-list" className="flex flex-col gap-3">
          <SectionHeader id="rep-list" title="PDF reports" to="/app/analyses" />
          <ReportList />
        </section>
        <DisclaimerBanner compact />
      </Page>
    </>
  );
}

function DesktopReports() {
  const { overview } = useReports();
  const stats = overview.data;
  return (
    <Page>
      <DesktopHeader title="Reports" subtitle="Summary of your analyses and a PDF report for each one." />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-5">
          <section aria-labelledby="desk-rep-summary" className="rounded-lg bg-surface px-5 pb-3 pt-3.5">
            <h2 id="desk-rep-summary" className="text-lg font-semibold tracking-ref text-ink">
              Summary
            </h2>
            {overview.isError ? (
              <ErrorState error={overview.error} onRetry={() => void overview.refetch()} className="mt-3" />
            ) : stats ? (
              <SummaryRows stats={stats} className="mt-2" />
            ) : (
              <Skeleton className="mt-3 h-40" />
            )}
          </section>
          <Charts />
        </div>
        <section aria-labelledby="desk-rep-list" className="flex flex-col gap-3">
          <h2 id="desk-rep-list" className="text-lg font-semibold tracking-ref text-ink">
            PDF reports
          </h2>
          <ReportList />
        </section>
      </div>
      <DisclaimerBanner />
    </Page>
  );
}

export function ReportsPage() {
  useDocumentTitle("Reports");
  return useIsDesktop() ? <DesktopReports /> : <MobileReports />;
}
