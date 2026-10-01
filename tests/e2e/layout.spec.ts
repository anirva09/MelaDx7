import { expect, test } from "@playwright/test";

import { analyse, register } from "./helpers";

// Every page at phone, tablet and desktop widths in both themes: no horizontal overflow and
// no console errors. (The silent session check on load returns 401 when signed out; that is
// expected and excluded.)
const VIEWPORTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

test("pages have no horizontal overflow or console errors on phone, tablet and desktop, light and dark", async ({
  page,
}) => {
  test.setTimeout(360_000);
  const problems: string[] = [];
  let where = "register";
  page.on("requestfailed", (request) => {
    problems.push(`failed request: ${request.url().slice(0, 120)} (${request.failure()?.errorText}) on ${where}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/status of 401/.test(text)) return;
    problems.push(`console: ${text} on ${where}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

  await register(page);
  const id = await analyse(page);
  const paths = [
    "/app",
    "/app/analyze",
    `/app/analyses/${id}`,
    "/app/analyses",
    "/app/model",
    "/app/reports",
    "/app/profile",
  ];

  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      ([t]) => (t === "dark" ? localStorage.removeItem("meladx7-theme") : localStorage.setItem("meladx7-theme", t)),
      [theme],
    );
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const path of paths) {
        where = `${path} ${viewport.name} ${theme}`;
        await page.goto(path);
        await page.waitForLoadState("load");
        await page.waitForTimeout(1200); // pace like a person: session refresh is limited to 60 per minute per IP
        // A login page has no overflow and no errors either, so a lost session would pass silently.
        const landed = new URL(page.url()).pathname;
        if (landed !== path) {
          problems.push(`session lost: ${path} ${viewport.name} ${theme} landed on ${landed}`);
          continue;
        }
        const { scrollWidth, innerWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        if (scrollWidth > innerWidth) {
          problems.push(`overflow: ${path} ${viewport.name} ${theme} (${scrollWidth} > ${innerWidth})`);
        }
      }
    }
  }
  expect(problems).toEqual([]);
});
