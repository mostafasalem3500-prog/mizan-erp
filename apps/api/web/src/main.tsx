import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";
import { loadConfig, CFG } from "./shared/country";
import { startA11y } from "./a11y";

// theme before the first paint (no flash): saved choice, else the system setting
try { const v = localStorage.getItem("mz_theme") || "auto"; document.documentElement.dataset.theme = v === "dark" || (v === "auto" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light"; } catch {}

loadConfig().finally(async () => {
  const [{ App }, { ToastProvider }] = await Promise.all([import("./App"), import("./lib")]);
  document.documentElement.dataset.country = CFG.country;
  if (CFG.country !== "SA" && !location.pathname.startsWith("/charity")) document.title = CFG.appName;
  startA11y();
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

/**
 * Service worker: it keeps the app available offline, but must never keep an old version on screen. When a new version
 * takes control the page reloads by itself — unless a form is open or the cashier is selling, where a bar asks first.
 */
declare const __APP_VERSION__: string;
(window as any).MIZAN_VERSION = __APP_VERSION__;
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller; let handled = false;
  const offer = () => {
    if (document.getElementById("mz-update")) return;
    const bar = document.createElement("div"); bar.id = "mz-update"; bar.className = "update-bar no-print";
    bar.innerHTML = '<span>صدر تحديث جديد للبرنامج.</span><button class="btn primary sm">تحديث الآن</button>';
    bar.querySelector("button")!.addEventListener("click", () => location.reload());
    document.body.appendChild(bar);
  };
  /** True when the shell on screen is not the one the server now serves (its entry script has another name). */
  const stale = async () => {
    try {
      const mine = (document.querySelector('script[type="module"][src*="/assets/"]') as HTMLScriptElement | null)?.src.split("/").pop();
      const html = await fetch("/index.html", { cache: "no-store" }).then((r) => r.text());
      return !!mine && !html.includes(mine);
    } catch { return false; }
  };
  const newVersion = async () => {
    if (!hadController || handled) return; handled = true;
    if (!(await stale())) { handled = false; return; } // the worker changed but this page already runs the current shell
    const busy = !!document.querySelector(".modal") || location.pathname === "/pos" || !!(document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName));
    if (busy) offer(); else location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", newVersion);
  // the worker announces a new version; answering tells it this window looks after itself (it reloads windows that stay silent)
  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data?.type === "MZ_NEW_VERSION") { (e.source as ServiceWorker | null)?.postMessage({ type: "MZ_ACK" }); newVersion(); } });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then((reg) => {
      const check = () => { reg.update().catch(() => undefined); };
      setInterval(check, 20 * 60 * 1000);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
    }).catch(() => undefined);
  });
}
