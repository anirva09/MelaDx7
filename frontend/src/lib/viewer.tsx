/** Grad-CAM viewer state and rendering helpers shared by the viewer, toolbars and sheets. */

import { Columns2, Eye, Flame, Layers, SplitSquareHorizontal } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import { colorizeCam, type ColormapName } from "@/lib/colormap";

export type ViewMode = "overlay" | "heatmap" | "original" | "side" | "compare";

export interface ViewerSettings {
  mode: ViewMode;
  opacity: number;
  threshold: number;
  colormap: ColormapName;
  compareAt: number;
}

export interface ViewerState extends ViewerSettings {
  set: (patch: Partial<ViewerSettings>) => void;
}

/** Viewer settings live outside the stage so a toolbar, a sheet and full screen share them. */
export function useViewerState(initial: Partial<ViewerSettings> = {}): ViewerState {
  const [settings, setSettings] = useState<ViewerSettings>({
    mode: "overlay",
    opacity: 0.5,
    threshold: 0,
    colormap: "turbo",
    compareAt: 50,
    ...initial,
  });
  const set = useCallback((patch: Partial<ViewerSettings>) => setSettings((s) => ({ ...s, ...patch })), []);
  return { ...settings, set };
}

export interface ViewerSources {
  imageUrl: string;
  /** Raw grayscale CAM (preferred: enables threshold and colour-map controls). */
  camUrl?: string | null;
  /** Pre-rendered Turbo heatmap, used if the raw CAM is unavailable. */
  heatmapUrl?: string | null;
  targetLabel?: string | null;
  degenerate?: boolean;
  /** Called when an image fails to load (e.g. an expired signed URL) so the parent can refetch. */
  onImageError?: () => void;
}

export const VIEW_OPTIONS: { value: ViewMode; label: string; icon: ReactNode; title?: string }[] = [
  { value: "overlay", label: "Overlay", icon: <Layers aria-hidden />, title: "Heatmap over the image" },
  { value: "heatmap", label: "Heatmap", icon: <Flame aria-hidden />, title: "Attribution map only" },
  { value: "original", label: "Original", icon: <Eye aria-hidden />, title: "Uploaded image" },
  { value: "side", label: "Side by side", icon: <Columns2 aria-hidden /> },
  { value: "compare", label: "Compare", icon: <SplitSquareHorizontal aria-hidden /> },
];

export const MAX_RENDER_SIDE = 1600;
export const MAX_ZOOM = 6;

export function renderSize(image: HTMLImageElement): { width: number; height: number } {
  const scale = Math.min(1, MAX_RENDER_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  return { width: Math.round(image.naturalWidth * scale), height: Math.round(image.naturalHeight * scale) };
}

/** Draw one composited frame of the viewer into a canvas. */
export function paint(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  heat: CanvasImageSource | null,
  mode: "overlay" | "heatmap" | "original",
  opacity: number,
): void {
  const { width, height } = renderSize(image);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, width, height);
  if (mode === "heatmap") {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.drawImage(image, 0, 0, width, height);
  }
  if (heat && mode !== "original") {
    ctx.globalAlpha = mode === "heatmap" ? 1 : opacity;
    ctx.drawImage(heat, 0, 0, width, height);
    ctx.globalAlpha = 1;
  }
}

/** Without a heat layer only the original can be shown; the chosen mode is kept for later. */
export function effectiveMode(mode: ViewMode, sources: ViewerSources): ViewMode {
  return sources.camUrl || sources.heatmapUrl ? mode : "original";
}

/** Export the current view as a PNG (the original pixels are never altered). */
export function exportView(sources: ViewerSources, state: ViewerSettings, filename: string): void {
  const img = new Image();
  const cam = sources.camUrl ? new Image() : null;
  img.crossOrigin = "anonymous";
  const load = (el: HTMLImageElement, url: string) =>
    new Promise<void>((resolve, reject) => {
      el.onload = () => resolve();
      el.onerror = () => reject(new Error("load"));
      el.src = url;
    });
  void Promise.all([
    load(img, sources.imageUrl),
    cam && sources.camUrl ? load(cam, sources.camUrl) : Promise.resolve(),
  ])
    .then(() => {
      let heat: HTMLCanvasElement | null = null;
      if (cam) {
        const source = document.createElement("canvas");
        source.width = cam.naturalWidth;
        source.height = cam.naturalHeight;
        const sctx = source.getContext("2d");
        if (sctx) {
          sctx.drawImage(cam, 0, 0);
          heat = document.createElement("canvas");
          heat.width = source.width;
          heat.height = source.height;
          heat
            .getContext("2d")
            ?.putImageData(
              colorizeCam(
                sctx.getImageData(0, 0, source.width, source.height),
                state.colormap,
                state.threshold,
                false,
              ),
              0,
              0,
            );
        }
      }
      const mode = effectiveMode(state.mode, sources);
      const { width, height } = renderSize(img);
      const side = mode === "side" || mode === "compare";
      const canvas = document.createElement("canvas");
      canvas.width = side ? width * 2 + 16 : width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const frame = document.createElement("canvas");
      if (side) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        paint(frame, img, null, "original", state.opacity);
        ctx.drawImage(frame, 0, 0);
        paint(frame, img, heat, "overlay", state.opacity);
        ctx.drawImage(frame, width + 16, 0);
      } else {
        paint(frame, img, heat, mode === "heatmap" || mode === "original" ? mode : "overlay", state.opacity);
        ctx.drawImage(frame, 0, 0);
      }
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, "image/png");
    })
    .catch(() => undefined);
}
