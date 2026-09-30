import { Link } from "react-router-dom";

import type { ModelInfo } from "@/api/types";
import { Notice } from "@/components/Notice";
import { UNTRAINED_WARNING } from "@/lib/copy";

/** Explains, with next steps, why results are unavailable or must not be interpreted. */
export function ModelAvailabilityNotice({
  info,
  className,
}: {
  info: ModelInfo | undefined;
  className?: string;
}) {
  if (!info || info.status === "ready") return null;
  if (info.status === "untrained") {
    return (
      <Notice tone="danger" title="Untrained model: results are not meaningful" className={className}>
        {UNTRAINED_WARNING}{" "}
        <Link to="/app/model" className="font-medium text-ink underline underline-offset-2">
          How to train and load a model
        </Link>
      </Notice>
    );
  }
  return (
    <Notice tone="caution" title="Model weights are not available" className={className}>
      <p>{info.message}</p>
      <p className="mt-1">
        Analyses cannot run until a trained model is loaded. History and existing reports remain available.{" "}
        <Link to="/app/model" className="font-medium text-ink underline underline-offset-2">
          Setup instructions
        </Link>
      </p>
    </Notice>
  );
}
