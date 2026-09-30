import type { ModelRef } from "@/api/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMs, shortHash } from "@/lib/utils";

interface ModelInfoCardProps {
  model: ModelRef;
  temperature: number;
  inferenceMs: number;
  explainMs: number | null;
}

/** Everything needed to reproduce a prediction: model identity, weights hash, preprocessing, calibration. */
export function ModelInfoCard({ model, temperature, inferenceMs, explainMs }: ModelInfoCardProps) {
  const rows: [string, React.ReactNode][] = [
    ["Architecture", model.display_name],
    ["Model version", model.version],
    [
      "Weights SHA-256",
      <span key="sha" className="font-mono text-xs" title={model.weights_sha256}>
        {shortHash(model.weights_sha256, 16)}…
      </span>,
    ],
    [
      "Training dataset",
      model.trained ? model.dataset_id : `None (untrained; ${model.dataset_id} class set)`,
    ],
    ["Preprocessing", `v${model.preprocessing_version}, ${model.input_size}×${model.input_size} px`],
    ["Calibration", `Temperature scaling, T = ${temperature.toFixed(3)}`],
    [
      "Grad-CAM layer",
      <span key="layer" className="font-mono text-xs">
        {model.gradcam_layer}
      </span>,
    ],
    ["Inference time", formatMs(inferenceMs)],
    ["Explanation time", formatMs(explainMs)],
  ];
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Model information</CardTitle>
        {model.trained ? <Badge tone="good">Trained</Badge> : <Badge tone="danger">Untrained</Badge>}
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd className="min-w-0 break-words text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
