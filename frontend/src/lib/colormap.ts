/**
 * Colour maps for client-side Grad-CAM rendering.
 *
 * The backend stores the raw normalised CAM as an 8-bit grayscale PNG. The viewer
 * colourises it on a canvas, which allows live opacity, threshold and colour-map changes
 * without another server round-trip. The "turbo" polynomial is identical to the one used
 * server-side (ml/explainability/render.py), so client and PDF renderings match.
 */

export type ColormapName = "turbo" | "mono";

const RED = [0.13572138, 4.6153926, -42.66032258, 132.13108234, -152.94239396, 59.28637943];
const GREEN = [0.09140261, 2.19418839, 4.84296658, -14.18503333, 4.27729857, 2.82956604];
const BLUE = [0.1066733, 12.64194608, -60.58204836, 110.36276771, -89.90310912, 27.34824973];

function poly(coefficients: number[], x: number): number {
  let result = 0;
  let power = 1;
  for (const c of coefficients) {
    result += c * power;
    power *= x;
  }
  return result;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function buildTurbo(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    lut[i * 3] = Math.round(clamp01(poly(RED, x)) * 255);
    lut[i * 3 + 1] = Math.round(clamp01(poly(GREEN, x)) * 255);
    lut[i * 3 + 2] = Math.round(clamp01(poly(BLUE, x)) * 255);
  }
  return lut;
}

/** Single-hue alternative: a perceptually ordered warm ramp (dark red -> light yellow). */
function buildMono(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  const stops: [number, [number, number, number]][] = [
    [0, [60, 6, 18]],
    [0.5, [214, 60, 36]],
    [1, [255, 236, 160]],
  ];
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    const upper = stops.findIndex(([at]) => at >= x);
    const [a, ca] = stops[Math.max(0, upper - 1)]!;
    const [b, cb] = stops[Math.max(0, upper)]!;
    const t = b === a ? 0 : (x - a) / (b - a);
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(ca[c]! + (cb[c]! - ca[c]!) * t);
  }
  return lut;
}

export const COLORMAPS: Record<ColormapName, Uint8ClampedArray> = {
  turbo: buildTurbo(),
  mono: buildMono(),
};

export function colormapGradient(name: ColormapName, steps = 12): string {
  const lut = COLORMAPS[name];
  const parts: string[] = [];
  for (let s = 0; s <= steps; s++) {
    const i = Math.round((s / steps) * 255);
    parts.push(`rgb(${lut[i * 3]}, ${lut[i * 3 + 1]}, ${lut[i * 3 + 2]}) ${((s / steps) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}

/**
 * Colourise a grayscale CAM (ImageData from the cam PNG) into RGBA.
 * Values below `threshold` (0-1) become transparent; with `weightAlpha`, alpha also
 * scales with attribution so weak regions stay close to the original image.
 */
export function colorizeCam(
  source: ImageData,
  name: ColormapName,
  threshold: number,
  weightAlpha: boolean,
): ImageData {
  const lut = COLORMAPS[name];
  const out = new ImageData(source.width, source.height);
  const cut = Math.round(clamp01(threshold) * 255);
  for (let p = 0; p < source.data.length; p += 4) {
    const v = source.data[p]!;
    out.data[p] = lut[v * 3]!;
    out.data[p + 1] = lut[v * 3 + 1]!;
    out.data[p + 2] = lut[v * 3 + 2]!;
    out.data[p + 3] = v < cut ? 0 : weightAlpha ? Math.round(80 + (175 * v) / 255) : 255;
  }
  return out;
}
