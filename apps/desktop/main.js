/**
 * ميزان ERP — desktop shell.
 *   • Cloud mode: a dedicated window on the hosted Mizan server (same accounts, ZATCA online, offline-capable POS).
 *   • Local mode: an embedded PostgreSQL + the same Mizan server running on this PC (data stays on the device).
 * The mode is chosen on first launch and can be changed from the menu at any time.
 */
const { app, BrowserWindow, Menu, ipcMain, shell, dialog, nativeTheme } = require("electron");
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const crypto = require("crypto");

const DEFAULT_CLOUD = "https://mizan-api-production-7c00.up.railway.app";
const APP_TITLE = "ميزان ERP";

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const userData = app.getPath("userData");
const cfgFile = path.join(userData, "mizan-desktop.json");
const logFile = path.join(userData, "mizan-desktop.log");
const log = (...a) => { try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}\n`); } catch {} };

function readCfg() { try { return JSON.parse(fs.readFileSync(cfgFile, "utf8")); } catch { return {}; } }
function writeCfg(c) { fs.mkdirSync(userData, { recursive: true }); fs.writeFileSync(cfgFile, JSON.stringify(c, null, 2)); }

let win = null;
let pg = null; // embedded postgres instance (local mode)
let localUrl = null;
let quitting = false;

function freePort(preferred) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => { const s2 = net.createServer(); s2.listen(0, "127.0.0.1", () => { const p = s2.address().port; s2.close(() => resolve(p)); }); });
    s.listen(preferred, "127.0.0.1", () => s.close(() => resolve(preferred)));
  });
}

function waitHealth(url, timeoutMs = 90000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      http.get(url + "/api/health", (res) => { res.resume(); if (res.statusCode === 200) resolve(); else retry(); }).on("error", retry);
    };
    const retry = () => (Date.now() - started > timeoutMs ? reject(new Error("لم يبدأ الخادم المحلي خلال الوقت المتوقع")) : setTimeout(tick, 400));
    tick();
  });
}

function showStatus(text) {
  if (win && !win.isDestroyed()) win.webContents.send("status", text);
}

// ── local mode: embedded PostgreSQL + Mizan server in this process ─────────
async function startLocal(cfg) {
  const EmbeddedPostgres = require("embedded-postgres").default || require("embedded-postgres");
  const dataDir = path.join(userData, "pgdata");
  if (!cfg.local) cfg.local = { dbPassword: crypto.randomBytes(18).toString("hex"), jwtSecret: crypto.randomBytes(32).toString("hex"), dbPort: 54329, appPort: 3517 };
  writeCfg(cfg);
  const dbPort = await freePort(cfg.local.dbPort);
  const appPort = await freePort(cfg.local.appPort);
  const fresh = !fs.existsSync(path.join(dataDir, "PG_VERSION"));
  showStatus(fresh ? "تهيئة قاعدة البيانات المحلية لأول مرة…" : "تشغيل قاعدة البيانات المحلية…");
  pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "mizan", password: cfg.local.dbPassword, port: dbPort, persistent: true, onLog: (m) => log("[pg]", String(m).trim()), onError: (m) => log("[pg:err]", String(m).trim()) });
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase("mizan").catch((e) => log("createDatabase", e.message));
  showStatus("تشغيل خادم ميزان المحلي…");
  process.env.DATABASE_URL = `postgresql://mizan:${cfg.local.dbPassword}@127.0.0.1:${dbPort}/mizan`;
  process.env.PORT = String(appPort);
  process.env.JWT_SECRET = cfg.local.jwtSecret;
  process.env.TRIAL_DAYS = process.env.TRIAL_DAYS || "30";
  process.env.MIZAN_EDITION = "desktop-local";
  process.env.PUBLIC_URL = `http://127.0.0.1:${appPort}`;
  process.env.HOST = "127.0.0.1"; // not exposed to the network
  const serverEntry = path.join(__dirname, "server", "dist", "server.js");
  require(serverEntry);
  localUrl = `http://127.0.0.1:${appPort}`;
  await waitHealth(localUrl);
  return localUrl;
}

async function stopLocal() {
  if (pg) { try { await pg.stop(); } catch (e) { log("pg stop", e.message); } pg = null; }
}

// ── windows & navigation ───────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 980, minHeight: 640, title: APP_TITLE, show: false,
    icon: path.join(__dirname, "assets", process.platform === "win32" ? "icon.ico" : "icon.png"),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0b2f2c" : "#f5f7f6",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.once("ready-to-show", () => win.show());
  win.on("page-title-updated", (e) => { e.preventDefault(); win.setTitle(APP_TITLE + (readCfg().mode === "local" ? " — محلي" : "")); });
  const isApp = (u) => { try { const x = new URL(u); const base = new URL(readCfg().mode === "local" ? localUrl : (readCfg().cloudUrl || DEFAULT_CLOUD)); return x.origin === base.origin; } catch { return false; } };
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isApp(url)) return { action: "allow", overrideBrowserWindowOptions: { width: 1000, height: 800, autoHideMenuBar: true, title: APP_TITLE } };
    shell.openExternal(url); // wa.me, mailto:, external docs…
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file:") && !isApp(url)) { e.preventDefault(); shell.openExternal(url); } });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    if (code === -3 || url.startsWith("file:")) return; // aborted redirects
    log("did-fail-load", code, desc, url);
    win.loadFile(path.join(__dirname, "renderer", "offline.html"), { query: { url, desc } });
  });
  buildMenu();
}

async function launch() {
  const cfg = readCfg();
  if (!cfg.mode) return win.loadFile(path.join(__dirname, "renderer", "launcher.html"));
  if (cfg.mode === "cloud") return win.loadURL(cfg.cloudUrl || DEFAULT_CLOUD);
  await win.loadFile(path.join(__dirname, "renderer", "starting.html"));
  try {
    const url = localUrl || (await startLocal(cfg));
    await win.loadURL(url);
  } catch (e) {
    log("local start failed", e.stack || e.message);
    dialog.showErrorBox(APP_TITLE, `تعذّر تشغيل الوضع المحلي:\n${e.message}\n\nيمكنك التحويل إلى الوضع السحابي من قائمة «ميزان».\nسجل الأخطاء: ${logFile}`);
    win.loadFile(path.join(__dirname, "renderer", "launcher.html"));
  }
}

function buildMenu() {
  const cfg = readCfg();
  const template = [
    {
      label: "ميزان",
      submenu: [
        { label: "الصفحة الرئيسية", accelerator: "CmdOrCtrl+H", click: () => launch() },
        { type: "separator" },
        { label: `وضع التشغيل: ${cfg.mode === "local" ? "محلي على هذا الجهاز" : cfg.mode === "cloud" ? "سحابي" : "غير محدد"}`, enabled: false },
        { label: "تغيير وضع التشغيل…", click: async () => {
          const r = await dialog.showMessageBox(win, { type: "question", buttons: ["إلغاء", "تغيير"], defaultId: 1, cancelId: 0, title: APP_TITLE, message: "تغيير وضع التشغيل؟", detail: "البيانات المحلية لا تُحذف عند التحويل، ويمكنك العودة إليها في أي وقت. سيُعاد تشغيل البرنامج." });
          if (r.response !== 1) return;
          const c = readCfg(); delete c.mode; writeCfg(c);
          app.relaunch(); app.quit();
        } },
        { label: "فتح مجلد بيانات البرنامج", click: () => shell.openPath(userData) },
        { type: "separator" },
        { label: "خروج", accelerator: "Alt+F4", role: "quit" },
      ],
    },
    { label: "تحرير", submenu: [{ role: "undo", label: "تراجع" }, { role: "redo", label: "إعادة" }, { type: "separator" }, { role: "cut", label: "قص" }, { role: "copy", label: "نسخ" }, { role: "paste", label: "لصق" }, { role: "selectAll", label: "تحديد الكل" }] },
    { label: "عرض", submenu: [{ role: "reload", label: "تحديث الصفحة" }, { role: "togglefullscreen", label: "ملء الشاشة" }, { type: "separator" }, { role: "zoomIn", label: "تكبير" }, { role: "zoomOut", label: "تصغير" }, { role: "resetZoom", label: "الحجم الطبيعي" }, { type: "separator" }, { role: "toggleDevTools", label: "أدوات المطور" }] },
    { label: "مساعدة", submenu: [
      { label: "طباعة الصفحة الحالية", accelerator: "CmdOrCtrl+P", click: () => win && win.webContents.print({ printBackground: true }) },
      { label: "سجل البرنامج", click: () => shell.openPath(logFile) },
      { label: "عن ميزان", click: () => dialog.showMessageBox(win, { type: "info", title: APP_TITLE, message: `${APP_TITLE} — الإصدار ${app.getVersion()}`, detail: "نظام محاسبة ونقاط بيع ومخزون وفوترة إلكترونية متوافق مع هيئة الزكاة والضريبة والجمارك." }) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── IPC from the launcher page ─────────────────────────────────────────────
ipcMain.handle("get-config", () => ({ ...readCfg(), defaultCloud: DEFAULT_CLOUD, version: app.getVersion() }));
ipcMain.handle("choose-mode", async (_e, { mode, cloudUrl }) => {
  const c = readCfg();
  c.mode = mode === "local" ? "local" : "cloud";
  if (c.mode === "cloud") c.cloudUrl = (cloudUrl || DEFAULT_CLOUD).replace(/\/+$/, "");
  writeCfg(c);
  buildMenu();
  await launch();
  return true;
});
ipcMain.handle("retry", () => launch());

// ── lifecycle ──────────────────────────────────────────────────────────────
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => { createWindow(); launch(); setupAutoUpdate(); });

// ── auto-update from GitHub releases (installed builds only) ──────────────
function setupAutoUpdate() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try { ({ autoUpdater } = require("electron-updater")); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.on("error", (e) => log("updater", e && e.message));
  autoUpdater.on("update-downloaded", async (info) => {
    const r = await dialog.showMessageBox(win, { type: "info", buttons: ["لاحقاً", "إعادة التشغيل والتحديث"], defaultId: 1, cancelId: 0, title: APP_TITLE, message: `يتوفر إصدار جديد ${info.version}`, detail: "تم تنزيل التحديث. أعد تشغيل البرنامج لتثبيته (بياناتك محفوظة)." });
    if (r.response === 1) { quitting = true; await stopLocal(); autoUpdater.quitAndInstall(); }
  });
  autoUpdater.checkForUpdates().catch((e) => log("updater check", e && e.message));
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 3600 * 1000);
}
app.on("window-all-closed", () => app.quit());
app.on("before-quit", async (e) => {
  if (quitting || !pg) return;
  e.preventDefault();
  quitting = true;
  await stopLocal();
  app.quit();
});
process.on("uncaughtException", (e) => log("uncaught", e.stack || e.message));
