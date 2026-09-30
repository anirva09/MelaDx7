/**
 * Hands a picked file from the global "+" composer to the analysis screen. Kept in memory
 * only: a lesion image never touches browser storage.
 */
let pending: File | null = null;

export function setPendingFile(file: File): void {
  pending = file;
}

/** Read without clearing (safe to call from a state initialiser, which may run twice). */
export function peekPendingFile(): File | null {
  return pending;
}

export function clearPendingFile(): void {
  pending = null;
}
