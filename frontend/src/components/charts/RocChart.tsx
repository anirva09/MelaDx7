import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts";

import type { Curve } from "@/api/types";

interface RocChartProps {
  curves: Record<string, Curve>;
  selected: string;
  aucs: Record<string, number | null>;
}

/** One-vs-rest ROC curves; the selected class is emphasised, the others recede to grey. */
export function RocChart({ curves, selected, aucs }: RocChartProps) {
  const entries = Object.entries(curves);
  const toPoints = (curve: Curve) => curve.fpr.map((fpr, i) => ({ fpr, tpr: curve.tpr[i] }));
  const ordered = [...entries.filter(([c]) => c !== selected), ...entries.filter(([c]) => c === selected)];
  return (
    <figure>
      <div className="aspect-square max-h-80 w-full" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 8, right: 12, bottom: 16, left: 14 }}>
            <CartesianGrid />
            <XAxis
              type="number"
              dataKey="fpr"
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              tickLine={false}
              label={{ value: "False positive rate", position: "insideBottom", offset: -10 }}
            />
            <YAxis
              type="number"
              dataKey="tpr"
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              tickLine={false}
              width={40}
              label={{
                value: "True positive rate",
                angle: -90,
                position: "left",
                offset: 2,
                style: { textAnchor: "middle" },
              }}
            />
            <Line
              data={[
                { fpr: 0, tpr: 0 },
                { fpr: 1, tpr: 1 },
              ]}
              dataKey="tpr"
              stroke="var(--line-strong)"
              strokeWidth={1}
              dot={false}
              isAnimationActive={false}
            />
            {ordered.map(([code, curve]) => (
              <Line
                key={code}
                data={toPoints(curve)}
                dataKey="tpr"
                type="linear"
                stroke={code === selected ? "var(--series-1)" : "var(--chart-muted)"}
                strokeWidth={code === selected ? 2.5 : 1.25}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="text-xs text-muted">
        Selected: <span className="font-mono text-ink">{selected}</span>, AUC{" "}
        <span className="tabular text-ink">{aucs[selected]?.toFixed(3) ?? "n/a"}</span>. Diagonal = chance.
      </figcaption>
    </figure>
  );
}
