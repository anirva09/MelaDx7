import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { HistogramBin } from "@/api/types";

import { TooltipCard } from "./ChartTooltip";

/** Distribution of top-class probabilities in 10 equal-width bins. */
export function HistogramChart({
  bins,
  height = 180,
  label = "Predictions",
}: {
  bins: HistogramBin[];
  height?: number;
  label?: string;
}) {
  const rows = bins.map((b) => ({
    ...b,
    name: `${Math.round(b.lower * 100)}–${Math.round(b.upper * 100)}%`,
  }));
  return (
    <figure>
      <div style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: -18 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="lower"
              tickFormatter={(v: number) => `${Math.round(v * 100)}`}
              tickLine={false}
              axisLine={false}
            />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload }) =>
                active && payload?.[0] ? (
                  <TooltipCard
                    title={`Probability ${payload[0].payload.name}`}
                    rows={[{ label, value: String(payload[0].value) }]}
                  />
                ) : null
              }
            />
            <Bar dataKey="count" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-1 text-center text-2xs text-muted">Top-class probability (%)</figcaption>
      <table className="sr-only">
        <caption>{label} by top-class probability</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <th scope="row">{r.name}</th>
              <td>{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
