import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";
import { loadConfig, CFG } from "./shared/country";

// theme before the first paint (no flash): saved choice, else the system setting
try { const v = localStorage.getItem("mz_theme") || "auto"; document.documentElement.dataset.theme = v === "dark" || (v === "auto" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light"; } catch {}

loadConfig().finally(async () => {
  const [{ App }, { ToastProvider }] = await Promise.all([import("./App"), import("./lib")]);
  document.documentElement.dataset.country = CFG.country;
  if (CFG.country !== "SA" && !location.pathname.startsWith("/charity")) document.title = CFG.appName;
  createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
});
