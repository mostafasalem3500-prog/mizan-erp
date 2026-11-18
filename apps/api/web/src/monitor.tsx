/**
 * Errors in the browser reach the server's error monitor (the system manager sees them under «أخطاء النظام»), and a
 * screen that fails to draw shows a message with a way out instead of a blank page.
 */
import React from "react";
declare const __APP_VERSION__: string;

const sent = new Set<string>();
const NOISE = /ResizeObserver loop|chrome-extension:|moz-extension:|safari-extension:|Failed to fetch|NetworkError|Load failed|AbortError|The operation was aborted|Importing a module script failed|error loading dynamically imported module/i;
/** One report per kind of error per page load, at most ten; network drops and browser extensions are left out. */
export function reportError(message: string, stack?: string | null) {
  const m = String(message || "").slice(0, 500);
  if (!m || NOISE.test(m) || NOISE.test(stack || "") || sent.has(m) || sent.size >= 10) return;
  sent.add(m);
  const body = JSON.stringify({ message: m, stack: stack ? String(stack).slice(0, 4000) : null, path: location.pathname + location.search, version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "" });
  try {
    if (navigator.sendBeacon && navigator.sendBeacon("/api/client-errors", new Blob([body], { type: "application/json" }))) return;
  } catch { /* fall back to fetch */ }
  fetch("/api/client-errors", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
}

export function startErrorReports() {
  window.addEventListener("error", (e) => { if (e.error || e.message) reportError(e.message || String(e.error), e.error?.stack); });
  window.addEventListener("unhandledrejection", (e) => { const r: any = e.reason; reportError(r?.message || String(r), r?.stack); });
}

/** Wraps the screens: a screen that throws while drawing shows this card; moving to another screen clears it. */
export class ScreenGuard extends React.Component<{ resetKey: string; children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) { reportError(error.message, (error.stack || "") + "\n" + (info.componentStack || "")); }
  componentDidUpdate(prev: { resetKey: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card" role="alert" data-screen-error style={{ maxWidth: 560, margin: "40px auto" }}>
        <div className="card-b">
          <h3 style={{ marginTop: 0 }}>تعذّر عرض هذه الشاشة</h3>
          <p className="muted">حدث خطأ غير متوقع أثناء عرضها، وأُبلغ به فريق الدعم تلقائياً. بياناتك محفوظة ولم يتغير شيء.</p>
          <div className="row"><button className="btn primary" onClick={() => location.reload()}>إعادة تحميل الصفحة</button><a className="btn" href="/">الرئيسية</a></div>
        </div>
      </div>
    );
  }
}
