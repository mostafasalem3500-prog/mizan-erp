/**
 * Error monitoring and service status.
 *
 * Unexpected server errors (5xx) and errors reported by the browser are stored in app_errors, one row per kind of
 * error per day with a count (the fingerprint drops numbers and ids, so the same fault on different records groups
 * together). A ceiling per minute keeps a burst from filling the table; rows older than 30 days are removed.
 * The status page shows only health figures — no error text, no names.
 */
import crypto from "node:crypto";
import { pool } from "../db/pool";

const started = Date.now();
let selfcheck: { ok: boolean; passed: number; total: number; at: string } | null = null;
const beats: Record<string, string> = {};
export const setSelfcheck = (r: { ok: boolean; passed: number; failed: number }) => { selfcheck = { ok: r.ok, passed: r.passed, total: r.passed + r.failed, at: new Date().toISOString() }; };
export const beat = (name: string) => { beats[name] = new Date().toISOString(); };

const cut = (v: any, n: number) => (v === undefined || v === null ? null : String(v).slice(0, n));
const shape = (s: string) => s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{27}/gi, ":id").replace(/\d+/g, "#");
let window0 = 0, inWindow = 0;
const PER_MINUTE = 120;

export type ErrorInput = { source: "server" | "client"; message: string; stack?: string | null; path?: string | null; method?: string | null; status?: number | null; version?: string | null; userAgent?: string | null; companyId?: string | null; userId?: string | null };

export async function recordError(e: ErrorInput) {
  const now = Date.now();
  if (now - window0 > 60_000) { window0 = now; inWindow = 0; }
  if (++inWindow > PER_MINUTE) return;
  const message = cut(e.message, 500) || "خطأ بلا رسالة";
  const stack = cut(e.stack, 4000);
  const frame = (stack || "").split("\n").find((l) => /\bat\b|@/.test(l)) || "";
  const path = cut(e.path, 300);
  const fingerprint = crypto.createHash("sha1").update([e.source, shape(message), shape(frame.trim()), shape((path || "").split("?")[0])].join("|")).digest("hex");
  try {
    await pool.query(
      `INSERT INTO app_errors (fingerprint, source, message, stack, path, method, status, version, user_agent, company_id, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (fingerprint, day) DO UPDATE SET count = app_errors.count + 1, last_at = now(), path = EXCLUDED.path, stack = COALESCE(EXCLUDED.stack, app_errors.stack)`,
      [fingerprint, e.source, message, stack, path, cut(e.method, 10), e.status ?? null, cut(e.version, 40), cut(e.userAgent, 300), e.companyId || null, e.userId || null]);
    if (Math.random() < 0.02) await pool.query(`DELETE FROM app_errors WHERE day < CURRENT_DATE - 30`);
  } catch { /* monitoring must never break the request that failed */ }
}

export async function listErrors(days = 7) {
  const rows = (await pool.query(
    `SELECT e.*, c.name_ar company_name FROM app_errors e LEFT JOIN companies c ON c.id=e.company_id
      WHERE e.day >= CURRENT_DATE - $1::int ORDER BY e.last_at DESC LIMIT 300`, [days])).rows;
  const sum = (await pool.query(`SELECT source, SUM(count)::int n FROM app_errors WHERE last_at > now() - interval '24 hours' GROUP BY 1`)).rows;
  return { rows, last24h: Object.fromEntries(sum.map((r: any) => [r.source, r.n])), performance: perfStats() };
}

export async function status(version: string) {
  let db: { ok: boolean; ms: number | null } = { ok: false, ms: null };
  const t0 = Date.now();
  try { await pool.query("SELECT 1"); db = { ok: true, ms: Date.now() - t0 }; } catch { /* reported as down */ }
  let errors24h = 0;
  try { errors24h = Number((await pool.query(`SELECT COALESCE(SUM(count),0)::int n FROM app_errors WHERE source='server' AND last_at > now() - interval '24 hours'`)).rows[0].n); } catch { /* table missing on a fresh boot */ }
  const ok = db.ok && (!selfcheck || selfcheck.ok);
  const pf = perfStats(0);
  return { ok, version, uptimeSeconds: Math.round((Date.now() - started) / 1000), database: db, selfcheck, schedulers: beats, serverErrors24h: errors24h, responseMs: { median: pf.medianMs, p95: pf.p95Ms, requests: pf.requests }, time: new Date().toISOString() };
}

const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dur = (s: number) => (s >= 86400 ? `${Math.floor(s / 86400)} يوم` : s >= 3600 ? `${Math.floor(s / 3600)} ساعة` : `${Math.floor(s / 60)} دقيقة`);
/** The public status page: plain HTML, no script, readable in both languages. */
export function statusHtml(s: Awaited<ReturnType<typeof status>>, appName: string) {
  const row = (ar: string, en: string, good: boolean | null, value: string) =>
    `<tr><td>${ar}<div class="en">${en}</div></td><td class="v">${value}</td><td class="s ${good === null ? "" : good ? "ok" : "bad"}">${good === null ? "—" : good ? "✓" : "✗"}</td></tr>`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>حالة الخدمة — ${esc(appName)}</title><style>
body{font-family:system-ui,"Segoe UI",Tahoma,sans-serif;background:#f3f6f5;color:#16302d;margin:0;padding:24px}main{max-width:720px;margin:0 auto}
.head{background:${s.ok ? "#0f766e" : "#b91c1c"};color:#fff;border-radius:12px;padding:20px 22px}.head h1{margin:0 0 4px;font-size:22px}.head .en{opacity:.85}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;margin-top:16px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
td{padding:12px 14px;border-bottom:1px solid #e3ebe9;vertical-align:top}.v{font-variant-numeric:tabular-nums;direction:ltr;text-align:left}.s{width:30px;text-align:center;font-weight:700}
.ok{color:#15803d}.bad{color:#b91c1c}.en{color:#667;font-size:12px;direction:ltr;text-align:right}p.small{color:#667;font-size:12px}
</style></head><body><main>
<div class="head"><h1>${s.ok ? "الخدمة تعمل بشكل طبيعي" : "الخدمة تواجه مشكلة"}</h1><div class="en">${s.ok ? "All systems operational" : "Service degraded"} · ${esc(appName)}</div></div>
<table>
${row("قاعدة البيانات", "Database", s.database.ok, s.database.ok ? `${s.database.ms} ms` : "down")}
${row("الفحص الذاتي للمحرك المحاسبي", "Accounting engine self-check", s.selfcheck ? s.selfcheck.ok : null, s.selfcheck ? `${s.selfcheck.passed}/${s.selfcheck.total}` : "pending")}
${row("أخطاء الخادم آخر 24 ساعة", "Server errors, last 24 hours", s.serverErrors24h === 0, String(s.serverErrors24h))}
${row("زمن الاستجابة (الوسيط / 95%)", "Response time (median / 95th percentile)", s.responseMs.requests ? s.responseMs.p95 < 1500 : null, s.responseMs.requests ? `${s.responseMs.median} / ${s.responseMs.p95} ms` : "—")}
${row("مدة التشغيل منذ آخر تحديث", "Uptime since last release", null, esc(dur(s.uptimeSeconds)))}
${row("الإصدار", "Version", null, esc(s.version))}
</table>
<p class="small">آخر تحديث للصفحة ${esc(s.time.slice(0, 16).replace("T", " "))} UTC — <a href="/api/status">JSON</a></p>
</main></body></html>`;
}

// ─── response times (since the server started; kept in memory) ───
type Perf = { count: number; total: number; max: number; slow: number; recent: number[] };
const perf = new Map<string, Perf>();
const recentAll: number[] = [];
const SLOW_MS = 1500;
/** One finished API request. `key` is the route pattern (ids collapsed), so the same screen's calls group together. */
export function trackRequest(method: string, key: string, ms: number) {
  const k = `${method} ${key}`;
  let p = perf.get(k);
  if (!p) { if (perf.size > 600) return; p = { count: 0, total: 0, max: 0, slow: 0, recent: [] }; perf.set(k, p); }
  p.count++; p.total += ms; if (ms > p.max) p.max = ms; if (ms >= SLOW_MS) p.slow++;
  p.recent.push(ms); if (p.recent.length > 200) p.recent.shift();
  recentAll.push(ms); if (recentAll.length > 2000) recentAll.shift();
}
const pct = (xs: number[], q: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]); };
/** The slowest routes by their 95th percentile, and the overall median / 95th percentile of the last 2,000 requests. */
export function perfStats(limit = 20) {
  const rows = [...perf.entries()].map(([route, p]) => ({ route, count: p.count, avgMs: Math.round(p.total / p.count), p95Ms: pct(p.recent, 0.95), maxMs: Math.round(p.max), slow: p.slow }))
    .sort((a, b) => b.p95Ms - a.p95Ms).slice(0, limit);
  return { since: new Date(started).toISOString(), requests: recentAll.length, medianMs: pct(recentAll, 0.5), p95Ms: pct(recentAll, 0.95), slowMs: SLOW_MS, rows };
}
/** Collapses ids and numbers in a path so /invoices/5f…/post and /invoices/9a…/post count as one route. */
export const routeKey = (path: string) => path.split("?")[0].replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{27}/gi, ":id").replace(/\/\d+(?=\/|$)/g, "/:n").slice(0, 120);
