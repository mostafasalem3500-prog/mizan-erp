import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";
import { loadConfig, CFG } from "./shared/country";

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
