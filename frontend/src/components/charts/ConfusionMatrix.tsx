import { useState } from "react";

import { Segmented } from "@/components/ui/segmented";

interface ConfusionMatrixProps {
  labels: string[];
  names?: Record<string, string>;
  matrix: number[][];
}

/**
 * Confusion matrix as a sequential single-hue heatmap (rows = true class, columns = prediction).
 * Row-normalised view shows per-class recall on the diagonal. Every cell prints its value.
 */
export function ConfusionMatrix({ labels, names = {}, matrix }: ConfusionMatrixProps) {
  const [mode, setMode] = useState<"normalized" | "counts">("normalized");
  const rowTotals = matrix.map((row) => row.reduce((a, b) => a + b, 0));
  const maxCount = Math.max(1, ...matrix.flat());

  return (
    <div className="flex flex-col gap-3">
      <Segmented
        size="sm"
        label="Matrix values"
        value={mode}
        onValueChange={setMode}
        options={[
          { value: "normalized", label: "Row-normalised" },
          { value: "counts", label: "Counts" },
        ]}
        className="self-start"
      />
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-[2px] text-xs">
          <caption className="sr-only">
            Confusion matrix. Rows are the true class, columns the predicted class.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="p-1 text-left align-bottom text-2xs font-normal text-muted">
                True ↓ / Predicted →
              </th>
              {labels.map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="min-w-11 p-1 text-center font-mono font-medium text-ink-2"
                  title={names[label]}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, i) => (
              <tr key={labels[i]}>
                <th
                  scope="row"
                  className="whitespace-nowrap p-1 pr-2 text-left font-mono font-medium text-ink-2"
                  title={names[labels[i]!]}
                >
                  {labels[i]}
                  <span className="ml-1 font-sans font-normal text-muted">({rowTotals[i]})</span>
                </th>
                {row.map((value, j) => {
                  const share = rowTotals[i] ? value / rowTotals[i]! : 0;
                  const t = mode === "normalized" ? share : value / maxCount;
                  const strong = t > 0.55;
                  return (
                    <td
                      key={labels[j]}
                      className="tabular h-10 min-w-11 rounded-[3px] text-center"
                      style={{
                        background: `color-mix(in oklab, var(--seq-hi) ${Math.round(t * 100)}%, var(--seq-lo))`,
                        color: strong ? "var(--surface)" : "var(--ink)",
                        outline: i === j ? "1px solid var(--line-strong)" : undefined,
                      }}
                      title={`True ${labels[i]}, predicted ${labels[j]}: ${value} (${(share * 100).toFixed(1)}% of row)`}
                    >
                      {mode === "normalized" ? (share * 100).toFixed(0) : value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-2xs text-muted">
        {mode === "normalized"
          ? "Percent of each true class. The diagonal is per-class recall (sensitivity)."
          : "Number of test images."}
      </p>
    </div>
  );
}
