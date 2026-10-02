import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: false, // public/manifest.webmanifest is hand-written
      workbox: {
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
