import { Copy, Eye, History, Share, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { analysisApi } from "@/api/endpoints";
import { useDeleteAnalysis } from "@/api/queries";
import { ConfirmDialog } from "@/components/ui/dialog";
import { LongPressMenu } from "@/components/ui/lift-menu";
import { formatDateTime } from "@/lib/utils";
import { errorMessage } from "@/lib/utils";

interface AnalysisRef {
  id: string;
  created_at: string;
  original_filename: string;
  predicted_class: { name: string };
}

export async function downloadReport(id: string): Promise<void> {
  const pending = toast.loading("Preparing the PDF report");
  try {
    await analysisApi.downloadReport(id);
    toast.success("Report downloaded", { id: pending });
  } catch (error) {
    toast.error("The report could not be generated", { id: pending, description: errorMessage(error) });
  }
}

/** Long-press / right-click menu for an analysis card or row, with a confirmed delete. */
export function AnalysisMenu({ item, children, className }: { item: AnalysisRef; children: ReactNode; className?: string }) {
  const navigate = useNavigate();
  const remove = useDeleteAnalysis();
  const [confirm, setConfirm] = useState(false);
  const label = `Actions for ${item.predicted_class.name}, ${formatDateTime(item.created_at)}`;
  return (
    <>
      <LongPressMenu
        label={label}
        className={className}
        actions={[
          { label: "Open result", icon: <Eye aria-hidden />, onSelect: () => navigate(`/app/analyses/${item.id}`) },
          { label: "Download report", icon: <Share aria-hidden />, onSelect: () => void downloadReport(item.id) },
          {
            label: "Copy analysis ID",
            icon: <Copy aria-hidden />,
            onSelect: () =>
              void navigator.clipboard?.writeText(item.id).then(
                () => toast.success("Analysis ID copied"),
                () => toast.error("Copy failed"),
              ),
          },
          {
            label: "Prediction history",
            icon: <History aria-hidden />,
            onSelect: () => navigate(`/app/analyses/${item.id}#history`),
          },
          { label: "Delete", icon: <Trash2 aria-hidden />, destructive: true, onSelect: () => setConfirm(true) },
        ]}
      >
        {children}
      </LongPressMenu>
      <DeleteAnalysisDialog
        open={confirm}
        onOpenChange={setConfirm}
        filename={item.original_filename}
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(item.id, {
            onSuccess: () => {
              setConfirm(false);
              toast.success("Analysis deleted");
            },
            onError: (error) => {
              setConfirm(false);
              toast.error("The analysis could not be deleted", { description: errorMessage(error) });
            },
          })
        }
      />
    </>
  );
}

export function DeleteAnalysisDialog({
  open,
  onOpenChange,
  filename,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filename: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete this analysis?"
      description={`${filename}: the stored image, its Grad-CAM maps and all predictions for it will be permanently deleted.`}
      confirmLabel="Delete analysis"
      pending={pending}
      onConfirm={onConfirm}
    />
  );
}
