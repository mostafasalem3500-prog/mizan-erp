import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
// the typeface ships with the app: no request to a third party, and it works offline on the desktop edition
import "@fontsource/ibm-plex-sans-arabic/arabic-400.css";
import "@fontsource/ibm-plex-sans-arabic/latin-400.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-500.css";
import "@fontsource/ibm-plex-sans-arabic/latin-500.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-600.css";
import "@fontsource/ibm-plex-sans-arabic/latin-600.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-700.css";
import "@fontsource/ibm-plex-sans-arabic/latin-700.css";
import "./styles.css";
import { loadConfig, CFG } from "./shared/country";
import { startA11y } from "./a11y";
import { startI18n, tr } from "./i18n";
import { startErrorReports } from "./monitor";
startErrorReports();

// theme before the first paint (no flash): saved choice, else the system setting
try { const v = localStorage.getItem("mz_theme") || "auto"; document.documentElement.dataset.theme = v === "dark" || (v === "auto" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light"; } catch {}

loadConfig().finally(async () => {
  // English interface: the dictionary loads before the first screen is drawn (not for the associations edition)
  await startI18n(!CFG.assoc && !location.pathname.startsWith("/charity")).catch(() => undefined);
  const [{ App }, { ToastProvider }] = await Promise.all([import("./App"), import("./lib")]);
  document.documentElement.dataset.country = CFG.country;
  if (CFG.country !== "SA" && !location.pathname.startsWith("/charity")) document.title = CFG.appName;
  if (CFG.assoc && CFG.assocBrand) {
    // associations edition: the association's seal and name everywhere, even when the cached page still carries Mizan's
    const b = CFG.assocBrand;
    document.title = b.name;
    document.documentElement.dataset.edition = "assoc";
    const set = (sel: string, attr: string, v: string, type?: string) => { const el = document.querySelector<HTMLLinkElement | HTMLMetaElement>(sel); if (el) { el.setAttribute(attr, v); if (type) el.setAttribute("type", type); } };
    set('link[rel~="icon"]', "href", "/charity/favicon.png", "image/png");
    set('link[rel="apple-touch-icon"]', "href", b.icon512);
    set('link[rel="manifest"]', "href", "/assoc.webmanifest");
    set('meta[name="theme-color"]', "content", "#1c3f8a");
  }
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
    bar.innerHTML = `<span>${tr("صدر تحديث جديد للبرنامج.")}</span><button class="btn primary sm">${tr("تحديث الآن")}</button>`;
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
