#!/usr/bin/env node
/**
 * Load test: N simulated users work at the same time for D seconds against one server, each repeating a realistic mix of
 * screens (home, lists, reports, the management dashboard, the written report) and — optionally — point-of-sale sales.
 * Every user has its own establishment with the demo data, so the database holds as many companies as users.
 *
 *   node tools/loadtest/load.mjs --base http://127.0.0.1:3100 --users 20 --seconds 60 [--sales]
 *
 * Prints per-endpoint count, median, 95th percentile, max and errors, and the overall requests per second.
 */
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] ?? true : d; };
const BASE = String(arg("base", "http://127.0.0.1:3100")) + "/api", USERS = Number(arg("users", 20)), SECONDS = Number(arg("seconds", 60)), SALES = process.argv.includes("--sales");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(path, tok, body) {
  const r = await fetch(BASE + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${r.status} ${path} ${JSON.stringify(j).slice(0, 120)}`);
  return j;
}
async function setup(i) {
  const st = Date.now() + "" + i;
  const r = await call("/auth/register", null, { fullName: "حمل " + i, companyName: "load " + st, email: `load${st}@t.sa`, password: "Passw0rd!1" });
  await call("/demo/load", r.token, {});
  for (let k = 0; k < 400; k++) { const s = await call("/demo/status", r.token); if (s.demoLoaded) break; await sleep(1500); }
  const pr = await call("/products?limit=50", r.token);
  const prods = (Array.isArray(pr) ? pr : pr.rows || []).filter((p) => p.type === "STOCK" && Number(p.qty) > 30);
  let session = null;
  if (SALES) { const s = await call("/pos/session/open", r.token, { openingCash: 0 }).catch((e) => { console.error("session", e.message); return null; }); session = s?.session || s; }
  return { tok: r.token, prods, session };
}
const today = new Date().toISOString().slice(0, 10), y0 = today.slice(0, 4) + "-01-01", m0 = today.slice(0, 8) + "01";
const MIX = [
  ["home /dashboard", "/dashboard", 6], ["home /brief", "/brief", 4], ["sales invoices list", "/invoices?direction=SALE&limit=50", 6], ["products list", "/products?limit=50", 5],
  ["customers list", "/partners?role=CUSTOMER&limit=50", 4], ["journal list", "/journals?limit=50", 3], ["trial balance (year)", `/reports/trial-balance?from=${y0}&to=${today}`, 3],
  ["income statement (year)", `/reports/income?from=${y0}&to=${today}`, 2], ["management dashboard (month)", `/analytics/executive?from=${m0}&to=${today}`, 2],
  ["financial analysis (year)", `/analysis/financial?from=${y0}&to=${today}`, 1], ["written report (year)", `/reports/financial-report?from=${y0}&to=${today}`, 1], ["aging", `/reports/aging?role=CUSTOMER&to=${today}`, 2],
];
const bag = MIX.flatMap(([n, p, w]) => Array(w).fill([n, p]));
const stats = new Map();
const rec = (k, ms, err) => { const s = stats.get(k) || { t: [], e: 0, msg: "" }; if (err) { s.e++; s.msg = String(err.message || err).slice(0, 140); } else s.t.push(ms); stats.set(k, s); };
async function user(u, until) {
  while (Date.now() < until) {
    let name, path, body;
    if (SALES && u.session && u.prods.length && Math.random() < 0.15) { const p = u.prods[Math.floor(Math.random() * u.prods.length)]; name = "POS sale (write)"; path = "/pos/sale"; body = { sessionId: u.session.id, lines: [{ productId: p.id, qty: 1 }], tenders: [{ method: "CASH", amount: null }] }; }
    else [name, path] = bag[Math.floor(Math.random() * bag.length)];
    const t0 = performance.now();
    try { await call(path, u.tok, body); rec(name, performance.now() - t0); } catch (e) { rec(name, 0, e); }
    await sleep(100 + Math.random() * 400); // think time between clicks
  }
}
const q = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;
console.log(`setting up ${USERS} establishments with demo data on ${BASE} …`);
const t0 = Date.now(); const us = [];
for (let i = 0; i < USERS; i += 5) us.push(...(await Promise.all(Array.from({ length: Math.min(5, USERS - i) }, (_, k) => setup(i + k)))));
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(0)} s — ${USERS} users for ${SECONDS} s${SALES ? " with POS sales" : ""}`);
const start = Date.now(); await Promise.all(us.map((u) => user(u, start + SECONDS * 1000))); const dur = (Date.now() - start) / 1000;
let n = 0, errs = 0; const rows = [];
for (const [k, s] of stats) { s.t.sort((a, b) => a - b); n += s.t.length; errs += s.e; rows.push([k, s.t.length, q(s.t, 0.5), q(s.t, 0.95), s.t[s.t.length - 1] || 0, s.e, s.msg]); }
rows.sort((a, b) => b[3] - a[3]);
console.log("\nendpoint".padEnd(34) + "count".padStart(7) + "median".padStart(9) + "p95".padStart(9) + "max".padStart(9) + "errors".padStart(8));
for (const r of rows) console.log(String(r[0]).padEnd(33) + String(r[1]).padStart(7) + r[2].toFixed(0).padStart(8) + "ms" + r[3].toFixed(0).padStart(7) + "ms" + r[4].toFixed(0).padStart(7) + "ms" + String(r[5]).padStart(8) + (r[6] ? "  " + r[6] : ""));
console.log(`\n${n} requests in ${dur.toFixed(0)} s = ${(n / dur).toFixed(1)} req/s · errors ${errs}`);
