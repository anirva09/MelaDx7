// Renders the MelaDx7 promo from storyboard.html (and the banner images from banner.html).
//
//   node render.mjs still <seconds> <out.png>     one frame, for previews
//   node render.mjs video <out.mp4> [out.gif]     all frames -> MP4 (+ short GIF preview)
//   node render.mjs images <out-dir>              banner.png and social-preview.png
//
// Frames are rendered by seeking the storyboard's animations, not by recording the screen,
// so the output is identical on any machine regardless of load. Needs Chrome
// (PLAYWRIGHT_CHROMIUM_EXECUTABLE) and an ffmpeg binary (FFMPEG, e.g. from `pip install imageio-ffmpeg`).
import { chromium } from "../../tests/e2e/node_modules/@playwright/test/index.mjs";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const FPS = 30;
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
const [mode, ...args] = process.argv.slice(2);

async function open(file, width, height) {
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--allow-file-access-from-files"] });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(here, file)).href);
  await page.evaluate(() => window.READY);
  return { browser, page };
}

function ffmpeg(argv) {
  const bin = process.env.FFMPEG;
  if (!bin) throw new Error("set FFMPEG to an ffmpeg binary");
  const r = spawnSync(bin, ["-y", "-loglevel", "error", ...argv], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("ffmpeg failed");
}

if (mode === "still") {
  const [t, out] = args;
  const { browser, page } = await open("storyboard.html", 1920, 1080);
  await page.evaluate((s) => window.render(s), Number(t));
  await page.screenshot({ path: out });
  await browser.close();
} else if (mode === "video") {
  const [out, gif] = args;
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), "meladx7-frames-"));
  const { browser, page } = await open("storyboard.html", 1920, 1080);
  const duration = await page.evaluate(() => window.DURATION);
  const total = Math.round(duration * FPS);
  for (let i = 0; i < total; i++) {
    await page.evaluate((s) => window.render(s), i / FPS);
    await page.screenshot({ path: path.join(frames, `${String(i).padStart(5, "0")}.jpg`), type: "jpeg", quality: 94 });
    if (i % 120 === 0) console.log(`frame ${i}/${total}`);
  }
  await browser.close();
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  ffmpeg([
    "-framerate", String(FPS), "-i", path.join(frames, "%05d.jpg"),
    // JPEG frames are full-range; convert to the TV-range BT.709 that every player expects.
    "-vf", "scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p",
    "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-color_range", "tv", "-colorspace", "bt709",
    "-color_primaries", "bt709", "-color_trc", "bt709", "-movflags", "+faststart", out,
  ]);
  if (gif) {
    // A short highlight (result + Grad-CAM) as an inline-friendly GIF for the README.
    const start = 11.4, len = 13;
    ffmpeg([
      "-framerate", String(FPS), "-start_number", String(Math.round(start * FPS)), "-i", path.join(frames, "%05d.jpg"),
      "-t", String(len),
      "-vf", "fps=10,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
      gif,
    ]);
  }
  fs.rmSync(frames, { recursive: true, force: true });
  console.log("done", out, fs.statSync(out).size, "bytes", gif ? `${gif} ${fs.statSync(gif).size} bytes` : "");
} else if (mode === "images") {
  const [dir] = args;
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, name, w, h] of [["banner.html", "banner.png", 1600, 400], ["banner.html", "social-preview.png", 1280, 640]]) {
    const { browser, page } = await open(file, w, h);
    await page.screenshot({ path: path.join(dir, name) });
    await browser.close();
    console.log("saved", name);
  }
} else {
  console.error("usage: render.mjs still <t> <out> | video <out.mp4> [out.gif] | images <dir>");
  process.exit(2);
}
