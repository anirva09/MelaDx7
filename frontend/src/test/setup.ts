import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom lacks these browser APIs used by the UI.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

// Object URLs are only used for previews; jsdom cannot create real ones.
URL.createObjectURL = () => "blob:mock";
URL.revokeObjectURL = () => undefined;

// jsdom has no canvas implementation; a minimal ImageData is enough for colour-map maths.
if (typeof globalThis.ImageData === "undefined") {
  class ImageDataPolyfill {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    constructor(dataOrWidth: Uint8ClampedArray | number, width: number, height?: number) {
      if (typeof dataOrWidth === "number") {
        this.width = dataOrWidth;
        this.height = width;
        this.data = new Uint8ClampedArray(dataOrWidth * width * 4);
      } else {
        this.data = dataOrWidth;
        this.width = width;
        this.height = height ?? dataOrWidth.length / 4 / width;
      }
    }
  }
  globalThis.ImageData = ImageDataPolyfill as unknown as typeof ImageData;
}
