/** Every main page must fit a phone screen without horizontal scrolling. */
import { expect, test } from "@playwright/test";

import { analyse, register } from "./helpers";

test("pages fit the viewport on a phone", async ({ page }) => {
  await register(page, "Mobile Tester");
  const id = await analyse(page);
  for (const path of ["/", "/app", "/app/analyze", "/app/analyses", `/app/analyses/${id}`, "/app/model", "/app/settings"]) {
    await page.goto(path);
    await page.waitForLoadState("load");
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth, `horizontal overflow on ${path}`).toBeLessThanOrEqual(innerWidth);
  }
  await page.goto("/app");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
});
