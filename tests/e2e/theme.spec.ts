import { expect, test } from "@playwright/test";

import { PASSWORD, register } from "./helpers";

const KEY = "meladx7-theme";

test("theme: Light, Dark and System apply at once and persist", async ({ page }) => {
  const email = await register(page);
  await page.goto("/app/profile");
  const html = page.locator("html");
  const theme = page.getByRole("radiogroup", { name: "Colour theme" });
  const stored = () => page.evaluate((k) => localStorage.getItem(k), KEY);
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  // Dark is the default.
  await expect(html).toHaveClass(/dark/);
  const darkBackground = await background();

  // Light: immediate, stored, survives a reload (no flash: the class is set before first paint).
  await theme.getByRole("radio", { name: "Light" }).click();
  await expect(html).not.toHaveClass(/dark/);
  expect(await stored()).toBe("light");
  const lightBackground = await background();
  expect(lightBackground).not.toBe(darkBackground);
  await page.reload();
  await expect(html).not.toHaveClass(/dark/);
  await expect(theme.getByRole("radio", { name: "Light" })).toBeChecked();

  // Other pages respect it too.
  for (const path of ["/app", "/app/analyze", "/app/analyses", "/app/model", "/app/reports"]) {
    await page.goto(path);
    await expect(html).not.toHaveClass(/dark/);
  }

  // Dark again.
  await page.goto("/app/profile");
  await theme.getByRole("radio", { name: "Dark" }).click();
  await expect(html).toHaveClass(/dark/);
  await page.reload();
  await expect(html).toHaveClass(/dark/);

  // System follows the operating system, live and after a reload.
  await theme.getByRole("radio", { name: "System" }).click();
  expect(await stored()).toBe("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(html).not.toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await expect(html).not.toHaveClass(/dark/);
  await expect(theme.getByRole("radio", { name: "System" })).toBeChecked();

  // The choice survives signing out and back in.
  await page.getByText("Sign out").click();
  await expect(page).toHaveURL(/\/login/);
  await expect(html).not.toHaveClass(/dark/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app/);
  await page.goto("/app/profile");
  expect(await stored()).toBe("system");
  await expect(theme.getByRole("radio", { name: "System" })).toBeChecked();
});
