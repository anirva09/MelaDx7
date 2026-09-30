import { ImageUp, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_BYTES, MIN_IMAGE_SIDE, checkFile } from "@/lib/files";
import { cn, formatBytes } from "@/lib/utils";

interface ImageUploaderProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
  maxBytes?: number;
}

interface Preview {
  file: File;
  url: string;
  width: number;
  height: number;
}

/**
 * Drag-and-drop or picker upload with local validation and a preview.
 * Validation here is a convenience; the server re-validates by content, never by extension.
 */
export function ImageUploader({
  file,
  onFileChange,
  disabled = false,
  maxBytes = MAX_UPLOAD_BYTES,
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [loadedPreview, setPreview] = useState<Preview | null>(null);
  const preview = loadedPreview && loadedPreview.file === file ? loadedPreview : null;
  const hintId = useId();
  const errorId = useId();

  // Build a preview (and read dimensions) whenever the selected file changes.
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    let active = true;
    const img = new Image();
    img.onload = () => {
      if (!active) return;
      if (Math.min(img.naturalWidth, img.naturalHeight) < MIN_IMAGE_SIDE) {
        setProblem(
          `This image is ${img.naturalWidth}×${img.naturalHeight} px. Both sides must be at least ${MIN_IMAGE_SIDE} px.`,
        );
        onFileChange(null);
        return;
      }
      setPreview({ file, url, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      if (!active) return;
      setProblem("This file could not be read as an image. It may be corrupted.");
      onFileChange(null);
    };
    img.src = url;
    return () => {
      active = false;
      URL.revokeObjectURL(url);
    };
  }, [file, onFileChange]);

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

  const openPicker = () => {
    if (!disabled) inputRef.current?.click();
  };

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
      openPicker();
    }
  };

  const clear = () => {
    setProblem(null);
    onFileChange(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        accept={[...ACCEPTED_EXTENSIONS, "image/jpeg", "image/png", "image/webp"].join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => accept(event.target.files?.[0])}
        data-testid="file-input"
      />

      {file && preview ? (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="stage-checker flex items-center justify-center p-3">
            <img
              src={preview.url}
              alt={`Preview of ${file.name}`}
              className="max-h-[420px] w-auto rounded-sm object-contain"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink" title={file.name}>
                {file.name}
              </p>
              <p className="tabular text-xs text-muted">
                {preview.width} × {preview.height} px · {formatBytes(file.size)}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={openPicker} disabled={disabled}>
                <RefreshCw aria-hidden /> Replace
              </Button>
              <Button variant="ghost" size="sm" onClick={clear} disabled={disabled}>
                <X aria-hidden /> Remove
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          aria-describedby={`${hintId}${problem ? ` ${errorId}` : ""}`}
          aria-label="Choose a dermoscopic image to upload, or drop one here"
          onClick={openPicker}
          onKeyDown={onKeyDown}
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex min-h-64 cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
            dragging
              ? "border-accent bg-accent-soft"
              : "border-line-strong bg-surface hover:border-accent/60",
            problem && "border-danger/60",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">
            <ImageUp className="size-6" aria-hidden />
          </span>
          <div>
            <p className="text-base font-medium text-ink">
              {dragging ? "Drop the image to select it" : "Drop a dermoscopic image here"}
            </p>
            <p className="mt-1 text-sm text-muted">
              or <span className="font-medium text-accent">browse your files</span>
            </p>
          </div>
          <p id={hintId} className="text-xs text-muted">
            JPEG, PNG or WebP · up to {Math.round(maxBytes / 1024 / 1024)} MB · at least {MIN_IMAGE_SIDE} px
            per side
          </p>
        </div>
      )}

      {problem && (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}
