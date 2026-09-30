/**
 * HTTP client.
 *
 * - The access token lives in memory only (never localStorage), so XSS cannot read a
 *   long-lived credential from storage. The refresh token is an httpOnly cookie that
 *   JavaScript cannot see at all.
 * - On a 401 the client performs ONE refresh (shared by concurrent requests) and retries.
 * - Every failure becomes an ApiError with a stable `code` and a human-readable message.
 */

import type { TokenResponse } from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: unknown;
  readonly retryAfter: number | null;

  constructor(
    status: number,
    code: string,
    message: string,
    opts: { requestId?: string | null; details?: unknown; retryAfter?: number | null } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = opts.requestId ?? null;
    this.details = opts.details;
    this.retryAfter = opts.retryAfter ?? null;
  }
}

export const NETWORK_ERROR_MESSAGE =
  "Could not reach the MelaDx7 server. Check your connection and try again.";

type Listener = (token: string | null) => void;

class TokenStore {
  private token: string | null = null;
  private listeners = new Set<Listener>();

  get(): string | null {
    return this.token;
  }

  set(token: string | null): void {
    this.token = token;
    this.listeners.forEach((listener) => listener(token));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const tokenStore = new TokenStore();

let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON error body (e.g. a proxy error page).
  }
  const error = (
    body as { error?: { code?: string; message?: string; request_id?: string; details?: unknown } }
  )?.error;
  const retry = response.headers.get("retry-after");
  return new ApiError(
    response.status,
    error?.code ?? `http_${response.status}`,
    error?.message ?? defaultMessage(response.status),
    {
      requestId: error?.request_id ?? response.headers.get("x-request-id"),
      details: error?.details,
      retryAfter: retry ? Number(retry) : null,
    },
  );
}

function defaultMessage(status: number): string {
  if (status === 413) return "The file is too large.";
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  if (status === 502 || status === 503 || status === 504)
    return "The server is temporarily unavailable. Please try again shortly.";
  if (status >= 500) return "The server encountered an error. Please try again.";
  return "The request failed.";
}

let refreshInFlight: Promise<string | null> | null = null;

/** Exchange the httpOnly refresh cookie for a new access token (single-flight). */
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" });
        if (!response.ok) {
          tokenStore.set(null);
          return null;
        }
        const data = (await response.json()) as TokenResponse;
        tokenStore.set(data.access_token);
        return data.access_token;
      } catch {
        return null;
      } finally {
        setTimeout(() => {
          refreshInFlight = null;
        }, 0);
      }
    })();
  }
  return refreshInFlight;
}

export interface RequestOptions {
  method?: string;
  json?: unknown;
  body?: BodyInit;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  auth?: boolean;
}

export function buildUrl(path: string, query?: RequestOptions["query"]): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function send(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token && opts.auth !== false) headers.Authorization = `Bearer ${token}`;
  let body = opts.body;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }
  try {
    return await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      signal: opts.signal,
      credentials: "same-origin",
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new ApiError(0, "network_error", NETWORK_ERROR_MESSAGE);
  }
}

export async function request(path: string, opts: RequestOptions = {}): Promise<Response> {
  let response = await send(path, opts, tokenStore.get());
  if (response.status === 401 && opts.auth !== false) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      response = await send(path, opts, refreshed);
    }
    if (response.status === 401) {
      tokenStore.set(null);
      onSessionExpired?.();
    }
  }
  if (!response.ok) throw await toApiError(response);
  return response;
}

export async function requestJson<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const response = await request(path, opts);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Upload with progress events (fetch has no upload progress), including one refresh retry. */
export function uploadWithProgress<T>(
  path: string,
  form: FormData,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  const attempt = (token: string | null) =>
    new Promise<{ status: number; body: string; headers: Headers }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", path);
      xhr.withCredentials = true;
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total);
      };
      xhr.upload.onload = () => onProgress(1);
      xhr.onload = () => {
        const headers = new Headers();
        xhr
          .getAllResponseHeaders()
          .trim()
          .split(/[\r\n]+/)
          .forEach((line) => {
            const idx = line.indexOf(":");
            if (idx > 0) headers.append(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
          });
        resolve({ status: xhr.status, body: xhr.responseText, headers });
      };
      xhr.onerror = () => reject(new ApiError(0, "network_error", NETWORK_ERROR_MESSAGE));
      xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
      signal?.addEventListener("abort", () => xhr.abort(), { once: true });
      xhr.send(form);
    });

  return (async () => {
    let result = await attempt(tokenStore.get());
    if (result.status === 401) {
      const refreshed = await refreshAccessToken();
      if (refreshed) result = await attempt(refreshed);
      if (result.status === 401) {
        tokenStore.set(null);
        onSessionExpired?.();
      }
    }
    if (result.status < 200 || result.status >= 300) {
      throw await toApiError(
        new Response(result.body || null, { status: result.status, headers: result.headers }),
      );
    }
    return JSON.parse(result.body) as T;
  })();
}

/** Download an authenticated file (e.g. the PDF report) and save it with its server filename. */
export async function downloadFile(path: string, query?: RequestOptions["query"]): Promise<void> {
  const response = await request(path, { query });
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = match?.[1] ?? "download";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
