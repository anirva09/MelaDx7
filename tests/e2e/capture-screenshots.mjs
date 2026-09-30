// Captures the README/docs screenshots from a running stack with a real trained model.
//
//   E2E_BASE_URL=http://localhost:5173 \
//   PLAYWRIGHT_CHROMIUM_EXECUTABLE="C:/Program Files/Google/Chrome/Application/chrome.exe" \
//   TEST_IMAGES=data/processed/test node capture-screenshots.mjs ../../docs/screenshots
//
// Uses real held-out test-split images (never committed). Creates a throw-away account and
// deletes it again at the end.
import { chromium, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const out = path.resolve(process.argv[2] ?? "../../docs/screenshots");
const images = path.resolve(process.env.TEST_IMAGES ?? "../../data/processed/test");
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
const PASSWORD = "Screenshots-" + Math.random().toString(36).slice(2, 12);
const email = `screenshots-${Date.now()}@example.org`;

// A mix of classes so the history and dashboard look like real use.
const picks = [
  ["mel", 5],
  ["nv", 3],
  ["bcc", 2],
  ["bkl", 4],
];
function pick(cls, n) {
  return path.join(images, cls, fs.readdirSync(path.join(images, cls)).sort()[n]);
}

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });

async function shot(page, name) {
  await page.waitForTimeout(700); // let charts/animations settle
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log("saved", name);
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    if (t === "dark") localStorage.removeItem("meladx7-theme");
    else localStorage.setItem("meladx7-theme", t);
  }, theme);
}

async function session(label, contextOptions) {
  const context = await browser.newContext({ baseURL: base, ...contextOptions });
  const page = await context.newPage();
  const prefix = label;

  // landing (signed out), both themes
  for (const theme of ["dark", "light"]) {
    await page.goto("/");
    await setTheme(page, theme);
    await page.goto("/");
    await page.waitForLoadState("load");
    await shot(page, `${prefix}-landing-${theme}`);
  }

  // create the account (first context only registers; later contexts log in)
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Demo Researcher");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/app$/);

  const ids = [];
  for (const [cls, n] of picks) {
    await page.goto("/app/analyze");
    await page.getByTestId("file-input").setInputFiles(pick(cls, n));
    await page.getByRole("button", { name: "Analyse image" }).click();
    await page.waitForURL(/\/app\/analyses\/[0-9a-f-]{36}$/, { timeout: 60000 });
    ids.push(page.url().split("/").pop());
  }

  for (const theme of ["dark", "light"]) {
    await setTheme(page, theme);
    const go = async (p) => {
      await page.goto(p);
      await page.waitForLoadState("load");
    };
    await go("/app");
    await shot(page, `${prefix}-home-${theme}`);
    await go("/app/analyze");
    await page.getByTestId("file-input").setInputFiles(pick("nv", 1));
    await shot(page, `${prefix}-upload-${theme}`);
    await go(`/app/analyses/${ids[0]}`);
    // the phone layout shows the canvas only after the result sheet is opened
    await page.getByTestId("viewer-canvas").waitFor({ timeout: 10000 }).catch(() => {});
    await shot(page, `${prefix}-result-${theme}`);
    await go("/app/analyses");
    await shot(page, `${prefix}-history-${theme}`);
    await go("/app/model");
    await shot(page, `${prefix}-model-${theme}`);
    await go("/app/reports");
    await shot(page, `${prefix}-reports-${theme}`);
    await go("/app/profile");
    await shot(page, `${prefix}-settings-${theme}`);
  }
  await setTheme(page, "dark");

  // delete the account through the API the UI uses, so nothing is left behind
  const token = await page.evaluate(async () => {
    const r = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
    return (await r.json()).access_token;
  });
  const del = await page.evaluate(
    async ([t, pw]) =>
      (await fetch("/api/users/me", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      })).status,
    [token, PASSWORD],
  );
  console.log(label, "account cleanup status", del);
  await context.close();
}

if (process.env.ONLY !== "phone") await session("desktop", { viewport: { width: 1440, height: 900 } });
if (process.env.ONLY !== "desktop") await session("phone", { ...devices["Pixel 7"] });
await browser.close();
