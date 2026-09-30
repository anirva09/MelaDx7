import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GradCAMViewer } from "@/components/GradCAMViewer";
import { mockImageLoading } from "@/test/utils";

describe("GradCAMViewer", () => {
  beforeEach(() => mockImageLoading(600, 450));

  it("offers every view and switches between them", async () => {
    render(<GradCAMViewer imageUrl="/api/files/img" camUrl="/api/files/cam" targetLabel="Melanoma" />);
    const group = screen.getByRole("radiogroup", { name: "View mode" });
    for (const name of ["Overlay", "Heatmap", "Original", "Side by side", "Compare"]) {
      expect(group).toHaveTextContent(name);
    }
    const stage = screen.getByRole("application");
    expect(stage).toHaveAccessibleName(/Grad-CAM overlay for Melanoma/);
    await userEvent.click(screen.getByRole("radio", { name: /Heatmap/ }));
    expect(stage).toHaveAccessibleName(/Grad-CAM heatmap for Melanoma/);
    await userEvent.click(screen.getByRole("radio", { name: /Compare/ }));
    expect(screen.getByRole("slider", { name: /Compare position/ })).toBeInTheDocument();
  });

  it("exposes opacity, threshold and zoom controls", async () => {
    render(<GradCAMViewer imageUrl="/api/files/img" camUrl="/api/files/cam" />);
    expect(screen.getByRole("slider", { name: /Overlay opacity/ })).toHaveValue("50");
    expect(screen.getByRole("slider", { name: /Hide below/ })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("150%")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("shows only the original when no explanation exists", () => {
    render(<GradCAMViewer imageUrl="/api/files/img" camUrl={null} heatmapUrl={null} />);
    expect(screen.queryByRole("radio", { name: /Heatmap/ })).not.toBeInTheDocument();
    expect(screen.getByText(/No Grad-CAM explanation is available/)).toBeInTheDocument();
  });

  it("tells the user when the attribution map is empty", async () => {
    render(
      <GradCAMViewer imageUrl="/api/files/img" camUrl="/api/files/cam" degenerate targetLabel="Melanoma" />,
    );
    expect(await screen.findByText(/no positive evidence for Melanoma/)).toBeInTheDocument();
  });
});
