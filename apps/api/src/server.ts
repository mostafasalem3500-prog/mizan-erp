import nodeFs from "fs";
import nodePath from "path";
import { r20 } from "./routes/round20";
import { r22 } from "./routes/round22";
import { r23 } from "./routes/round23";
import { r25 } from "./routes/round25";
import { fr } from "./routes/finreport";
import { r27 } from "./routes/round27";
import { egr } from "./routes/egypt";
import { publicConfig, COUNTRY, CHARITY, IS_DESKTOP, ASSOC, ASSOC_BRAND } from "./lib/country";
import { r16 } from "./routes/round16";
import { assocRoutes, assocPublic } from "./routes/assoc";
import { r28 } from "./routes/round28";
import { r31 } from "./routes/round31";
import { amort } from "./routes/amort";
import { r338 } from "./routes/round338";
import { r339 } from "./routes/round339";
import { r340 } from "./routes/round340";
import { r343 } from "./routes/round343";
import { r347 } from "./routes/round347";
import { startDigestScheduler } from "./services/digest";
import { r15 } from "./routes/round15";
import { media } from "./routes/media";
import express from "express";
import compression from "compression";
import path from "path";
import fs from "fs";
import { migrate } from "./db/migrate";
import { pool } from "./db/pool";
import { AppError } from "./lib/core";
import * as monitor from "./services/monitor";
import { auth, admin } from "./routes/auth";
import { master } from "./routes/master";
import { ops } from "./routes/ops";
import { pub, extra } from "./routes/extra";
import { r3 } from "./routes/round3";
import { r4 } from "./routes/round4";
import { r5 } from "./routes/round5";
import { r6 } from "./routes/round6";
import { r7 } from "./routes/round7";
import { r8, v1, portal } from "./routes/round8";
import { r9 } from "./routes/round9";
import { r10, hooks } from "./routes/round10";
import { r12 } from "./routes/round12";
import { runZatcaSelfTest } from "./zatca/selftest";
import { runAccountingSelfCheck } from "./services/selfcheck";
import { startRecurringScheduler } from "./services/recurring";
import { startDailyBackups } from "./services/assoc2";
import { seedDemoAccount } from "./services/seed-demo-account";
import { startDesktopLicenseCheck } from "./services/desktopLicenseCheck";
import { startDesktopGuard } from "./services/desktopGuard";
import { openapi, apiDocsHtml } from "./services/openapi";

/** Ops aid: ZATCA_SELFTEST=1 runs the developer-portal self-test once at boot for the showcase (or first) company and logs it. */
async function zatcaBootSelfTest() {
  const email = (process.env.DEMO_EMAIL || "").toLowerCase();
  const c = (email && (await pool.query(`SELECT c.* FROM companies c JOIN memberships m ON m.company_id=c.id JOIN users u ON u.id=m.user_id WHERE u.email=$1 LIMIT 1`, [email])).rows[0]) || (await pool.query(`SELECT * FROM companies ORDER BY created_at LIMIT 1`)).rows[0];
  if (!c) return;
  const company = { ...c, nameAr: c.name_ar, vatNumber: c.vat_number, crNumber: c.cr_number, buildingNo: c.building_no, additionalNo: c.additional_no, postalCode: c.postal_code };
  const r = await runZatcaSelfTest(company, { env: "SANDBOX" });
  console.log(`[zatca-selftest] ok=${r.ok} company=${c.name_ar}`);
  for (const s of r.steps) console.log(`[zatca-selftest] step ${s.ok ? "OK " : "ERR"} ${s.name} — ${s.detail || ""}`);
  for (const d of r.docs) console.log(`[zatca-selftest] doc ${d.ok ? "OK " : "ERR"} ${d.typeCode}${d.simplified ? "S" : "B"} http=${d.httpStatus} status=${d.status} errors=${JSON.stringify(d.errors)} warnings=${JSON.stringify(d.warnings)}`);
  for (const n of r.notes) console.log(`[zatca-selftest] note ${n}`);
  await pool.query(`UPDATE zatca_configs SET selftest=$2, selftest_at=now() WHERE company_id=$1`, [c.id, JSON.stringify(r)]);
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(compression());

/**
 * Security headers on every response (OWASP secure-headers baseline).
 * The app loads nothing from other origins: scripts, styles, fonts and API calls are same-origin; images may also be
 * data:/blob: (uploads, QR codes) or https: (product pictures synced from an online store). Inline style attributes are
 * what React writes for dynamic layout, hence 'unsafe-inline' for styles only — never for scripts.
 */
const CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:", "font-src 'self' data:", "connect-src 'self'", "worker-src 'self' blob:", "frame-src 'self' blob: data:", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'", "manifest-src 'self'"].join("; ");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (req.path.startsWith("/api/")) { res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"); if (!res.getHeader("Cache-Control")) res.setHeader("Cache-Control", "no-store"); }
  else res.setHeader("Content-Security-Policy", CSP);
  next();
});
/** Where to report a vulnerability (RFC 9116). */
app.get("/.well-known/security.txt", (_req, res) => { const exp = new Date(Date.now() + 300 * 864e5).toISOString(); res.type("text/plain").send(`Contact: mailto:${process.env.SECURITY_CONTACT || process.env.SUPPORT_EMAIL || "security@mizan-erp.sa"}\nExpires: ${exp}\nPreferred-Languages: ar, en\n`); });
// attachments carry files (base64): their own, larger body limit; parsed bodies are skipped by the general parser
app.use(["/api/attachments", "/api/ai/chat", "/api/archive/upload"], express.json({ limit: "30mb" }));
// response times per route (in memory), for the system manager's error page and the status page
app.use("/api", (req, res, next) => {
  const t0 = process.hrtime.bigint();
  res.on("finish", () => { if (req.path !== "/client-errors") monitor.trackRequest(req.method, monitor.routeKey(req.baseUrl + req.path), Number(process.hrtime.bigint() - t0) / 1e6); });
  next();
});
app.use(express.json({ limit: "2mb", verify: (req: any, _res, buf) => { if (String(req.url || "").startsWith("/api/hooks/")) req.rawBody = Buffer.from(buf); } }));

app.get("/api/config", (_req, res) => { res.set("Cache-Control", "no-cache"); res.json(publicConfig()); });
/** The release number shown in the sidebar (apps/api/web/VERSION), so /api/health tells which build is running. */
const APP_VERSION = (() => { for (const f of [nodePath.join(process.cwd(), "web/VERSION"), nodePath.join(__dirname, "../web/VERSION"), nodePath.join(__dirname, "../../web/VERSION")]) { try { return nodeFs.readFileSync(f, "utf8").trim(); } catch { /* next */ } } return process.env.APP_VERSION || "unknown"; })();
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, version: APP_VERSION, country: COUNTRY, time: new Date() });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
// service status: a public page (no script) and the same figures as JSON; errors reported by the browser
app.get("/api/status", async (_req, res) => { res.set("Cache-Control", "no-cache"); const s = await monitor.status(APP_VERSION); res.status(s.ok ? 200 : 503).json(s); });
app.get("/status", async (_req, res) => {
  const s = await monitor.status(APP_VERSION);
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  res.setHeader("Cache-Control", "no-cache");
  res.status(s.ok ? 200 : 503).type("html").send(monitor.statusHtml(s, publicConfig().appName || "ميزان ERP"));
});
const clientHits = new Map<string, { at: number; n: number }>();
app.post("/api/client-errors", (req, res) => {
  const ip = String(req.ip || "");
  const now = Date.now(), h0 = clientHits.get(ip);
  const h1 = h0 && now - h0.at < 60_000 ? { at: h0.at, n: h0.n + 1 } : { at: now, n: 1 };
  clientHits.set(ip, h1);
  if (clientHits.size > 5000) clientHits.clear();
  const b = req.body || {};
  if (h1.n <= 20 && typeof b.message === "string" && b.message.trim()) {
    void monitor.recordError({ source: "client", message: b.message, stack: typeof b.stack === "string" ? b.stack : null, path: typeof b.path === "string" ? b.path : null, version: typeof b.version === "string" ? b.version : null, userAgent: String(req.headers["user-agent"] || "") });
  }
  res.status(204).end();
});
process.on("unhandledRejection", (e: any) => { console.error("[unhandledRejection]", e); void monitor.recordError({ source: "server", message: String(e?.message || e), stack: e?.stack || null, version: APP_VERSION }); });

app.use("/api/media", media);
app.use("/api/public", pub);
app.use("/api/public", portal);
app.use("/api/public", assocPublic);
// public description of the REST API: the OpenAPI file and a readable page (before the API-key check)
const originOf = (req: express.Request) => `${req.protocol}://${req.get("host")}`;
app.get("/api/v1/openapi.json", (req, res) => { res.setHeader("Cache-Control", "public, max-age=300"); res.json(openapi(originOf(req))); });
app.get(["/developers", "/api/docs"], (req, res) => { res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"); res.setHeader("Cache-Control", "public, max-age=300"); res.type("html").send(apiDocsHtml(originOf(req))); });
app.use("/api/v1", v1);
app.use("/api/hooks", hooks);
app.use("/api/auth", auth);
app.use("/api/admin", admin);
// the charity interface is a separate product, enabled per server (MIZAN_CHARITY=1)
app.use("/api/charity", (_req, res, next) => (CHARITY ? next() : res.status(404).json({ message: "واجهة الجمعيات غير متاحة في هذا الإصدار", code: "NOT_FOUND" })));
app.use("/api", master);
app.use("/api", ops);
app.use("/api", extra);
app.use("/api", r3);
app.use("/api", r4);
app.use("/api", r5);
app.use("/api", r6);
app.use("/api", r7);
app.use("/api", r8);
app.use("/api", r9);
app.use("/api", r10);
app.use("/api", r12);
app.use("/api", r15);
app.use("/api", assocRoutes);
app.use("/api", r16);
app.use("/api", r20);
app.use("/api", r22);
app.use("/api", r23);
app.use("/api", r25);
app.use("/api", fr);
app.use("/api", r27);
app.use("/api", r28);
app.use("/api", r31);
app.use("/api", amort);
app.use("/api", r338);
app.use("/api", r339);
app.use("/api", r340);
app.use("/api", r343);
app.use("/api", r347);
app.use("/api", egr);

app.use("/api", (_req, res) => res.status(404).json({ message: "المسار غير موجود", code: "NOT_FOUND" }));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) return res.status(err.status).json({ message: err.message, code: err.code, details: err.details });
  if (err?.status === 404) return res.status(404).json({ message: err.message, code: "NOT_FOUND" });
  if (err?.type === "entity.too.large") return res.status(413).json({ message: "حجم البيانات المرسلة أكبر من المسموح", code: "TOO_LARGE" });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ message: "JSON غير صحيح", code: "BAD_JSON" });
  if (err?.code === "22P02") return res.status(404).json({ message: "السجل غير موجود (معرّف غير صحيح)", code: "NOT_FOUND" }); // a malformed id in the address
  if (err?.code === "23505") return res.status(409).json({ message: "قيمة مكررة — السجل موجود مسبقاً", code: "CONFLICT" });
  if (err?.code === "23503") return res.status(409).json({ message: "لا يمكن الحذف — السجل مرتبط بسجلات أخرى", code: "CONFLICT" });
  if (typeof err?.message === "string" && err.message.startsWith("UNBALANCED_ENTRY")) return res.status(400).json({ message: "القيد غير متوازن", code: "UNBALANCED" });
  console.error(err);
  const r: any = req;
  void monitor.recordError({ source: "server", message: String(err?.message || err), stack: err?.stack || null, path: req.originalUrl, method: req.method, status: 500, version: APP_VERSION, userAgent: String(req.headers["user-agent"] || ""), companyId: r.company?.id || null, userId: r.auth?.userId || null });
  res.status(500).json({ message: err?.message || "خطأ غير متوقع", code: "INTERNAL" });
});

// static SPA
const webDir = path.resolve(__dirname, "../web/dist");
if (fs.existsSync(webDir)) {
  // hashed bundles never change → cached for a year; the service worker and manifest are always re-checked
  app.use("/assets", express.static(path.join(webDir, "assets"), { maxAge: "365d", immutable: true, index: false }));
  app.use("/assets", (_req, res) => { res.status(404).type("text/plain").send("not found"); }); // an old tab asking for a replaced chunk must not get index.html
  if (ASSOC) app.get("/index.html", (_req, res) => { res.setHeader("Cache-Control", "no-cache"); res.type("html").send(assocIndex()); }); // the service worker caches this copy
  app.use(express.static(webDir, { index: false, redirect: false, setHeaders: (res, file) => { res.setHeader("Cache-Control", /(sw\.js|sw-update\.js|registerSW\.js|workbox-[^/]*\.js|\.webmanifest)$/.test(file) ? "no-cache" : "public, max-age=3600"); } }));
  // associations edition: the site carries the association's name and seal (tab icon, home-screen icon, link previews)
  const assocManifest = () => JSON.stringify({ name: ASSOC_BRAND.name, short_name: "الجمعية", lang: "ar", dir: "rtl", start_url: "/charity", scope: "/", display: "standalone", background_color: "#ffffff", theme_color: "#1c3f8a",
    icons: [{ src: ASSOC_BRAND.icon192, sizes: "192x192", type: "image/png" }, { src: ASSOC_BRAND.icon512, sizes: "512x512", type: "image/png" }, { src: ASSOC_BRAND.icon512, sizes: "512x512", type: "image/png", purpose: "maskable" }] });
  app.get("/assoc.webmanifest", (_req, res) => { res.setHeader("Cache-Control", "no-cache"); res.type("application/manifest+json").send(assocManifest()); });
  let indexHtml: string | null = null;
  const assocIndex = () => {
    if (indexHtml) return indexHtml;
    const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const n = esc(ASSOC_BRAND.name);
    indexHtml = fs.readFileSync(path.join(webDir, "index.html"), "utf8")
      .replace(/<title>[^<]*<\/title>/, `<title>${n}</title>`)
      .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="/charity/favicon.png" type="image/png" />`)
      .replace(/<link rel="manifest"[^>]*>/, `<link rel="manifest" href="/assoc.webmanifest" />`)
      .replace(/<link rel="apple-touch-icon"[^>]*>/, `<link rel="apple-touch-icon" href="${ASSOC_BRAND.icon512}" />`)
      .replace(/<meta name="theme-color"[^>]*>/, `<meta name="theme-color" content="#1c3f8a" />`)
      .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${n}" />`)
      .replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${ASSOC_BRAND.icon512}" />`)
      .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${n} — نظام الجمعية والنظام المحاسبي: سندات القبض والصرف والتبرعات والأعضاء والقوائم المالية." />`);
    return indexHtml;
  };
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    if (ASSOC) res.type("html").send(assocIndex()); else res.sendFile(path.join(webDir, "index.html"));
  });
}

const port = Number(process.env.PORT || 3000);
migrate()
  .then(() => {
    app.listen(port, process.env.HOST || "0.0.0.0", () => console.log(`Mizan ERP v2 listening on :${port}`));
    seedDemoAccount().catch((e) => console.error("[demo-account]", e));
    // every boot re-proves the accounting engine on a throw-away company (rolled back, nothing stored)
    // on the desktop the check waits until the user has started working, so the first screen opens at full speed
    const selfCheck = () => runAccountingSelfCheck().then((r) => {
      monitor.setSelfcheck(r);
      console.log(`[selfcheck] ${r.ok ? "PASS" : "FAIL"} ${r.passed}/${r.passed + r.failed} in ${r.durationMs}ms`);
      for (const c of r.checks.filter((x) => !x.ok)) console.log(`[selfcheck] ✘ [${c.group}] ${c.name} expected=${JSON.stringify(c.expected)} actual=${JSON.stringify(c.actual)}`);
      if (r.error) console.log(`[selfcheck] error ${r.error}`);
    }).catch((e) => console.error("[selfcheck]", e));
    if (IS_DESKTOP) setTimeout(selfCheck, 3 * 60_000).unref(); else selfCheck();
    if (process.env.ZATCA_SELFTEST) zatcaBootSelfTest().catch((e) => console.error("[zatca-selftest]", e));
    startRecurringScheduler();
    startDailyBackups();
    startDigestScheduler();
    startDesktopGuard().catch((e) => console.error("[guard]", e));
    startDesktopLicenseCheck();
  })
  .catch((e) => {
    console.error("migration failed", e);
    // inside the desktop app the server shares the Electron process: report instead of killing the whole app
    if (process.env.MIZAN_EDITION === "desktop-local") { (global as any).__mizanBootError = e; return; }
    process.exit(1);
  });
