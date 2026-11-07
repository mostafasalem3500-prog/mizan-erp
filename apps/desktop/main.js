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
const os = require("os");
const { execFileSync } = require("child_process");

const DEFAULT_CLOUD = "https://mizan-api-production-7c00.up.railway.app";
const APP_TITLE = "ميزان ERP";

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const userData = app.getPath("userData");
const cfgFile = path.join(userData, "mizan-desktop.json");
const logFile = path.join(userData, "mizan-desktop.log");
const log = (...a) => { try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}\n`); } catch {} };

function readCfg() { try { return JSON.parse(fs.readFileSync(cfgFile, "utf8")); } catch { return {}; } }
function writeCfg(c) { fs.mkdirSync(userData, { recursive: true }); fs.writeFileSync(cfgFile, JSON.stringify(c, null, 2)); }

// ── device fingerprint (licence binding) ───────────────────────────────────
// ID = A-B-C-K: A = motherboard/BIOS, B = CPU, C = system disk, K = checksum. The licence keeps working while
// 2 of the 3 parts match, so reinstalling Windows changes nothing and one replaced part does not stop the program.
const { execFile } = require("child_process");
const HW_PS = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$p=Get-CimInstance Win32_ComputerSystemProduct",
  "$bb=Get-CimInstance Win32_BaseBoard",
  "$c=Get-CimInstance Win32_Processor | Select-Object -First 1",
  "$d=(Get-Partition -DriveLetter $env:SystemDrive.Substring(0,1) | Get-Disk).SerialNumber",
  "if(-not $d){$d=(Get-CimInstance Win32_DiskDrive | Where-Object {$_.Index -eq 0}).SerialNumber}",
  "[pscustomobject]@{uuid=$p.UUID;board=$bb.SerialNumber;boardMaker=$bb.Manufacturer;cpu=$c.ProcessorId;cpuName=$c.Name;disk=$d} | ConvertTo-Json -Compress",
].join(";");
const PS_ARGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", HW_PS];
const clean = (v) => {
  const s = String(v == null ? "" : v).trim();
  const bare = s.replace(/[\s.:-]/g, "");
  if (!bare || /^(0+|f+|none|null|na|notapplicable|defaultstring|tobefilledbyoem|systemserialnumber|oem|123456789|03000200040005000006000700080009)$/i.test(bare)) return "";
  return s.toUpperCase();
};
function machineGuid() {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { encoding: "utf8", windowsHide: true });
      const m = /MachineGuid\s+REG_\w+\s+([0-9a-f-]+)/i.exec(out);
      if (m) return m[1].toLowerCase();
    } else {
      for (const f of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim();
    }
  } catch (e) { log("machine guid", e.message); }
  return os.hostname();
}
let _hw = null; // hardware info from PowerShell (warmed up asynchronously at start)
function parseHw(out) { try { return JSON.parse(String(out).trim()) || {}; } catch { return {}; } }
function hwInfoSync() {
  if (_hw) return _hw;
  if (process.platform !== "win32") return (_hw = {});
  try { _hw = parseHw(execFileSync("powershell.exe", PS_ARGS, { encoding: "utf8", windowsHide: true, timeout: 20000 })); }
  catch (e) { log("hw info", e.message); _hw = {}; }
  return _hw;
}
if (process.platform === "win32") execFile("powershell.exe", PS_ARGS, { windowsHide: true, timeout: 20000 }, (err, out) => { if (!_hw) _hw = err ? null : parseHw(out); });
const h4 = (x) => crypto.createHash("sha256").update(x).digest("hex").slice(0, 4).toUpperCase();
let _deviceId = null;
function deviceId() {
  if (_deviceId) return _deviceId;
  const hw = hwInfoSync();
  const mg = machineGuid(); // fallback for a part that reports no serial (changes only with a Windows reinstall)
  const parts = [
    clean(hw.uuid) || (clean(hw.board) && clean(hw.boardMaker) + "|" + clean(hw.board)) || "mg:" + mg,
    (clean(hw.cpu) && clean(hw.cpu) + "|" + clean(hw.cpuName)) || "mg:" + mg + ":cpu",
    clean(hw.disk) || "mg:" + mg + ":disk",
  ];
  log("device parts", parts.map((p, i) => (p.startsWith("mg:") ? `${i}:fallback` : `${i}:hw`)).join(" "));
  const abc = parts.map((p, i) => h4(`mizan-part-${i}|${p}`)).join("-");
  return (_deviceId = abc + "-" + h4("mizan-dev-ck|" + abc));
}
function lanUrls(port) {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => `http://${i.address}:${port}`);
}

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

// ── full backups of the local database (the pgdata folder, copied while PostgreSQL is stopped) ──
const dataDirOf = () => path.join(userData, "pgdata");
const autoBackupDir = () => path.join(userData, "backups");
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
function writeBackup(destRoot) {
  const src = dataDirOf();
  if (!fs.existsSync(path.join(src, "PG_VERSION"))) throw new Error("لا توجد قاعدة بيانات محلية بعد");
  const dest = path.join(destRoot, `Mizan-Backup-${stamp()}`);
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, path.join(dest, "pgdata"), { recursive: true, filter: (f) => !/postmaster\.pid$/.test(f) });
  const c = readCfg();
  // the database password lives in the config — it is needed to open these files again
  fs.writeFileSync(path.join(dest, "mizan-backup.json"), JSON.stringify({ app: "Mizan ERP", version: app.getVersion(), createdAt: new Date().toISOString(), computer: os.hostname(), deviceId: deviceId(), dbPassword: c.local && c.local.dbPassword, jwtSecret: c.local && c.local.jwtSecret }, null, 2));
  return dest;
}
/** Daily automatic copy into %APPDATA%\Mizan ERP\backups before the database starts; keeps the last 7. */
function autoBackup(cfg) {
  try {
    if (!fs.existsSync(path.join(dataDirOf(), "PG_VERSION"))) return;
    const last = cfg.local && cfg.local.lastAutoBackup ? new Date(cfg.local.lastAutoBackup).getTime() : 0;
    if (Date.now() - last < 20 * 3600 * 1000) return;
    showStatus("نسخة احتياطية يومية تلقائية…");
    const d = writeBackup(autoBackupDir());
    cfg.local.lastAutoBackup = new Date().toISOString(); writeCfg(cfg);
    const all = fs.readdirSync(autoBackupDir()).filter((n) => n.startsWith("Mizan-Backup-")).sort();
    for (const old of all.slice(0, Math.max(0, all.length - 7))) fs.rmSync(path.join(autoBackupDir(), old), { recursive: true, force: true });
    log("auto backup", d);
  } catch (e) { log("auto backup failed", e.message); }
}
async function backupNow() {
  const r = await dialog.showOpenDialog(win, { title: "اختر مجلد حفظ النسخة الاحتياطية (يفضَّل فلاشة أو قرص خارجي أو OneDrive)", properties: ["openDirectory", "createDirectory"] });
  if (r.canceled || !r.filePaths[0]) return;
  const ok = await dialog.showMessageBox(win, { type: "question", buttons: ["إلغاء", "متابعة"], defaultId: 1, cancelId: 0, title: APP_TITLE, message: "سيُغلق البرنامج قاعدة البيانات لحظياً لأخذ نسخة كاملة ثم يعيد التشغيل.", detail: "إذا كانت المشاركة على الشبكة مفعّلة فأبلغ المستخدمين الآخرين بحفظ عملهم أولاً." });
  if (ok.response !== 1) return;
  const c = readCfg(); c.pendingBackup = r.filePaths[0]; writeCfg(c);
  quitting = true; await stopLocal(); app.relaunch(); app.exit(0);
}
async function restoreBackup() {
  const r = await dialog.showOpenDialog(win, { title: "اختر مجلد النسخة الاحتياطية (Mizan-Backup-…)", properties: ["openDirectory"], defaultPath: autoBackupDir() });
  if (r.canceled || !r.filePaths[0]) return;
  const dir = r.filePaths[0];
  let meta;
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, "mizan-backup.json"), "utf8")); } catch { meta = null; }
  if (!meta || !fs.existsSync(path.join(dir, "pgdata", "PG_VERSION"))) return dialog.showErrorBox(APP_TITLE, "هذا المجلد ليس نسخة احتياطية من ميزان (يجب أن يحتوي على pgdata و mizan-backup.json).");
  const ok = await dialog.showMessageBox(win, { type: "warning", buttons: ["إلغاء", "استعادة"], defaultId: 0, cancelId: 0, title: APP_TITLE, message: `استعادة النسخة المأخوذة في ${String(meta.createdAt).slice(0, 16).replace("T", " ")}؟`, detail: "ستحل محل البيانات الحالية. البيانات الحالية لا تُحذف بل تُنقل إلى مجلد pgdata-before-restore-… داخل مجلد البرنامج." });
  if (ok.response !== 1) return;
  const c = readCfg(); c.pendingRestore = dir; writeCfg(c);
  quitting = true; await stopLocal(); app.relaunch(); app.exit(0);
}
/** Runs queued backup/restore while PostgreSQL is not running (start of local mode). */
function runPending(cfg) {
  if (cfg.pendingBackup) {
    const to = cfg.pendingBackup; delete cfg.pendingBackup; writeCfg(cfg);
    try { const d = writeBackup(to); dialog.showMessageBox({ type: "info", title: APP_TITLE, message: "تم حفظ النسخة الاحتياطية", detail: d }); }
    catch (e) { dialog.showErrorBox(APP_TITLE, "تعذّر حفظ النسخة الاحتياطية:\n" + e.message); }
  }
  if (cfg.pendingRestore) {
    const from = cfg.pendingRestore; delete cfg.pendingRestore; writeCfg(cfg);
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(from, "mizan-backup.json"), "utf8"));
      if (fs.existsSync(dataDirOf())) fs.renameSync(dataDirOf(), path.join(userData, `pgdata-before-restore-${stamp()}`));
      fs.cpSync(path.join(from, "pgdata"), dataDirOf(), { recursive: true });
      cfg.local = { ...cfg.local, dbPassword: meta.dbPassword || cfg.local.dbPassword, jwtSecret: meta.jwtSecret || cfg.local.jwtSecret };
      writeCfg(cfg);
      log("restored from", from);
    } catch (e) { dialog.showErrorBox(APP_TITLE, "تعذّرت الاستعادة:\n" + e.message); }
  }
}

// ── local mode: embedded PostgreSQL + Mizan server in this process ─────────
async function startLocal(cfg) {
  const EmbeddedPostgres = require("embedded-postgres").default || require("embedded-postgres");
  const dataDir = path.join(userData, "pgdata");
  if (!cfg.local) cfg.local = { dbPassword: crypto.randomBytes(18).toString("hex"), jwtSecret: crypto.randomBytes(32).toString("hex"), dbPort: 54329, appPort: 3517 };
  writeCfg(cfg);
  runPending(cfg);
  autoBackup(cfg);
  const dbPort = await freePort(cfg.local.dbPort);
  const lan = !!cfg.local.lan;
  // a shared (LAN) server keeps a fixed port so the other PCs always find it
  const appPort = lan ? cfg.local.appPort : await freePort(cfg.local.appPort);
  if (lan && (await freePort(appPort)) !== appPort) throw new Error(`المنفذ ${appPort} مستخدم من برنامج آخر — أغلقه أو أوقف المشاركة على الشبكة`);
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
  process.env.MIZAN_DEVICE_ID = deviceId();
  // local only by default; "share on the local network" lets the office PCs connect to this one
  process.env.HOST = lan ? "0.0.0.0" : "127.0.0.1";
  process.env.PUBLIC_URL = (lan && lanUrls(appPort)[0]) || `http://127.0.0.1:${appPort}`;
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
        { label: "معرّف الجهاز (للترخيص)…", click: async () => {
          const r = await dialog.showMessageBox(win, { type: "info", buttons: ["إغلاق", "نسخ المعرّف"], defaultId: 1, cancelId: 0, title: APP_TITLE, message: `معرّف هذا الجهاز: ${deviceId()}`, detail: `اسم الجهاز: ${os.hostname()}\n\nأرسل هذا المعرّف لمزود النظام للحصول على مفتاح ترخيص (MZD-…) يعمل على هذا الجهاز فقط، ثم فعّله من الإعدادات ← الاشتراك والترخيص.` });
          if (r.response === 1) require("electron").clipboard.writeText(deviceId());
        } },
        ...(cfg.mode === "local" ? [
          { label: "مشاركة على الشبكة المحلية (جهاز رئيسي)", type: "checkbox", checked: !!(cfg.local && cfg.local.lan), click: async (item) => {
            const on = item.checked;
            const r = await dialog.showMessageBox(win, { type: "question", buttons: ["إلغاء", on ? "تفعيل وإعادة التشغيل" : "إيقاف وإعادة التشغيل"], defaultId: 1, cancelId: 0, title: APP_TITLE,
              message: on ? "السماح لأجهزة الشبكة بالاتصال بهذا الجهاز؟" : "إيقاف المشاركة على الشبكة؟",
              detail: on ? "يصبح هذا الجهاز خادماً للأجهزة الأخرى في نفس الشبكة (كل مستخدم بحسابه وصلاحياته). عند ظهور تنبيه جدار حماية ويندوز اختر «السماح» للشبكات الخاصة. يجب أن يبقى هذا الجهاز يعمل أثناء عمل الآخرين." : "لن تتمكن الأجهزة الأخرى من الاتصال، والبيانات تبقى كما هي." });
            if (r.response !== 1) { item.checked = !on; return; }
            const c = readCfg(); c.local = { ...(c.local || {}), lan: on }; writeCfg(c);
            quitting = true; await stopLocal(); app.relaunch(); app.exit(0);
          } },
          { label: "عنوان الاتصال من الأجهزة الأخرى…", enabled: !!(cfg.local && cfg.local.lan), click: () => {
            const urls = lanUrls(readCfg().local.appPort);
            dialog.showMessageBox(win, { type: "info", title: APP_TITLE, message: "عنوان هذا الجهاز على الشبكة", detail: (urls.join("\n") || "لا يوجد اتصال بشبكة") + "\n\nعلى الأجهزة الأخرى: ثبّت ميزان ← «الوضع السحابي» ← «خادم مخصص أو جهاز رئيسي» والصق العنوان، أو افتحه من المتصفح." });
          } },
        ] : []),
        ...(cfg.mode === "local" ? [
          { type: "separator" },
          { label: "نسخة احتياطية كاملة الآن…", click: () => backupNow() },
          { label: "استعادة نسخة احتياطية…", click: () => restoreBackup() },
          { label: "فتح مجلد النسخ التلقائية", click: () => { fs.mkdirSync(autoBackupDir(), { recursive: true }); shell.openPath(autoBackupDir()); } },
        ] : []),
        { type: "separator" },
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
ipcMain.handle("get-config", () => { const c = readCfg(); return { mode: c.mode, cloudUrl: c.cloudUrl, defaultCloud: DEFAULT_CLOUD, version: app.getVersion(), deviceId: deviceId() }; });
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
