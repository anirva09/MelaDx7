import {
  Columns2,
  Download,
  Eye,
  Flame,
  Layers,
  Maximize,
  SplitSquareHorizontal,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { colorizeCam, colormapGradient, type ColormapName } from "@/lib/colormap";
import { cn } from "@/lib/utils";

export type ViewMode = "overlay" | "heatmap" | "original" | "side" | "compare";

interface GradCAMViewerProps {
  imageUrl: string;
  /** Raw grayscale CAM (preferred: enables threshold and colour-map controls). */
  camUrl?: string | null;
  /** Pre-rendered Turbo heatmap, used if the raw CAM is unavailable. */
  heatmapUrl?: string | null;
  targetLabel?: string | null;
  degenerate?: boolean;
  /** Called when an image fails to load (e.g. an expired signed URL) so the parent can refetch. */
  onImageError?: () => void;
  downloadName?: string;
  className?: string;
}

type LoadState = "loading" | "ready" | "error";

function useImage(url: string | null | undefined): {
  image: HTMLImageElement | null;
  state: LoadState | "idle";
} {
  const [loaded, setLoaded] = useState<{ url: string; image: HTMLImageElement | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let active = true;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => active && setLoaded({ url, image: img });
    img.onerror = () => active && setLoaded({ url, image: null });
    img.src = url;
    return () => {
      active = false;
    };
  }, [url]);
  if (!url) return { image: null, state: "idle" };
  if (!loaded || loaded.url !== url) return { image: null, state: "loading" };
  return { image: loaded.image, state: loaded.image ? "ready" : "error" };
}

const VIEW_OPTIONS: { value: ViewMode; label: string; icon: React.ReactNode; title?: string }[] = [
  { value: "overlay", label: "Overlay", icon: <Layers aria-hidden />, title: "Heatmap over the image" },
  { value: "heatmap", label: "Heatmap", icon: <Flame aria-hidden />, title: "Attribution map only" },
  { value: "original", label: "Original", icon: <Eye aria-hidden />, title: "Uploaded image" },
  { value: "side", label: "Side by side", icon: <Columns2 aria-hidden /> },
  { value: "compare", label: "Compare", icon: <SplitSquareHorizontal aria-hidden /> },
];

const MAX_RENDER_SIDE = 1600;
const MAX_ZOOM = 6;

function renderSize(image: HTMLImageElement): { width: number; height: number } {
  const scale = Math.min(1, MAX_RENDER_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  return { width: Math.round(image.naturalWidth * scale), height: Math.round(image.naturalHeight * scale) };
}

/** Draw one composited frame of the viewer into a canvas. */
function paint(
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

/**
 * Grad-CAM viewer.
 *
 * Views: overlay (adjustable opacity), heatmap only, original, side-by-side, and a
 * draggable before/after comparison. The heat layer is rendered from the stored raw CAM
 * on a canvas, so threshold and colour map can change instantly; the original pixels are
 * never altered. Zoom/pan works with buttons, drag, and the keyboard.
 */
export function GradCAMViewer({
  imageUrl,
  camUrl,
  heatmapUrl,
  targetLabel,
  degenerate = false,
  onImageError,
  downloadName = "lesionlens-gradcam.png",
  className,
}: GradCAMViewerProps) {
  const original = useImage(imageUrl);
  const cam = useImage(camUrl);
  const fallbackHeat = useImage(camUrl ? null : heatmapUrl);
  const hasHeat = Boolean(camUrl || heatmapUrl);

  const [selectedMode, setMode] = useState<ViewMode>("overlay");
  // Without a heat layer (none stored, or a class explanation still loading) only the
  // original can be shown; the user's chosen mode is kept for when the layer arrives.
  const mode: ViewMode = hasHeat ? selectedMode : "original";
  const [opacity, setOpacity] = useState(0.5);
  const [threshold, setThreshold] = useState(0);
  const [colormap, setColormap] = useState<ColormapName>("turbo");
  const [compareAt, setCompareAt] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const mainCanvas = useRef<HTMLCanvasElement>(null);
  const leftCanvas = useRef<HTMLCanvasElement>(null);
  const rightCanvas = useRef<HTMLCanvasElement>(null);

  // Report a failed load once per mount (e.g. an expired link) so the parent can fetch
  // fresh URLs. Reporting only once prevents a refetch loop if a file is really gone.
  const reportedError = useRef(false);
  useEffect(() => {
    if (reportedError.current) return;
    if (original.state === "error" || (camUrl && cam.state === "error")) {
      reportedError.current = true;
      onImageError?.();
    }
  }, [original.state, cam.state, camUrl, onImageError]);

  // Colourised heat layer at CAM resolution; the browser upsamples it bilinearly on draw.
  const heatLayer = useMemo<CanvasImageSource | null>(() => {
    if (cam.image) {
      const source = document.createElement("canvas");
      source.width = cam.image.naturalWidth;
      source.height = cam.image.naturalHeight;
      const sctx = source.getContext("2d", { willReadFrequently: true });
      if (!sctx) return null;
      sctx.drawImage(cam.image, 0, 0);
      const colored = colorizeCam(
        sctx.getImageData(0, 0, source.width, source.height),
        colormap,
        threshold,
        false,
      );
      const out = document.createElement("canvas");
      out.width = source.width;
      out.height = source.height;
      out.getContext("2d")?.putImageData(colored, 0, 0);
      return out;
    }
    return fallbackHeat.image;
  }, [cam.image, fallbackHeat.image, colormap, threshold]);

  const ready = original.state === "ready" && original.image !== null;

  useEffect(() => {
    const image = original.image;
    if (!image) return;
    if (mode === "side") {
      if (leftCanvas.current) paint(leftCanvas.current, image, null, "original", opacity);
      if (rightCanvas.current) paint(rightCanvas.current, image, heatLayer, "overlay", opacity);
    } else if (mode === "compare") {
      if (leftCanvas.current) paint(leftCanvas.current, image, null, "original", opacity);
      if (rightCanvas.current) paint(rightCanvas.current, image, heatLayer, "overlay", opacity);
    } else if (mainCanvas.current) {
      paint(mainCanvas.current, image, heatLayer, mode, opacity);
    }
  }, [original.image, heatLayer, mode, opacity]);

  // ----------------------------------------------------------- zoom & pan
  const clampPan = useCallback((x: number, y: number, z: number) => {
    const el = stageRef.current;
    if (!el || z <= 1) return { x: 0, y: 0 };
    const maxX = ((z - 1) * el.clientWidth) / 2;
    const maxY = ((z - 1) * el.clientHeight) / 2;
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  }, []);

  const setZoomLevel = useCallback(
    (next: number) => {
      const z = Math.max(1, Math.min(MAX_ZOOM, next));
      setZoom(z);
      setPan((p) => clampPan(p.x, p.y, z));
    },
    [clampPan],
  );

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1 || mode === "compare") return;
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setPan(
      clampPan(
        drag.current.panX + (event.clientX - drag.current.x),
        drag.current.panY + (event.clientY - drag.current.y),
        zoom,
      ),
    );
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = 40;
    const handlers: Record<string, () => void> = {
      "+": () => setZoomLevel(zoom * 1.5),
      "=": () => setZoomLevel(zoom * 1.5),
      "-": () => setZoomLevel(zoom / 1.5),
      "0": resetView,
      ArrowLeft: () => setPan((p) => clampPan(p.x + step, p.y, zoom)),
      ArrowRight: () => setPan((p) => clampPan(p.x - step, p.y, zoom)),
      ArrowUp: () => setPan((p) => clampPan(p.x, p.y + step, zoom)),
      ArrowDown: () => setPan((p) => clampPan(p.x, p.y - step, zoom)),
    };
    const handler = handlers[event.key];
    if (handler && (zoom > 1 || ["+", "=", "-", "0"].includes(event.key))) {
      event.preventDefault();
      handler();
    }
  };

  // --------------------------------------------------------------- export
  const download = () => {
    const image = original.image;
    if (!image) return;
    const { width, height } = renderSize(image);
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
      paint(frame, image, null, "original", opacity);
      ctx.drawImage(frame, 0, 0);
      paint(frame, image, heatLayer, "overlay", opacity);
      ctx.drawImage(frame, width + 16, 0);
    } else {
      paint(frame, image, heatLayer, mode === "heatmap" || mode === "original" ? mode : "overlay", opacity);
      ctx.drawImage(frame, 0, 0);
    }
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  };

  const transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  const canvasClass = "block h-auto max-h-[62vh] w-auto max-w-full object-contain";
  const aspect = original.image
    ? `${original.image.naturalWidth} / ${original.image.naturalHeight}`
    : "4 / 3";

  return (
    <section
      aria-label="Image and Grad-CAM explanation viewer"
      className={cn(
        "min-w-0 overflow-hidden rounded-lg bg-stage text-white ring-1 ring-stage-line",
        className,
      )}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5">
        <Segmented<ViewMode>
          tone="stage"
          size="sm"
          compactLabels
          label="View mode"
          value={mode}
          onValueChange={(value) => {
            setMode(value);
            resetView();
          }}
          options={VIEW_OPTIONS.filter((option) => hasHeat || option.value === "original")}
        />
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-white/75 hover:bg-white/10 hover:text-white"
            onClick={() => setZoomLevel(zoom / 1.5)}
            disabled={zoom <= 1 || mode === "compare"}
            aria-label="Zoom out"
          >
            <ZoomOut />
          </Button>
          <span className="tabular w-11 text-center text-2xs text-white/70" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-white/75 hover:bg-white/10 hover:text-white"
            onClick={() => setZoomLevel(zoom * 1.5)}
            disabled={zoom >= MAX_ZOOM || mode === "compare"}
            aria-label="Zoom in"
          >
            <ZoomIn />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-white/75 hover:bg-white/10 hover:text-white"
            onClick={resetView}
            disabled={zoom === 1}
            aria-label="Reset zoom"
          >
            <Maximize />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-white/75 hover:bg-white/10 hover:text-white"
            onClick={download}
            disabled={!ready}
            aria-label="Download the current view as PNG"
          >
            <Download />
          </Button>
        </div>
      </div>

      {/* Stage: a custom pan/zoom widget. Every action is also available from the toolbar. */}
      {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      <div
        ref={stageRef}
        role="application"
        aria-roledescription="image viewer"
        aria-label={`${
          mode === "original"
            ? "Uploaded dermoscopic image"
            : `Grad-CAM ${mode} for ${targetLabel ?? "the predicted class"}`
        }. Use plus and minus to zoom, arrow keys to pan, 0 to reset.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={resetView}
        className={cn(
          "stage-checker relative flex min-h-72 touch-none select-none items-center justify-center overflow-hidden p-3 focus-visible:outline-offset-[-2px]",
          zoom > 1 && mode !== "compare" && "cursor-grab active:cursor-grabbing",
        )}
      >
        {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
        {!ready && (
          <div className="flex flex-col items-center gap-2 py-16 text-sm text-white/70" role="status">
            {original.state === "error" ? (
              <span>The image could not be loaded. Refresh the page to request a new link.</span>
            ) : (
              <>
                <span className="size-6 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
                <span>Loading image</span>
              </>
            )}
          </div>
        )}

        {ready && (mode === "overlay" || mode === "heatmap" || mode === "original") && (
          <div style={{ transform }} className="transition-transform duration-75 ease-out">
            <canvas ref={mainCanvas} className={canvasClass} data-testid="viewer-canvas" />
          </div>
        )}

        {ready && mode === "side" && (
          <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              { ref: leftCanvas, label: "Original" },
              { ref: rightCanvas, label: "Grad-CAM overlay" },
            ].map(({ ref, label }) => (
              <figure key={label} className="flex flex-col items-center gap-2 overflow-hidden">
                <div className="flex w-full justify-center overflow-hidden">
                  <div style={{ transform }} className="transition-transform duration-75 ease-out">
                    <canvas ref={ref} className="block h-auto max-h-[52vh] w-auto max-w-full" />
                  </div>
                </div>
                <figcaption className="text-2xs text-white/60">{label}</figcaption>
              </figure>
            ))}
          </div>
        )}

        {ready && mode === "compare" && (
          <div
            className="relative max-h-[62vh] w-full max-w-full"
            style={{ aspectRatio: aspect, maxWidth: "min(100%, 1100px)" }}
          >
            <canvas ref={rightCanvas} className="absolute inset-0 size-full" />
            <canvas
              ref={leftCanvas}
              className="absolute inset-0 size-full"
              style={{ clipPath: `inset(0 ${100 - compareAt}% 0 0)` }}
            />
            <div
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
              style={{ left: `${compareAt}%` }}
              aria-hidden
            />
            <span className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-2xs">Original</span>
            <span className="absolute right-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-2xs">Overlay</span>
          </div>
        )}
      </div>

      {/* Controls */}
      {hasHeat && (
        <div className="grid gap-x-6 gap-y-3 border-t border-white/10 px-4 py-3 text-2xs text-white/75 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
          {mode === "compare" ? (
            <label className="flex items-center gap-3 sm:col-span-2">
              <span className="w-24 shrink-0">Compare position</span>
              <input
                type="range"
                min={0}
                max={100}
                value={compareAt}
                onChange={(e) => setCompareAt(Number(e.target.value))}
                className="w-full"
                aria-valuetext={`${compareAt}% original`}
              />
            </label>
          ) : (
            <label
              className={cn(
                "flex items-center gap-3",
                (mode === "heatmap" || mode === "original") && "opacity-50",
              )}
            >
              <span className="w-24 shrink-0">Overlay opacity</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(opacity * 100)}
                onChange={(e) => setOpacity(Number(e.target.value) / 100)}
                disabled={mode === "heatmap" || mode === "original"}
                className="w-full"
                aria-valuetext={`${Math.round(opacity * 100)}%`}
              />
              <span className="tabular w-9 text-right">{Math.round(opacity * 100)}%</span>
            </label>
          )}
          <label className={cn("flex items-center gap-3", !camUrl && "opacity-50")}>
            <span className="w-24 shrink-0">Hide below</span>
            <input
              type="range"
              min={0}
              max={90}
              step={5}
              value={Math.round(threshold * 100)}
              onChange={(e) => setThreshold(Number(e.target.value) / 100)}
              disabled={!camUrl}
              className="w-full"
              aria-valuetext={`${Math.round(threshold * 100)}% of peak attribution`}
            />
            <span className="tabular w-9 text-right">{Math.round(threshold * 100)}%</span>
          </label>
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-1">
            <Segmented<ColormapName>
              tone="stage"
              size="sm"
              label="Colour map"
              value={colormap}
              onValueChange={setColormap}
              options={[
                { value: "turbo", label: "Turbo", title: "Conventional Grad-CAM colour map" },
                { value: "mono", label: "Ember", title: "Single-hue, perceptually ordered" },
              ]}
              className={cn(!camUrl && "pointer-events-none opacity-50")}
            />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-3">
            <span>Lower</span>
            <span
              className="h-2 flex-1 rounded-full"
              style={{ background: colormapGradient(camUrl ? colormap : "turbo") }}
              aria-hidden
            />
            <span>Higher relative attribution</span>
            <span className="sr-only">Colour scale for the attribution map; normalised per image.</span>
          </div>
        </div>
      )}

      {hasHeat && degenerate && (
        <p className="border-t border-white/10 px-4 py-2.5 text-xs text-[#f0b35a]" role="note">
          The map is empty: the model found no positive evidence for {targetLabel ?? "this class"} in this
          image.
        </p>
      )}
      {!hasHeat && (
        <p className="border-t border-white/10 px-4 py-2.5 text-xs text-white/70" role="note">
          No Grad-CAM explanation is available for this analysis.
        </p>
      )}
    </section>
  );
}
