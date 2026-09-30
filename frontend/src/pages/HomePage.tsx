import { Cpu, FileText, History, Plus, ScanLine } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAnalyses, useModelInfo, useOverview } from "@/api/queries";
import type { AnalysisListItem, OverviewStats } from "@/api/types";
import { ActivityList } from "@/components/analysis/ActivityList";
import { ActivityTimeline } from "@/components/analysis/ActivityTimeline";
import { LatestResultCard } from "@/components/analysis/LatestResultCard";
import { NoteCardSkeleton, ResultNoteCard } from "@/components/analysis/ResultNoteCard";
import { ReviewList } from "@/components/analysis/ReviewList";
import { CountBars } from "@/components/charts/CountBars";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { LensMark } from "@/components/icons";
import { ModelAvailabilityNotice } from "@/components/ModelAvailabilityNotice";
import { useComposer } from "@/components/shell/Composer";
import { TabTopBar } from "@/components/shell/MobileTopBar";
import { ErrorState } from "@/components/States";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DesktopHeader, Page } from "@/components/ui/page";
import { SectionHeader, SectionMenu, TextTabs } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { PullIndicator } from "@/components/ui/pull-indicator";
import { formatLongDate, greeting } from "@/lib/analysis";
import { cn, formatPercent } from "@/lib/utils";

type ResultsTab = "recents" | "flagged";

function useHomeData() {
  const overview = useOverview();
  const recent = useAnalyses({ page: 1, page_size: 12, sort: "created_at", order: "desc" });
  const flagged = useAnalyses({ page: 1, page_size: 6, uncertain: true, sort: "created_at", order: "desc" });
  const model = useModelInfo();
  return { overview, recent, flagged, model };
}

/** Horizontal note cards with the "Recents / Flagged" switch. */
function ResultsRow({
  recent,
  flagged,
  tab,
  className,
}: {
  recent: AnalysisListItem[] | undefined;
  flagged: AnalysisListItem[] | undefined;
  tab: ResultsTab;
  className?: string;
}) {
  const items = tab === "recents" ? recent : flagged;
  return (
    <div
      className={cn("no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4", className)}
      role="list"
      aria-label={tab === "recents" ? "Recent results" : "Results flagged as uncertain"}
    >
      {!items
        ? Array.from({ length: 3 }, (_, i) => <NoteCardSkeleton key={i} />)
        : items.map((item) => (
            <div role="listitem" key={item.id} className="contents">
              <ResultNoteCard item={item} />
            </div>
          ))}
      {items && items.length === 0 && (
        <p className="flex h-[120px] w-full items-center justify-center rounded-lg bg-surface-2 px-6 text-center text-md text-muted">
          {tab === "flagged" ? "No results are flagged as uncertain." : "No results yet."}
        </p>
      )}
    </div>
  );
}

/** Reference "Home - Empty State": illustration, title, hint and a hand-drawn arrow to "+". */
function EmptyHome() {
  return (
    <div className="flex min-h-[calc(100dvh-var(--page-top)-var(--page-bottom))] flex-col items-center justify-center pb-24 text-center">
      <svg viewBox="0 0 200 240" className="h-[190px] w-[160px]" aria-hidden>
        <defs>
          <linearGradient id="sheet-back" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2e2e2e" />
            <stop offset="1" stopColor="#1c1c1c" />
          </linearGradient>
          <linearGradient id="sheet-front" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3a3a3a" />
            <stop offset="1" stopColor="#222" />
          </linearGradient>
        </defs>
        <rect x="30" y="22" width="136" height="186" rx="10" fill="url(#sheet-back)" transform="rotate(-9 98 115)" />
        <path d="M44 20h122a10 10 0 0 1 10 10v150l-34 34H44a10 10 0 0 1-10-10V30a10 10 0 0 1 10-10z" fill="url(#sheet-front)" transform="rotate(4 105 117)" />
        <path d="M176 180l-34 34v-24a10 10 0 0 1 10-10z" fill="#5a5a5a" transform="rotate(4 105 117)" />
        <g transform="translate(78 88) scale(2.1)" className="text-[#8a8a8a]">
          <LensMark />
        </g>
      </svg>
      <h1 className="mt-10 text-xl font-semibold leading-[1.5] tracking-ref text-ink dark:text-[#f5f5f5]">
        Get started with LesionLens
      </h1>
      <p className="mt-1.5 max-w-[281px] text-base font-medium leading-[1.5] tracking-ref text-subtle">
        Analyse a dermoscopic image with the action button to see class probabilities and a Grad-CAM map
      </p>
      <svg
        className="pointer-events-none fixed right-[42px] w-[46vw] max-w-[220px] text-[#a3a3a3] lg:hidden"
        style={{ bottom: "calc(var(--tabbar-bottom) + var(--tabbar-height) + 8px)", height: "min(170px, 22dvh)" }}
        viewBox="0 0 180 170"
        preserveAspectRatio="none"
        fill="none"
        aria-hidden
      >
        <path
          d="M8 2 C -4 60, 10 118, 60 124 C 110 130, 176 96, 168 164"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <path d="M162 156 L168 165 L174 155" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function MobileHome() {
  const { overview, recent, flagged, model } = useHomeData();
  const { openComposer } = useComposer();
  const navigate = useNavigate();
  const [tab, setTab] = useState<ResultsTab>("recents");
  const stats = overview.data;
  const pull = usePullToRefresh(() =>
    Promise.all([overview.refetch(), recent.refetch(), flagged.refetch(), model.refetch()]),
  );

  return (
    <>
      <TabTopBar />
      <PullIndicator state={pull} />
      <Page className="gap-0" style={{ transform: pull.distance ? `translateY(${pull.distance}px)` : undefined }}>
        <h1 className="sr-only">Home</h1>
        {overview.isError ? (
          <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
        ) : !stats ? (
          <div className="flex flex-col gap-3" role="status" aria-label="Loading">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-[173px] rounded-lg" />
            <Skeleton className="mt-6 h-6 w-32" />
            <Skeleton className="h-[182px] rounded-lg" />
          </div>
        ) : stats.total_analyses === 0 ? (
          <>
            <ModelAvailabilityNotice info={model.data} className="mb-6" />
            <EmptyHome />
          </>
        ) : (
          <div className="flex flex-col gap-8">
            <ModelAvailabilityNotice info={model.data} />

            <section aria-labelledby="home-analyses" className="flex flex-col gap-3">
              <SectionHeader
                id="home-analyses"
                title="Analyses"
                to="/app/analyses"
                right={
                  <SectionMenu label="Analyses options">
                    <DropdownMenuItem onSelect={openComposer}>
                      <ScanLine aria-hidden /> New analysis
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => navigate("/app/analyses")}>
                      <History aria-hidden /> All history
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => navigate("/app/reports")}>
                      <FileText aria-hidden /> Summary and reports
                    </DropdownMenuItem>
                  </SectionMenu>
                }
              />
              <p className="-mt-1.5 text-xs text-muted">
                {stats.total_analyses.toLocaleString()} total · {stats.analyses_last_7_days.toLocaleString()} in the last 7
                days · average top-class probability {formatPercent(stats.average_confidence, 0)}
              </p>
              {recent.data ? (
                <ActivityList items={recent.data.items.slice(0, 5)} />
              ) : (
                <Skeleton className="h-[173px] rounded-lg" />
              )}
            </section>

            {stats.most_recent && <LatestResultCard analysisId={stats.most_recent.analysis_id} />}

            <section aria-labelledby="home-review" className="flex flex-col gap-3">
              <SectionHeader
                id="home-review"
                title="Needs review"
                to="/app/analyses?uncertain=yes"
                right={
                  <SectionMenu label="Needs review options">
                    <DropdownMenuItem onSelect={() => navigate("/app/analyses?uncertain=yes")}>
                      <History aria-hidden /> All flagged results
                    </DropdownMenuItem>
                  </SectionMenu>
                }
              />
              {flagged.data ? (
                <ReviewList
                  items={flagged.data.items.slice(0, 3)}
                  checked={Math.min(stats.total_analyses, 20)}
                  onNew={openComposer}
                />
              ) : (
                <Skeleton className="h-[182px] rounded-lg" />
              )}
            </section>

            <section aria-labelledby="home-results" className="flex flex-col gap-3">
              <SectionHeader
                id="home-results"
                title="Results"
                to="/app/analyses"
                right={
                  <TextTabs
                    label="Results shown"
                    value={tab}
                    onValueChange={setTab}
                    options={[
                      { value: "recents", label: "Recents" },
                      { value: "flagged", label: "Flagged" },
                    ]}
                  />
                }
              />
              <ResultsRow
                recent={recent.data?.items}
                flagged={flagged.data?.items}
                tab={tab}
                className="-mx-4 px-4"
              />
            </section>

            <DisclaimerBanner compact />
          </div>
        )}
      </Page>
    </>
  );
}

function SummaryRows({ stats, className }: { stats: OverviewStats; className?: string }) {
  const rows: [string, string][] = [
    ["Total analyses", stats.total_analyses.toLocaleString()],
    ["Last 7 days", stats.analyses_last_7_days.toLocaleString()],
    ["Average top-class probability", formatPercent(stats.average_confidence)],
    [
      "Flagged uncertain",
      `${stats.uncertain_count.toLocaleString()}${stats.total_analyses ? ` (${formatPercent(stats.uncertain_count / stats.total_analyses, 0)})` : ""}`,
    ],
  ];
  return (
    <dl className={cn("flex flex-col", className)}>
      {rows.map(([label, value], i) => (
        <div key={label} className={cn("flex items-center justify-between gap-4 py-2.5", i > 0 && "border-t border-line")}>
          <dt className="text-base text-ink-2">{label}</dt>
          <dd className="tabular text-base font-semibold text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DesktopHome() {
  const { user } = useAuth();
  const { overview, recent, flagged, model } = useHomeData();
  const navigate = useNavigate();
  const [tab, setTab] = useState<ResultsTab>("recents");
  const stats = overview.data;
  const firstName = user?.full_name.split(" ")[0];
  const newAnalysis = () => navigate("/app/analyze");

  return (
    <Page>
      <DesktopHeader
        title={`${greeting()}${firstName ? `, ${firstName}` : ""}`}
        subtitle={formatLongDate()}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={newAnalysis}>
              <ScanLine aria-hidden /> New analysis
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/app/reports">
                <FileText aria-hidden /> Reports
              </Link>
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/app/model">
                <Cpu aria-hidden /> Model card
              </Link>
            </Button>
          </>
        }
      />

      <ModelAvailabilityNotice info={model.data} />

      {overview.isError ? (
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      ) : (
        <>
          <section aria-labelledby="desk-results" className="overflow-hidden rounded-lg bg-surface">
            <div className="flex items-center justify-between gap-4 px-5 pt-3.5">
              <h2 id="desk-results" className="text-lg font-semibold tracking-ref text-ink">
                Results
              </h2>
              <TextTabs
                label="Results shown"
                value={tab}
                onValueChange={setTab}
                options={[
                  { value: "recents", label: "Recents" },
                  { value: "flagged", label: "Flagged" },
                ]}
              />
            </div>
            {stats && stats.total_analyses === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 pb-10 pt-8 text-center">
                <p className="text-xl font-semibold tracking-ref text-ink">Get started with LesionLens</p>
                <p className="max-w-md text-base text-subtle">
                  Upload a dermoscopic image to get class probabilities and a Grad-CAM explanation. Results are saved
                  here.
                </p>
                <Button className="mt-2" onClick={newAnalysis}>
                  <ScanLine aria-hidden /> New analysis
                </Button>
              </div>
            ) : (
              <ResultsRow
                recent={recent.data?.items}
                flagged={flagged.data?.items}
                tab={tab}
                className="px-5 pb-0 pt-6 [&_a]:h-[204px]"
              />
            )}
          </section>

          <ActivityTimeline />

          <div className="grid gap-5 xl:grid-cols-2">
            <section aria-labelledby="desk-review" className="rounded-lg bg-surface">
              <div className="flex items-center justify-between px-5 pt-3.5">
                <h2 id="desk-review" className="text-lg font-semibold tracking-ref text-ink">
                  Needs review
                </h2>
                <button
                  type="button"
                  onClick={newAnalysis}
                  className="press-soft flex items-center gap-0.5 text-sm text-ink hover:opacity-80"
                >
                  <Plus className="size-4" strokeWidth={1.5} aria-hidden /> New analysis
                </button>
              </div>
              {flagged.data && stats ? (
                <ReviewList
                  items={flagged.data.items.slice(0, 4)}
                  checked={Math.min(stats.total_analyses, 20)}
                  onNew={newAnalysis}
                  className="bg-transparent px-5 pb-5 pt-6"
                />
              ) : (
                <Skeleton className="m-5 h-40" />
              )}
            </section>

            <section aria-labelledby="desk-summary" className="rounded-lg bg-surface px-5 pb-4 pt-3.5">
              <h2 id="desk-summary" className="text-lg font-semibold tracking-ref text-ink">
                Summary
              </h2>
              {stats ? (
                <>
                  <SummaryRows stats={stats} className="mt-3" />
                  {stats.class_distribution.length > 0 && (
                    <div className="mt-4 border-t border-line pt-4">
                      <p className="mb-2 text-sm text-muted">Predicted classes (latest prediction per analysis)</p>
                      <CountBars items={stats.class_distribution} total={stats.total_analyses} />
                    </div>
                  )}
                </>
              ) : (
                <Skeleton className="mt-4 h-40" />
              )}
            </section>
          </div>

          <DisclaimerBanner />
        </>
      )}
    </Page>
  );
}

export function HomePage() {
  useDocumentTitle("Home");
  const desktop = useIsDesktop();
  return desktop ? <DesktopHome /> : <MobileHome />;
}
