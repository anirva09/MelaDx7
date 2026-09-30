import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a running stack (API + frontend).
 *   Local dev:  start the API and `npm run dev` in frontend/, then `npm test` here.
 *   Docker:     E2E_BASE_URL=http://localhost:8080 npm test
 * Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to use an existing Chrome/Chromium binary
 * instead of running `npx playwright install chromium`.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { executablePath, args: ["--no-sandbox"] },
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testIgnore: /responsive\.spec\.ts/,
    },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /responsive\.spec\.ts/ },
  ],
});
