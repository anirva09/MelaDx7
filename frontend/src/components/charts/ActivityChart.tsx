import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { TooltipCard } from "./ChartTooltip";

interface ActivityChartProps {
  data: { date: string; count: number }[];
  height?: number;
}

const dayLabel = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** Analyses per day (single series; value in tooltip and the accessible table). */
export function ActivityChart({ data, height = 180 }: ActivityChartProps) {
  const rows = data.map((d) => ({ ...d, label: dayLabel.format(new Date(`${d.date}T00:00:00`)) }));
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <figure>
      <div style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: -18 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval={6} minTickGap={8} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} domain={[0, max]} width={40} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload }) =>
                active && payload?.[0] ? (
                  <TooltipCard
                    title={String(payload[0].payload.label)}
                    rows={[{ label: "Analyses", value: String(payload[0].value) }]}
                  />
                ) : null
              }
            />
            <Bar dataKey="count" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Analyses per day, last {rows.length} days</caption>
        <tbody>
          {rows
            .filter((r) => r.count > 0)
            .map((r) => (
              <tr key={r.date}>
                <th scope="row">{r.label}</th>
                <td>{r.count}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </figure>
  );
}
