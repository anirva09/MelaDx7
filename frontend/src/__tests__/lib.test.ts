import { COLORMAPS, colorizeCam } from "@/lib/colormap";
import { checkFile } from "@/lib/files";
import { formatBytes, formatMs, formatPercent, shortHash } from "@/lib/utils";

describe("checkFile", () => {
  const make = (name: string, type: string, size: number) => new File([new Uint8Array(size)], name, { type });

  it("accepts JPEG, PNG and WebP", () => {
    expect(checkFile(make("a.jpg", "image/jpeg", 1000))).toBeNull();
    expect(checkFile(make("a.png", "image/png", 1000))).toBeNull();
    expect(checkFile(make("a.webp", "image/webp", 1000))).toBeNull();
  });

  it("rejects other types, empty and oversized files", () => {
    expect(checkFile(make("a.gif", "image/gif", 1000))?.code).toBe("type");
    expect(checkFile(make("a.pdf", "application/pdf", 1000))?.code).toBe("type");
    expect(checkFile(make("a.jpg", "image/jpeg", 0))?.code).toBe("empty");
    expect(checkFile(make("a.jpg", "image/jpeg", 2000), 1000)?.code).toBe("size");
  });
});

describe("colormap", () => {
  it("has 256 RGB entries and matches the server-side Turbo endpoints", () => {
    const lut = COLORMAPS.turbo;
    expect(lut.length).toBe(256 * 3);
    // Values produced by ml/explainability/render.py for indices 0 and 255.
    expect([lut[0], lut[1], lut[2]]).toEqual([35, 23, 27]);
    expect([lut[765], lut[766], lut[767]]).toEqual([144, 13, 0]);
  });

  it("applies the threshold as transparency", () => {
    const source = new ImageData(new Uint8ClampedArray([10, 10, 10, 255, 200, 200, 200, 255]), 2, 1);
    const out = colorizeCam(source, "turbo", 0.5, false);
    expect(out.data[3]).toBe(0); // below threshold -> transparent
    expect(out.data[7]).toBe(255);
  });
});

describe("formatters", () => {
  it("formats values for display", () => {
    expect(formatPercent(0.4567)).toBe("45.7%");
    expect(formatPercent(null)).toBe("n/a");
    expect(formatMs(48.4)).toBe("48 ms");
    expect(formatMs(1500)).toBe("1.50 s");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(shortHash("abcdef0123456789", 6)).toBe("abcdef");
  });
});
