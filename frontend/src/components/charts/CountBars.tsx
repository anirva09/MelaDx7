import type { ClassCount } from "@/api/types";

/** Horizontal count bars for categorical distributions. Values are printed at each bar tip. */
export function CountBars({ items, total }: { items: ClassCount[]; total?: number }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  const sum = total ?? items.reduce((acc, i) => acc + i.count, 0);
  return (
    <ul className="flex flex-col gap-2.5" aria-label="Predicted class distribution">
      {items.map((item) => (
        <li
          key={item.code}
          className="grid grid-cols-[minmax(0,10rem)_1fr] items-center gap-3 text-sm sm:grid-cols-[minmax(0,13rem)_1fr]"
        >
          <span className="truncate text-ink-2" title={item.name}>
            {item.name}
          </span>
          <span className="flex items-center gap-2">
            <span
              className="h-3 rounded-r-[4px] bg-series-1"
              style={{ width: `${(item.count / max) * 100}%`, minWidth: 3 }}
              aria-hidden
            />
            <span className="tabular shrink-0 text-xs text-ink">
              {item.count}
              <span className="text-muted"> · {sum ? Math.round((item.count / sum) * 100) : 0}%</span>
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
