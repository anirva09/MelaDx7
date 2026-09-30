/**
 * Critical workflow: select image -> analyse -> result page shows the model output,
 * probabilities, Grad-CAM viewer, model information and the disclaimer; selecting
 * another class requests its explanation.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import * as endpoints from "@/api/endpoints";
import { AnalysisDetailPage } from "@/pages/AnalysisDetailPage";
import { AnalyzePage } from "@/pages/AnalyzePage";
import { makeAnalysis, modelInfo } from "@/test/fixtures";
import { json, mockFetch, mockImageLoading, renderWithProviders } from "@/test/utils";

const detail = makeAnalysis();

describe("analysis workflow", () => {
  beforeEach(() => mockImageLoading(600, 450));

  it("uploads an image and opens the saved result", async () => {
    mockFetch({ "GET /api/model/info": () => json(modelInfo) });
    const create = vi.spyOn(endpoints.analysisApi, "create").mockImplementation(async (_file, onProgress) => {
      onProgress(0.5);
      onProgress(1);
      return detail;
    });

    renderWithProviders(<AnalyzePage />, {
      route: "/app/analyze",
      path: "/app/analyze",
      extraRoutes: [{ path: "/app/analyses/:id", element: <p>Result page</p> }],
    });

    const analyse = screen.getByRole("button", { name: "Analyse image" });
    expect(analyse).toBeDisabled();
    await userEvent.upload(
      screen.getByTestId("file-input"),
      new File([new Uint8Array(2000)], "case.jpg", { type: "image/jpeg" }),
    );
    await screen.findByAltText("Preview of case.jpg");
    await userEvent.click(analyse);

    expect(await screen.findByText("Result page")).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].name).toBe("case.jpg");
  });

  it("keeps the file and explains the error when the model is unavailable", async () => {
    mockFetch({ "GET /api/model/info": () => json(modelInfo) });
    const { ApiError } = await import("@/api/client");
    vi.spyOn(endpoints.analysisApi, "create").mockRejectedValue(
      new ApiError(503, "model_unavailable", "The analysis model is not available."),
    );
    renderWithProviders(<AnalyzePage />, { route: "/app/analyze", path: "/app/analyze" });
    await userEvent.upload(
      screen.getByTestId("file-input"),
      new File([new Uint8Array(2000)], "case.jpg", { type: "image/jpeg" }),
    );
    await screen.findByAltText("Preview of case.jpg");
    await userEvent.click(screen.getByRole("button", { name: "Analyse image" }));
    const alert = await screen.findByText("The analysis could not be completed");
    expect(alert.closest("[role=alert]")).toHaveTextContent(/A trained model must be loaded/);
    expect(screen.getByAltText("Preview of case.jpg")).toBeInTheDocument();
  });

  it("renders the full result and requests Grad-CAM for another class", async () => {
    const { calls } = mockFetch({
      [`GET /api/analyses/${detail.id}`]: () => json(detail),
      "GET /api/model/info": () => json(modelInfo),
      [`GET /api/analyses/${detail.id}/explanations/mel`]: () =>
        json({
          analysis_id: detail.id,
          prediction_id: detail.prediction.id,
          target_class: { index: 4, code: "mel", name: "Melanoma", group: "malignant" },
          probability: 0.21,
          heatmap_url: "/api/files/h2",
          overlay_url: "/api/files/o2",
          cam_url: "/api/files/c2",
          degenerate: false,
        }),
    });
    renderWithProviders(<AnalysisDetailPage />, {
      route: `/app/analyses/${detail.id}`,
      path: "/app/analyses/:id",
    });

    expect(await screen.findByTestId("predicted-class")).toHaveTextContent("Melanocytic nevus");
    expect(screen.getByTestId("predicted-confidence")).toHaveTextContent("66.0%");
    expect(
      screen.getByRole("application", { name: /Grad-CAM overlay for Melanocytic nevus/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/model-attribution visualizations/)).toBeInTheDocument();
    expect(screen.getByLabelText("Medical disclaimer")).toHaveTextContent(/not a medical diagnosis/);
    const modelCard = screen
      .getByRole("heading", { name: "Model information" })
      .closest("div")!.parentElement!;
    expect(within(modelCard).getByText("EfficientNet-B0")).toBeInTheDocument();
    expect(screen.getByText(detail.id)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Melanoma: 21.0%/ }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.pathname === `/api/analyses/${detail.id}/explanations/mel`)).toBe(true),
    );
    expect(await screen.findByRole("application", { name: /for Melanoma\./ })).toBeInTheDocument();
  });

  it("warns prominently when the result came from an untrained model", async () => {
    const untrained = makeAnalysis({
      prediction: { ...detail.prediction, model: { ...detail.prediction.model, trained: false } },
    });
    mockFetch({
      [`GET /api/analyses/${detail.id}`]: () => json(untrained),
      "GET /api/model/info": () => json(modelInfo),
    });
    renderWithProviders(<AnalysisDetailPage />, {
      route: `/app/analyses/${detail.id}`,
      path: "/app/analyses/:id",
    });
    expect(await screen.findByText("Produced by an untrained model")).toBeInTheDocument();
  });

  it("shows a not-found state for unknown analyses", async () => {
    mockFetch({
      "GET /api/analyses/missing": () =>
        json({ error: { code: "not_found", message: "Analysis not found." } }, 404),
      "GET /api/model/info": () => json(modelInfo),
    });
    renderWithProviders(<AnalysisDetailPage />, {
      route: "/app/analyses/missing",
      path: "/app/analyses/:id",
    });
    expect(await screen.findByText("Analysis not found", { selector: "p" })).toBeInTheDocument();
  });
});
