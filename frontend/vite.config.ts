/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    port: 5173,
    // Same-origin API in development: cookies and canvas image exports just work.
    proxy: { "/api": { target: apiTarget, changeOrigin: false } },
  },
  preview: {
    port: 4173,
    proxy: { "/api": { target: apiTarget, changeOrigin: false } },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        // Stable vendor chunks: better long-term caching and smaller page chunks.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (/recharts|d3-|victory-vendor|es-toolkit|immer|redux|reselect/.test(id)) return "vendor-charts";
          if (/radix-ui|@radix-ui|@floating-ui/.test(id)) return "vendor-radix";
          if (/react-router|react-dom|scheduler|\/react\//.test(id)) return "vendor-react";
          if (/zod|react-hook-form|@hookform/.test(id)) return "vendor-forms";
          return "vendor";
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    restoreMocks: true,
  },
});
