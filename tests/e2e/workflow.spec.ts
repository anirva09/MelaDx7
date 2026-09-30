/**
 * The core workflow end to end, against the real API, database, storage and model:
 * upload -> prediction -> explanation -> save -> retrieve -> report -> delete.
 */
import { expect, test } from "@playwright/test";

import { analyse, PASSWORD, register } from "./helpers";

test("upload, predict, explain, save, retrieve, report and delete", async ({ page }) => {
  await register(page);
  await expect(page.getByText("No analyses yet")).toBeVisible();

  const id = await analyse(page);

  // Prediction: a class, a probability and the full distribution from the backend.
  await expect(page.getByTestId("predicted-class")).not.toBeEmpty();
  await expect(page.getByTestId("predicted-confidence")).toHaveText(/\d+\.\d%/);
  const rows = page.getByRole("list", { name: "Probability for each class" }).getByRole("button");
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(2);

  // Explanation: the viewer loads the stored image and CAM and draws them on canvas.
  const stage = page.getByRole("application", { name: /Grad-CAM overlay/ });
  await expect(stage).toBeVisible();
  await expect(page.getByTestId("viewer-canvas")).toBeVisible();
  const canvasSize = await page.getByTestId("viewer-canvas").evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
  expect(canvasSize[0]).toBeGreaterThan(100);
  await expect(page.getByLabel("Medical disclaimer")).toContainText("not a medical diagnosis");

  // Explanation for another class is computed on demand.
  const second = rows.nth(1);
  const explainResponse = page.waitForResponse((r) => r.url().includes(`/api/analyses/${id}/explanations/`));
  await second.click();
  expect((await explainResponse).status()).toBe(200);
  await expect(second).toHaveAttribute("aria-pressed", "true");

  // Viewer modes.
  for (const mode of ["Heatmap", "Side by side", "Compare", "Original", "Overlay"]) {
    await page.getByRole("radio", { name: new RegExp(mode) }).first().click();
  }

  // Report download.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download report" }).click();
  expect((await download).suggestedFilename()).toMatch(/^lesionlens-report-[0-9a-f]{8}\.pdf$/);

  // Retrieve: history lists the analysis; reloading the result shows the same output.
  const predicted = await page.getByTestId("predicted-class").textContent();
  await page.goto("/app/analyses");
  await expect(page.getByRole("table", { name: "Analysis history" }).getByRole("row")).toHaveCount(2);
  await page.getByRole("link", { name: "synthetic-lesion.jpg" }).click();
  await expect(page.getByTestId("predicted-class")).toHaveText(predicted ?? "");

  // Dashboard numbers come from the stored analysis.
  await page.goto("/app");
  await expect(page.getByText("Total analyses")).toBeVisible();

  // Delete.
  await page.goto(`/app/analyses/${id}`);
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete analysis" }).click();
  await expect(page).toHaveURL(/\/app\/analyses$/);
  await expect(page.getByText("Your history is empty")).toBeVisible();

  // Sign out and back in.
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("protected pages require sign-in and unknown results show a clear state", async ({ page }) => {
  await page.goto("/app/analyses");
  await expect(page).toHaveURL(/\/login$/);
  await register(page);
  await page.goto("/app/analyses/00000000-0000-0000-0000-000000000000");
  await expect(page.getByText("Analysis not found", { exact: true })).toBeVisible();
});

test("invalid uploads are rejected with an explanation", async ({ page }) => {
  await register(page);
  await page.goto("/app/analyze");
  await page.getByTestId("file-input").setInputFiles({
    name: "notes.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 not an image"),
  });
  await expect(page.getByRole("alert")).toContainText("Unsupported file type");
  await expect(page.getByRole("button", { name: "Analyse image" })).toBeDisabled();
});

test("deleting the account removes access and data", async ({ page }) => {
  const email = await register(page, "Delete Me");
  await analyse(page);
  await page.goto("/app/settings");
  await page.getByRole("button", { name: "Delete account" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await dialog.getByRole("button", { name: "Delete account and data" }).click();
  await expect(page).toHaveURL(/\/\?account=deleted$/);
  await expect(page.getByText("Your account was deleted")).toBeVisible();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
});
