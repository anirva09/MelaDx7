import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

import { LESION, LESION_NAME, PASSWORD, uniqueEmail } from "./helpers";

/**
 * The full user journey, through the real UI only (no API shortcuts): landing page, sign-up
 * validation, sign-in, upload, prediction, probabilities, uncertainty, Grad-CAM controls, history,
 * quick search, PDF reports, model pages, settings, themes, account deletion and access control.
 *
 * Run against a production-like stack with a real model and a real lesion image:
 *   E2E_BASE_URL=http://localhost:8080 E2E_LESION_IMAGE=<held-out test image> npx playwright test full-ui-journey
 * Every step prints "STEP n PASS|FAIL name" so the run doubles as an acceptance record.
 */

// A wrong selector should fail in seconds, not after the whole test timeout.
test.use({ actionTimeout: 20_000 });

let counter = 0;
async function step<T>(name: string, body: () => Promise<T>): Promise<T> {
  counter += 1;
  const n = String(counter).padStart(2, "0");
  try {
    const result = await test.step(`${n} ${name}`, body);
    console.log(`STEP ${n} PASS ${name}`);
    return result;
  } catch (error) {
    console.log(`STEP ${n} FAIL ${name}`);
    throw error;
  }
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("full UI journey: landing, sign-up, analysis, Grad-CAM, history, reports, settings, themes, deletion", async ({
  page,
}) => {
  test.setTimeout(420_000);
  const consoleProblems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/status of 401/.test(m.text())) consoleProblems.push(m.text());
  });
  page.on("pageerror", (e) => consoleProblems.push(`pageerror: ${e.message}`));
  // Which requests failed (kept in the log so a console error can be traced to its request).
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("/api/auth/refresh")) {
      console.log(`HTTP ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
    }
  });

  const email = uniqueEmail("journey");
  const html = page.locator("html");

  // ------------------------------------------------------------------ 1. open the application
  await step("open the application: landing page, sections and disclaimer", async () => {
    await page.goto("/");
    await expect(page).toHaveTitle(/MelaDx7/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Interpretable AI");
    const sections = page.getByRole("navigation", { name: "Sections" });
    for (const name of ["How it works", "Explainability", "Limitations"]) {
      await expect(sections.getByRole("link", { name })).toBeVisible();
    }
    await sections.getByRole("link", { name: "Limitations" }).click();
    await expect(page.locator("#limitations")).toBeInViewport();
    await expect(page.getByText(/not a medical (device|diagnosis)/i).first()).toBeVisible();
  });

  // ------------------------------------------------------------------ 2. create an account
  await step("create account: validation messages, then success", async () => {
    await page.getByRole("link", { name: "Create account" }).first().click();
    await expect(page).toHaveURL(/\/register$/);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Enter your name.")).toBeVisible();
    await expect(page.getByText("Enter your email address.")).toBeVisible();
    await expect(page.getByText("Please confirm to continue.")).toBeVisible();

    await page.getByLabel("Full name").fill("Journey Tester");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByLabel("Confirm password").fill("different");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByText("The password does not meet the requirements.")).toBeVisible();
    await expect(page.getByText("The passwords do not match.")).toBeVisible();

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByText("Get started with MelaDx7").first()).toBeVisible();
  });

  // ------------------------------------------------------------------ 3. log in
  await step("sign out, reject a wrong password, then log in", async () => {
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await signIn(page, email, "Wrong-password-1");
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
    await signIn(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/app$/);
  });

  // ------------------------------------------------------------------ 4-7. upload and prediction
  let resultUrl = "";
  await step("invalid upload is rejected, a real lesion image is accepted", async () => {
    await page.goto("/app/analyze");
    await page.getByTestId("file-input").setInputFiles({
      name: "notes.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7 not an image"),
    });
    await expect(page.getByRole("alert")).toContainText("Unsupported file type");
    await expect(page.getByRole("button", { name: "Analyse image" })).toBeDisabled();
    await page.getByTestId("file-input").setInputFiles(LESION);
    await expect(page.getByAltText(`Preview of ${LESION_NAME}`)).toBeVisible();
    await page.getByRole("button", { name: "Analyse image" }).click();
    await expect(page).toHaveURL(/\/app\/analyses\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    resultUrl = page.url();
  });

  await step("prediction from the trained model: class, confidence and model version", async () => {
    await expect(page.getByTestId("predicted-class")).not.toBeEmpty();
    await expect(page.getByTestId("predicted-confidence")).toHaveText(/\d+\.\d%/);
    await expect(page.getByText(/ViT-Base\/16 v1\.0\.0/).first()).toBeVisible();
    await expect(page.getByLabel("Medical disclaimer")).toContainText("not a medical diagnosis");
  });

  await step("probabilities: all 7 classes, summing to 100%", async () => {
    const rows = page.getByRole("list", { name: "Probability for each class" }).getByRole("button");
    await expect(rows).toHaveCount(7);
    const texts = await rows.allTextContents();
    const total = texts.map((t) => parseFloat(t.match(/(\d+(?:\.\d+)?)%\s*$/)?.[1] ?? "NaN")).reduce((a, b) => a + b, 0);
    expect(Math.abs(total - 100)).toBeLessThan(1.0); // one-decimal rounding of 7 values
  });

  await step("uncertainty information is shown", async () => {
    await expect(page.getByText("Margin to 2nd class")).toBeVisible();
    await expect(page.getByText("Normalised entropy")).toBeVisible();
    await expect(page.getByText(/Not a risk score/)).toBeVisible();
  });

  // ------------------------------------------------------------------ 8. Grad-CAM
  await step("Grad-CAM: viewer modes, another class, opacity, colour map, zoom, PNG download", async () => {
    await expect(page.getByTestId("viewer-canvas")).toBeVisible();
    const viewer = page.getByLabel("Image and Grad-CAM explanation viewer");
    for (const mode of ["Heatmap", "Original", "Side by side", "Compare", "Overlay"]) {
      const radio = page.getByRole("radio", { name: new RegExp(mode) }).first();
      await radio.click();
      await expect(radio).toBeChecked(); // each mode renders differently, so check the mode and the viewer
      await expect(viewer).toBeVisible();
    }
    await expect(page.getByTestId("viewer-canvas")).toBeVisible(); // back on the overlay
    const rows = page.getByRole("list", { name: "Probability for each class" }).getByRole("button");
    const response = page.waitForResponse((r) => r.url().includes("/explanations/"));
    await rows.nth(1).click();
    expect((await response).status()).toBe(200);
    await expect(rows.nth(1)).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("radio", { name: "Ember" }).click();
    await expect(page.getByRole("radio", { name: "Ember" })).toBeChecked();
    await page.getByRole("radio", { name: "Turbo" }).click();
    await expect(page.getByRole("radio", { name: "Turbo" })).toBeChecked();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect(page.getByRole("button", { name: "Reset zoom" })).toBeEnabled(); // zoomed, so reset is available
    await page.getByRole("button", { name: "Reset zoom" }).click();
    await expect(page.getByRole("button", { name: "Reset zoom" })).toBeDisabled(); // back at 100%
    const slider = page.getByRole("slider", { name: /Overlay opacity/ });
    await slider.focus();
    await page.keyboard.press("ArrowRight");

    const png = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download the current view as PNG" }).click();
    expect((await png).suggestedFilename()).toMatch(/^meladx7-[0-9a-f]{8}-.+\.png$/);
  });

  // ------------------------------------------------------------------ 9-10. saved analysis
  await step("saved analysis appears in history and reopens with the same prediction", async () => {
    const predicted = await page.getByTestId("predicted-class").textContent();
    await page.goto("/app/analyses");
    const table = page.getByRole("table", { name: "Analysis history" });
    await expect(table.getByRole("row")).toHaveCount(2); // header + 1
    await table.getByRole("link", { name: LESION_NAME }).click();
    await expect(page).toHaveURL(resultUrl);
    await expect(page.getByTestId("predicted-class")).toHaveText(predicted ?? "");
  });

  // ------------------------------------------------------------------ 11-12. PDF report
  await step("PDF report from the result page is a real PDF", async () => {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download report" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^meladx7-report-[0-9a-f]{8}\.pdf$/);
    const bytes = fs.readFileSync((await file.path())!);
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(bytes.length).toBeGreaterThan(20_000); // includes the image and Grad-CAM
  });

  await step("Reports page lists the report and downloads it", async () => {
    await page.goto("/app/reports");
    await expect(page.getByRole("list", { name: "Analysis reports" })).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Download PDF report for/ }).first().click();
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  });

  // ------------------------------------------------------------------ history, search, quick search
  await step("history search finds the file and shows an empty state for nonsense", async () => {
    await page.goto("/app/analyses");
    const search = page.getByPlaceholder("Search file name, ID or class code");
    await search.fill("zzz-no-such-file");
    await expect(page.getByRole("table", { name: "Analysis history" }).locator("tbody tr")).toHaveCount(0);
    await search.fill(LESION_NAME.replace(/\.[a-z]+$/i, ""));
    await expect(page.getByRole("table", { name: "Analysis history" }).locator("tbody tr")).toHaveCount(1);
  });

  await step("quick search (Ctrl K) opens and finds the analysis", async () => {
    await page.goto("/app");
    await expect(page.getByRole("button", { name: /Quick Search/ })).toBeVisible(); // the app is ready
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox").fill(LESION_NAME.replace(/\.[a-z]+$/i, ""));
    await expect(dialog.getByRole("listbox", { name: "Results" }).getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  // ------------------------------------------------------------------ overview and model pages
  await step("overview shows real statistics and the result card", async () => {
    await page.goto("/app");
    await expect(page.getByText("Total analyses")).toBeVisible();
    await expect(page.getByRole("region", { name: "Latest result" }).or(page.getByRole("list", { name: "Recent results" }))).toBeVisible();
  });

  await step("model pages: model card, held-out evaluation, training metrics, real inference", async () => {
    await page.goto("/app/model");
    await expect(page.getByRole("heading", { name: /ViT-Base\/16 v1\.0\.0/ })).toBeVisible();
    await expect(page.getByText("Weights SHA-256")).toBeVisible();
    for (const tab of ["Held-out evaluation", "Training metrics", "Real inference results", "Model card"]) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
    }
    await page.getByRole("tab", { name: "Held-out evaluation" }).click();
    await expect(page.getByText(/Accuracy/i).first()).toBeVisible();
  });

  // ------------------------------------------------------------------ settings, profile, password
  await step("settings: About & safety sheet, profile update", async () => {
    await page.goto("/app/profile");
    await page.getByRole("button", { name: /About & safety/ }).click();
    await expect(page.getByRole("dialog")).toContainText(/research and clinical decision-support prototype/i);
    await page.keyboard.press("Escape");
    await page.getByLabel("Full name").fill("Journey Tester Jr");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByRole("button", { name: "Account: Journey Tester Jr" })).toBeVisible();
  });

  const newPassword = PASSWORD + "-changed1";
  await step("settings: change password, then sign in with the new one", async () => {
    await page.getByLabel("Current password").fill(PASSWORD);
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Confirm new password").fill(newPassword);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText(/password (was )?(changed|updated)/i).first()).toBeVisible();
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await signIn(page, email, PASSWORD);
    await expect(page.getByText("Incorrect email or password.")).toBeVisible(); // the old one no longer works
    await signIn(page, email, newPassword);
    await expect(page).toHaveURL(/\/app(\/profile)?$/); // signing in returns you to the page you were on
  });

  // ------------------------------------------------------------------ 13-16. themes
  await step("themes: Light, Dark and System apply at once and persist across a refresh", async () => {
    await page.goto("/app/profile");
    const theme = page.getByRole("radiogroup", { name: "Colour theme" });
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await theme.getByRole("radio", { name: "Dark" }).click();
    await expect(html).toHaveClass(/dark/);
    const dark = await bg();

    await theme.getByRole("radio", { name: "Light" }).click(); // 14. light mode
    await expect(html).not.toHaveClass(/dark/);
    expect(await bg()).not.toBe(dark);
    await page.reload(); // 16. persistence
    await expect(html).not.toHaveClass(/dark/);
    await expect(theme.getByRole("radio", { name: "Light" })).toBeChecked();

    await theme.getByRole("radio", { name: "Dark" }).click(); // 15. dark mode
    await expect(html).toHaveClass(/dark/);
    await page.reload();
    await expect(html).toHaveClass(/dark/);

    await theme.getByRole("radio", { name: "System" }).click();
    await page.emulateMedia({ colorScheme: "light" });
    await expect(html).not.toHaveClass(/dark/);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(html).toHaveClass(/dark/);
    await page.reload();
    await expect(theme.getByRole("radio", { name: "System" })).toBeChecked();
    await theme.getByRole("radio", { name: "Dark" }).click();
  });

  await step("account menu: appearance toggle and keyboard navigation", async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: /Light appearance/ }).click();
    await expect(html).not.toHaveClass(/dark/);
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: /Dark appearance/ }).click();
    await expect(html).toHaveClass(/dark/);
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
  });

  await step("unknown pages and results show clear states", async () => {
    await page.goto("/app/analyses/00000000-0000-0000-0000-000000000000");
    await expect(page.getByText("Analysis not found", { exact: true })).toBeVisible();
    await page.goto("/this-page-does-not-exist");
    await expect(page.getByRole("heading", { name: "This page does not exist" })).toBeVisible();
    await page.getByRole("link", { name: "Go to overview" }).click();
    await expect(page).toHaveURL(/\/app$/);
  });

  // ------------------------------------------------------------------ deleting one analysis, then the account
  await step("delete the analysis from its page: empty history", async () => {
    await page.goto(resultUrl);
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete analysis" }).click();
    await expect(page).toHaveURL(/\/app\/analyses$/);
    await expect(page.getByText("Your history is empty")).toBeVisible();
  });

  await step("17. account deletion: wrong password is refused, the right one deletes", async () => {
    await page.goto("/app/settings");
    await page.getByRole("button", { name: "Delete account" }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByLabel("Password", { exact: true }).fill("not-my-password-1");
    await dialog.getByRole("button", { name: "Delete account and data" }).click();
    await expect(dialog).toBeVisible(); // still open: refused
    await dialog.getByLabel("Password", { exact: true }).fill(newPassword);
    await dialog.getByRole("button", { name: "Delete account and data" }).click();
    await expect(page).toHaveURL(/\/\?account=deleted$/);
    await expect(page.getByText("Your account was deleted")).toBeVisible();
  });

  await step("18. session is terminated and the credentials no longer work", async () => {
    await signIn(page, email, newPassword);
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
    const refreshed = await page.evaluate(async () => (await fetch("/api/auth/refresh", { method: "POST" })).status);
    expect(refreshed).toBe(401);
  });

  await step("19. every protected route redirects to sign-in", async () => {
    for (const path of ["/app", "/app/analyze", "/app/analyses", "/app/reports", "/app/model", "/app/profile"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
  });

  await step("no unexpected console errors (only the two deliberate negative tests)", async () => {
    // The browser logs failed requests. Exactly two are intended: the unknown-analysis page (404)
    // and the wrong password on account deletion (400). Anything else is a real problem.
    expect(consoleProblems.filter((m) => !/status of (400|404)/.test(m))).toEqual([]);
    expect(consoleProblems.filter((m) => /status of 404/.test(m))).toHaveLength(1);
    expect(consoleProblems.filter((m) => /status of 400/.test(m))).toHaveLength(1);
  });
});
