import { toast } from "sonner";

import { analysisApi } from "@/api/endpoints";
import { errorMessage } from "@/lib/utils";

/** Download an analysis's PDF report, with progress and failure shown as toasts. */
export async function downloadReport(id: string): Promise<void> {
  const pending = toast.loading("Preparing the PDF report");
  try {
    await analysisApi.downloadReport(id);
    toast.success("Report downloaded", { id: pending });
  } catch (error) {
    toast.error("The report could not be generated", { id: pending, description: errorMessage(error) });
  }
}
