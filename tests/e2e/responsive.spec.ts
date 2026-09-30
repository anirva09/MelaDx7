/**
 * The phone experience: every page fits the screen, the floating tab bar and "+" composer
 * work, and a result opens on the swipe comparison with its details in a bottom sheet.
 */
import { expect, test } from "@playwright/test";

import { analyse, LESION_NAME, register } from "./helpers";

test("pages fit the viewport on a phone", async ({ page }) => {
  await register(page, "Mobile Tester");
  const id = await analyse(page);
  for (const path of [
    "/",
    "/app",
    "/app/analyze",
    "/app/analyses",
    `/app/analyses/${id}`,
    "/app/reports",
    "/app/profile",
    "/app/model",
  ]) {
    await page.goto(path);
    await page.waitForLoadState("load");
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth, `horizontal overflow on ${path}`).toBeLessThanOrEqual(innerWidth);
  }
});

test("tab bar, composer and result sheet on a phone", async ({ page }) => {
  await register(page, "Mobile Tester");
  const id = await analyse(page);

  // The result opens on the swipe comparison; details open in a bottom sheet.
  await expect(page.getByRole("application", { name: /^Comparison of the original/ })).toBeVisible();
  await page.getByRole("button", { name: "Result details" }).click();
  const sheet = page.getByRole("dialog", { name: "Result details" });
  await expect(sheet.getByRole("list", { name: "Probability for each class" })).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).click();

  // Floating tab bar: four destinations; the current one is marked.
  await page.goto("/app");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav).toBeVisible();
  for (const [name, url] of [
    ["History", /\/app\/analyses$/],
    ["Reports", /\/app\/reports$/],
    ["Profile", /\/app\/profile$/],
    ["Home", /\/app$/],
  ] as const) {
    await nav.getByRole("link", { name }).click();
    await expect(page).toHaveURL(url);
    await expect(nav.getByRole("link", { name })).toHaveAttribute("aria-current", "page");
  }

  // History row opens the result.
  await page.goto("/app/analyses");
  await page.getByRole("link", { name: LESION_NAME }).first().click();
  await expect(page).toHaveURL(new RegExp(`/app/analyses/${id}$`));

  // The "+" composer offers the image sources.
  await page.goto("/app");
  await page.getByRole("button", { name: "New analysis" }).click();
  const composer = page.getByRole("dialog", { name: "New analysis" });
  for (const name of ["Take a photo", "Choose from photos", "Browse files"]) {
    await expect(composer.getByRole("button", { name })).toBeVisible();
  }
});
