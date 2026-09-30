import { ArrowUp, Camera, FolderOpen, Image as ImageIcon, ImageUp } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { PillButton } from "@/components/shell/Glass";
import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_BYTES, MIN_IMAGE_SIDE, checkFile } from "@/lib/files";
import { makePreview, type PreviewImage } from "@/lib/preview";
import { cn } from "@/lib/utils";

export interface ImageMeta {
  width: number;
  height: number;
}

export interface ImageUploaderHandle {
  open: (source?: "library" | "camera" | "files") => void;
  clear: () => void;
}

interface ImageUploaderProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  onMeta?: (meta: ImageMeta | null) => void;
  disabled?: boolean;
  maxBytes?: number;
  /** Drawn over the preview (the processing state). */
  overlay?: ReactNode;
  /** "touch": composer-style card with camera/photos/files; "pointer": drop zone. */
  variant?: "touch" | "pointer";
}

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
const FILE_ACCEPT = [...ACCEPTED_EXTENSIONS, "image/jpeg", "image/png", "image/webp"].join(",");

/**
 * Image picker with local validation and an immediate, downscaled preview.
 * Validation here is a convenience; the server re-validates by content, never by extension.
 */
export const ImageUploader = forwardRef<ImageUploaderHandle, ImageUploaderProps>(function ImageUploader(
  { file, onFileChange, onMeta, disabled = false, maxBytes = MAX_UPLOAD_BYTES, overlay, variant = "pointer" },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ file: File; preview: PreviewImage } | null>(null);
  const preview = loaded && loaded.file === file ? loaded.preview : null;
  const hintId = useId();
  const errorId = useId();

  // Build a preview (and read dimensions) whenever the selected file changes.
  useEffect(() => {
    if (!file) {
      onMeta?.(null);
      return;
    }
    let active = true;
    let made: PreviewImage | null = null;
    makePreview(file)
      .then((result) => {
        made = result;
        if (!active) {
          result.dispose();
          return;
        }
        if (Math.min(result.width, result.height) < MIN_IMAGE_SIDE) {
          setProblem(
            `This image is ${result.width}×${result.height} px. Both sides must be at least ${MIN_IMAGE_SIDE} px.`,
          );
          result.dispose();
          onFileChange(null);
          return;
        }
        setLoaded({ file, preview: result });
        onMeta?.({ width: result.width, height: result.height });
      })
      .catch(() => {
        if (!active) return;
        setProblem("This file could not be read as an image. It may be corrupted.");
        onFileChange(null);
      });
    return () => {
      active = false;
      made?.dispose();
    };
  }, [file, onFileChange, onMeta]);

  const accept = useCallback(
    (candidate: File | undefined | null) => {
      if (!candidate) return;
      const issue = checkFile(candidate, maxBytes);
      if (issue) {
        setProblem(issue.message);
        return;
      }
      setProblem(null);
      onFileChange(candidate);
    },
    [maxBytes, onFileChange],
  );

  const open = (source: "library" | "camera" | "files" = "library") => {
    if (disabled) return;
    const target = source === "camera" ? cameraRef : source === "files" ? filesRef : inputRef;
    target.current?.click();
  };
  const clear = () => {
    setProblem(null);
    onFileChange(null);
    for (const r of [inputRef, cameraRef, filesRef]) if (r.current) r.current.value = "";
  };
  useImperativeHandle(ref, () => ({ open, clear }));

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const files = event.dataTransfer.files;
    if (files.length > 1) {
      setProblem("Drop one image at a time.");
      return;
    }
    accept(files[0]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  };

  const hidden = (r: React.RefObject<HTMLInputElement | null>, acceptTypes: string, extra: object = {}) => (
    <input
      ref={r}
      type="file"
      accept={acceptTypes}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(event) => accept(event.target.files?.[0])}
      {...extra}
    />
  );

  const limits = `JPEG, PNG or WebP · up to ${Math.round(maxBytes / 1024 / 1024)} MB · at least ${MIN_IMAGE_SIDE} px per side`;

  return (
    <div className="flex flex-col gap-3">
      {hidden(inputRef, `${FILE_ACCEPT}`, { "data-testid": "file-input" })}
      {hidden(cameraRef, IMAGE_ACCEPT, { capture: "environment" })}
      {hidden(filesRef, FILE_ACCEPT)}

      {file && preview ? (
        <figure className="relative overflow-hidden rounded-lg bg-stage">
          <img
            src={preview.url}
            alt={`Preview of ${file.name}`}
            width={preview.width}
            height={preview.height}
            className="mx-auto block max-h-[58dvh] w-auto max-w-full object-contain lg:max-h-[460px]"
            style={{ aspectRatio: `${preview.width} / ${preview.height}` }}
          />
          {overlay}
        </figure>
      ) : file ? (
        <div
          className="aspect-[4/3] animate-pulse rounded-lg bg-surface"
          role="status"
          aria-label="Preparing preview"
        />
      ) : variant === "touch" ? (
        <div className="flex flex-col gap-4">
          <div className="glass relative min-h-[113px] rounded-[20px]">
            <button
              type="button"
              onClick={() => open("library")}
              disabled={disabled}
              aria-describedby={`${hintId}${problem ? ` ${errorId}` : ""}`}
              className="press-soft flex min-h-[113px] w-full flex-col items-start gap-1 rounded-[20px] px-4 pb-12 pt-4 text-left"
            >
              <span className="text-lg font-semibold tracking-ref text-[#949494]">
                Add a dermoscopic image
              </span>
              <span id={hintId} className="text-md text-muted">
                {limits}
              </span>
            </button>
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-3 right-4 flex size-8 items-center justify-center rounded-full bg-accent text-white"
            >
              <ArrowUp className="size-5" strokeWidth={1.8} />
            </span>
          </div>
          <div
            role="group"
            aria-label="Image source"
            className="glass inline-flex h-[50px] items-center gap-3 self-start rounded-full px-2"
          >
            <PillButton label="Take a photo" onClick={() => open("camera")} disabled={disabled}>
              <Camera aria-hidden />
            </PillButton>
            <PillButton label="Choose from photos" onClick={() => open("library")} disabled={disabled}>
              <ImageIcon aria-hidden />
            </PillButton>
            <PillButton label="Browse files" onClick={() => open("files")} disabled={disabled}>
              <FolderOpen aria-hidden />
            </PillButton>
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          aria-describedby={`${hintId}${problem ? ` ${errorId}` : ""}`}
          aria-label="Choose a dermoscopic image to upload, or drop one here"
          onClick={() => open()}
          onKeyDown={onKeyDown}
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex min-h-72 cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border-[1.5px] border-dashed px-6 py-10 text-center transition-colors",
            dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-surface hover:border-subtle",
            problem && "border-danger/60",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <span className="glass flex size-12 items-center justify-center rounded-full text-ink">
            <ImageUp className="size-6" strokeWidth={1.5} aria-hidden />
          </span>
          <div>
            <p className="text-lg font-semibold tracking-ref text-ink">
              {dragging ? "Drop the image to select it" : "Drop a dermoscopic image here"}
            </p>
            <p className="mt-1 text-base text-subtle">
              or <span className="font-medium text-accent">browse your files</span>
            </p>
          </div>
          <p id={hintId} className="text-sm text-muted">
            {limits}
          </p>
        </div>
      )}

      {problem && (
        <p id={errorId} role="alert" className="text-md font-medium text-danger">
          {problem}
        </p>
      )}
    </div>
  );
});
