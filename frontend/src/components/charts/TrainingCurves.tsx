import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { TrainingEpoch } from "@/api/types";

import { TooltipCard } from "./ChartTooltip";

interface CurveSpec {
  key: keyof TrainingEpoch;
  label: string;
  color: string;
}

function CurveChart({
  history,
  series,
  title,
  percent,
  bestEpoch,
}: {
  history: TrainingEpoch[];
  series: CurveSpec[];
  title: string;
  percent?: boolean;
  bestEpoch?: number;
}) {
  const fmt = (v: number) => (percent ? `${(v * 100).toFixed(1)}%` : v.toFixed(3));
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-sm font-medium text-ink">{title}</figcaption>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={history} margin={{ top: 6, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="epoch"
              tickLine={false}
              axisLine={false}
              label={{ value: "Epoch", position: "insideBottomRight", offset: -2 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={48}
              domain={percent ? [0, 1] : ["auto", "auto"]}
              tickFormatter={(v: number) => (percent ? `${Math.round(v * 100)}` : v.toFixed(2))}
            />
            {bestEpoch !== undefined && (
              <ReferenceLine
                x={bestEpoch}
                stroke="var(--line-strong)"
                label={{ value: "best", position: "insideTopRight", fontSize: 11 }}
              />
            )}
            <Tooltip
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipCard
                    title={`Epoch ${label}`}
                    rows={payload.map((p) => ({
                      label: String(p.name),
                      value: fmt(Number(p.value)),
                      color: String(p.color),
                    }))}
                  />
                ) : null
              }
            />
            <Legend
              verticalAlign="top"
              align="right"
              height={24}
              iconType="plainline"
              wrapperStyle={{ fontSize: 12, color: "var(--ink-2)" }}
            />
            {series.map((s) => (
              <Line
                key={String(s.key)}
                type="monotone"
                dataKey={s.key as string}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={history.length <= 12 ? { r: 3, strokeWidth: 2, stroke: "var(--surface)" } : false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** Loss and validation-metric curves. Two charts, never a dual axis. */
export function TrainingCurves({ history }: { history: TrainingEpoch[] }) {
  const best = [...history].reverse().find((h) => h.is_best)?.epoch;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <CurveChart
        title="Loss"
        history={history}
        bestEpoch={best}
        series={[
          { key: "train_loss", label: "Training", color: "var(--series-1)" },
          { key: "val_loss", label: "Validation", color: "var(--series-2)" },
        ]}
      />
      <CurveChart
        title="Validation metrics"
        percent
        history={history}
        bestEpoch={best}
        series={[
          { key: "val_macro_f1", label: "Macro F1", color: "var(--series-1)" },
          { key: "val_balanced_accuracy", label: "Balanced accuracy", color: "var(--series-2)" },
        ]}
      />
    </div>
  );
}
