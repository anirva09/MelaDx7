import { Link } from "react-router-dom";

import { useModelInfo } from "@/api/queries";
import { cn } from "@/lib/utils";

/** Always-visible indicator of which model (if any) is producing results. */
export function ModelStatusBadge({ className }: { className?: string }) {
  const { data, isLoading, isError } = useModelInfo();
  let dot = "bg-line-strong";
  let text = "Checking model";
  if (isError) {
    dot = "bg-danger";
    text = "Model status unavailable";
  } else if (data?.status === "ready") {
    dot = "bg-good";
    text = `${data.display_name} v${data.version}`;
  } else if (data?.status === "untrained") {
    dot = "bg-caution";
    text = "Untrained model";
  } else if (data?.status === "unavailable") {
    dot = "bg-danger";
    text = "No model weights";
  }
  return (
    <Link
      to="/app/model"
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink-2 transition-colors hover:border-line-strong hover:text-ink",
        className,
      )}
      aria-label={`Model status: ${text}. Open model details.`}
    >
      <span className={cn("size-2 shrink-0 rounded-full", dot, isLoading && "animate-pulse")} aria-hidden />
      <span className="truncate">{text}</span>
    </Link>
  );
}
