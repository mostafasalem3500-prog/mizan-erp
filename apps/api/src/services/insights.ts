/**
 * Executive analytics: one call that reads sales, purchases, expenses, stock, receivables, payables and cash for a
 * period, compares it with the previous period of the same length, and turns the figures into alerts and plain
 * findings. Used by the management dashboard and by the e-mailed digest.
 */
import { Db } from "../db/pool";
import { r2, today, isDate, addDays, addMonths } from "../lib/core";
import { normalizeSubtype } from "../accounting/coa";
import { IS_EG } from "../lib/country";

const N = (v: any) => Number(v || 0);
const pct = (cur: number, prev: number) => (prev ? r2(((cur - prev) / Math.abs(prev)) * 100) : cur ? null : 0);
const SIGN = `CASE WHEN i.kind='CREDIT_NOTE' THEN -1 ELSE 1 END`;
const DOCS = `i.status='POSTED' AND i.kind IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE')`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Filters accepted by the dashboard; ids are checked against the uuid shape and the channel against a closed list before going into SQL. */
export const CHANNELS = ["POS", "SALES", "SALLA", "ZID", "API", "BACKOFFICE"];
export function dashFilters(q: any = {}) {
  const u = (v: any) => (UUID.test(String(v || "")) ? String(v) : null);
  const ch = CHANNELS.includes(String(q.channel || "")) ? String(q.channel) : null;
  return { branchId: u(q.branchId), costCenterId: u(q.costCenterId), partnerId: u(q.partnerId), categoryId: u(q.categoryId), channel: ch, compare: q.compare === "yoy" ? "yoy" : "prev" };
}

/** Operating result from the posted ledger (every expense — payroll, depreciation, rent — not only expense vouchers). */
export async function ledgerPnl(t: Db, C: string, from: string, to: string, f: { branchId?: string | null; costCenterId?: string | null } = {}) {
  const rows = await t.rows(`SELECT a.type, a.subtype, COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id
      WHERE e.company_id=$1 AND e.status='POSTED' AND e.type<>'CLOSING' AND e.date BETWEEN $2 AND $3 AND a.type IN ('REVENUE','EXPENSE')
      ${f.branchId ? `AND e.branch_id='${f.branchId}'` : ""} ${f.costCenterId ? `AND l.cost_center_id='${f.costCenterId}'` : ""} GROUP BY 1,2`, [C, from, to]);
  const by: Record<string, number> = {};
  for (const r of rows) { const k = normalizeSubtype(r.type, r.subtype); by[k] = (by[k] || 0) + Number(r.b); }
  const g = (...ks: string[]) => ks.reduce((a, k) => a + (by[k] || 0), 0);
  const netSales = r2(-g("SALES", "SALES_RETURNS")), cogs = r2(g("COGS")), opex = r2(g("EXPENSE", "SELLING_EXPENSE"));
  const grossProfit = r2(netSales - cogs), operating = r2(grossProfit - opex);
  const net = r2(-rows.reduce((a: number, r: any) => a + Number(r.b), 0));
  return { netSales, cogs, grossProfit, opex, operating, other: r2(net - operating), net };
}

export async function executive(t: Db, companyId: string, q: any = {}) {
  const to = isDate(q.to) ? q.to : today();
  const from = isDate(q.from) && q.from <= to ? q.from : to.slice(0, 8) + "01";
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const F = dashFilters(q);
  // the comparison: the previous period of the same length, or the same dates a year earlier
  const pTo = F.compare === "yoy" ? addMonths(to, -12) : addDays(from, -1), pFrom = F.compare === "yoy" ? addMonths(from, -12) : addDays(from, -days);
  const B = F.branchId;
  const C = companyId;
  // document filters (values validated by dashFilters): purchases follow branch and cost centre; sales also channel and customer
  const fP = (a = "i") => `${B ? ` AND ${a}.branch_id='${B}'` : ""}${F.costCenterId ? ` AND ${a}.cost_center_id='${F.costCenterId}'` : ""}`;
  const fS = (a = "i") => `${fP(a)}${F.channel ? ` AND COALESCE(${a}.channel,'SALES')='${F.channel}'` : ""}${F.partnerId ? ` AND ${a}.partner_id='${F.partnerId}'` : ""}`;
  const br = (a = "i") => fS(a);
  const CAT = F.categoryId ? ` AND p.category_id='${F.categoryId}'` : "";
  // one row per sales document with its net and cost; with a category filter only that category's lines count
  const S = (f: string, tt: string) => F.categoryId
    ? `(SELECT i.id, i.date, i.kind, i.partner_id, i.partner_name, i.channel, i.issued_at, i.tenders, i.discount_total, SUM(l.net_amount)*COALESCE(MAX(i.exchange_rate),1) net, SUM(l.qty*COALESCE(l.factor,1)*COALESCE(l.unit_cost,0)) cost
         FROM invoices i JOIN invoice_lines l ON l.invoice_id=i.id JOIN products p ON p.id=l.product_id WHERE i.company_id='${C}' AND i.direction='SALE' AND ${DOCS} AND i.date BETWEEN '${f}' AND '${tt}' ${fS()}${CAT} GROUP BY i.id)`
    : `(SELECT i.id, i.date, i.kind, i.partner_id, i.partner_name, i.channel, i.issued_at, i.tenders, i.discount_total, i.taxable*COALESCE(i.exchange_rate,1) net, i.cost_total cost
         FROM invoices i WHERE i.company_id='${C}' AND i.direction='SALE' AND ${DOCS} AND i.date BETWEEN '${f}' AND '${tt}' ${fS()})`;
  const docOnly = !!(F.partnerId || F.channel || F.categoryId); // the ledger cannot be cut by customer, channel or category

  const tot = async (f: string, tt: string) => {
    const s = await t.one(`SELECT COALESCE(SUM(${SIGN}*i.net),0) net, COALESCE(SUM(${SIGN}*i.cost),0) cost, COUNT(*) FILTER (WHERE i.kind='INVOICE')::int n,
        COALESCE(SUM(i.net) FILTER (WHERE i.kind='CREDIT_NOTE'),0) returns, COUNT(DISTINCT i.partner_id) FILTER (WHERE i.kind='INVOICE')::int customers,
        COALESCE(SUM(i.discount_total) FILTER (WHERE i.kind='INVOICE'),0) discounts
      FROM ${S(f, tt)} i`, []);
    const p = await t.one(`SELECT COALESCE(SUM(${SIGN}*i.taxable*COALESCE(i.exchange_rate,1)),0) net, COUNT(*) FILTER (WHERE i.kind='INVOICE')::int n FROM invoices i WHERE i.company_id=$1 AND i.direction='PURCHASE' AND ${DOCS} AND i.date BETWEEN $2 AND $3 ${fP()}`, [C, f, tt]);
    const e = await t.one(`SELECT COUNT(*)::int n FROM expenses e WHERE e.company_id=$1 AND e.status='POSTED' AND e.date BETWEEN $2 AND $3 ${F.costCenterId ? `AND (e.cost_center_id='${F.costCenterId}' OR e.allocations @> '[{"costCenterId":"${F.costCenterId}"}]')` : ""} ${B ? `AND EXISTS (SELECT 1 FROM journal_entries j WHERE j.id=e.journal_id AND j.branch_id='${B}')` : ""}`, [C, f, tt]);
    const pay = await t.one(`SELECT COALESCE(SUM(amount) FILTER (WHERE direction='IN'),0) inn, COALESCE(SUM(amount) FILTER (WHERE direction='OUT'),0) out FROM payments p WHERE company_id=$1 AND status='POSTED' AND date BETWEEN $2 AND $3 ${F.partnerId ? `AND p.partner_id='${F.partnerId}'` : ""} ${B ? `AND EXISTS (SELECT 1 FROM journal_entries j WHERE j.id=p.journal_id AND j.branch_id='${B}')` : ""}`, [C, f, tt]);
    const L = docOnly ? null : await ledgerPnl(t, C, f, tt, F);
    const sales = N(s.net), cost = N(s.cost), gp = r2(sales - cost);
    return { sales, cost, grossProfit: gp, margin: sales ? r2((gp / sales) * 100) : 0, invoices: s.n, avgTicket: s.n ? r2(sales / s.n) : 0, returns: N(s.returns), customers: s.customers, discounts: N(s.discounts),
      purchases: N(p.net), purchaseInvoices: p.n, expenses: L ? L.opex : null, expenseCount: e.n, netProfit: L ? L.operating : null, collected: N(pay.inn), paid: N(pay.out), ledger: L };
  };
  const cur = await tot(from, to), prev = await tot(pFrom, pTo);
  const change: Record<string, number | null> = {};
  for (const k of Object.keys(cur) as (keyof typeof cur)[]) if (typeof cur[k] === "number" && typeof prev[k] === "number") change[k] = pct(cur[k] as number, prev[k] as number); else if (k !== "ledger") change[k] = null;

  const P = [C, from, to];
  const SS = S(from, to);
  const TZ = IS_EG ? "Africa/Cairo" : "Asia/Riyadh";
  const dSales = await t.rows(`SELECT i.date::text d, SUM(${SIGN}*i.net) sales, SUM(${SIGN}*(i.net-i.cost)) profit, COUNT(*) FILTER (WHERE i.kind='INVOICE')::int n FROM ${SS} i GROUP BY 1`, []);
  const dPurch = await t.rows(`SELECT i.date::text d, SUM(${SIGN}*i.taxable*COALESCE(i.exchange_rate,1)) v FROM invoices i WHERE i.company_id=$1 AND i.direction='PURCHASE' AND ${DOCS} AND i.date BETWEEN $2 AND $3 ${fP()} GROUP BY 1`, P);
  const dm = new Map<string, any>();
  for (const r of dSales) dm.set(String(r.d).slice(0, 10), { d: String(r.d).slice(0, 10), sales: N(r.sales), profit: N(r.profit), purchases: 0, n: r.n });
  for (const r of dPurch) { const k = String(r.d).slice(0, 10); const x = dm.get(k) || { d: k, sales: 0, profit: 0, purchases: 0, n: 0 }; x.purchases = N(r.v); dm.set(k, x); }
  const daily = [...dm.values()].sort((x, y) => x.d.localeCompare(y.d));
  const SALE = `i.company_id=$1 AND i.direction='SALE' AND ${DOCS} AND i.date BETWEEN $2 AND $3 ${fS()}`;
  const byChannel = (await t.rows(`SELECT COALESCE(i.channel,'SALES') k, SUM(${SIGN}*i.net) v, COUNT(*) FILTER (WHERE i.kind='INVOICE')::int n FROM ${SS} i GROUP BY 1 ORDER BY 2 DESC`, [])).map((r: any) => ({ k: r.k, v: N(r.v), n: r.n }));
  const byWeekday = (await t.rows(`SELECT EXTRACT(DOW FROM i.date)::int k, SUM(${SIGN}*i.net) v, COUNT(*) FILTER (WHERE i.kind='INVOICE')::int n FROM ${SS} i GROUP BY 1 ORDER BY 1`, [])).map((r: any) => ({ k: r.k, v: N(r.v), n: r.n }));
  // hour of sale in the establishment's local time (Saudi or Egyptian), not the server's
  const byHour = (await t.rows(`SELECT EXTRACT(HOUR FROM i.issued_at AT TIME ZONE '${TZ}')::int k, SUM(i.net) v, COUNT(*)::int n FROM ${SS} i WHERE i.kind='INVOICE' AND i.issued_at IS NOT NULL GROUP BY 1 ORDER BY 1`, [])).map((r: any) => ({ k: r.k, v: N(r.v), n: r.n }));
  // tenders belong to the whole document: not split when one category is selected
  const payMethods = F.categoryId ? [] : (await t.rows(`SELECT x->>'method' k, SUM((x->>'amount')::numeric) v FROM ${SS} i, jsonb_array_elements(COALESCE(i.tenders,'[]'::jsonb)) x WHERE i.kind='INVOICE' GROUP BY 1 ORDER BY 2 DESC`, [])).map((r: any) => ({ k: r.k, v: N(r.v) }));

  // products: quantity in base units, revenue, cost and margin
  const LQ = `l.qty*COALESCE(l.factor,1)`;
  const prodRows = await t.rows(`SELECT p.id, p.name, p.sku, c.name category, SUM(${SIGN}*${LQ}) qty, SUM(${SIGN}*l.net_amount*COALESCE(i.exchange_rate,1)) net, SUM(${SIGN}*${LQ}*l.unit_cost) cost, COUNT(DISTINCT i.id)::int docs
      FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id JOIN products p ON p.id=l.product_id LEFT JOIN product_categories c ON c.id=p.category_id
     WHERE ${SALE}${CAT} GROUP BY p.id, c.name`, P);
  const products = prodRows.map((r: any) => { const net = N(r.net), cost = N(r.cost); return { id: r.id, name: r.name, sku: r.sku, category: r.category || "بدون تصنيف", qty: N(r.qty), net, profit: r2(net - cost), margin: net ? r2(((net - cost) / net) * 100) : 0, docs: r.docs }; });
  const bySales = [...products].sort((a, b) => b.net - a.net);
  // ABC: A = the products making the first 80% of revenue, B the next 15%, C the rest
  const totalNet = bySales.reduce((s, p) => s + Math.max(0, p.net), 0); let acc = 0;
  const abc = { A: { n: 0, v: 0 }, B: { n: 0, v: 0 }, C: { n: 0, v: 0 } };
  for (const p of bySales) { const before = totalNet ? acc / totalNet : 1; acc += Math.max(0, p.net); const k = before < 0.8 ? "A" : before < 0.95 ? "B" : "C"; (p as any).abc = k; abc[k].n++; abc[k].v = r2(abc[k].v + p.net); }
  const catMap = new Map<string, { k: string; v: number; profit: number; qty: number }>();
  for (const p of products) { const c = catMap.get(p.category) || { k: p.category, v: 0, profit: 0, qty: 0 }; c.v = r2(c.v + p.net); c.profit = r2(c.profit + p.profit); c.qty += p.qty; catMap.set(p.category, c); }
  const topCustomers = (await t.rows(`SELECT i.partner_id id, MAX(i.partner_name) name, SUM(${SIGN}*i.net) v, SUM(${SIGN}*(i.net-i.cost)) profit, COUNT(*) FILTER (WHERE i.kind='INVOICE')::int n FROM ${SS} i JOIN partners p ON p.id=i.partner_id WHERE p.code<>'WALKIN' GROUP BY 1 ORDER BY 3 DESC LIMIT 10`, [])).map((r: any) => ({ id: r.id, name: r.name, v: N(r.v), profit: N(r.profit), n: r.n }));
  const topSuppliers = (await t.rows(`SELECT i.partner_id id, MAX(i.partner_name) name, SUM(${SIGN}*i.taxable*COALESCE(i.exchange_rate,1)) v, COUNT(*) FILTER (WHERE i.kind='INVOICE')::int n FROM invoices i WHERE i.company_id=$1 AND i.direction='PURCHASE' AND ${DOCS} AND i.date BETWEEN $2 AND $3 ${fP()} GROUP BY 1 ORDER BY 3 DESC LIMIT 10`, P)).map((r: any) => ({ id: r.id, name: r.name, v: N(r.v), n: r.n }));
  const topPurchased = (await t.rows(`SELECT p.id, p.name, SUM(${SIGN}*${LQ}) qty, SUM(${SIGN}*l.net_amount) v, MIN(l.net_amount/NULLIF(${LQ},0)) min_price, MAX(l.net_amount/NULLIF(${LQ},0)) max_price FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id JOIN products p ON p.id=l.product_id WHERE i.company_id=$1 AND i.direction='PURCHASE' AND ${DOCS} AND i.date BETWEEN $2 AND $3 ${fP()}${CAT} GROUP BY p.id ORDER BY 4 DESC LIMIT 10`, P)).map((r: any) => ({ id: r.id, name: r.name, qty: N(r.qty), v: N(r.v), minPrice: N(r.minPrice), maxPrice: N(r.maxPrice) }));
  // operating expenses by account from the ledger (payroll, depreciation and journal entries included), same filters as the result
  const expByAccount = (await t.rows(`SELECT a.name_ar k, SUM(l.debit-l.credit) v FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id
      WHERE e.company_id=$1 AND e.status='POSTED' AND e.type<>'CLOSING' AND e.date BETWEEN $2 AND $3 AND a.type='EXPENSE' AND a.subtype IN ('EXPENSE','SELLING_EXPENSE')
      ${B ? `AND e.branch_id='${B}'` : ""} ${F.costCenterId ? `AND l.cost_center_id='${F.costCenterId}'` : ""} GROUP BY 1 HAVING SUM(l.debit-l.credit) <> 0 ORDER BY 2 DESC LIMIT 10`, P)).map((r: any) => ({ k: r.k, v: N(r.v) }));

  // stock as of now, with the last-90-days sales velocity
  const stock = await t.rows(`SELECT p.id, p.name, p.sku, p.reorder_level, COALESCE(b.qty,0) qty, COALESCE(b.value,0) value, COALESCE(s.qty90,0) qty90, s.last_sale
      FROM products p
      LEFT JOIN (SELECT product_id, SUM(qty) qty, SUM(value) value FROM stock_balances WHERE company_id=$1 GROUP BY 1) b ON b.product_id=p.id
      LEFT JOIN (SELECT l.product_id, SUM(${SIGN}*${LQ}) qty90, MAX(i.date) last_sale FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.company_id=$1 AND i.direction='SALE' AND ${DOCS} AND i.date > CURRENT_DATE - 90 GROUP BY 1) s ON s.product_id=p.id
     WHERE p.company_id=$1 AND p.is_active AND p.type='STOCK'`, [C]);
  const inv = stock.map((r: any) => { const qty = N(r.qty), daily = N(r.qty90) / 90; return { id: r.id, name: r.name, sku: r.sku, qty, value: N(r.value), reorder: N(r.reorderLevel), daily: r2(daily), cover: daily > 0 ? Math.round(qty / daily) : null, lastSale: r.lastSale ? String(r.lastSale).slice(0, 10) : null }; });
  const outOfStock = inv.filter((x) => x.qty <= 0 && x.daily > 0).sort((a, b) => b.daily - a.daily);
  const belowReorder = inv.filter((x) => x.qty > 0 && x.reorder > 0 && x.qty <= x.reorder).sort((a, b) => (a.cover ?? 9999) - (b.cover ?? 9999));
  const runningOut = inv.filter((x) => x.qty > 0 && x.cover !== null && x.cover <= 7 && !(x.reorder > 0 && x.qty <= x.reorder)).sort((a, b) => a.cover! - b.cover!);
  const dead = inv.filter((x) => x.qty > 0 && x.daily <= 0).sort((a, b) => b.value - a.value);
  const overstock = inv.filter((x) => x.cover !== null && x.cover > 180 && x.value > 0).sort((a, b) => b.value - a.value);
  const expiring = (await t.rows(`SELECT p.name, l.lot_no, l.expiry_date::text expiry, SUM(l.qty) qty, (l.expiry_date - CURRENT_DATE) days FROM stock_lots l JOIN products p ON p.id=l.product_id WHERE l.company_id=$1 AND l.qty > 0 AND l.expiry_date IS NOT NULL AND l.expiry_date <= CURRENT_DATE + 60 GROUP BY p.name, l.lot_no, l.expiry_date ORDER BY l.expiry_date LIMIT 30`, [C])).map((r: any) => ({ name: r.name, lotNo: r.lotNo, expiry: String(r.expiry).slice(0, 10), qty: N(r.qty), days: N(r.days) }));
  const stockValue = r2(inv.reduce((s, x) => s + x.value, 0));

  // open balances and their age
  const aging = async (dir: string) => {
    const r = await t.one(`SELECT COALESCE(SUM(open),0) total, COALESCE(SUM(open) FILTER (WHERE age <= 0),0) current, COALESCE(SUM(open) FILTER (WHERE age BETWEEN 1 AND 30),0) d30, COALESCE(SUM(open) FILTER (WHERE age BETWEEN 31 AND 60),0) d60, COALESCE(SUM(open) FILTER (WHERE age BETWEEN 61 AND 90),0) d90, COALESCE(SUM(open) FILTER (WHERE age > 90),0) d90p, COUNT(*) FILTER (WHERE age > 0)::int overdue_docs
        FROM (SELECT (i.total - i.amount_paid)*COALESCE(i.exchange_rate,1) open, (CURRENT_DATE - COALESCE(i.due_date, i.date)) age FROM invoices i WHERE i.company_id=$1 AND i.direction=$2 AND i.status='POSTED' AND i.kind IN ('INVOICE','DEBIT_NOTE') AND i.total - i.amount_paid > 0.005 AND ($3::uuid IS NULL OR i.branch_id=$3)) x`, [C, dir, B]);
    const top = await t.rows(`SELECT i.partner_id id, MAX(i.partner_name) name, SUM((i.total - i.amount_paid)*COALESCE(i.exchange_rate,1)) open, SUM((i.total - i.amount_paid)*COALESCE(i.exchange_rate,1)) FILTER (WHERE COALESCE(i.due_date,i.date) < CURRENT_DATE) overdue, MAX(CURRENT_DATE - COALESCE(i.due_date,i.date)) max_age
        FROM invoices i WHERE i.company_id=$1 AND i.direction=$2 AND i.status='POSTED' AND i.kind IN ('INVOICE','DEBIT_NOTE') AND i.total - i.amount_paid > 0.005 AND ($3::uuid IS NULL OR i.branch_id=$3) GROUP BY 1 ORDER BY 3 DESC LIMIT 8`, [C, dir, B]);
    const next30 = await t.one(`SELECT COALESCE(SUM((i.total - i.amount_paid)*COALESCE(i.exchange_rate,1)),0) v FROM invoices i WHERE i.company_id=$1 AND i.direction=$2 AND i.status='POSTED' AND i.kind IN ('INVOICE','DEBIT_NOTE') AND i.total - i.amount_paid > 0.005 AND COALESCE(i.due_date,i.date) <= CURRENT_DATE + 30 AND ($3::uuid IS NULL OR i.branch_id=$3)`, [C, dir, B]);
    const total = N(r.total);
    return { total, current: N(r.current), d30: N(r.d30), d60: N(r.d60), d90: N(r.d90), d90p: N(r.d90p), overdue: r2(total - N(r.current)), overdueDocs: r.overdueDocs, dueIn30: N(next30.v), top: top.map((x: any) => ({ id: x.id, name: x.name, open: N(x.open), overdue: N(x.overdue), maxAge: Math.max(0, N(x.maxAge)) })) };
  };
  const receivables = await aging("SALE"), payables = await aging("PURCHASE");
  const cashAccounts = (await t.rows(`SELECT a.code, a.name_ar name, COALESCE(SUM(l.debit-l.credit),0) balance FROM accounts a LEFT JOIN journal_lines l ON l.account_id=a.id LEFT JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED' WHERE a.company_id=$1 AND a.is_cash_bank AND NOT a.is_group AND (l.id IS NULL OR e.id IS NOT NULL) GROUP BY a.id ORDER BY a.code`, [C])).map((r: any) => ({ code: r.code, name: r.name, balance: N(r.balance) })).filter((x) => Math.abs(x.balance) > 0.005 || /الرئيسي|BANK/.test(x.name));
  const cashTotal = r2(cashAccounts.reduce((s, x) => s + x.balance, 0));
  const forecast = { cashNow: cashTotal, inflow30: receivables.dueIn30, outflow30: payables.dueIn30, projected: r2(cashTotal + receivables.dueIn30 - payables.dueIn30) };

  // things worth a second look
  const dupBills = await t.rows(`SELECT MAX(i.partner_name) name, i.supplier_ref ref, COUNT(*)::int n, SUM(i.total) total FROM invoices i WHERE i.company_id=$1 AND i.direction='PURCHASE' AND i.kind='INVOICE' AND i.status='POSTED' AND COALESCE(i.supplier_ref,'')<>'' AND i.date > CURRENT_DATE - 365 GROUP BY i.partner_id, i.supplier_ref HAVING COUNT(*) > 1 LIMIT 10`, [C]);
  const belowCost = await t.rows(`SELECT i.number, i.id, l.description, ${LQ} qty, l.net_amount net, ${LQ}*l.unit_cost cost FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE ${SALE} AND i.kind='INVOICE' AND l.product_id IS NOT NULL AND l.unit_cost > 0 AND l.net_amount < ${LQ}*l.unit_cost - 0.01 ORDER BY (${LQ}*l.unit_cost - l.net_amount) DESC LIMIT 10`, P);
  // over the credit limit — on the net (less what we owe the same party as a supplier) unless the company measures it gross
  const netting = (await t.one(`SELECT COALESCE(accounting->>'creditNetting','NET') m FROM companies WHERE id=$1`, [C])).m !== "GROSS";
  const overLimit = (await t.rows(`SELECT p.id, p.name, p.credit_limit lim,
       COALESCE(SUM((i.total - i.amount_paid)*COALESCE(i.exchange_rate,1)) FILTER (WHERE i.direction='SALE'),0) gross,
       COALESCE(SUM((i.total - i.amount_paid)*COALESCE(i.exchange_rate,1)) FILTER (WHERE i.direction='PURCHASE'),0) owed
     FROM partners p JOIN invoices i ON i.partner_id=p.id AND i.status='POSTED' AND i.kind IN ('INVOICE','DEBIT_NOTE') WHERE p.company_id=$1 AND p.credit_limit > 0 GROUP BY p.id`, [C]))
    .map((o: any) => ({ ...o, open: Number(o.gross) - (netting ? Math.max(0, Number(o.owed)) : 0) })).filter((o: any) => o.open > Number(o.lim) + 0.005).slice(0, 10);
  const spikes = await t.rows(`WITH m AS (SELECT e.account_id, date_trunc('month', e.date) mo, SUM(e.amount) v FROM expenses e WHERE e.company_id=$1 AND e.status='POSTED' AND e.date >= date_trunc('month', $2::date) - interval '3 months' AND e.date <= $2 GROUP BY 1,2)
      SELECT a.name_ar name, c.v cur, COALESCE(p.avg,0) avg FROM (SELECT account_id, v FROM m WHERE mo = date_trunc('month', $2::date)) c JOIN accounts a ON a.id=c.account_id
      LEFT JOIN (SELECT account_id, SUM(v)/3 avg FROM m WHERE mo < date_trunc('month', $2::date) GROUP BY 1) p ON p.account_id=c.account_id WHERE COALESCE(p.avg,0) > 0 AND c.v > p.avg*1.5 AND c.v - p.avg > 200 ORDER BY c.v - p.avg DESC LIMIT 5`, [C, to]);
  const noDocs = await t.one(`SELECT (SELECT COUNT(*) FROM invoices i WHERE i.company_id=$1 AND i.direction='PURCHASE' AND i.kind='INVOICE' AND i.status='POSTED' AND i.date BETWEEN $2 AND $3 AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.entity='invoice' AND a.entity_id=i.id))::int purchases,
      (SELECT COUNT(*) FROM expenses e WHERE e.company_id=$1 AND e.status='POSTED' AND e.date BETWEEN $2 AND $3 AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.entity='expense' AND a.entity_id=e.id))::int expenses`, [C, from, to]);
  const expiringDocs = (await t.rows(`SELECT id, COALESCE(title,name) title, category, expires_at::text expires, (expires_at - CURRENT_DATE) days FROM attachments WHERE company_id=$1 AND expires_at IS NOT NULL AND expires_at <= CURRENT_DATE + 45 ORDER BY expires_at LIMIT 15`, [C])).map((r: any) => ({ id: r.id, title: r.title, category: r.category, expires: String(r.expires).slice(0, 10), days: N(r.days) }));

  type Alert = { level: "danger" | "warn" | "info"; area: string; text: string; to?: string };
  const alerts: Alert[] = [];
  const f = (v: number) => v.toLocaleString("en", { maximumFractionDigits: 0 });
  if (outOfStock.length) alerts.push({ level: "danger", area: "المخزون", text: `${outOfStock.length} صنف مطلوب نفد من المخزون: ${outOfStock.slice(0, 3).map((x) => x.name).join("، ")}`, to: "/reorder" });
  if (belowReorder.length) alerts.push({ level: "warn", area: "المخزون", text: `${belowReorder.length} صنف وصل حد إعادة الطلب`, to: "/reorder" });
  if (runningOut.length) alerts.push({ level: "warn", area: "المخزون", text: `${runningOut.length} صنف يكفي أقل من أسبوع بمعدل البيع الحالي: ${runningOut.slice(0, 3).map((x) => `${x.name} (${x.cover} يوم)`).join("، ")}`, to: "/reorder" });
  const exp30 = expiring.filter((x) => x.days <= 30);
  if (exp30.length) alerts.push({ level: exp30.some((x) => x.days < 0) ? "danger" : "warn", area: "الصلاحية", text: `${exp30.length} دفعة تنتهي صلاحيتها خلال 30 يوماً أو انتهت`, to: "/lots" });
  const deadVal = r2(dead.reduce((s, x) => s + x.value, 0));
  if (deadVal > 0) alerts.push({ level: "info", area: "المخزون", text: `مخزون راكد بلا بيع منذ 90 يوماً بقيمة ${f(deadVal)} (${dead.length} صنف)`, to: "/reports-center/stock_dead" });
  if (receivables.d90p > 0) alerts.push({ level: "danger", area: "التحصيل", text: `ذمم عملاء متأخرة أكثر من 90 يوماً: ${f(receivables.d90p)}`, to: "/collections" });
  else if (receivables.overdue > 0) alerts.push({ level: "warn", area: "التحصيل", text: `ذمم عملاء متأخرة: ${f(receivables.overdue)} في ${receivables.overdueDocs} فاتورة`, to: "/collections" });
  if (payables.overdue > 0) alerts.push({ level: "warn", area: "الموردون", text: `مستحقات موردين تجاوزت موعدها: ${f(payables.overdue)}`, to: "/reports/aging" });
  if (forecast.projected < 0) alerts.push({ level: "danger", area: "السيولة", text: `السيولة المتوقعة خلال 30 يوماً سالبة (${f(forecast.projected)}): المستحق للموردين يفوق النقد والتحصيل المتوقع`, to: "/treasury" });
  for (const o of overLimit) alerts.push({ level: "warn", area: "الائتمان", text: `العميل «${o.name}» تجاوز حد الائتمان: ${f(N(o.open))} من ${f(N(o.lim))}`, to: `/customers/${o.id}` });
  for (const d of dupBills) alerts.push({ level: "warn", area: "المشتريات", text: `فاتورة مورد مكررة محتملة: «${d.name}» رقم ${d.ref} مسجلة ${d.n} مرات`, to: "/purchases/invoices" });
  if (belowCost.length) alerts.push({ level: "warn", area: "الربحية", text: `${belowCost.length} بند بيع بأقل من التكلفة في الفترة (مثل ${belowCost[0].description} في ${belowCost[0].number})`, to: `/doc/${belowCost[0].id}` });
  for (const s of spikes) alerts.push({ level: "info", area: "المصروفات", text: `«${s.name}» هذا الشهر ${f(N(s.cur))} مقابل متوسط ${f(N(s.avg))} للأشهر الثلاثة السابقة`, to: "/expenses" });
  if (noDocs.purchases + noDocs.expenses > 0) alerts.push({ level: "info", area: "الأرشفة", text: `${noDocs.purchases} فاتورة مشتريات و${noDocs.expenses} مصروف في الفترة بلا مستند مرفق`, to: "/archive?tab=missing" });
  for (const d of expiringDocs.slice(0, 5)) alerts.push({ level: d.days < 0 ? "danger" : "warn", area: "المستندات", text: d.days < 0 ? `انتهى «${d.title}» منذ ${-d.days} يوماً` : `«${d.title}» ينتهي خلال ${d.days} يوماً (${d.expires})`, to: "/archive?tab=expiring" });

  // plain-language reading of the period
  const insights: string[] = [];
  const up = (v: number | null) => (v === null ? "" : v > 0 ? `بارتفاع ${Math.abs(v)}%` : v < 0 ? `بانخفاض ${Math.abs(v)}%` : "دون تغيّر");
  if (cur.sales || prev.sales) insights.push(`المبيعات ${f(cur.sales)}${change.sales === null ? "" : ` ${up(change.sales)} عن الفترة السابقة`}، في ${cur.invoices} فاتورة بمتوسط ${f(cur.avgTicket)} للفاتورة.`);
  if (cur.sales) insights.push(`هامش مجمل الربح ${cur.margin}%${prev.sales ? ` (كان ${prev.margin}%)` : ""}${cur.ledger ? `، والربح التشغيلي من الدفاتر بعد كل المصروفات التشغيلية (${f(cur.ledger.opex)}) ${f(cur.ledger.operating)}` : ""}.`);
  if (bySales[0] && totalNet) { const top5 = bySales.slice(0, 5).reduce((s, p) => s + p.net, 0); insights.push(`الأكثر مبيعاً «${bySales[0].name}» (${f(bySales[0].net)})، وأعلى خمسة أصناف تمثل ${Math.round((top5 / totalNet) * 100)}% من المبيعات.`); }
  if (abc.A.n) insights.push(`${abc.A.n} صنف (فئة A) يحقق 80% من الإيراد من أصل ${products.length} صنف مباع — ركّز التوفّر والتسعير عليها.`);
  const bestDay = [...byWeekday].sort((a, b) => b.v - a.v)[0];
  const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  if (bestDay && byWeekday.length > 2) insights.push(`أقوى أيام البيع ${DAYS[bestDay.k]}${byHour.length ? `، وساعة الذروة ${[...byHour].sort((a, b) => b.v - a.v)[0].k}:00` : ""}.`);
  if (topCustomers[0] && cur.sales) insights.push(`أكبر عميل «${topCustomers[0].name}» بنسبة ${Math.round((topCustomers[0].v / cur.sales) * 100)}% من المبيعات${topCustomers[0].v / cur.sales > 0.3 ? " — تركّز مرتفع على عميل واحد" : ""}.`);
  if (cur.returns && cur.sales) insights.push(`المرتجعات ${f(cur.returns)} أي ${r2((cur.returns / (cur.sales + cur.returns)) * 100)}% من المبيعات.`);
  if (receivables.total) insights.push(`ذمم العملاء ${f(receivables.total)} منها ${f(receivables.overdue)} متأخرة؛ المتوقع تحصيله خلال 30 يوماً ${f(receivables.dueIn30)} مقابل ${f(payables.dueIn30)} مستحقة للموردين.`);
  if (stockValue) insights.push(`قيمة المخزون ${f(stockValue)}${deadVal ? `، منها ${Math.round((deadVal / stockValue) * 100)}% راكد` : ""}.`);

  return {
    period: { from, to, days, prevFrom: pFrom, prevTo: pTo, compare: F.compare }, filters: F, docOnly, kpis: cur, prev, change, daily, byChannel, byWeekday, byHour, payMethods,
    topProducts: bySales.slice(0, 15), topByQty: [...products].sort((a, b) => b.qty - a.qty).slice(0, 10), topByProfit: [...products].sort((a, b) => b.profit - a.profit).slice(0, 10),
    lowMargin: products.filter((p) => p.net > 0).sort((a, b) => a.margin - b.margin).slice(0, 10), abc, productsSold: products.length,
    categories: [...catMap.values()].sort((a, b) => b.v - a.v), topCustomers, topSuppliers, topPurchased, expByAccount,
    inventory: { value: stockValue, skus: inv.length, outOfStock: outOfStock.slice(0, 20), belowReorder: belowReorder.slice(0, 20), runningOut: runningOut.slice(0, 20), dead: dead.slice(0, 20), deadValue: deadVal, deadCount: dead.length, overstock: overstock.slice(0, 15), expiring,
      counts: { outOfStock: outOfStock.length, belowReorder: belowReorder.length, runningOut: runningOut.length, dead: dead.length, overstock: overstock.length, expiring: expiring.length } },
    receivables, payables, cash: { total: cashTotal, accounts: cashAccounts }, forecast,
    anomalies: { duplicateBills: dupBills.map((d: any) => ({ name: d.name, ref: d.ref, n: d.n, total: N(d.total) })), belowCost: belowCost.map((b: any) => ({ id: b.id, number: b.number, description: b.description, net: N(b.net), cost: N(b.cost) })), overLimit: overLimit.map((o: any) => ({ id: o.id, name: o.name, limit: N(o.lim), open: N(o.open) })), expenseSpikes: spikes.map((s: any) => ({ name: s.name, cur: N(s.cur), avg: N(s.avg) })), missingDocs: noDocs, expiringDocs },
    alerts, insights,
  };
}
