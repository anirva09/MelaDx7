import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/context/ThemeContext";

export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

interface Options extends Omit<RenderOptions, "wrapper"> {
  route?: string;
  path?: string;
  extraRoutes?: { path: string; element: ReactNode }[];
  client?: QueryClient;
}

/** Render with the same providers as the app, inside a memory router. */
export function renderWithProviders(ui: ReactElement, options: Options = {}) {
  const { route = "/", path = "*", extraRoutes = [], client = testQueryClient(), ...rest } = options;
  return {
    client,
    ...render(
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <MemoryRouter initialEntries={[route]}>
              <Routes>
                <Route path={path} element={ui} />
                {extraRoutes.map((r) => (
                  <Route key={r.path} path={r.path} element={r.element} />
                ))}
              </Routes>
            </MemoryRouter>
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>,
      rest,
    ),
  };
}

type Handler = (init: RequestInit | undefined, url: URL) => Response | Promise<Response>;

/** Minimal fetch mock: map "METHOD /path" to a handler. Unmatched requests fail loudly. */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: { method: string; url: URL; init?: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url, init });
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) throw new Error(`Unmocked request: ${method} ${url.pathname}`);
    return handler(init, url);
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** jsdom never loads images; make every `new Image()` succeed with the given size. */
export function mockImageLoading(width = 600, height = 450) {
  class LoadedImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = width;
    naturalHeight = height;
    decoding = "async";
    private _src = "";
    set src(value: string) {
      this._src = value;
      queueMicrotask(() => this.onload?.());
    }
    get src() {
      return this._src;
    }
  }
  vi.stubGlobal("Image", LoadedImage);
}
