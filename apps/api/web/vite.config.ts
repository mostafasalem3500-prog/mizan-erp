import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync } from "node:fs";

// one version number for web and desktop
const VERSION = (() => { try { return JSON.parse(readFileSync(new URL("../../desktop/package.json", import.meta.url), "utf8")).version as string; } catch { return "dev"; } })();

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false, // registered in main.tsx, which also reloads the page when a new version takes over
      manifest: false, // public/manifest.webmanifest is hand-written
      workbox: {
        importScripts: ["/sw-update.js"],
        skipWaiting: true, // a new version takes over at once; it never waits for every tab to be closed
        clientsClaim: true,
        globIgnores: ["sw-update.js"],
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/p\//, /^\/c\//],
        runtimeCaching: [
          {
            // POS needs these while offline: catalog, categories, session, identity
            urlPattern: ({ url }) => /^\/api\/(products|categories|pos\/session|auth\/me|warehouses)(\?|$)/.test(url.pathname + url.search),
            handler: "NetworkFirst",
            options: { cacheName: "mizan-pos-api", networkTimeoutSeconds: 5, expiration: { maxEntries: 40, maxAgeSeconds: 7 * 24 * 3600 } },
          },
          {
            // product images are versioned (?v=) — cache-first keeps the POS catalog visual while offline
            urlPattern: ({ url }) => url.pathname.startsWith("/api/media/"),
            handler: "CacheFirst",
            options: { cacheName: "mizan-media", expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 24 * 3600 }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com",
            handler: "StaleWhileRevalidate",
            options: { cacheName: "fonts", expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 3600 } },
          },
        ],
      },
    }),
  ],
  server: { port: 5173, proxy: { "/api": "http://localhost:3100" } },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 1500 },
});
