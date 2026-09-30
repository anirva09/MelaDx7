import { Link } from "react-router-dom";

import type { ModelInfo } from "@/api/types";
import { UNTRAINED_WARNING } from "@/lib/copy";
import { cn } from "@/lib/utils";

/** Explains, with next steps, why results are unavailable or must not be interpreted. */
export function ModelAvailabilityNotice({
  info,
  className,
}: {
  info: ModelInfo | undefined;
  className?: string;
}) {
  if (!info || info.status === "ready") return null;
  const untrained = info.status === "untrained";
  return (
    <div role="note" className={cn("flex flex-col gap-2 rounded-lg bg-surface p-3", className)}>
      <div className="flex flex-col gap-1 px-1">
        <p className="text-md font-semibold text-today">
          {untrained ? "UNTRAINED MODEL: RESULTS ARE NOT MEANINGFUL" : "MODEL WEIGHTS ARE NOT AVAILABLE"}
        </p>
        <hr className="border-0 border-t border-line" />
      </div>
      <div className="px-1 text-md leading-relaxed text-ink-2">
        {untrained ? (
          <p>{UNTRAINED_WARNING}</p>
        ) : (
          <>
            <p>{info.message}</p>
            <p className="mt-1">
              Analyses cannot run until a trained model is loaded. History and existing reports remain
              available.
            </p>
          </>
        )}
        <Link
          to="/app/model"
          className="mt-0.5 inline-block py-1 font-medium text-ink underline underline-offset-2"
        >
          {untrained ? "How to train and load a model" : "Setup instructions"}
        </Link>
      </div>
    </div>
  );
}
