import {
  Columns2,
  Download,
  Eye,
  Flame,
  Layers,
  Maximize,
  Maximize2,
  SplitSquareHorizontal,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Dialog } from "radix-ui";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from "react";

import { GlassCircle } from "@/components/shell/Glass";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { colorizeCam, colormapGradient, type ColormapName } from "@/lib/colormap";
import { cn } from "@/lib/utils";

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

type LoadState = "loading" | "ready" | "error";

function useImage(url: string | null | undefined): { image: HTMLImageElement | null; state: LoadState | "idle" } {
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

export const VIEW_OPTIONS: { value: ViewMode; label: string; icon: ReactNode; title?: string }[] = [
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

/** Loads the images and builds the colourised heat layer for a set of sources. */
function useLayers(sources: ViewerSources, settings: ViewerSettings) {
  const { imageUrl, camUrl, heatmapUrl, onImageError } = sources;
  const original = useImage(imageUrl);
  const cam = useImage(camUrl);
  const fallbackHeat = useImage(camUrl ? null : heatmapUrl);
  const hasHeat = Boolean(camUrl || heatmapUrl);

  // Report a failed load once per mount so the parent can fetch fresh (signed) URLs.
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
        settings.colormap,
        settings.threshold,
        false,
      );
      const out = document.createElement("canvas");
      out.width = source.width;
      out.height = source.height;
      out.getContext("2d")?.putImageData(colored, 0, 0);
      return out;
    }
    return fallbackHeat.image;
  }, [cam.image, fallbackHeat.image, settings.colormap, settings.threshold]);

  return { original, heatLayer, hasHeat };
}

/** Without a heat layer only the original can be shown; the chosen mode is kept for later. */
export function effectiveMode(mode: ViewMode, sources: ViewerSources): ViewMode {
  return sources.camUrl || sources.heatmapUrl ? mode : "original";
}

interface StageProps {
  sources: ViewerSources;
  state: ViewerState;
  /** Zoom is controlled so toolbar buttons and gestures agree. */
  zoom: number;
  onZoomChange: (zoom: number) => void;
  className?: string;
  fullscreen?: boolean;
}

/**
 * The image stage: canvas rendering, pinch/wheel zoom, drag pan, double-tap zoom, and a
 * swipe-to-compare divider. Every gesture has a keyboard or button equivalent.
 */
export function GradCAMStage({ sources, state, zoom, onZoomChange, className, fullscreen = false }: StageProps) {
  const { original, heatLayer } = useLayers(sources, state);
  const mode = effectiveMode(state.mode, sources);
  const { opacity, compareAt } = state;
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const compareRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: "pan"; x: number; y: number; panX: number; panY: number }
    | { kind: "pinch"; distance: number; zoom: number }
    | { kind: "compare" }
    | null
  >(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);

  const mainCanvas = useRef<HTMLCanvasElement>(null);
  const leftCanvas = useRef<HTMLCanvasElement>(null);
  const rightCanvas = useRef<HTMLCanvasElement>(null);
  const ready = original.state === "ready" && original.image !== null;
  const zoomable = mode !== "compare";

  useEffect(() => {
    const image = original.image;
    if (!image) return;
    if (mode === "side" || mode === "compare") {
      if (leftCanvas.current) paint(leftCanvas.current, image, null, "original", opacity);
      if (rightCanvas.current) paint(rightCanvas.current, image, heatLayer, "overlay", opacity);
    } else if (mainCanvas.current) {
      paint(mainCanvas.current, image, heatLayer, mode, opacity);
    }
  }, [original.image, heatLayer, mode, opacity]);

  const clampPan = useCallback((x: number, y: number, z: number) => {
    const el = stageRef.current;
    if (!el || z <= 1) return { x: 0, y: 0 };
    const maxX = ((z - 1) * el.clientWidth) / 2;
    const maxY = ((z - 1) * el.clientHeight) / 2;
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  }, []);

  // Keep the pan inside bounds whenever the zoom changes (buttons, pinch, reset).
  const shownPan = zoom <= 1 ? { x: 0, y: 0 } : clampPan(pan.x, pan.y, zoom);
  const setZoom = (z: number) => onZoomChange(Math.max(1, Math.min(MAX_ZOOM, z)));

  const setCompareFrom = (clientX: number) => {
    const box = compareRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const pct = Math.round(((clientX - box.left) / box.width) * 100);
    state.set({ compareAt: Math.max(0, Math.min(100, pct)) });
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    if (points.length === 2 && zoomable) {
      const [a, b] = points as [{ x: number; y: number }, { x: number; y: number }];
      gesture.current = { kind: "pinch", distance: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      return;
    }
    if (mode === "compare") {
      gesture.current = { kind: "compare" };
      // Touch waits for movement so a vertical page scroll starting here does not jump the divider.
      if (event.pointerType === "mouse") setCompareFrom(event.clientX);
      return;
    }
    if (zoom > 1) {
      gesture.current = { kind: "pan", x: event.clientX, y: event.clientY, panX: shownPan.x, panY: shownPan.y };
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch") {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      if (!b) return;
      setZoom((g.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(g.distance, 1));
    } else if (g.kind === "compare") {
      setCompareFrom(event.clientX);
    } else {
      setPan(clampPan(g.panX + (event.clientX - g.x), g.panY + (event.clientY - g.y), zoom));
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointers.current.get(event.pointerId);
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
    // Double tap (touch) toggles 2.5x zoom.
    if (event.pointerType !== "mouse" && zoomable && start) {
      const now = performance.now();
      const last = lastTap.current;
      if (last && now - last.t < 300 && Math.hypot(last.x - event.clientX, last.y - event.clientY) < 24) {
        lastTap.current = null;
        setZoom(zoom > 1 ? 1 : 2.5);
        if (zoom > 1) setPan({ x: 0, y: 0 });
      } else {
        lastTap.current = { t: now, x: event.clientX, y: event.clientY };
      }
    }
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    // Trackpad pinch arrives as ctrl+wheel; plain scrolling is left to the page.
    if (!event.ctrlKey || !zoomable) return;
    event.preventDefault();
    setZoom(zoom * Math.exp(-event.deltaY / 200));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = 40;
    if (mode === "compare" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -5 : 5;
      state.set({ compareAt: Math.max(0, Math.min(100, compareAt + delta)) });
      return;
    }
    const handlers: Record<string, () => void> = {
      "+": () => setZoom(zoom * 1.5),
      "=": () => setZoom(zoom * 1.5),
      "-": () => setZoom(zoom / 1.5),
      "0": () => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      },
      ArrowLeft: () => setPan(clampPan(shownPan.x + step, shownPan.y, zoom)),
      ArrowRight: () => setPan(clampPan(shownPan.x - step, shownPan.y, zoom)),
      ArrowUp: () => setPan(clampPan(shownPan.x, shownPan.y + step, zoom)),
      ArrowDown: () => setPan(clampPan(shownPan.x, shownPan.y - step, zoom)),
    };
    const handler = handlers[event.key];
    if (handler && zoomable && (zoom > 1 || ["+", "=", "-", "0"].includes(event.key))) {
      event.preventDefault();
      handler();
    }
  };

  const transform = `translate(${shownPan.x}px, ${shownPan.y}px) scale(${zoom})`;
  const maxH = fullscreen ? "max-h-[calc(100dvh-180px)]" : "max-h-[62vh]";
  const canvasClass = cn("block h-auto w-auto max-w-full object-contain", maxH);
  const aspect = original.image ? `${original.image.naturalWidth} / ${original.image.naturalHeight}` : "4 / 3";
  const description =
    mode === "original"
      ? "Uploaded dermoscopic image"
      : mode === "compare"
        ? `Comparison of the original and the Grad-CAM overlay for ${sources.targetLabel ?? "the predicted class"}, divider at ${compareAt}%. Drag or use the left and right arrow keys to move it`
        : `Grad-CAM ${mode} for ${sources.targetLabel ?? "the predicted class"}`;

  return (
    // A custom pan/zoom widget. Every action is also available from the toolbar.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={stageRef}
      role="application"
      aria-roledescription="image viewer"
      aria-label={`${description}. Pinch or use plus and minus to zoom, arrow keys to pan, 0 to reset.`}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onDoubleClick={() => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }}
      className={cn(
        "stage-checker relative flex min-h-64 select-none items-center justify-center overflow-hidden p-3 focus-visible:outline-offset-[-2px]",
        // At 1x the page can still scroll vertically through the image; zoomed, gestures are ours.
        zoom > 1 && zoomable ? "touch-none cursor-grab active:cursor-grabbing" : "touch-pan-y",
        mode === "compare" && "cursor-ew-resize",
        className,
      )}
    >
      {!ready && (
        <div className="flex flex-col items-center gap-2 py-16 text-md text-white/70" role="status">
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
                  <canvas ref={ref} className="block h-auto max-h-[40vh] w-auto max-w-full sm:max-h-[52vh]" />
                </div>
              </div>
              <figcaption className="text-xs text-white/60">{label}</figcaption>
            </figure>
          ))}
        </div>
      )}

      {ready && mode === "compare" && (
        <div
          ref={compareRef}
          className={cn("relative w-full max-w-full", maxH)}
          style={{ aspectRatio: aspect, maxWidth: "min(100%, 1100px)" }}
        >
          <canvas ref={rightCanvas} className="absolute inset-0 size-full rounded-[10px]" />
          <canvas
            ref={leftCanvas}
            className="absolute inset-0 size-full rounded-[10px]"
            style={{ clipPath: `inset(0 ${100 - compareAt}% 0 0)` }}
          />
          <div
            className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
            style={{ left: `${compareAt}%` }}
            aria-hidden
          >
            <span className="glass absolute left-1/2 top-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-white">
              <SplitSquareHorizontal className="size-4" strokeWidth={1.5} />
            </span>
          </div>
          <span className="glass absolute left-2 top-2 rounded-full px-2.5 py-1 text-xs text-white">Original</span>
          <span className="glass absolute right-2 top-2 rounded-full px-2.5 py-1 text-xs text-white">Grad-CAM</span>
        </div>
      )}
    </div>
  );
}

/** Opacity / threshold / colour-map / compare controls, plus the colour scale. */
export function ViewerControls({
  sources,
  state,
  className,
  tone = "stage",
}: {
  sources: ViewerSources;
  state: ViewerState;
  className?: string;
  tone?: "stage" | "sheet";
}) {
  const mode = effectiveMode(state.mode, sources);
  const hasCam = Boolean(sources.camUrl);
  const text = tone === "stage" ? "text-white/75" : "text-ink-2";
  return (
    <div className={cn("grid gap-x-6 gap-y-3 text-sm", text, className)}>
      {mode === "compare" ? (
        <label className="flex items-center gap-3">
          <span className="w-28 shrink-0">Compare position</span>
          <input
            type="range"
            min={0}
            max={100}
            value={state.compareAt}
            onChange={(e) => state.set({ compareAt: Number(e.target.value) })}
            className="w-full"
            aria-valuetext={`${state.compareAt}% original`}
          />
        </label>
      ) : (
        <label className={cn("flex items-center gap-3", (mode === "heatmap" || mode === "original") && "opacity-50")}>
          <span className="w-28 shrink-0">Overlay opacity</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(state.opacity * 100)}
            onChange={(e) => state.set({ opacity: Number(e.target.value) / 100 })}
            disabled={mode === "heatmap" || mode === "original"}
            className="w-full"
            aria-valuetext={`${Math.round(state.opacity * 100)}%`}
          />
          <span className="tabular w-10 text-right">{Math.round(state.opacity * 100)}%</span>
        </label>
      )}
      <label className={cn("flex items-center gap-3", !hasCam && "opacity-50")}>
        <span className="w-28 shrink-0">Hide below</span>
        <input
          type="range"
          min={0}
          max={90}
          step={5}
          value={Math.round(state.threshold * 100)}
          onChange={(e) => state.set({ threshold: Number(e.target.value) / 100 })}
          disabled={!hasCam}
          className="w-full"
          aria-valuetext={`${Math.round(state.threshold * 100)}% of peak attribution`}
        />
        <span className="tabular w-10 text-right">{Math.round(state.threshold * 100)}%</span>
      </label>
      <div className="flex items-center gap-3">
        <Segmented<ColormapName>
          tone={tone === "stage" ? "stage" : "default"}
          size="sm"
          label="Colour map"
          value={state.colormap}
          onValueChange={(colormap) => state.set({ colormap })}
          options={[
            { value: "turbo", label: "Turbo", title: "Conventional Grad-CAM colour map" },
            { value: "mono", label: "Ember", title: "Single-hue, perceptually ordered" },
          ]}
          className={cn(!hasCam && "pointer-events-none opacity-50")}
        />
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span>Lower</span>
        <span
          className="h-2 flex-1 rounded-full"
          style={{ background: colormapGradient(hasCam ? state.colormap : "turbo") }}
          aria-hidden
        />
        <span>Higher relative attribution</span>
        <span className="sr-only">Colour scale for the attribution map; normalised per image.</span>
      </div>
    </div>
  );
}

/** Messages that accompany the stage (empty map, no explanation). */
export function ViewerNotes({ sources, className }: { sources: ViewerSources; className?: string }) {
  const hasHeat = Boolean(sources.camUrl || sources.heatmapUrl);
  if (hasHeat && sources.degenerate) {
    return (
      <p className={cn("text-md text-caution", className)} role="note">
        The map is empty: the model found no positive evidence for {sources.targetLabel ?? "this class"} in this image.
      </p>
    );
  }
  if (!hasHeat) {
    return (
      <p className={cn("text-md text-muted", className)} role="note">
        No Grad-CAM explanation is available for this analysis.
      </p>
    );
  }
  return null;
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
  void Promise.all([load(img, sources.imageUrl), cam && sources.camUrl ? load(cam, sources.camUrl) : Promise.resolve()])
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
              colorizeCam(sctx.getImageData(0, 0, source.width, source.height), state.colormap, state.threshold, false),
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

/** Full-screen viewer (black surround, floating glass controls). */
export function ViewerFullscreen({
  open,
  onOpenChange,
  sources,
  state,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: ViewerSources;
  state: ViewerState;
}) {
  const [zoom, setZoom] = useState(1);
  const hasHeat = Boolean(sources.camUrl || sources.heatmapUrl);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Content className="data-open-fade fixed inset-0 z-50 flex flex-col bg-black focus:outline-none">
          <Dialog.Title className="sr-only">Full-screen image viewer</Dialog.Title>
          <Dialog.Description className="sr-only">
            Pinch to zoom, drag to pan. In compare mode, drag across the image to move the divider.
          </Dialog.Description>
          <GradCAMStage
            sources={sources}
            state={state}
            zoom={zoom}
            onZoomChange={setZoom}
            fullscreen
            className="min-h-0 flex-1 bg-black [background-image:none]"
          />
          <div
            className="pointer-events-none absolute inset-x-0 flex items-start justify-between px-4"
            style={{ top: "var(--topbar-top)" }}
          >
            <Dialog.Close asChild>
              <GlassCircle label="Close full screen" className="pointer-events-auto text-white">
                <X aria-hidden />
              </GlassCircle>
            </Dialog.Close>
            <span className="glass pointer-events-auto rounded-full px-3 py-2 text-sm text-white" aria-live="polite">
              {Math.round(zoom * 100)}%
            </span>
          </div>
          {hasHeat && (
            <div
              className="absolute inset-x-0 flex justify-center px-4"
              style={{ bottom: "calc(var(--safe-bottom) + 16px)" }}
            >
              <Segmented<ViewMode>
                tone="stage"
                label="View mode"
                value={effectiveMode(state.mode, sources)}
                onValueChange={(mode) => {
                  state.set({ mode });
                  setZoom(1);
                }}
                compactLabels
                options={VIEW_OPTIONS.filter((o) => o.value !== "side")}
              />
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface GradCAMViewerProps extends ViewerSources {
  downloadName?: string;
  className?: string;
  /** Share settings with other controls (e.g. the phone toolbar); created internally if omitted. */
  state?: ViewerState;
}

/**
 * Grad-CAM viewer with its own toolbar (desktop and tablet).
 *
 * Views: overlay (adjustable opacity), heatmap only, original, side-by-side, and a
 * draggable before/after comparison. The heat layer is rendered from the stored raw CAM
 * on a canvas, so threshold and colour map can change instantly; the original pixels are
 * never altered. Zoom/pan works with buttons, gestures, and the keyboard.
 */
export function GradCAMViewer({ downloadName = "lesionlens-gradcam.png", className, state: external, ...sources }: GradCAMViewerProps) {
  const internal = useViewerState();
  const state = external ?? internal;
  const [zoom, setZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const hasHeat = Boolean(sources.camUrl || sources.heatmapUrl);
  const mode = effectiveMode(state.mode, sources);
  const iconButton = "text-white/75 hover:bg-white/10 hover:text-white";

  return (
    <section
      aria-label="Image and Grad-CAM explanation viewer"
      className={cn("min-w-0 overflow-hidden rounded-lg bg-stage text-white", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
        <Segmented<ViewMode>
          tone="stage"
          size="sm"
          compactLabels
          label="View mode"
          value={mode}
          onValueChange={(value) => {
            state.set({ mode: value });
            setZoom(1);
          }}
          options={VIEW_OPTIONS.filter((option) => hasHeat || option.value === "original")}
        />
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" className={iconButton} onClick={() => setZoom(Math.max(1, zoom / 1.5))} disabled={zoom <= 1 || mode === "compare"} aria-label="Zoom out">
            <ZoomOut />
          </Button>
          <span className="tabular w-11 text-center text-xs text-white/70" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <Button variant="ghost" size="icon-sm" className={iconButton} onClick={() => setZoom(Math.min(MAX_ZOOM, zoom * 1.5))} disabled={zoom >= MAX_ZOOM || mode === "compare"} aria-label="Zoom in">
            <ZoomIn />
          </Button>
          <Button variant="ghost" size="icon-sm" className={iconButton} onClick={() => setZoom(1)} disabled={zoom === 1} aria-label="Reset zoom">
            <Maximize />
          </Button>
          <Button variant="ghost" size="icon-sm" className={iconButton} onClick={() => setFullscreen(true)} aria-label="Full screen">
            <Maximize2 />
          </Button>
          <Button variant="ghost" size="icon-sm" className={iconButton} onClick={() => exportView(sources, state, downloadName)} aria-label="Download the current view as PNG">
            <Download />
          </Button>
        </div>
      </div>

      <GradCAMStage sources={sources} state={state} zoom={zoom} onZoomChange={setZoom} />

      {hasHeat && (
        <ViewerControls sources={sources} state={state} className="px-4 py-3.5 sm:grid-cols-2" />
      )}
      <ViewerNotes sources={sources} className="px-4 pb-3" />
      <ViewerFullscreen open={fullscreen} onOpenChange={setFullscreen} sources={sources} state={state} />
    </section>
  );
}
