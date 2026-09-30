/** Phone history: day-grouped rows, filter sheet, and a confirmed delete from the row menu. */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AnalysisListItem, Page } from "@/api/types";
import { ComposerProvider } from "@/components/shell/Composer";
import { AuthProvider } from "@/context/AuthContext";
import { HistoryPage } from "@/pages/HistoryPage";
import { modelInfo } from "@/test/fixtures";
import { json, mockFetch, renderWithProviders } from "@/test/utils";

function item(n: number, iso: string, code = "nv"): AnalysisListItem {
  return {
    id: `00000000-0000-0000-0000-00000000000${n}`,
    created_at: iso,
    original_filename: `case-${n}.jpg`,
    thumbnail_url: `/api/files/t${n}`,
    predicted_class: { index: 5, code, name: code === "nv" ? "Melanocytic nevus" : "Melanoma", group: code === "nv" ? "benign" : "malignant" },
    confidence: 0.7,
    uncertain: false,
    concern_probability: 0.2,
    model_label: "EfficientNet-B0 v1.0.0",
    prediction_count: 1,
  };
}

const page = (items: AnalysisListItem[]): Page<AnalysisListItem> => ({ items, total: items.length, page: 1, page_size: 20, pages: 1 });

describe("history on phones", () => {
  it("groups analyses by day and filters by class from the sheet", async () => {
    const items = [item(1, "2026-09-30T10:00:00Z"), item(2, "2026-09-30T08:00:00Z"), item(3, "2026-09-20T08:00:00Z", "mel")];
    const { calls } = mockFetch({
      "POST /api/auth/refresh": () => json({ error: { code: "no_session", message: "x" } }, 401),
      "GET /api/model/info": () => json(modelInfo),
      "GET /api/analyses": (_init, url) =>
        json(page(url.searchParams.get("predicted_class") === "mel" ? [items[2]!] : items)),
    });
    renderWithProviders(
      <AuthProvider>
        <ComposerProvider>
          <HistoryPage />
        </ComposerProvider>
      </AuthProvider>,
      { route: "/app/analyses", path: "/app/analyses" },
    );
    const groups = await screen.findAllByRole("list");
    const rows = groups.flatMap((g) => within(g).queryAllByRole("link"));
    expect(rows).toHaveLength(3);
    expect(screen.getAllByRole("region").length).toBeGreaterThanOrEqual(2);

    await userEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    const sheet = await screen.findByRole("dialog", { name: "Filters" });
    await userEvent.click(within(sheet).getByRole("button", { name: /mel\s*Melanoma/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Apply filters" }));

    await waitFor(() =>
      expect(calls.some((c) => c.url.searchParams.get("predicted_class") === "mel")).toBe(true),
    );
    expect(await screen.findByRole("button", { name: "Remove filter: Melanoma" })).toBeInTheDocument();
  });

  it("asks for confirmation before deleting from the row menu", async () => {
    const items = [item(1, "2026-09-30T10:00:00Z")];
    const { calls } = mockFetch({
      "POST /api/auth/refresh": () => json({ error: { code: "no_session", message: "x" } }, 401),
      "GET /api/model/info": () => json(modelInfo),
      "GET /api/analyses": () => json(page(items)),
      [`DELETE /api/analyses/${items[0]!.id}`]: () => new Response(null, { status: 204 }),
    });
    renderWithProviders(
      <AuthProvider>
        <ComposerProvider>
          <HistoryPage />
        </ComposerProvider>
      </AuthProvider>,
      { route: "/app/analyses", path: "/app/analyses" },
    );
    const row = await screen.findByRole("link", { name: /Melanocytic nevus/ });
    fireEvent.contextMenu(row);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Delete this analysis?" });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await userEvent.click(within(confirm).getByRole("button", { name: "Delete analysis" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
  });
});
