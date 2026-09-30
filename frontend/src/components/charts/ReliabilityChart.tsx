import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ReliabilityBin } from "@/api/types";

import { TooltipCard } from "./ChartTooltip";

/** Reliability diagram: observed accuracy per confidence bin against the ideal diagonal. */
export function ReliabilityChart({ bins }: { bins: ReliabilityBin[] }) {
  const rows = bins.map((b) => ({
    ...b,
    mid: (b.bin_lower + b.bin_upper) / 2,
    ideal: (b.bin_lower + b.bin_upper) / 2,
  }));
  return (
    <figure>
      <div className="h-64" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 16, left: -8 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="mid"
              type="number"
              domain={[0, 1]}
              ticks={[0, 0.2, 0.4, 0.6, 0.8, 1]}
              tickLine={false}
              label={{ value: "Mean predicted probability", position: "insideBottom", offset: -10 }}
            />
            <YAxis
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as (ReliabilityBin & { mid: number }) | undefined;
                return active && row ? (
                  <TooltipCard
                    title={`Confidence ${Math.round(row.bin_lower * 100)}–${Math.round(row.bin_upper * 100)}%`}
                    rows={[
                      { label: "Mean confidence", value: `${(row.confidence * 100).toFixed(1)}%` },
                      { label: "Observed accuracy", value: `${(row.accuracy * 100).toFixed(1)}%` },
                      { label: "Images", value: String(row.count) },
                    ]}
                  />
                ) : null;
              }}
            />
            <Bar dataKey="accuracy" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={24} />
            <Line
              data={[
                { mid: 0, ideal: 0 },
                { mid: 1, ideal: 1 },
              ]}
              dataKey="ideal"
              stroke="var(--line-strong)"
              dot={false}
              strokeWidth={1}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="text-xs text-muted">
        Bars: observed accuracy. Diagonal: perfect calibration.
      </figcaption>
    </figure>
  );
}
