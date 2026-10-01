import { expect, test } from "@playwright/test";

import { analyse, register } from "./helpers";

// Regressions found in manual review. Each assertion measures the layout, so it fails if the
// problem comes back.

test("landing header: the brand sits on the same line as the section links", async ({ page }) => {
  await page.goto("/");
  const brand = page.getByRole("link", { name: "MelaDx7 home" }).getByText("MelaDx7");
  const link = page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "How it works" });
  const centre = async (locator: typeof brand) => {
    const box = await locator.boundingBox();
    return box!.y + box!.height / 2;
  };
  expect(Math.abs((await centre(brand)) - (await centre(link)))).toBeLessThanOrEqual(2);
});

test("sidebar: Quick Search is never clipped, at normal and enlarged text", async ({ page }) => {
  await register(page);
  await page.goto("/app");
  const search = page.getByRole("button", { name: /Quick Search/ });
  const label = search.getByText("Quick Search");
  const shortcut = search.locator("kbd");
  await expect(search).toBeVisible();

  const clipped = () => label.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  const lines = async () => {
    const lineHeight = await label.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || 20);
    return Math.round(((await label.boundingBox())!.height) / lineHeight);
  };

  // Normal size: the label is complete and the shortcut chip is shown.
  expect(await clipped()).toBe(false);
  expect(await lines()).toBe(1);
  await expect(shortcut).toBeVisible();

  // 125% text: the sidebar grows with the text (its width is in rem), so the label stays complete
  // and the shortcut chip stays visible.
  await page.addStyleTag({ content: "html { font-size: 20px !important; }" });
  expect(await clipped()).toBe(false);
  expect(await lines()).toBe(1);
  await expect(shortcut).toBeVisible();
  const sidebarWidth = await page.locator("aside[aria-label='Sidebar']").evaluate((el) => el.getBoundingClientRect().width);
  expect(sidebarWidth).toBeGreaterThan(260); // 13.75rem at 20px
  const overflow = await search.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("account menu: compact rows with small icons", async ({ page }) => {
  await register(page);
  await page.goto("/app");
  await page.getByRole("button", { name: /^Account:/ }).click();
  const item = page.getByRole("menuitem", { name: "Profile" });
  await expect(item).toBeVisible();
  expect(((await item.boundingBox())!).height).toBeLessThanOrEqual(38);
  expect(((await item.locator("svg").boundingBox())!).width).toBeLessThanOrEqual(18);
});

test("overview: result cards do not touch the bottom edge of their panel", async ({ page }) => {
  await register(page);
  await analyse(page);
  await page.goto("/app");
  const panel = page.locator("section[aria-labelledby='desk-results']");
  const card = panel.getByRole("link").first();
  await expect(card).toBeVisible();
  const panelBox = (await panel.boundingBox())!;
  const cardBox = (await card.boundingBox())!;
  expect(panelBox.y + panelBox.height - (cardBox.y + cardBox.height)).toBeGreaterThanOrEqual(12);
});

test("light theme: menu dividers are visible", async ({ page }) => {
  await register(page);
  await page.evaluate(() => localStorage.setItem("meladx7-theme", "light"));
  await page.goto("/app");
  await page.getByRole("button", { name: /^Account:/ }).click();
  const separator = page.getByRole("menu").getByRole("separator").first();
  await expect(separator).toBeVisible();
  // Normalise whatever colour syntax the browser reports (rgb(), color(srgb ...), oklab ...) to 0-255 RGBA.
  const [r, g, b, a] = await separator.evaluate((el) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = getComputedStyle(el).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  });
  // On a white menu a visible divider is dark and not fully transparent; white-on-white is invisible.
  expect(a).toBeGreaterThanOrEqual(12);
  expect((r + g + b) / 3).toBeLessThan(80);
});
