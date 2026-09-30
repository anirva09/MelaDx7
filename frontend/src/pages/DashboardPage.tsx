import { ArrowRight, ScanSearch } from "lucide-react";
import { Link } from "react-router-dom";

import { useAnalyses, useModelInfo, useOverview } from "@/api/queries";
import { AnalysisTable } from "@/components/AnalysisTable";
import { ActivityChart } from "@/components/charts/ActivityChart";
import { CountBars } from "@/components/charts/CountBars";
import { HistogramChart } from "@/components/charts/HistogramChart";
import { ClassGroupBadge } from "@/components/ClassGroupBadge";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { MetricCard } from "@/components/MetricCard";
import { ModelAvailabilityNotice } from "@/components/ModelAvailabilityNotice";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorState } from "@/components/States";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { formatPercent, formatRelative } from "@/lib/utils";

function StatSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-[92px] rounded-lg" />
      ))}
    </div>
  );
}

export function DashboardPage() {
  useDocumentTitle("Overview");
  const { user } = useAuth();
  const overview = useOverview();
  const model = useModelInfo();
  const recent = useAnalyses({ page: 1, page_size: 5, sort: "created_at", order: "desc" });
  const stats = overview.data;
  const firstName = user?.full_name.split(" ")[0];

  const newAnalysis = (
    <Button asChild>
      <Link to="/app/analyze">
        <ScanSearch aria-hidden /> New analysis
      </Link>
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : "Overview"}
        description="Your analyses at a glance. Every number here is computed from analyses stored in your account."
        actions={newAnalysis}
      />

      <ModelAvailabilityNotice info={model.data} />

      {overview.isError ? (
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      ) : !stats ? (
        <StatSkeleton />
      ) : stats.total_analyses === 0 ? (
        <EmptyState
          icon={<ScanSearch />}
          title="No analyses yet"
          description="Upload a dermoscopic image to get the model's class probabilities and a Grad-CAM explanation. Results are saved here."
          action={newAnalysis}
          className="bg-surface py-16"
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard label="Total analyses" value={stats.total_analyses.toLocaleString()} />
            <MetricCard label="Last 7 days" value={stats.analyses_last_7_days.toLocaleString()} />
            <MetricCard
              label="Average top-class probability"
              value={formatPercent(stats.average_confidence)}
              hint="Mean of each analysis's highest probability"
            />
            <MetricCard
              label="Flagged uncertain"
              value={stats.uncertain_count.toLocaleString()}
              hint={`${formatPercent(stats.uncertain_count / stats.total_analyses, 0)} of analyses`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Activity</CardTitle>
                <CardDescription>Analyses per day over the last 30 days</CardDescription>
              </CardHeader>
              <CardContent>
                <ActivityChart data={stats.activity} />
              </CardContent>
            </Card>

            {stats.most_recent && (
              <Card>
                <CardHeader>
                  <CardTitle>Most recent result</CardTitle>
                  <CardDescription>{formatRelative(stats.most_recent.created_at)}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div>
                    <p className="text-xl font-semibold text-ink">{stats.most_recent.predicted_class.name}</p>
                    <p className="tabular mt-0.5 text-sm text-ink-2">
                      {formatPercent(stats.most_recent.confidence)} probability
                      {stats.most_recent.uncertain && (
                        <span className="text-caution">, flagged uncertain</span>
                      )}
                    </p>
                  </div>
                  <ClassGroupBadge group={stats.most_recent.predicted_class.group} className="self-start" />
                  <Button asChild variant="secondary" size="sm" className="mt-2 self-start">
                    <Link to={`/app/analyses/${stats.most_recent.analysis_id}`}>
                      Open result <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Predicted classes</CardTitle>
                <CardDescription>Latest prediction of each analysis</CardDescription>
              </CardHeader>
              <CardContent>
                <CountBars items={stats.class_distribution} total={stats.total_analyses} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Probability distribution</CardTitle>
                <CardDescription>
                  How confident the model's top class was across your analyses
                </CardDescription>
              </CardHeader>
              <CardContent>
                <HistogramChart bins={stats.confidence_histogram} label="Analyses" />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Recent analyses</CardTitle>
                <CardDescription>Your five latest uploads</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link to="/app/analyses">
                  View all <ArrowRight aria-hidden />
                </Link>
              </Button>
            </CardHeader>
            <div className="mt-3 border-t border-line">
              {recent.isError ? (
                <ErrorState error={recent.error} className="m-4" onRetry={() => void recent.refetch()} />
              ) : recent.data ? (
                <AnalysisTable items={recent.data.items} compact caption="Recent analyses" />
              ) : (
                <div className="flex flex-col gap-2 p-4">
                  {Array.from({ length: 3 }, (_, i) => (
                    <Skeleton key={i} className="h-12" />
                  ))}
                </div>
              )}
            </div>
          </Card>
        </>
      )}

      <DisclaimerBanner />
    </div>
  );
}
