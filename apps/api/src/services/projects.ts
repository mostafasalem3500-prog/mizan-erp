/**
 * Cost centres and projects. A project is a cost centre with a customer, a contract value, a cost budget and dates;
 * centres nest, so a parent («إجمالي المشاريع») shows the total of everything under it. All figures come from the
 * posted journal lines that carry the centre — whatever screen produced them.
 */
import { Db } from "../db/pool";
import { bad, conflict, num, r2, isDate, today } from "../lib/core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AR = (col: string) => `replace(replace(replace(replace(replace(lower(${col}),'أ','ا'),'إ','ا'),'آ','ا'),'ة','ه'),'ى','ي')`;
const arNorm = (s: string) => String(s || "").toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").trim();
const STATUS = ["ACTIVE", "ON_HOLD", "DONE"];
const range = (q: any) => { const to = isDate(q.to) ? String(q.to) : today(); const from = isDate(q.from) && String(q.from) <= to ? String(q.from) : "1900-01-01"; return { from, to }; };

export async function saveCentre(t: Db, C: string, b: any, id?: string) {
  const name = String(b.name || "").trim().slice(0, 120); if (!name) throw bad("الاسم مطلوب");
  const kind = b.kind === "PROJECT" ? "PROJECT" : "CENTER";
  let code = String(b.code || "").trim().slice(0, 20);
  if (!code) { const n = await t.one(`SELECT COUNT(*)::int c FROM cost_centers WHERE company_id=$1 AND kind=$2`, [C, kind]); code = `${kind === "PROJECT" ? "PRJ" : "CC"}-${String(n.c + 1).padStart(3, "0")}`; }
  const dup = await t.maybe(`SELECT id FROM cost_centers WHERE company_id=$1 AND lower(code)=lower($2) AND id <> $3`, [C, code, id || "00000000-0000-0000-0000-000000000000"]);
  if (dup) throw conflict(`الرمز «${code}» مستخدم لمركز آخر`);
  let parentId: string | null = UUID.test(b.parentId || "") ? b.parentId : null;
  if (parentId) {
    if (parentId === id) throw bad("المركز لا يكون أباً لنفسه");
    await t.one(`SELECT id FROM cost_centers WHERE id=$1 AND company_id=$2`, [parentId, C], "المركز الأب غير موجود");
    if (id) { const loop = await t.maybe(`WITH RECURSIVE up AS (SELECT id, parent_id FROM cost_centers WHERE id=$1 UNION ALL SELECT c.id, c.parent_id FROM cost_centers c JOIN up ON c.id=up.parent_id) SELECT 1 FROM up WHERE id=$2`, [parentId, id]); if (loop) throw bad("المركز الأب تابع لهذا المركز — اختر أباً آخر"); }
  }
  if (b.startDate && !isDate(b.startDate)) throw bad("تاريخ البداية غير صحيح");
  if (b.endDate && !isDate(b.endDate)) throw bad("تاريخ النهاية غير صحيح");
  if (b.startDate && b.endDate && b.endDate < b.startDate) throw bad("تاريخ النهاية قبل البداية");
  const v: any = { code, name, kind, parentId, partnerId: UUID.test(b.partnerId || "") ? b.partnerId : null, contractValue: Math.max(0, r2(num(b.contractValue))), budget: Math.max(0, r2(num(b.budget))), startDate: b.startDate || null, endDate: b.endDate || null,
    status: STATUS.includes(b.status) ? b.status : "ACTIVE", manager: b.manager ? String(b.manager).slice(0, 80) : null, notes: b.notes ? String(b.notes).slice(0, 500) : null, isActive: b.status !== "DONE" };
  return id ? t.update("cost_centers", { id, companyId: C }, v) : t.insert("cost_centers", { companyId: C, ...v });
}
export async function deleteCentre(t: Db, C: string, id: string) {
  const used = await t.one(`SELECT (SELECT COUNT(*) FROM journal_lines WHERE cost_center_id=$1)::int j, (SELECT COUNT(*) FROM expenses WHERE cost_center_id=$1)::int x, (SELECT COUNT(*) FROM employees WHERE cost_center_id=$1)::int e, (SELECT COUNT(*) FROM invoices WHERE cost_center_id=$1)::int i, (SELECT COUNT(*) FROM cost_centers WHERE parent_id=$1)::int k`, [id]);
  if (used.j + used.x + used.i) throw conflict("على المركز قيود أو مستندات — غيّر حالته إلى «منتهٍ» بدل الحذف");
  if (used.k) throw conflict("تحته مراكز تابعة — انقلها أولاً");
  if (used.e) throw conflict("مربوط به موظفون — غيّر مركزهم أولاً");
  await t.exec(`DELETE FROM cost_centers WHERE id=$1 AND company_id=$2`, [id, C]);
}
/** Every centre with its figures for the period; a parent's row also shows the total of all that is under it. */
export async function listCentres(t: Db, C: string, q: any) {
  const { from, to } = range(q);
  const rows = await t.rows(`SELECT c.*, p.name partner_name FROM cost_centers c LEFT JOIN partners p ON p.id=c.partner_id WHERE c.company_id=$1 ORDER BY c.code`, [C]);
  const sums = await t.rows(
    `SELECT l.cost_center_id id,
       COALESCE(SUM(CASE WHEN a.type='REVENUE' THEN l.credit-l.debit END),0) revenue,
       COALESCE(SUM(CASE WHEN a.subtype='COGS' THEN l.debit-l.credit END),0) cogs,
       COALESCE(SUM(CASE WHEN a.type='EXPENSE' AND a.subtype<>'COGS' THEN l.debit-l.credit END),0) expenses,
       COALESCE(SUM(CASE WHEN a.system_key='INVENTORY' AND e.type IN ('PURCHASE','PURCHASE_RETURN') THEN l.debit-l.credit END),0) stock,
       COUNT(DISTINCT e.id)::int entries, MAX(e.date) last_date
     FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id
     WHERE l.company_id=$1 AND l.cost_center_id IS NOT NULL AND e.status='POSTED' AND e.type<>'CLOSING' AND e.date BETWEEN $2 AND $3 GROUP BY l.cost_center_id`, [C, from, to]);
  const own = new Map(sums.map((s) => [s.id, s]));
  const kids = new Map<string, string[]>(); for (const r of rows) if (r.parentId) kids.set(r.parentId, [...(kids.get(r.parentId) || []), r.id]);
  const under = (id: string, seen = new Set<string>()): string[] => { if (seen.has(id)) return []; seen.add(id); return [id, ...(kids.get(id) || []).flatMap((k) => under(k, seen))]; };
  const fig = (ids: string[]) => { const z = { revenue: 0, cogs: 0, expenses: 0, stock: 0, entries: 0 }; for (const i of ids) { const s = own.get(i); if (s) { z.revenue += Number(s.revenue); z.cogs += Number(s.cogs); z.expenses += Number(s.expenses); z.stock += Number(s.stock); z.entries += s.entries; } } const cost = z.cogs + z.expenses; return { revenue: r2(z.revenue), cogs: r2(z.cogs), expenses: r2(z.expenses), stock: r2(z.stock), cost: r2(cost), profit: r2(z.revenue - cost), margin: z.revenue ? r2(((z.revenue - cost) / z.revenue) * 100) : null, entries: z.entries }; };
  const byId = new Map(rows.map((r) => [r.id, r]));
  let list = rows.map((r) => { const f = fig(under(r.id)); const budget = Number(r.budget), contract = Number(r.contractValue);
    return { id: r.id, code: r.code, name: r.name, kind: r.kind, status: r.status, parentId: r.parentId, parentName: r.parentId ? byId.get(r.parentId)?.name || null : null, children: (kids.get(r.id) || []).length, partnerId: r.partnerId, partnerName: r.partnerName, contractValue: contract, budget, startDate: r.startDate ? String(r.startDate instanceof Date ? r.startDate.toISOString() : r.startDate).slice(0, 10) : null, endDate: r.endDate ? String(r.endDate instanceof Date ? r.endDate.toISOString() : r.endDate).slice(0, 10) : null, manager: r.manager, notes: r.notes,
      ...f, budgetUsed: budget ? r2((f.cost / budget) * 100) : null, overBudget: budget > 0 && f.cost > budget, invoicedPct: contract ? r2((f.revenue / contract) * 100) : null, lastDate: own.get(r.id)?.lastDate ? String(own.get(r.id)!.lastDate instanceof Date ? own.get(r.id)!.lastDate.toISOString() : own.get(r.id)!.lastDate).slice(0, 10) : null }; });
  // filters: kind, status, text (code / name / customer / manager), one parent with everything under it
  const text = arNorm(q.q || "");
  if (q.kind === "PROJECT" || q.kind === "CENTER") list = list.filter((r) => r.kind === q.kind);
  if (STATUS.includes(q.status)) list = list.filter((r) => r.status === q.status);
  if (UUID.test(q.parentId || "")) { const ids = new Set(under(q.parentId)); list = list.filter((r) => ids.has(r.id)); }
  if (text) list = list.filter((r) => [r.code, r.name, r.partnerName, r.manager].some((x) => arNorm(x || "").includes(text)));
  if (q.only === "active") list = list.filter((r) => r.entries > 0);
  // totals count every amount once: only rows whose parent is not also in the list
  const shown = new Set(list.map((r) => r.id)); const tops = list.filter((r) => !r.parentId || !shown.has(r.parentId));
  const T = (k: string) => r2(tops.reduce((a, r: any) => a + Number(r[k] || 0), 0)); const rev = T("revenue"), cost = T("cost");
  const unassigned = await t.one(`SELECT COALESCE(SUM(CASE WHEN a.type='REVENUE' THEN l.credit-l.debit END),0) revenue, COALESCE(SUM(CASE WHEN a.type='EXPENSE' THEN l.debit-l.credit END),0) cost FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE l.company_id=$1 AND l.cost_center_id IS NULL AND a.type IN ('REVENUE','EXPENSE') AND e.status='POSTED' AND e.type<>'CLOSING' AND e.date BETWEEN $2 AND $3`, [C, from, to]);
  return { from, to, rows: list, totals: { count: list.length, revenue: rev, cogs: T("cogs"), expenses: T("expenses"), cost, stock: T("stock"), profit: r2(rev - cost), margin: rev ? r2(((rev - cost) / rev) * 100) : null, contractValue: r2(list.filter((r) => r.kind === "PROJECT").reduce((a, r) => a + r.contractValue, 0)), budget: r2(list.reduce((a, r) => a + r.budget, 0)) },
    unassigned: { revenue: r2(unassigned.revenue), cost: r2(unassigned.cost) }, options: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, kind: r.kind, parentId: r.parentId })) };
}
/** One centre (with everything under it): figures, accounts, months, and every movement — filtered by period, type and text. */
export async function centreDetail(t: Db, C: string, id: string, q: any) {
  const { from, to } = range(q);
  const c = await t.one(`SELECT c.*, p.name partner_name FROM cost_centers c LEFT JOIN partners p ON p.id=c.partner_id WHERE c.id=$1 AND c.company_id=$2`, [UUID.test(id) ? id : null, C], "المركز غير موجود");
  const ids = (await t.rows(`WITH RECURSIVE down AS (SELECT id FROM cost_centers WHERE id=$1 UNION SELECT c.id FROM cost_centers c JOIN down ON c.parent_id=down.id) SELECT id FROM down`, [c.id])).map((r) => r.id);
  const lit = `{${ids.join(",")}}`;
  const base = `FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id LEFT JOIN partners p ON p.id=l.partner_id LEFT JOIN cost_centers cc ON cc.id=l.cost_center_id
    WHERE l.company_id=$1 AND l.cost_center_id = ANY($2::uuid[]) AND e.status='POSTED' AND e.type<>'CLOSING' AND e.date BETWEEN $3 AND $4`;
  const pl = `a.type IN ('REVENUE','EXPENSE')`;
  const accounts = await t.rows(`SELECT a.code, a.name_ar, a.type, a.subtype, SUM(CASE WHEN a.type='REVENUE' THEN l.credit-l.debit ELSE l.debit-l.credit END) amount, COUNT(*)::int n ${base} AND ${pl} GROUP BY a.id HAVING SUM(l.debit-l.credit) <> 0 ORDER BY a.type DESC, a.code`, [C, lit, from, to]);
  const months = await t.rows(`SELECT to_char(e.date,'YYYY-MM') m, COALESCE(SUM(CASE WHEN a.type='REVENUE' THEN l.credit-l.debit END),0) revenue, COALESCE(SUM(CASE WHEN a.type='EXPENSE' THEN l.debit-l.credit END),0) cost ${base} AND ${pl} GROUP BY 1 ORDER BY 1`, [C, lit, from, to]);
  const typ = q.type === "REVENUE" ? `a.type='REVENUE'` : q.type === "COGS" ? `a.subtype='COGS'` : q.type === "EXPENSE" ? `a.type='EXPENSE' AND a.subtype<>'COGS'` : q.type === "OTHER" ? `a.type NOT IN ('REVENUE','EXPENSE')` : q.type === "ALL" ? "true" : pl;
  const params: any[] = [C, lit, from, to]; let txt = "";
  const text = arNorm(q.q || ""); if (text) { params.push(`%${text}%`); txt = ` AND (${AR("COALESCE(l.description,'')")} LIKE $5 OR ${AR("COALESCE(e.memo,'')")} LIKE $5 OR lower(e.number) LIKE $5 OR lower(COALESCE(e.reference,'')) LIKE $5 OR ${AR("a.name_ar")} LIKE $5 OR ${AR("COALESCE(p.name,'')")} LIKE $5)`; }
  const lines = await t.rows(`SELECT e.id entry_id, e.date, e.number, e.type entry_type, e.reference, e.source_type, e.source_id, e.memo, a.code, a.name_ar account, a.type, a.subtype, l.description, l.debit, l.credit, p.name partner, cc.name centre ${base} AND ${typ}${txt} ORDER BY e.date DESC, e.number DESC, l.sort LIMIT 500`, params);
  const cnt = await t.one(`SELECT COUNT(*)::int n, COALESCE(SUM(l.debit),0) dr, COALESCE(SUM(l.credit),0) cr ${base} AND ${typ}${txt}`, params);
  const S = (f: (x: any) => boolean) => r2(accounts.filter(f).reduce((a, x) => a + Number(x.amount), 0));
  const revenue = S((x) => x.type === "REVENUE"), cogs = S((x) => x.subtype === "COGS"), expenses = S((x) => x.type === "EXPENSE" && x.subtype !== "COGS"), cost = r2(cogs + expenses);
  const stock = await t.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) v ${base} AND a.system_key='INVENTORY' AND e.type IN ('PURCHASE','PURCHASE_RETURN')`, [C, lit, from, to]);
  const D = (v: any) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
  const budget = Number(c.budget), contract = Number(c.contractValue);
  return { from, to, centre: { id: c.id, code: c.code, name: c.name, kind: c.kind, status: c.status, parentId: c.parentId, partnerId: c.partnerId, partnerName: c.partnerName, contractValue: contract, budget, startDate: D(c.startDate), endDate: D(c.endDate), manager: c.manager, notes: c.notes, includes: ids.length - 1 },
    figures: { revenue, cogs, expenses, cost, stock: r2(stock.v), profit: r2(revenue - cost), margin: revenue ? r2(((revenue - cost) / revenue) * 100) : null, budgetUsed: budget ? r2((cost / budget) * 100) : null, budgetLeft: budget ? r2(budget - cost) : null, invoicedPct: contract ? r2((revenue / contract) * 100) : null, toInvoice: contract ? r2(contract - revenue) : null },
    accounts: accounts.map((x) => ({ code: x.code, name: x.nameAr, type: x.type, subtype: x.subtype, amount: r2(x.amount), n: x.n })), months: months.map((m) => ({ m: m.m, revenue: r2(m.revenue), cost: r2(m.cost), profit: r2(m.revenue - m.cost) })),
    lines: lines.map((l) => ({ ...l, date: D(l.date), debit: Number(l.debit), credit: Number(l.credit) })), lineCount: cnt.n, lineTotals: { debit: r2(cnt.dr), credit: r2(cnt.cr) }, truncated: cnt.n > lines.length };
}
