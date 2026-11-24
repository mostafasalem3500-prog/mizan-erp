/**
 * 3.47.0
 *  • Category tree: main and sub categories with an icon, an order and visibility at the till; merge, move items,
 *    and the profitability of each category rolled up to its parent.
 *  • Business pulse for the home screen: the period against the previous one, with a daily (or hourly) series.
 *  • Smart observations: what changed, what is running out, what is costing more — each with the question to ask.
 *  • Peak hours (weekday × hour) and a sales breakdown by any dimension, for the dashboard and the assistant.
 */
import { Db } from "../db/pool";
import { bad, conflict, num, r2, r3, isDate, today, addDays } from "../lib/core";
import { IS_EG } from "../lib/country";
import { incomeStatement } from "./reports";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (d: any) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
export const TZ = IS_EG ? "Africa/Cairo" : "Asia/Riyadh";
/** SQL: the given category ids and every sub category below them. */
export const CAT_TREE = (param = "?") => `(WITH RECURSIVE ct AS (SELECT id FROM product_categories WHERE id = ANY(${param}::uuid[]) UNION SELECT c.id FROM product_categories c JOIN ct ON c.parent_id=ct.id) SELECT id FROM ct)`;
const SIGN = "CASE WHEN i.kind='CREDIT_NOTE' THEN -1 ELSE 1 END";
const SALES = `i.company_id=$1 AND i.direction='SALE' AND i.status='POSTED' AND i.kind IN ('INVOICE','CREDIT_NOTE')`;

// ───────────────────────── categories ─────────────────────────
export async function listCategories(t: Db, C: string) {
  const rows = await t.rows(`SELECT c.id, c.name, c.color, c.icon, c.parent_id, c.sort, c.is_active, c.is_demo,
      (SELECT COUNT(*)::int FROM products p WHERE p.category_id=c.id) count FROM product_categories c WHERE c.company_id=$1 ORDER BY c.sort, c.name`, [C]);
  const by = new Map(rows.map((r: any) => [r.id, r]));
  const depth = (r: any, n = 0): number => (r.parentId && by.has(r.parentId) && n < 6 ? depth(by.get(r.parentId), n + 1) : n);
  const path = (r: any, n = 0): string => (r.parentId && by.has(r.parentId) && n < 6 ? path(by.get(r.parentId), n + 1) + " › " : "") + r.name;
  // tree order: each parent followed by its children
  const out: any[] = [];
  const walk = (pid: string | null, n = 0) => { if (n > 6) return; for (const r of rows.filter((x: any) => (x.parentId || null) === pid || (pid === null && x.parentId && !by.has(x.parentId)))) { if (out.includes(r)) continue; out.push(r); walk(r.id, n + 1); } };
  walk(null);
  for (const r of rows) if (!out.includes(r)) out.push(r);
  return out.map((r: any) => ({ ...r, depth: depth(r), path: path(r), children: rows.filter((x: any) => x.parentId === r.id).length, total: r.count + rows.filter((x: any) => isBelow(x, r.id)).reduce((a: number, x: any) => a + x.count, 0) }));
  function isBelow(x: any, id: string, n = 0): boolean { return !!x.parentId && n < 6 && (x.parentId === id || (by.has(x.parentId) && isBelow(by.get(x.parentId), id, n + 1))); }
}

async function checkParent(t: Db, C: string, id: string | null, parentId: any) {
  if (!parentId) return null;
  if (!UUID.test(String(parentId))) throw bad("التصنيف الرئيسي غير صحيح");
  if (id && parentId === id) throw bad("التصنيف لا يكون رئيسياً لنفسه");
  const rows = await t.rows(`SELECT id, parent_id FROM product_categories WHERE company_id=$1`, [C]);
  const by = new Map(rows.map((r: any) => [r.id, r.parentId]));
  if (!by.has(parentId)) throw bad("التصنيف الرئيسي غير موجود");
  let cur: any = parentId, chain = 0;
  while (cur && chain < 10) { if (id && cur === id) throw bad("لا يصح: التصنيف الرئيسي المختار يقع تحت هذا التصنيف"); chain++; cur = by.get(cur); }
  // levels = the parent's chain + this category + the deepest branch below it
  const height = (x: string, n = 0): number => (n > 6 ? 0 : Math.max(0, ...rows.filter((r: any) => r.parentId === x).map((r: any) => 1 + height(r.id, n + 1))));
  if (chain + 1 + (id ? height(id) : 0) > 3) throw bad("التصنيفات حتى ثلاثة مستويات (رئيسي ← فرعي ← فرعي)");
  return String(parentId);
}
const clean = (b: any) => ({ name: String(b.name ?? "").trim().slice(0, 60), color: /^#[0-9a-fA-F]{6}$/.test(String(b.color || "")) ? String(b.color) : null, icon: b.icon ? Array.from(String(b.icon).trim()).slice(0, 3).join("") : null });

export async function saveCategory(t: Db, C: string, b: any, id?: string) {
  const c = clean(b);
  if (!c.name) throw bad("اسم التصنيف مطلوب");
  const dup = await t.maybe(`SELECT id FROM product_categories WHERE company_id=$1 AND lower(name)=lower($2) AND id <> COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000')`, [C, c.name, id && UUID.test(id) ? id : null]);
  if (dup) throw conflict(`يوجد تصنيف بالاسم «${c.name}»`);
  const parentId = await checkParent(t, C, id || null, b.parentId);
  const row: any = { name: c.name, color: c.color, icon: c.icon, parentId, isActive: b.isActive !== false };
  if (b.sort !== undefined) row.sort = Math.round(num(b.sort));
  if (id) { await t.one(`SELECT id FROM product_categories WHERE id=$1 AND company_id=$2`, [UUID.test(id) ? id : null, C], "التصنيف غير موجود"); return t.update("product_categories", { id, companyId: C }, row); }
  const n = await t.one(`SELECT COALESCE(MAX(sort),0)+1 s FROM product_categories WHERE company_id=$1`, [C]);
  return t.insert("product_categories", { companyId: C, ...row, sort: row.sort ?? Number(n.s) });
}

/** Deleting a category: its items and sub categories move up to its parent (or become uncategorised). */
export async function deleteCategory(t: Db, C: string, id: string) {
  const c = await t.one(`SELECT id, parent_id FROM product_categories WHERE id=$1 AND company_id=$2`, [UUID.test(id) ? id : null, C], "التصنيف غير موجود");
  await t.exec(`UPDATE products SET category_id=$2 WHERE category_id=$1 AND company_id=$3`, [c.id, c.parentId || null, C]);
  await t.exec(`UPDATE product_categories SET parent_id=$2 WHERE parent_id=$1 AND company_id=$3`, [c.id, c.parentId || null, C]);
  await t.exec(`DELETE FROM product_categories WHERE id=$1`, [c.id]);
  return { ok: true };
}

export async function mergeCategory(t: Db, C: string, id: string, into: string) {
  if (id === into) throw bad("اختر تصنيفاً آخر للدمج فيه");
  const a = await t.one(`SELECT id, name FROM product_categories WHERE id=$1 AND company_id=$2`, [UUID.test(id) ? id : null, C], "التصنيف غير موجود");
  const b = await t.one(`SELECT id, name FROM product_categories WHERE id=$1 AND company_id=$2`, [UUID.test(String(into)) ? into : null, C], "التصنيف المدموج فيه غير موجود");
  await checkParent(t, C, a.id, b.id).catch(() => { throw bad(`لا يصح دمج «${a.name}» في تصنيف يقع تحته`); });
  const moved = await t.one(`WITH u AS (UPDATE products SET category_id=$2 WHERE category_id=$1 AND company_id=$3 RETURNING 1) SELECT COUNT(*)::int n FROM u`, [a.id, b.id, C]);
  await t.exec(`UPDATE product_categories SET parent_id=$2 WHERE parent_id=$1 AND company_id=$3`, [a.id, b.id, C]);
  await t.exec(`DELETE FROM product_categories WHERE id=$1`, [a.id]);
  return { merged: a.name, into: b.name, items: moved.n };
}

export async function reorderCategories(t: Db, C: string, ids: any) {
  const list = (Array.isArray(ids) ? ids : []).filter((x: any) => UUID.test(String(x)));
  let i = 1; for (const id of list) await t.exec(`UPDATE product_categories SET sort=$3 WHERE id=$1 AND company_id=$2`, [id, C, i++]);
  return { ok: true, count: list.length };
}

export async function moveProducts(t: Db, C: string, productIds: any, categoryId: any) {
  const ids = (Array.isArray(productIds) ? productIds : []).filter((x: any) => UUID.test(String(x)));
  if (!ids.length) throw bad("اختر الأصناف");
  if (categoryId) await t.one(`SELECT id FROM product_categories WHERE id=$1 AND company_id=$2`, [UUID.test(String(categoryId)) ? categoryId : null, C], "التصنيف غير موجود");
  const r = await t.one(`WITH u AS (UPDATE products SET category_id=$3 WHERE company_id=$1 AND id = ANY($2::uuid[]) RETURNING 1) SELECT COUNT(*)::int n FROM u`, [C, ids, categoryId || null]);
  return { moved: r.n };
}

/** Sales, cost, margin, stock and items of each category over a period, each parent including what is below it. */
export async function categoryStats(t: Db, C: string, q: { from?: string; to?: string }) {
  const to = isDate(q.to) ? String(q.to) : today(), from = isDate(q.from) ? String(q.from) : addDays(to, -29);
  const cats = await listCategories(t, C);
  const sales = await t.rows(`SELECT p.category_id id, SUM(l.qty*COALESCE(l.factor,1)*${SIGN}) qty, SUM(l.net_amount*COALESCE(i.exchange_rate,1)*${SIGN}) net, SUM(CASE WHEN i.kind='INVOICE' THEN l.qty*COALESCE(l.factor,1)*l.unit_cost ELSE 0 END) cost, COUNT(DISTINCT i.id)::int docs
      FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id JOIN products p ON p.id=l.product_id WHERE ${SALES} AND i.date BETWEEN $2 AND $3 GROUP BY p.category_id`, [C, from, to]);
  const stock = await t.rows(`SELECT p.category_id id, SUM(b.value) value FROM stock_balances b JOIN products p ON p.id=b.product_id WHERE b.company_id=$1 GROUP BY p.category_id`, [C]);
  const S = new Map(sales.map((r: any) => [r.id || "none", r])), V = new Map(stock.map((r: any) => [r.id || "none", r]));
  const by = new Map(cats.map((c: any) => [c.id, c]));
  const own = (id: string) => ({ qty: Number(S.get(id)?.qty || 0), net: Number(S.get(id)?.net || 0), cost: Number(S.get(id)?.cost || 0), stock: Number(V.get(id)?.value || 0) });
  const below = (id: string, n = 0): string[] => (n > 6 ? [] : cats.filter((c: any) => c.parentId === id).flatMap((c: any) => [c.id, ...below(c.id, n + 1)]));
  const rows = cats.map((c: any) => {
    const ids = [c.id, ...below(c.id)]; const s = ids.map(own).reduce((a, x) => ({ qty: a.qty + x.qty, net: a.net + x.net, cost: a.cost + x.cost, stock: a.stock + x.stock }), { qty: 0, net: 0, cost: 0, stock: 0 });
    return { id: c.id, name: c.name, path: c.path, depth: c.depth, parentId: c.parentId, icon: c.icon, color: c.color, items: c.total, qty: r3(s.qty), revenue: r2(s.net), cost: r2(s.cost), profit: r2(s.net - s.cost), marginPct: s.net > 0 ? r2(((s.net - s.cost) / s.net) * 100) : null, stockValue: r2(s.stock) };
  });
  const none = own("none");
  const total = [...S.values()].reduce((a: number, r: any) => a + Number(r.net || 0), 0);
  for (const r of rows) (r as any).sharePct = total > 0 && !r.parentId ? r2((r.revenue / total) * 100) : null;
  return { from, to, rows, uncategorised: { revenue: r2(none.net), cost: r2(none.cost), profit: r2(none.net - none.cost), stockValue: r2(none.stock) }, totalRevenue: r2(total) };
}

// ───────────────────────── business pulse ─────────────────────────
export function periodOf(p: string, ref = today()) {
  const d = new Date(ref + "T00:00:00Z");
  const fmt = (x: Date) => x.toISOString().slice(0, 10);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  const shift = (from: string, to: string, back: (x: Date) => Date) => ({ from, to, pFrom: fmt(back(new Date(from + "T00:00:00Z"))), pTo: fmt(back(new Date(to + "T00:00:00Z"))) });
  const minusMonths = (n: number) => (x: Date) => { const z = new Date(x); const want = z.getUTCDate(); z.setUTCDate(1); z.setUTCMonth(z.getUTCMonth() - n); const last = new Date(Date.UTC(z.getUTCFullYear(), z.getUTCMonth() + 1, 0)).getUTCDate(); z.setUTCDate(Math.min(want, last)); return z; };
  if (p === "today") return { key: p, ...shift(ref, ref, (x) => new Date(x.getTime() - 7 * 864e5)), label: "اليوم", vs: "نفس اليوم الأسبوع الماضي" };
  if (p === "week") return { key: p, ...shift(addDays(ref, -6), ref, (x) => new Date(x.getTime() - 7 * 864e5)), label: "آخر 7 أيام", vs: "الأيام السبعة قبلها" };
  if (p === "quarter") { const qs = fmt(new Date(Date.UTC(y, m - (m % 3), 1))); return { key: p, ...shift(qs, ref, minusMonths(3)), label: "الربع حتى اليوم", vs: "نفس الفترة من الربع السابق" }; }
  if (p === "year") return { key: p, ...shift(`${y}-01-01`, ref, (x) => new Date(Date.UTC(x.getUTCFullYear() - 1, x.getUTCMonth(), x.getUTCDate()))), label: "السنة حتى اليوم", vs: "نفس الفترة من السنة الماضية" };
  return { key: "month", ...shift(fmt(new Date(Date.UTC(y, m, 1))), ref, minusMonths(1)), label: "الشهر حتى اليوم", vs: "نفس الفترة من الشهر الماضي", _day: day };
}

export async function pulse(t: Db, C: string, q: { period?: string; branchId?: string | null }) {
  const P = periodOf(String(q.period || "month"));
  const B = q.branchId && UUID.test(q.branchId) ? q.branchId : null;
  const [cur, prev] = await Promise.all([incomeStatement(t, C, { from: P.from, to: P.to, branchId: B }), incomeStatement(t, C, { from: P.pFrom, to: P.pTo, branchId: B })]);
  const docs = async (f: string, to: string) => t.one(`SELECT COUNT(*) FILTER (WHERE i.kind='INVOICE')::int n, COALESCE(SUM(i.taxable*COALESCE(i.exchange_rate,1)*${SIGN}),0) net, COUNT(DISTINCT i.partner_id) FILTER (WHERE i.kind='INVOICE')::int customers FROM invoices i WHERE ${SALES} AND i.date BETWEEN $2 AND $3 ${B ? "AND i.branch_id=$4" : ""}`, B ? [C, f, to, B] : [C, f, to]);
  const [dc, dp] = await Promise.all([docs(P.from, P.to), docs(P.pFrom, P.pTo)]);
  const coll = async (f: string, to: string) => Number((await t.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) v FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id WHERE e.company_id=$1 AND e.status='POSTED' AND a.system_key IN ('CASH','BANK') AND e.date BETWEEN $2 AND $3 AND l.debit > 0 AND e.source_type IN ('INVOICE','PAYMENT','POS_SESSION') ${B ? "AND e.branch_id=$4" : ""}`, B ? [C, f, to, B] : [C, f, to])).v);
  const [cc, cp] = await Promise.all([coll(P.from, P.to), coll(P.pFrom, P.pTo)]);
  const hourly = P.key === "today";
  const series = await t.rows(hourly
    ? `SELECT CASE WHEN (i.issued_at AT TIME ZONE '${TZ}')::date = i.date THEN EXTRACT(HOUR FROM i.issued_at AT TIME ZONE '${TZ}')::int END k, SUM(i.taxable*COALESCE(i.exchange_rate,1)*${SIGN}) net FROM invoices i WHERE ${SALES} AND i.date=$2 ${B ? "AND i.branch_id=$3" : ""} GROUP BY 1 ORDER BY 1`
    : `SELECT i.date::text k, SUM(i.taxable*COALESCE(i.exchange_rate,1)*${SIGN}) net FROM invoices i WHERE ${SALES} AND i.date BETWEEN $2 AND $3 ${B ? "AND i.branch_id=$4" : ""} GROUP BY 1 ORDER BY 1`,
    hourly ? (B ? [C, P.from, B] : [C, P.from]) : (B ? [C, P.from, P.to, B] : [C, P.from, P.to]));
  const sm = new Map(series.map((r: any) => [String(r.k), Number(r.net)]));
  let points: { k: string; v: number }[] = [];
  if (hourly) for (let h = 0; h < 24; h++) points.push({ k: String(h), v: r2(sm.get(String(h)) || 0) });
  else { let d = P.from; let guard = 0; while (d <= P.to && guard++ < 400) { points.push({ k: d, v: r2(sm.get(d) || 0) }); d = addDays(d, 1); } }
  if (P.key === "year" && points.length > 62) { const m = new Map<string, number>(); for (const x of points) m.set(x.k.slice(0, 7), (m.get(x.k.slice(0, 7)) || 0) + x.v); points = [...m.entries()].map(([k, v]) => ({ k, v: r2(v) })); }
  const ch = (a: number, b: number) => (Math.abs(b) > 0.005 ? r2(((a - b) / Math.abs(b)) * 100) : null);
  const k = (key: string, label: string, a: number, b: number, extra: any = {}) => ({ key, label, value: r2(a), prev: r2(b), changePct: ch(a, b), ...extra });
  const avg = (d: any) => (d.n > 0 ? Number(d.net) / d.n : 0);
  return { period: P.key, label: P.label, vs: P.vs, from: P.from, to: P.to, prevFrom: P.pFrom, prevTo: P.pTo, series: points, seriesBy: hourly ? "hour" : P.key === "year" && points.length && points[0].k.length === 7 ? "month" : "day",
    kpis: [
      k("sales", "صافي المبيعات", cur.netSales, prev.netSales),
      k("gross", "مجمل الربح", cur.grossProfit, prev.grossProfit, { marginPct: cur.grossMargin, prevMarginPct: prev.grossMargin }),
      k("net", "صافي الربح", cur.net, prev.net, { marginPct: cur.netMargin }),
      k("expenses", "المصروفات التشغيلية", cur.opex.total, prev.opex.total, { lowerIsBetter: true }),
      k("docs", "عدد فواتير البيع", dc.n, dp.n, { count: true }),
      k("ticket", "متوسط الفاتورة", avg(dc), avg(dp)),
      k("collected", "المتحصلات النقدية والبنكية", cc, cp),
      k("customers", "عملاء اشتروا", dc.customers, dp.customers, { count: true }),
    ] };
}

// ───────────────────────── peak hours ─────────────────────────
export async function heatmap(t: Db, C: string, q: { days?: number; branchId?: string | null }) {
  const days = Math.min(365, Math.max(7, Math.round(num(q.days) || 28)));
  const B = q.branchId && UUID.test(q.branchId) ? q.branchId : null;
  const rows = await t.rows(`SELECT EXTRACT(DOW FROM i.date)::int d, CASE WHEN (i.issued_at AT TIME ZONE '${TZ}')::date = i.date THEN EXTRACT(HOUR FROM i.issued_at AT TIME ZONE '${TZ}')::int END h, COUNT(*) FILTER (WHERE i.kind='INVOICE')::int n, SUM(i.taxable*COALESCE(i.exchange_rate,1)*${SIGN}) net
      FROM invoices i WHERE ${SALES} AND i.date > CURRENT_DATE - $2::int ${B ? "AND i.branch_id=$3" : ""} GROUP BY 1,2`, B ? [C, days, B] : [C, days]);
  const all = rows.map((r: any) => ({ day: r.d, hour: r.h, docs: r.n, net: r2(Number(r.net)) }));
  const cells = all.filter((c) => c.hour !== null && c.hour !== undefined);
  const max = Math.max(0, ...cells.map((c) => c.net));
  const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const byDay = DAYS.map((name, d) => ({ day: d, name, net: r2(all.filter((c) => c.day === d).reduce((a, c) => a + c.net, 0)), docs: all.filter((c) => c.day === d).reduce((a, c) => a + c.docs, 0) }));
  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, net: r2(cells.filter((c) => c.hour === h).reduce((a, c) => a + c.net, 0)), docs: cells.filter((c) => c.hour === h).reduce((a, c) => a + c.docs, 0) }));
  const peak = cells.reduce((a: any, c) => (!a || c.docs > a.docs || (c.docs === a.docs && c.net > a.net) ? c : a), null);
  const bestDay = byDay.reduce((a, c) => (c.net > a.net ? c : a), byDay[0]);
  const quiet = byHour.filter((h) => h.docs > 0).reduce((a: any, c) => (!a || c.net < a.net ? c : a), null);
  return { days, cells, max, byDay, byHour, peak: peak ? { ...peak, dayName: DAYS[peak.day] } : null, bestDay: bestDay.net > 0 ? bestDay : null, quietHour: quiet, timed: cells.reduce((a, c) => a + c.docs, 0), untimed: all.filter((c) => c.hour === null || c.hour === undefined).reduce((a, c) => a + c.docs, 0), hours: [Math.min(...byHour.filter((h) => h.docs).map((h) => h.hour), 24), Math.max(...byHour.filter((h) => h.docs).map((h) => h.hour), -1)] };
}

// ───────────────────────── sales breakdown ─────────────────────────
const DIMS: Record<string, [string, string]> = {
  category: ["التصنيف", "COALESCE(pc.name,'بلا تصنيف')"], product: ["الصنف", "COALESCE(p.name, l.description)"], customer: ["العميل", "COALESCE(i.partner_name,'عميل نقدي')"],
  day: ["اليوم", "i.date::text"], month: ["الشهر", "to_char(i.date,'YYYY-MM')"], weekday: ["يوم الأسبوع", `EXTRACT(DOW FROM i.date)::int`],
  hour: ["الساعة", `CASE WHEN (i.issued_at AT TIME ZONE '${TZ}')::date = i.date THEN EXTRACT(HOUR FROM i.issued_at AT TIME ZONE '${TZ}')::int END`], branch: ["الفرع", "COALESCE(b.name,'—')"], channel: ["القناة", "COALESCE(i.channel,'—')"], cashier: ["الموظف", "COALESCE(i.created_by,'—')"],
};
const WD = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const CH: Record<string, string> = { POS: "نقطة البيع", SALLA: "سلة", ZID: "زد", API: "المتجر (API)", MANUAL: "فاتورة" };
export async function salesBreakdown(t: Db, C: string, q: { by?: string; from?: string; to?: string; limit?: number; categoryId?: string }) {
  const by = DIMS[String(q.by)] ? String(q.by) : "category";
  const to = isDate(q.to) ? String(q.to) : today(), from = isDate(q.from) ? String(q.from) : to.slice(0, 8) + "01";
  const cat = q.categoryId && UUID.test(q.categoryId) ? q.categoryId : null;
  const rows = await t.rows(`SELECT ${DIMS[by][1]} k, SUM(l.qty*COALESCE(l.factor,1)*${SIGN}) qty, SUM(l.net_amount*COALESCE(i.exchange_rate,1)*${SIGN}) net, SUM(CASE WHEN i.kind='INVOICE' THEN l.qty*COALESCE(l.factor,1)*l.unit_cost ELSE 0 END) cost, COUNT(DISTINCT i.id) FILTER (WHERE i.kind='INVOICE')::int docs
      FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id LEFT JOIN products p ON p.id=l.product_id LEFT JOIN product_categories pc ON pc.id=p.category_id LEFT JOIN branches b ON b.id=i.branch_id
     WHERE ${SALES} AND i.date BETWEEN $2 AND $3 ${cat ? `AND p.category_id IN ${CAT_TREE("$4")}` : ""} GROUP BY 1`, cat ? [C, from, to, [cat]] : [C, from, to]);
  const total = rows.reduce((a: number, r: any) => a + Number(r.net), 0);
  let out = rows.map((r: any) => ({ key: by === "weekday" ? WD[Number(r.k)] : by === "hour" ? `${String(r.k).padStart(2, "0")}:00` : by === "channel" ? CH[r.k] || r.k : String(r.k), raw: r.k, qty: r3(Number(r.qty)), revenue: r2(Number(r.net)), cost: r2(Number(r.cost)), profit: r2(Number(r.net) - Number(r.cost)), marginPct: Number(r.net) > 0 ? r2(((Number(r.net) - Number(r.cost)) / Number(r.net)) * 100) : null, docs: r.docs, sharePct: total > 0 ? r2((Number(r.net) / total) * 100) : null }));
  if (by === "hour") out = out.filter((r) => r.raw !== null && r.raw !== undefined); // sales with no recorded time of day
  if (["day", "month", "weekday", "hour"].includes(by)) out.sort((a, b) => Number(a.raw) - Number(b.raw) || String(a.raw).localeCompare(String(b.raw))); else out.sort((a, b) => b.revenue - a.revenue);
  const limit = Math.min(60, Math.max(1, Math.round(num(q.limit) || 15)));
  const rest = out.slice(limit);
  out = out.slice(0, limit);
  return { by, label: DIMS[by][0], from, to, total: r2(total), rows: out, others: rest.length ? { count: rest.length, revenue: r2(rest.reduce((a, r) => a + r.revenue, 0)) } : null };
}

// ───────────────────────── smart observations ─────────────────────────
export async function insights(t: Db, C: string) {
  const td = today(); const out: any[] = [];
  const net = async (f: string, to: string) => Number((await t.one(`SELECT COALESCE(SUM(i.taxable*COALESCE(i.exchange_rate,1)*${SIGN}),0) v FROM invoices i WHERE ${SALES} AND i.date BETWEEN $2 AND $3`, [C, f, to])).v);
  // this week against the same days of last week
  const w1 = await net(addDays(td, -6), td), w0 = await net(addDays(td, -13), addDays(td, -7));
  if (w0 > 0 && Math.abs(w1 - w0) / w0 >= 0.1) {
    const up = w1 > w0, pct = Math.round((Math.abs(w1 - w0) / w0) * 100);
    out.push({ key: "week", level: up ? "good" : "warn", icon: up ? "📈" : "📉", title: up ? `المبيعات أعلى بـ ${pct}% من الأسبوع الماضي` : `المبيعات أقل بـ ${pct}% من الأسبوع الماضي`, text: `آخر 7 أيام ${r2(w1).toLocaleString("en-US")} مقابل ${r2(w0).toLocaleString("en-US")} في الأيام السبعة قبلها.`, ask: "قارن هذا الأسبوع بالأسبوع الماضي حسب التصنيف", to: "/insights" });
  }
  // the item that grew most and the one that fell most (last 30 days against the 30 before)
  const mv = await t.rows(`SELECT p.id, p.name, SUM(CASE WHEN i.date > $2::date - 30 THEN l.net_amount*${SIGN} ELSE 0 END) cur, SUM(CASE WHEN i.date <= $2::date - 30 THEN l.net_amount*${SIGN} ELSE 0 END) prev
      FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id JOIN products p ON p.id=l.product_id WHERE ${SALES} AND i.date > $2::date - 60 GROUP BY p.id HAVING SUM(CASE WHEN i.date <= $2::date - 30 THEN l.net_amount*${SIGN} ELSE 0 END) > 0`, [C, td]);
  const ch = mv.map((r: any) => ({ ...r, d: Number(r.cur) - Number(r.prev), pct: (Number(r.cur) - Number(r.prev)) / Number(r.prev) })).filter((r: any) => Math.abs(r.pct) >= 0.25);
  const up = ch.filter((r: any) => r.d > 0).sort((a: any, b: any) => b.d - a.d)[0], dn = ch.filter((r: any) => r.d < 0).sort((a: any, b: any) => a.d - b.d)[0];
  if (up) out.push({ key: "riser", level: "good", icon: "🚀", title: `«${up.name}» يصعد: +${Math.round(up.pct * 100)}%`, text: `مبيعاته آخر 30 يوماً ${r2(Number(up.cur)).toLocaleString("en-US")} مقابل ${r2(Number(up.prev)).toLocaleString("en-US")} قبلها. تأكد من رصيده.`, ask: `معلومات الصنف ${up.name}`, to: `/inventory?q=${encodeURIComponent(up.name)}` });
  if (dn) out.push({ key: "faller", level: "warn", icon: "🔻", title: `«${dn.name}» يتراجع: ${Math.round(dn.pct * 100)}%`, text: `مبيعاته آخر 30 يوماً ${r2(Number(dn.cur)).toLocaleString("en-US")} مقابل ${r2(Number(dn.prev)).toLocaleString("en-US")} قبلها.`, ask: `معلومات الصنف ${dn.name}`, to: `/inventory?q=${encodeURIComponent(dn.name)}` });
  // items that will run out within a week at the current pace
  const cover = await t.rows(`SELECT p.id, p.name, COALESCE((SELECT SUM(b.qty) FROM stock_balances b WHERE b.product_id=p.id),0) qty,
        (SELECT -SUM(m.qty) FROM stock_moves m WHERE m.product_id=p.id AND m.source_type IN ('SALE','POS') AND m.date > $2::date - 30) sold
      FROM products p WHERE p.company_id=$1 AND p.type='STOCK' AND p.is_active`, [C, td]);
  const soon = cover.map((r: any) => ({ ...r, daily: Number(r.sold || 0) / 30 })).filter((r: any) => r.daily > 0 && Number(r.qty) > 0 && Number(r.qty) / r.daily < 7).sort((a: any, b: any) => Number(a.qty) / a.daily - Number(b.qty) / b.daily);
  if (soon.length) out.push({ key: "runout", level: "warn", icon: "⏳", title: `${soon.length} صنف ينفد خلال أسبوع بمعدل البيع الحالي`, text: soon.slice(0, 4).map((r: any) => `${r.name} (${Math.max(1, Math.round(Number(r.qty) / r.daily))} يوم)`).join("، "), ask: "الأصناف الناقصة", to: "/reorder" });
  // purchase price rises (last 30 days against the average of the 90 before)
  const px = await t.rows(`SELECT p.id, p.name, AVG(l.unit_price) FILTER (WHERE i.date > $2::date - 30) cur, AVG(l.unit_price) FILTER (WHERE i.date <= $2::date - 30) prev
      FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id JOIN products p ON p.id=l.product_id WHERE i.company_id=$1 AND i.direction='PURCHASE' AND i.kind='INVOICE' AND i.status='POSTED' AND i.date > $2::date - 120 AND COALESCE(i.currency,'')=COALESCE(i.currency,'') GROUP BY p.id`, [C, td]);
  const rises = px.filter((r: any) => r.cur && r.prev && Number(r.cur) > Number(r.prev) * 1.1).sort((a: any, b: any) => Number(b.cur) / Number(b.prev) - Number(a.cur) / Number(a.prev));
  if (rises.length) out.push({ key: "cost", level: "warn", icon: "💸", title: `ارتفع سعر شراء ${rises.length} صنف بأكثر من 10%`, text: rises.slice(0, 3).map((r: any) => `${r.name} +${Math.round((Number(r.cur) / Number(r.prev) - 1) * 100)}%`).join("، ") + " — راجع سعر البيع أو المورد.", ask: rises[0] ? `معلومات الصنف ${rises[0].name}` : undefined, to: "/reports-center?r=purch.price-history" });
  // receivables overdue more than 60 days
  const od = await t.one(`SELECT COUNT(*)::int n, COALESCE(SUM(total-amount_paid),0) v FROM invoices WHERE company_id=$1 AND direction='SALE' AND kind IN ('INVOICE','DEBIT_NOTE') AND status='POSTED' AND total-amount_paid > 0.005 AND COALESCE(due_date,date) < $2::date - 60`, [C, td]);
  if (od.n) out.push({ key: "overdue", level: "warn", icon: "⏰", title: `${od.n} فاتورة متأخرة أكثر من 60 يوماً`, text: `بإجمالي ${r2(Number(od.v)).toLocaleString("en-US")} — كلما طال التأخير قلّ احتمال التحصيل.`, ask: "من لم يسدد؟", to: "/collections" });
  // the leading category
  const cat = await t.rows(`SELECT COALESCE(pc.name,'بلا تصنيف') name, SUM(l.net_amount*${SIGN}) v FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id LEFT JOIN products p ON p.id=l.product_id LEFT JOIN product_categories pc ON pc.id=p.category_id WHERE ${SALES} AND i.date > $2::date - 30 GROUP BY 1 ORDER BY 2 DESC`, [C, td]);
  const catTotal = cat.reduce((a: number, r: any) => a + Number(r.v), 0);
  if (cat.length > 1 && catTotal > 0 && Number(cat[0].v) / catTotal >= 0.4) out.push({ key: "concentration", level: "info", icon: "🎯", title: `«${cat[0].name}» = ${Math.round((Number(cat[0].v) / catTotal) * 100)}% من المبيعات`, text: "تركّز كبير في تصنيف واحد: أي نقص فيه يؤثر على الإيراد كله.", ask: "مبيعات هذا الشهر حسب التصنيف", to: "/categories" });
  // food cost above target
  if (await t.maybe(`SELECT 1 FROM product_recipes WHERE company_id=$1 LIMIT 1`, [C])) {
    const fc = await t.one(`SELECT COALESCE(SUM(l.net_amount*${SIGN}),0) rev, COALESCE(SUM(CASE WHEN i.kind='INVOICE' THEN l.qty*COALESCE(l.factor,1)*l.unit_cost ELSE 0 END),0) cost FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE ${SALES} AND i.date > $2::date - 30 AND l.product_id IN (SELECT product_id FROM product_recipes WHERE company_id=$1)`, [C, td]);
    const target = Number((await t.one(`SELECT COALESCE((accounting->'pos'->>'foodCostTarget')::numeric, 30) v FROM companies WHERE id=$1`, [C])).v);
    const pct = Number(fc.rev) > 0 ? (Number(fc.cost) / Number(fc.rev)) * 100 : null;
    if (pct !== null && pct > target) out.push({ key: "foodcost", level: "warn", icon: "🍽", title: `تكلفة الطعام ${r2(pct)}% فوق المستهدف ${target}%`, text: "راجع الأحجام والأطباق الأعلى تكلفة في تقرير تكاليف الطعام.", ask: "تكلفة الطعام", to: "/recipes?tab=cost" });
  }
  // the peak hour
  const hm = await heatmap(t, C, { days: 28 });
  if (hm.peak && hm.peak.docs >= 3) out.push({ key: "peak", level: "info", icon: "🕖", title: `الذروة: ${hm.peak.dayName} الساعة ${String(hm.peak.hour).padStart(2, "0")}:00`, text: `أعلى ساعة مبيعات في آخر 4 أسابيع${hm.bestDay ? `، وأفضل يوم ${hm.bestDay.name}` : ""}. جهّز الطاقم والمخزون قبلها.`, ask: "متى وقت الذروة؟", to: "/" });
  return { at: new Date().toISOString(), items: out.slice(0, 8) };
}
