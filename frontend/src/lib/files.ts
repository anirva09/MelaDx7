/** Client-side upload validation. The server validates again (magic bytes, decoding). */

export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const ACCEPTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MIN_IMAGE_SIDE = 64;

export type FileProblem = { code: "type" | "size" | "empty"; message: string };

export function checkFile(file: File, maxBytes = MAX_UPLOAD_BYTES): FileProblem | null {
  const name = file.name.toLowerCase();
  const typeOk =
    (ACCEPTED_TYPES as readonly string[]).includes(file.type) ||
    ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
  if (!typeOk) {
    return { code: "type", message: "Unsupported file type. Use a JPEG, PNG or WebP image." };
  }
  if (file.size === 0) {
    return { code: "empty", message: "This file is empty." };
  }
  if (file.size > maxBytes) {
    return {
      code: "size",
      message: `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`,
    };
  }
  return null;
}
