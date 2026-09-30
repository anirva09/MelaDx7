/** Preview helpers: read dimensions and downscale large images so previews stay light. */

export const PREVIEW_MAX_SIDE = 1600;

export interface PreviewImage {
  url: string;
  width: number;
  height: number;
  /** Revoke every object URL created for this preview. */
  dispose: () => void;
}

/**
 * Revoke shortly after the preview is released: the <img> showing it may still be loading while
 * the page navigates away, and revoking at once makes the browser log ERR_FILE_NOT_FOUND.
 */
function revokeLater(url: string): void {
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode"));
    img.src = url;
  });
}

/**
 * Decode a local file for preview. Images larger than PREVIEW_MAX_SIDE are redrawn at a
 * smaller size; the original file is what gets uploaded.
 */
export async function makePreview(file: File): Promise<PreviewImage> {
  const original = URL.createObjectURL(file);
  const img = await loadImage(original).catch((error: unknown) => {
    URL.revokeObjectURL(original);
    throw error;
  });
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const scale = PREVIEW_MAX_SIDE / Math.max(width, height);
  if (scale >= 1) return { url: original, width, height, dispose: () => revokeLater(original) };

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { url: original, width, height, dispose: () => revokeLater(original) };
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) return { url: original, width, height, dispose: () => revokeLater(original) };
  URL.revokeObjectURL(original);
  const small = URL.createObjectURL(blob);
  return { url: small, width, height, dispose: () => revokeLater(small) };
}
