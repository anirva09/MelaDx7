import { expect, type Page } from "@playwright/test";
import path from "node:path";

// Defaults to a synthetic fixture so CI needs no dataset. For a release check point
// E2E_LESION_IMAGE at a real dermoscopic image from the held-out test split.
export const LESION = process.env.E2E_LESION_IMAGE ?? path.join(import.meta.dirname, "fixtures", "synthetic-lesion.jpg");
export const LESION_NAME = path.basename(LESION);
export const PASSWORD = "e2e-password-2026";

export function uniqueEmail(prefix = "e2e"): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.org`;
}

export async function register(page: Page, name = "E2E Researcher"): Promise<string> {
  const email = uniqueEmail();
  await page.goto("/register");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app$/);
  return email;
}

export async function analyse(page: Page): Promise<string> {
  await page.goto("/app/analyze");
  await page.getByTestId("file-input").setInputFiles(LESION);
  await expect(page.getByAltText(`Preview of ${LESION_NAME}`)).toBeVisible();
  await page.getByRole("button", { name: "Analyse image" }).click();
  await expect(page).toHaveURL(/\/app\/analyses\/[0-9a-f-]{36}$/, { timeout: 45_000 });
  return page.url().split("/").pop()!;
}
