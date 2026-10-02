/** Financial reports, all computed from journal_lines (single source of truth). */
import { Db } from "../db/pool";
import { bad, r2, D, isDate, today, addDays, addMonths, monthEnd } from "../lib/core";
import { provisionTotals } from "./hr";
import { debitNature, SUBTYPE_AR } from "../accounting/coa";

const dateRange = (q: any) => {
  const from = q.from && isDate(q.from) ? q.from : "1900-01-01";
  const to = q.to && isDate(q.to) ? q.to : today();
  return { from, to };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Optional branch filter on journal_entries alias `e`: appends the param and returns the SQL fragment ("" when not filtered). */
/** Inline branch filter on journal_entries alias e (uuid-validated literal). */
const bLit = (q: any) => (q?.branchId && UUID_RE.test(String(q.branchId)) ? ` AND e.branch_id='${q.branchId}'::uuid` : "");
export const branchCond = (q: any, params: any[], alias = "e") => {
  const b = q?.branchId;
  if (!b || !UUID_RE.test(String(b))) return "";
  params.push(String(b));
  return ` AND ${alias}.branch_id=$${params.length}`;
};

/** Balance per account: opening (before from), period movement, closing. */
export async function trialBalance(t: Db, companyId: string, q: any) {
  const { from, to } = dateRange(q);
  const tbParams: any[] = [companyId, from, to];
  const tbBranch = branchCond(q, tbParams);
  const rows = await t.rows(
    `SELECT a.id, a.code, a.name_ar, a.name_en, a.type, a.subtype, a.parent_id, a.level, a.is_group,
       COALESCE(SUM(CASE WHEN e.date < $2 THEN l.debit - l.credit END),0) opening,
       COALESCE(SUM(CASE WHEN e.date BETWEEN $2 AND $3 THEN l.debit END),0) debit,
       COALESCE(SUM(CASE WHEN e.date BETWEEN $2 AND $3 THEN l.credit END),0) credit
     FROM accounts a
     LEFT JOIN journal_lines l ON l.account_id=a.id
     LEFT JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED'${tbBranch}
     WHERE a.company_id=$1 AND NOT a.is_group
     GROUP BY a.id ORDER BY a.code`,
    tbParams,
  );
  const list = rows
    .map((r) => {
      const closing = r2(D(r.opening).plus(r.debit).minus(r.credit));
      return { ...r, opening: r2(r.opening), debit: r2(r.debit), credit: r2(r.credit), closing, openingDr: r.opening > 0 ? r2(r.opening) : 0, openingCr: r.opening < 0 ? r2(-r.opening) : 0, closingDr: closing > 0 ? closing : 0, closingCr: closing < 0 ? -closing : 0 };
    })
    .filter((r) => q.all === "1" || r.opening !== 0 || r.debit !== 0 || r.credit !== 0 || r.closing !== 0);
  const tot = (k: string) => r2(list.reduce((a, r: any) => a + r[k], 0));
  return {
    from, to, rows: list,
    totals: { openingDr: tot("openingDr"), openingCr: tot("openingCr"), debit: tot("debit"), credit: tot("credit"), closingDr: tot("closingDr"), closingCr: tot("closingCr") },
    balanced: Math.abs(tot("debit") - tot("credit")) < 0.005 && Math.abs(tot("closingDr") - tot("closingCr")) < 0.005,
  };
}

export async function generalLedger(t: Db, companyId: string, q: any) {
  const { from, to } = dateRange(q);
  if (!q.accountId) throw bad("اختر الحساب");
  const acc = await t.one(`SELECT * FROM accounts WHERE id=$1 AND company_id=$2`, [q.accountId, companyId]);
  const obP: any[] = [acc.id, from];
  const obB = branchCond(q, obP);
  const ob = await t.one(
    `SELECT COALESCE(SUM(l.debit - l.credit),0) b FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id=$1 AND e.status='POSTED' AND e.date < $2${obB}`,
    obP,
  );
  const glP: any[] = [acc.id, from, to];
  const glB = branchCond(q, glP);
  const lines = await t.rows(
    `SELECT e.id AS entry_id, e.number, e.date, e.type, e.memo, e.reference, e.source_type, e.source_id, l.debit, l.credit, l.description, l.partner_id, p.name AS partner_name
     FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id LEFT JOIN partners p ON p.id=l.partner_id
     WHERE l.account_id=$1 AND e.status='POSTED' AND e.date BETWEEN $2 AND $3${glB} ORDER BY e.date, e.created_at, l.sort`,
    glP,
  );
  let bal = D(ob.b);
  const out = lines.map((l) => {
    bal = bal.plus(l.debit).minus(l.credit);
    return { ...l, balance: r2(bal) };
  });
  return { account: acc, from, to, opening: r2(ob.b), rows: out, closing: r2(bal), totalDebit: r2(lines.reduce((a, l) => a + l.debit, 0)), totalCredit: r2(lines.reduce((a, l) => a + l.credit, 0)) };
}

export async function journalBook(t: Db, companyId: string, q: any) {
  const { from, to } = dateRange(q);
  const limit = Math.min(Number(q.limit) || 200, 2000);
  const offset = Number(q.offset) || 0;
  const where = [`e.company_id=$1`, `e.date BETWEEN $2 AND $3`];
  const params: any[] = [companyId, from, to];
  if (q.type) { params.push(q.type); where.push(`e.type=$${params.length}`); }
  if (q.status) { params.push(q.status); where.push(`e.status=$${params.length}`); }
  const jb = branchCond(q, params); if (jb) where.push(jb.replace(" AND ", ""));
  if (q.search) { params.push(`%${q.search}%`); where.push(`(e.number ILIKE $${params.length} OR e.memo ILIKE $${params.length} OR e.reference ILIKE $${params.length})`); }
  const total = await t.one(`SELECT COUNT(*)::int c FROM journal_entries e WHERE ${where.join(" AND ")}`, params);
  params.push(limit, offset);
  const entries = await t.rows(`SELECT e.* FROM journal_entries e WHERE ${where.join(" AND ")} ORDER BY e.date DESC, e.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  if (entries.length) {
    const lines = await t.rows(
      `SELECT l.*, a.code, a.name_ar, p.name AS partner_name FROM journal_lines l JOIN accounts a ON a.id=l.account_id LEFT JOIN partners p ON p.id=l.partner_id WHERE l.entry_id = ANY($1) ORDER BY l.sort`,
      [entries.map((e) => e.id)],
    );
    const by = new Map<string, any[]>();
    for (const l of lines) (by.get(l.entryId) || by.set(l.entryId, []).get(l.entryId)!).push(l);
    for (const e of entries) e.lines = by.get(e.id) || [];
  }
  return { from, to, total: total.c, rows: entries };
}

async function balancesByType(t: Db, companyId: string, from: string, to: string, branchId?: string) {
  const params: any[] = [companyId, from, to];
  const bc = branchCond({ branchId }, params);
  return t.rows(
    `SELECT a.id, a.code, a.name_ar, a.type, a.subtype, a.parent_id, COALESCE(SUM(l.debit - l.credit),0) bal
     FROM accounts a JOIN journal_lines l ON l.account_id=a.id JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED'
     WHERE a.company_id=$1 AND e.date BETWEEN $2 AND $3${bc} GROUP BY a.id HAVING COALESCE(SUM(l.debit - l.credit),0) <> 0 ORDER BY a.code`,
    params,
  );
}

function group(rows: any[], subtypes: string[], sign: 1 | -1) {
  const sections = subtypes.map((s) => {
    const items = rows.filter((r) => r.subtype === s).map((r) => ({ code: r.code, name: r.nameAr, amount: r2(D(r.bal).times(sign)) }));
    return { subtype: s, name: SUBTYPE_AR[s] || s, items, total: r2(items.reduce((a, i) => a + i.amount, 0)) };
  }).filter((s) => s.items.length);
  return { sections, total: r2(sections.reduce((a, s) => a + s.total, 0)) };
}

export async function incomeStatement(t: Db, companyId: string, q: any) {
  const { from, to } = dateRange(q);
  const rows = (await balancesByType(t, companyId, from, to, q.branchId)).filter((r) => r.type === "REVENUE" || r.type === "EXPENSE");
  const sales = group(rows, ["SALES"], -1);
  const returns = group(rows, ["SALES_RETURNS"], -1);
  const netSales = r2(sales.total + returns.total);
  const cogs = group(rows, ["COGS"], 1);
  const grossProfit = r2(netSales - cogs.total);
  const opex = group(rows, ["EXPENSE", "SELLING_EXPENSE"], 1);
  const operating = r2(grossProfit - opex.total);
  const otherIncome = group(rows, ["OTHER_INCOME"], -1);
  const otherExp = group(rows, ["OTHER_EXPENSE"], 1);
  const beforeZakat = r2(operating + otherIncome.total - otherExp.total);
  const zakat = group(rows, ["ZAKAT"], 1);
  const net = r2(beforeZakat - zakat.total);
  return { from, to, sales, returns, netSales, cogs, grossProfit, grossMargin: netSales ? r2((grossProfit / netSales) * 100) : 0, opex, operating, otherIncome, otherExp, beforeZakat, zakat, net, netMargin: netSales ? r2((net / netSales) * 100) : 0 };
}

/** Income statement with a comparison column: previous period of equal length, or the same period last year. */
export async function incomeStatementCompare(t: Db, companyId: string, q: any) {
  const { from, to } = dateRange(q);
  let pFrom: string, pTo: string;
  if (q.compare === "year") { pFrom = addMonths(from, -12); pTo = addMonths(to, -12); }
  else if (from.endsWith("-01") && to === monthEnd(to)) { const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1; pTo = addDays(from, -1); pFrom = addMonths(from, -months); }
  else { const len = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1; pTo = addDays(from, -1); pFrom = addDays(pTo, -(len - 1)); }
  const [current, previous] = await Promise.all([incomeStatement(t, companyId, { from, to, branchId: q.branchId }), incomeStatement(t, companyId, { from: pFrom, to: pTo, branchId: q.branchId })]);
  const merge = (a: any, b: any) => {
    const codes = new Map<string, any>();
    for (const sec of a.sections) for (const i of sec.items) codes.set(i.code, { code: i.code, name: i.name, section: sec.name, cur: i.amount, prev: 0 });
    for (const sec of b.sections) for (const i of sec.items) { const x = codes.get(i.code) || { code: i.code, name: i.name, section: sec.name, cur: 0, prev: 0 }; x.prev = i.amount; codes.set(i.code, x); }
    return [...codes.values()].sort((x, y) => x.code.localeCompare(y.code)).map((x) => ({ ...x, change: r2(x.cur - x.prev), pct: x.prev ? r2(((x.cur - x.prev) / Math.abs(x.prev)) * 100) : null }));
  };
  const line = (k: string) => ({ cur: current[k], prev: previous[k], change: r2(current[k] - previous[k]), pct: previous[k] ? r2(((current[k] - previous[k]) / Math.abs(previous[k])) * 100) : null });
  return {
    from, to, prevFrom: pFrom, prevTo: pTo, mode: q.compare === "year" ? "year" : "prev",
    sales: merge(current.sales, previous.sales), returns: merge(current.returns, previous.returns), cogs: merge(current.cogs, previous.cogs), opex: merge(current.opex, previous.opex),
    otherIncome: merge(current.otherIncome, previous.otherIncome), otherExp: merge(current.otherExp, previous.otherExp), zakat: merge(current.zakat, previous.zakat),
    netSales: line("netSales"), grossProfit: line("grossProfit"), operating: line("operating"), beforeZakat: line("beforeZakat"), net: line("net"),
    grossMargin: { cur: current.grossMargin, prev: previous.grossMargin }, netMargin: { cur: current.netMargin, prev: previous.netMargin },
  };
}

/** Profit & loss by cost center (journal lines carrying a cost center; the rest is "غير موزع"). */
export async function costCenterPnl(t: Db, companyId: string, q: any) {
  const { from, to } = dateRange(q);
  const rows = await t.rows(
    `SELECT c.id, c.code, c.name,
       COALESCE(SUM(CASE WHEN a.type='REVENUE' THEN l.credit-l.debit END),0) revenue,
       COALESCE(SUM(CASE WHEN a.subtype='COGS' THEN l.debit-l.credit END),0) cogs,
       COALESCE(SUM(CASE WHEN a.type='EXPENSE' AND a.subtype<>'COGS' THEN l.debit-l.credit END),0) expenses
     FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id LEFT JOIN cost_centers c ON c.id=l.cost_center_id
     WHERE a.company_id=$1 AND a.type IN ('REVENUE','EXPENSE') AND e.status='POSTED' AND e.type<>'CLOSING' AND e.date BETWEEN $2 AND $3
     GROUP BY c.id, c.code, c.name ORDER BY c.code NULLS LAST`, [companyId, from, to]);
  const list = rows.map((r) => ({ id: r.id, code: r.code || "—", name: r.name || "غير موزع على مركز تكلفة", revenue: r2(r.revenue), cogs: r2(r.cogs), expenses: r2(r.expenses), gross: r2(r.revenue - r.cogs), net: r2(r.revenue - r.cogs - r.expenses) }));
  let detail: any[] = [];
  if (q.costCenterId !== undefined) {
    detail = await t.rows(
      `SELECT a.code, a.name_ar, a.type, a.subtype, SUM(CASE WHEN a.type='REVENUE' THEN l.credit-l.debit ELSE l.debit-l.credit END) amount
       FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id
       WHERE a.company_id=$1 AND a.type IN ('REVENUE','EXPENSE') AND e.status='POSTED' AND e.type<>'CLOSING' AND e.date BETWEEN $2 AND $3 AND ${q.costCenterId ? "l.cost_center_id=$4" : "l.cost_center_id IS NULL"}
       GROUP BY a.id HAVING SUM(l.debit-l.credit) <> 0 ORDER BY a.code`, q.costCenterId ? [companyId, from, to, q.costCenterId] : [companyId, from, to]);
    detail = detail.map((d) => ({ ...d, amount: r2(d.amount) }));
  }
  const tot = (k: string) => r2(list.reduce((a, r: any) => a + r[k], 0));
  return { from, to, rows: list, detail, totals: { revenue: tot("revenue"), cogs: tot("cogs"), expenses: tot("expenses"), gross: tot("gross"), net: tot("net") } };
}

/** Profit & loss and sales KPIs side by side for every branch (journal entries carry the branch). */
export async function branchPnl(t: Db, companyId: string, q: any) {
  const { from, to } = dateRange(q);
  const rows = await t.rows(
    `SELECT b.id, b.code, b.name, b.is_main,
       COALESCE(SUM(CASE WHEN a.subtype='SALES' THEN l.credit-l.debit END),0) sales,
       COALESCE(SUM(CASE WHEN a.subtype='SALES_RETURNS' THEN l.debit-l.credit END),0) returns,
       COALESCE(SUM(CASE WHEN a.type='REVENUE' AND a.subtype NOT IN ('SALES','SALES_RETURNS') THEN l.credit-l.debit END),0) other_income,
       COALESCE(SUM(CASE WHEN a.subtype='COGS' THEN l.debit-l.credit END),0) cogs,
       COALESCE(SUM(CASE WHEN a.type='EXPENSE' AND a.subtype<>'COGS' THEN l.debit-l.credit END),0) expenses
     FROM branches b
     LEFT JOIN journal_entries e ON e.branch_id=b.id AND e.status='POSTED' AND e.type<>'CLOSING' AND e.date BETWEEN $2 AND $3
     LEFT JOIN journal_lines l ON l.entry_id=e.id
     LEFT JOIN accounts a ON a.id=l.account_id AND a.type IN ('REVENUE','EXPENSE')
     WHERE b.company_id=$1${q.branchId && UUID_RE.test(String(q.branchId)) ? ` AND b.id='${q.branchId}'::uuid` : ""} GROUP BY b.id ORDER BY b.is_main DESC, b.code`, [companyId, from, to]);
  const kpi = await t.rows(
    `SELECT i.branch_id, COUNT(*) FILTER (WHERE i.kind='INVOICE')::int invoices, COUNT(*) FILTER (WHERE i.kind='INVOICE' AND i.channel='POS')::int pos_orders,
       COALESCE(SUM(CASE WHEN i.kind='INVOICE' THEN i.total END),0) gross, COUNT(DISTINCT i.partner_id)::int customers
     FROM invoices i WHERE i.company_id=$1 AND i.direction='SALE' AND i.status='POSTED' AND i.date BETWEEN $2 AND $3 GROUP BY i.branch_id`, [companyId, from, to]);
  const cash = await t.rows(
    `SELECT e.branch_id, COALESCE(SUM(l.debit-l.credit),0) bal FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id
     WHERE e.company_id=$1 AND e.status='POSTED' AND e.date <= $2 AND a.is_cash_bank GROUP BY e.branch_id`, [companyId, to]);
  const stock = await t.rows(
    `SELECT w.branch_id, COALESCE(SUM(sb.value),0) value FROM stock_balances sb JOIN warehouses w ON w.id=sb.warehouse_id WHERE sb.company_id=$1 GROUP BY w.branch_id`, [companyId]).catch(() => [] as any[]);
  const list = rows.map((r) => {
    const k = kpi.find((x) => x.branchId === r.id) || {};
    const netSales = r2(r.sales - r.returns);
    const gross = r2(netSales - r.cogs);
    const net = r2(gross + Number(r.otherIncome) - r.expenses);
    return {
      id: r.id, code: r.code, name: r.name, isMain: r.isMain,
      sales: r2(r.sales), returns: r2(r.returns), netSales, cogs: r2(r.cogs), gross, grossMargin: netSales ? r2((gross / netSales) * 100) : 0,
      otherIncome: r2(r.otherIncome), expenses: r2(r.expenses), net, netMargin: netSales ? r2((net / netSales) * 100) : 0,
      invoices: k.invoices || 0, posOrders: k.posOrders || 0, customers: k.customers || 0, avgTicket: k.invoices ? r2(Number(k.gross) / k.invoices) : 0,
      cash: r2(cash.find((x) => x.branchId === r.id)?.bal || 0), stock: r2(stock.find((x) => x.branchId === r.id)?.value || 0),
    };
  });
  const tot = (k: string) => r2(list.reduce((a, r: any) => a + Number(r[k] || 0), 0));
  const totals: any = {};
  for (const k of ["sales", "returns", "netSales", "cogs", "gross", "otherIncome", "expenses", "net", "invoices", "posOrders", "cash", "stock"]) totals[k] = tot(k);
  totals.grossMargin = totals.netSales ? r2((totals.gross / totals.netSales) * 100) : 0;
  totals.netMargin = totals.netSales ? r2((totals.net / totals.netSales) * 100) : 0;
  return { from, to, rows: list, totals };
}

export async function balanceSheet(t: Db, companyId: string, q: any) {
  const to = q.to && isDate(q.to) ? q.to : today();
  const rows = await balancesByType(t, companyId, "1900-01-01", to, q.branchId);
  const currentAssets = group(rows.filter((r) => r.type === "ASSET"), ["CASH", "BANK", "RECEIVABLE", "INVENTORY", "CURRENT_ASSET"], 1);
  const fixedAssets = group(rows.filter((r) => r.type === "ASSET"), ["FIXED_ASSET", "ACC_DEPRECIATION"], 1);
  const totalAssets = r2(currentAssets.total + fixedAssets.total);
  const currentLiab = group(rows.filter((r) => r.type === "LIABILITY"), ["PAYABLE", "TAX", "CURRENT_LIABILITY"], -1);
  const ltLiab = group(rows.filter((r) => r.type === "LIABILITY"), ["LONG_TERM_LIABILITY"], -1);
  const totalLiab = r2(currentLiab.total + ltLiab.total);
  const equity = group(rows.filter((r) => r.type === "EQUITY"), ["CAPITAL", "EQUITY", "RETAINED"], -1);
  // unclosed result (revenue - expense) up to date
  const result = r2(rows.filter((r) => r.type === "REVENUE" || r.type === "EXPENSE").reduce((a, r) => a - Number(r.bal), 0));
  const totalEquity = r2(equity.total + result);
  return { to, currentAssets, fixedAssets, totalAssets, currentLiab, ltLiab, totalLiab, equity, currentResult: result, totalEquity, totalLiabEquity: r2(totalLiab + totalEquity), balanced: Math.abs(totalAssets - (totalLiab + totalEquity)) < 0.005 };
}

/** Direct-method cash flow: movements on cash/bank accounts classified by counterpart. */
export async function cashFlow(t: Db, companyId: string, q: any) {
  const { from, to } = dateRange(q);
  const cfO: any[] = [companyId, from];
  const cfOB = branchCond(q, cfO);
  const opening = await t.one(
    `SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id
     WHERE a.company_id=$1 AND a.is_cash_bank AND e.status='POSTED' AND e.date < $2${cfOB}`, cfO);
  const cfP: any[] = [companyId, from, to];
  const cfB = branchCond(q, cfP);
  const rows = await t.rows(
    `WITH cash_entries AS (
       SELECT e.id, SUM(l.debit - l.credit) cash_delta FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id JOIN accounts a ON a.id=l.account_id
       WHERE e.company_id=$1 AND e.status='POSTED' AND e.date BETWEEN $2 AND $3${cfB} AND a.is_cash_bank GROUP BY e.id HAVING SUM(l.debit - l.credit) <> 0)
     SELECT a.subtype, a.type, SUM(l.credit - l.debit) amt
     FROM cash_entries ce JOIN journal_lines l ON l.entry_id=ce.id JOIN accounts a ON a.id=l.account_id
     WHERE NOT a.is_cash_bank GROUP BY a.subtype, a.type`,
    cfP,
  );
  const cls = (s: string, ty: string) => (["FIXED_ASSET", "ACC_DEPRECIATION"].includes(s) ? "investing" : ["CAPITAL", "EQUITY", "RETAINED", "LONG_TERM_LIABILITY"].includes(s) || ty === "EQUITY" ? "financing" : "operating");
  const out: any = { operating: [], investing: [], financing: [] };
  for (const r of rows) out[cls(r.subtype, r.type)].push({ name: SUBTYPE_AR[r.subtype] || r.subtype, amount: r2(r.amt) });
  const sumOf = (k: string) => r2(out[k].reduce((a: number, x: any) => a + x.amount, 0));
  const net = r2(sumOf("operating") + sumOf("investing") + sumOf("financing"));
  return { from, to, opening: r2(opening.b), operating: out.operating, investing: out.investing, financing: out.financing, totals: { operating: sumOf("operating"), investing: sumOf("investing"), financing: sumOf("financing") }, net, closing: r2(D(opening.b).plus(net)) };
}

export async function partnerStatement(t: Db, companyId: string, partnerId: string, q: any) {
  const { from, to } = dateRange(q);
  const partner = await t.one(`SELECT * FROM partners WHERE id=$1 AND company_id=$2`, [partnerId, companyId], "الطرف غير موجود");
  const role = q.role === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER";
  const key = role === "CUSTOMER" ? "AR" : "AP";
  const sign = role === "CUSTOMER" ? 1 : -1; // customer balance = debit; supplier = credit
  const ob = await t.one(
    `SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id
     WHERE l.company_id=$1 AND l.partner_id=$2 AND a.system_key=$3 AND e.status='POSTED' AND e.date < $4${bLit(q)}`, [companyId, partnerId, key, from]);
  const lines = await t.rows(
    `SELECT e.number, e.date, e.type, e.memo, e.reference, e.source_type, e.source_id, l.debit, l.credit FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id
     WHERE l.company_id=$1 AND l.partner_id=$2 AND a.system_key=$3 AND e.status='POSTED' AND e.date BETWEEN $4 AND $5${bLit(q)} ORDER BY e.date, e.created_at`, [companyId, partnerId, key, from, to]);
  let bal = D(ob.b).times(sign);
  const rows = lines.map((l) => {
    const dr = sign === 1 ? l.debit : l.credit, cr = sign === 1 ? l.credit : l.debit;
    bal = bal.plus(dr).minus(cr);
    return { ...l, debit: dr, credit: cr, balance: r2(bal) };
  });
  return { partner, role, from, to, opening: r2(D(ob.b).times(sign)), rows, closing: r2(bal) };
}

export async function aging(t: Db, companyId: string, q: any) {
  const asOf = q.to && isDate(q.to) ? q.to : today();
  const dir = q.role === "SUPPLIER" ? "PURCHASE" : "SALE";
  const rows = await t.rows(
    `SELECT i.partner_id, p.name, i.number, i.date, i.due_date, i.total, i.amount_paid, (i.total - i.amount_paid) due, ($2::date - COALESCE(i.due_date, i.date)) days
     FROM invoices i JOIN partners p ON p.id=i.partner_id
     WHERE i.company_id=$1 AND i.direction=$3 AND i.kind='INVOICE' AND i.status='POSTED' AND i.total - i.amount_paid > 0.001 AND i.date <= $2${q.branchId && UUID_RE.test(String(q.branchId)) ? ` AND i.branch_id='${q.branchId}'::uuid` : ""} ORDER BY p.name, i.date`,
    [companyId, asOf, dir],
  );
  const buckets = ["current", "d30", "d60", "d90", "d120"];
  const bucket = (d: number) => (d <= 0 ? "current" : d <= 30 ? "d30" : d <= 60 ? "d60" : d <= 90 ? "d90" : "d120");
  const byPartner = new Map<string, any>();
  for (const r of rows) {
    const p = byPartner.get(r.partnerId) || { partnerId: r.partnerId, name: r.name, current: 0, d30: 0, d60: 0, d90: 0, d120: 0, total: 0, invoices: [] };
    p[bucket(Number(r.days))] = r2(p[bucket(Number(r.days))] + Number(r.due));
    p.total = r2(p.total + Number(r.due));
    p.invoices.push({ number: r.number, date: r.date, dueDate: r.dueDate, due: r2(r.due), days: Number(r.days) });
    byPartner.set(r.partnerId, p);
  }
  const list = [...byPartner.values()];
  const totals: any = { total: r2(list.reduce((a, p) => a + p.total, 0)) };
  for (const b of buckets) totals[b] = r2(list.reduce((a, p) => a + p[b], 0));
  return { asOf, role: dir === "SALE" ? "CUSTOMER" : "SUPPLIER", rows: list, totals };
}

export async function inventoryValuation(t: Db, companyId: string, q: any) {
  const rows = await t.rows(
    `SELECT p.id, p.sku, p.name, p.unit, p.sale_price, p.reorder_level, c.name AS category, w.name AS warehouse, w.id AS warehouse_id, b.qty, b.value,
       CASE WHEN b.qty > 0 THEN b.value / b.qty ELSE 0 END avg_cost
     FROM stock_balances b JOIN products p ON p.id=b.product_id JOIN warehouses w ON w.id=b.warehouse_id LEFT JOIN product_categories c ON c.id=p.category_id
     WHERE b.company_id=$1 AND (b.qty <> 0 OR b.value <> 0) ${q.warehouseId ? "AND b.warehouse_id=$2" : ""}${q.branchId && UUID_RE.test(String(q.branchId)) ? ` AND w.branch_id='${q.branchId}'::uuid` : ""} ORDER BY p.sku`,
    q.warehouseId ? [companyId, q.warehouseId] : [companyId],
  );
  const gl = await t.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND a.system_key='INVENTORY' AND e.status='POSTED'${bLit(q)}`, [companyId]);
  const total = r2(rows.reduce((a, r) => a + Number(r.value), 0));
  return { rows: rows.map((r) => ({ ...r, avgCost: r2(r.avgCost), value: r2(r.value), retail: r2(D(r.qty).times(r.salePrice)) })), total, glBalance: r2(gl.b), matches: Math.abs(total - Number(gl.b)) < 0.005 };
}

export async function stockCard(t: Db, companyId: string, productId: string, q: any) {
  const { from, to } = dateRange(q);
  const product = await t.one(`SELECT * FROM products WHERE id=$1 AND company_id=$2`, [productId, companyId], "الصنف غير موجود");
  const rows = await t.rows(
    `SELECT m.*, w.name AS warehouse FROM stock_moves m JOIN warehouses w ON w.id=m.warehouse_id WHERE m.company_id=$1 AND m.product_id=$2 AND m.date BETWEEN $3 AND $4 ORDER BY m.date, m.created_at`,
    [companyId, productId, from, to],
  );
  return { product, from, to, rows };
}

/** VAT return in the ZATCA form layout (boxes 1-15). */
export async function vatReturn(t: Db, companyId: string, q: any) {
  const { from, to } = dateRange(q);
  const sales = await t.rows(
    `SELECT l.tax_code, i.kind, SUM(l.net_amount) net, SUM(l.vat_amount) vat FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id
     WHERE i.company_id=$1 AND i.direction='SALE' AND i.status='POSTED' AND i.kind IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE') AND i.date BETWEEN $2 AND $3 GROUP BY l.tax_code, i.kind`,
    [companyId, from, to],
  );
  const purch = await t.rows(
    `SELECT l.tax_code, i.kind, SUM(l.net_amount) net, SUM(l.vat_amount) vat FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id
     WHERE i.company_id=$1 AND i.direction='PURCHASE' AND i.status='POSTED' AND i.kind IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE') AND i.date BETWEEN $2 AND $3 GROUP BY l.tax_code, i.kind`,
    [companyId, from, to],
  );
  const exp = await t.rows(`SELECT tax_code, SUM(amount) net, SUM(vat_amount) vat FROM expenses WHERE company_id=$1 AND status='POSTED' AND date BETWEEN $2 AND $3 GROUP BY tax_code`, [companyId, from, to]);
  const assets = await t.rows(
    `SELECT COALESCE(SUM(l.debit - l.credit),0) vat FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id
     WHERE a.company_id=$1 AND a.system_key='VAT_IN' AND e.type='ASSET' AND e.status='POSTED' AND e.date BETWEEN $2 AND $3`, [companyId, from, to]);
  const sgn = (k: string) => (k === "CREDIT_NOTE" ? -1 : 1);
  const acc = (rows: any[], codes: string[]) => ({
    net: r2(rows.filter((r) => codes.includes(r.taxCode)).reduce((a, r) => a + Number(r.net) * sgn(r.kind || "INVOICE"), 0)),
    vat: r2(rows.filter((r) => codes.includes(r.taxCode)).reduce((a, r) => a + Number(r.vat) * sgn(r.kind || "INVOICE"), 0)),
  });
  const s = acc(sales, ["S"]), sz = acc(sales, ["Z"]), sx = acc(sales, ["X"]), se = acc(sales, ["E"]);
  const p = acc([...purch, ...exp], ["S"]), pim = acc([...purch, ...exp], ["IM"]), prc = acc([...purch, ...exp], ["RC"]), pz = acc([...purch, ...exp], ["Z", "E"]);
  const rcVat = r2(prc.net * 0.15);
  const assetVat = r2(assets[0]?.vat || 0);
  const boxes = [
    { no: 1, label: "المبيعات الخاضعة للنسبة الأساسية 15%", net: s.net, vat: s.vat },
    { no: 2, label: "المبيعات للمواطنين (الخدمات الصحية والتعليم الخاص والمسكن الأول)", net: 0, vat: 0 },
    { no: 3, label: "المبيعات المحلية الخاضعة لنسبة الصفر", net: sz.net, vat: 0 },
    { no: 4, label: "الصادرات", net: sx.net, vat: 0 },
    { no: 5, label: "المبيعات المعفاة", net: se.net, vat: 0 },
    { no: 6, label: "إجمالي المبيعات", net: r2(s.net + sz.net + sx.net + se.net), vat: s.vat, total: true },
    { no: 7, label: "المشتريات الخاضعة للنسبة الأساسية 15%", net: r2(p.net + assetVat / 0.15), vat: r2(p.vat + assetVat) },
    { no: 8, label: "الواردات الخاضعة للضريبة المدفوعة بالجمارك", net: pim.net, vat: pim.vat },
    { no: 9, label: "الواردات الخاضعة للضريبة (آلية الاحتساب العكسي)", net: prc.net, vat: rcVat },
    { no: 10, label: "المشتريات الخاضعة لنسبة الصفر / المعفاة", net: pz.net, vat: 0 },
    { no: 11, label: "إجمالي المشتريات", net: r2(p.net + assetVat / 0.15 + pim.net + prc.net + pz.net), vat: r2(p.vat + assetVat + pim.vat + rcVat), total: true },
  ];
  const outputVat = r2(s.vat + rcVat);
  const inputVat = r2(p.vat + assetVat + pim.vat + rcVat);
  const net = r2(outputVat - inputVat);
  const gl = await t.rows(
    `SELECT a.system_key, COALESCE(SUM(l.credit - l.debit),0) bal FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id
     WHERE a.company_id=$1 AND a.system_key IN ('VAT_OUT','VAT_IN') AND e.status='POSTED' AND e.date BETWEEN $2 AND $3 AND e.type <> 'VAT_SETTLEMENT' GROUP BY a.system_key`,
    [companyId, from, to],
  );
  const glOut = r2(gl.find((g) => g.systemKey === "VAT_OUT")?.bal || 0);
  const glIn = r2(-(gl.find((g) => g.systemKey === "VAT_IN")?.bal || 0));
  return { from, to, boxes, outputVat, inputVat, net, glOutputVat: glOut, glInputVat: glIn, reconciled: Math.abs(glOut - outputVat) < 0.01 && Math.abs(glIn - inputVat) < 0.01 };
}

export async function integrity(t: Db, companyId: string) {
  const checks: { name: string; ok: boolean; a: number; b: number; note?: string }[] = [];
  const tb = await trialBalance(t, companyId, {});
  checks.push({ name: "ميزان المراجعة متوازن (مدين = دائن)", ok: tb.balanced, a: tb.totals.debit, b: tb.totals.credit });
  const bs = await balanceSheet(t, companyId, {});
  checks.push({ name: "الميزانية العمومية متوازنة (الأصول = الخصوم + حقوق الملكية)", ok: bs.balanced, a: bs.totalAssets, b: bs.totalLiabEquity });
  const unb = await t.one(`SELECT COUNT(*)::int c FROM (SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id WHERE e.company_id=$1 AND e.status='POSTED' GROUP BY e.id HAVING SUM(l.debit)<>SUM(l.credit)) x`, [companyId]);
  checks.push({ name: "لا توجد قيود غير متوازنة", ok: unb.c === 0, a: unb.c, b: 0 });
  const arGl = await t.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND a.system_key='AR' AND e.status='POSTED'`, [companyId]);
  const arDocs = await t.one(`SELECT COALESCE(SUM(CASE WHEN kind='CREDIT_NOTE' THEN -(total-amount_paid) ELSE total-amount_paid END),0) b FROM invoices WHERE company_id=$1 AND direction='SALE' AND status='POSTED' AND kind IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE')`, [companyId]);
  const arUnalloc = await t.one(`SELECT COALESCE(SUM(amount-allocated),0) b FROM payments WHERE company_id=$1 AND direction='IN' AND status='POSTED'`, [companyId]);
  checks.push({ name: "رصيد حساب العملاء = أرصدة فواتير العملاء المفتوحة − دفعات غير مخصصة", ok: Math.abs(Number(arGl.b) - (Number(arDocs.b) - Number(arUnalloc.b))) < 0.01, a: r2(arGl.b), b: r2(Number(arDocs.b) - Number(arUnalloc.b)) });
  const apGl = await t.one(`SELECT COALESCE(SUM(l.credit-l.debit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND a.system_key='AP' AND e.status='POSTED'`, [companyId]);
  const apDocs = await t.one(`SELECT COALESCE(SUM(CASE WHEN kind='CREDIT_NOTE' THEN -(total-amount_paid) ELSE total-amount_paid END),0) b FROM invoices WHERE company_id=$1 AND direction='PURCHASE' AND status='POSTED' AND kind IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE')`, [companyId]);
  const apExp = await t.one(`SELECT COALESCE(SUM(total),0) b FROM expenses WHERE company_id=$1 AND status='POSTED' AND pay_account_id IS NULL`, [companyId]);
  const apUnalloc = await t.one(`SELECT COALESCE(SUM(amount-allocated),0) b FROM payments WHERE company_id=$1 AND direction='OUT' AND status='POSTED'`, [companyId]);
  const apAssets = await t.one(`SELECT COALESCE(SUM(l.credit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND a.system_key='AP' AND e.type='ASSET' AND e.status='POSTED'`, [companyId]);
  checks.push({ name: "رصيد حساب الموردين = فواتير المشتريات المفتوحة + مصروفات آجلة + أصول آجلة − دفعات غير مخصصة", ok: Math.abs(Number(apGl.b) - (Number(apDocs.b) + Number(apExp.b) + Number(apAssets.b) - Number(apUnalloc.b))) < 0.01, a: r2(apGl.b), b: r2(Number(apDocs.b) + Number(apExp.b) + Number(apAssets.b) - Number(apUnalloc.b)), note: "المصروفات الآجلة تُسدد بسندات صرف للمورد" });
  const inv = await inventoryValuation(t, companyId, {});
  checks.push({ name: "قيمة المخزون الفعلية = رصيد حساب المخزون", ok: inv.matches, a: inv.total, b: inv.glBalance });
  const vat = await vatReturn(t, companyId, {});
  checks.push({ name: "ضريبة المخرجات في المستندات = حساب ضريبة المخرجات", ok: Math.abs(vat.outputVat - vat.glOutputVat) < 0.01, a: vat.outputVat, b: vat.glOutputVat });
  checks.push({ name: "ضريبة المدخلات في المستندات = حساب ضريبة المدخلات", ok: Math.abs(vat.inputVat - vat.glInputVat) < 0.01, a: vat.inputVat, b: vat.glInputVat });
  const fa = await t.one(`SELECT COALESCE(SUM(cost),0) c, COALESCE(SUM(accumulated),0) d FROM fixed_assets WHERE company_id=$1 AND status<>'DISPOSED'`, [companyId]);
  const faGl = await t.one(`SELECT COALESCE(SUM(CASE WHEN a.subtype='FIXED_ASSET' THEN l.debit-l.credit END),0) c, COALESCE(SUM(CASE WHEN a.subtype='ACC_DEPRECIATION' THEN l.credit-l.debit END),0) d FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND e.status='POSTED'`, [companyId]);
  checks.push({ name: "سجل الأصول الثابتة = حسابات الأصول الثابتة", ok: Math.abs(Number(fa.c) - Number(faGl.c)) < 0.01, a: r2(fa.c), b: r2(faGl.c) });
  checks.push({ name: "مجمع الإهلاك في السجل = حساب مجمع الإهلاك", ok: Math.abs(Number(fa.d) - Number(faGl.d)) < 0.01, a: r2(fa.d), b: r2(faGl.d) });
  const prov = await provisionTotals(t, companyId);
  const provGl = await t.rows(`SELECT a.system_key k, COALESCE(SUM(l.credit-l.debit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND a.system_key IN ('EOSB_PROVISION','LEAVE_PROVISION','EMP_ADVANCES') AND e.status='POSTED' GROUP BY 1`, [companyId]);
  const g = (k: string) => r2(provGl.find((x) => x.k === k)?.b || 0);
  checks.push({ name: "سجل مخصص نهاية الخدمة للموظفين = حساب مخصص نهاية الخدمة", ok: Math.abs(prov.EOSB - g("EOSB_PROVISION")) < 0.01, a: prov.EOSB, b: g("EOSB_PROVISION") });
  checks.push({ name: "سجل مخصص الإجازات للموظفين = حساب مخصص الإجازات", ok: Math.abs(prov.LEAVE - g("LEAVE_PROVISION")) < 0.01, a: prov.LEAVE, b: g("LEAVE_PROVISION") });
  const loans = await t.one(`SELECT COALESCE(SUM(amount-paid),0) b FROM employee_loans WHERE company_id=$1 AND status='ACTIVE'`, [companyId]);
  checks.push({ name: "سلف الموظفين القائمة = حساب سلف وعهد الموظفين", ok: Math.abs(Number(loans.b) + g("EMP_ADVANCES")) < 0.01, a: r2(loans.b), b: r2(-g("EMP_ADVANCES")), note: "العهد النقدية المسجلة يدوياً على نفس الحساب تظهر كفرق" });
  const lots = await t.one(`SELECT COALESCE(SUM(b.qty),0) s, COALESCE((SELECT SUM(l.qty) FROM stock_lots l JOIN products p2 ON p2.id=l.product_id WHERE l.company_id=$1 AND p2.track_lots),0) l FROM stock_balances b JOIN products p ON p.id=b.product_id WHERE b.company_id=$1 AND p.track_lots`, [companyId]);
  checks.push({ name: "أرصدة الدفعات (Lots) = كميات المخزون للأصناف المتتبعة", ok: Math.abs(Number(lots.s) - Number(lots.l)) < 0.001, a: r2(lots.l), b: r2(lots.s) });
  const br = await t.one(
    `SELECT (SELECT COUNT(*)::int FROM journal_entries WHERE company_id=$1 AND branch_id IS NULL) unassigned,
       COALESCE((SELECT SUM(l.debit-l.credit) FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND a.system_key='INTER_BRANCH' AND e.status='POSTED'),0) inter`, [companyId]);
  checks.push({ name: "كل القيود موزعة على فروع وجاري الفروع متوازن على مستوى المنشأة", ok: br.unassigned === 0 && Math.abs(Number(br.inter)) < 0.01, a: br.unassigned, b: r2(br.inter), note: "a = قيود بلا فرع، b = رصيد جاري الفروع (يجب أن يكون صفراً)" });
  return { ok: checks.every((c) => c.ok), checks };
}

export async function dashboard(t: Db, companyId: string, branchId?: string | null) {
  // optional branch scope (validated uuid → inlined literal)
  const B = branchId && UUID_RE.test(branchId) ? `'${branchId}'::uuid` : null;
  const IB = B ? ` AND branch_id=${B}` : "";            // invoices (unaliased)
  const IIB = B ? ` AND i.branch_id=${B}` : "";         // invoices i
  const EB = B ? ` AND e.branch_id=${B}` : "";          // journal_entries e
  const WB = B ? ` AND warehouse_id IN (SELECT id FROM warehouses WHERE branch_id=${B})` : "";
  const td = today();
  const month = td.slice(0, 7) + "-01";
  const kpi = async (sql: string, params: any[]) => Number((await t.one(sql, params)).v || 0);
  const salesMonth = await kpi(`SELECT COALESCE(SUM(CASE WHEN kind='CREDIT_NOTE' THEN -total ELSE total END),0) v FROM invoices WHERE company_id=$1 AND direction='SALE' AND status='POSTED' AND kind IN ('INVOICE','CREDIT_NOTE') AND date >= $2${IB}`, [companyId, month]);
  const salesToday = await kpi(`SELECT COALESCE(SUM(CASE WHEN kind='CREDIT_NOTE' THEN -total ELSE total END),0) v FROM invoices WHERE company_id=$1 AND direction='SALE' AND status='POSTED' AND kind IN ('INVOICE','CREDIT_NOTE') AND date = $2${IB}`, [companyId, td]);
  const purchMonth = await kpi(`SELECT COALESCE(SUM(CASE WHEN kind='CREDIT_NOTE' THEN -total ELSE total END),0) v FROM invoices WHERE company_id=$1 AND direction='PURCHASE' AND status='POSTED' AND kind IN ('INVOICE','CREDIT_NOTE') AND date >= $2${IB}`, [companyId, month]);
  const expMonth = await kpi(`SELECT COALESCE(SUM(total),0) v FROM expenses x WHERE company_id=$1 AND status='POSTED' AND date >= $2${B ? ` AND EXISTS (SELECT 1 FROM journal_entries e WHERE e.id=x.journal_id${EB})` : ""}`, [companyId, month]);
  const ar = await kpi(`SELECT COALESCE(SUM(l.debit-l.credit),0) v FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND a.system_key='AR' AND e.status='POSTED'${EB}`, [companyId]);
  const ap = await kpi(`SELECT COALESCE(SUM(l.credit-l.debit),0) v FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND a.system_key='AP' AND e.status='POSTED'${EB}`, [companyId]);
  const cash = await t.rows(`SELECT a.code, a.name_ar, COALESCE(SUM(l.debit-l.credit),0) bal FROM accounts a LEFT JOIN journal_lines l ON l.account_id=a.id LEFT JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED'${EB} WHERE a.company_id=$1 AND a.is_cash_bank AND NOT a.is_group GROUP BY a.id ORDER BY a.code`, [companyId]);
  const vatOut = await kpi(`SELECT COALESCE(SUM(l.credit-l.debit),0) v FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND a.system_key='VAT_OUT' AND e.status='POSTED'${EB}`, [companyId]);
  const vatIn = await kpi(`SELECT COALESCE(SUM(l.debit-l.credit),0) v FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND a.system_key='VAT_IN' AND e.status='POSTED'${EB}`, [companyId]);
  const inventory = await kpi(`SELECT COALESCE(SUM(value),0) v FROM stock_balances WHERE company_id=$1${WB}`, [companyId]);
  const start12 = addDays(month, -335).slice(0, 7) + "-01";
  const trend = await t.rows(
    `SELECT to_char(date,'YYYY-MM') m,
       SUM(CASE WHEN direction='SALE' THEN CASE WHEN kind='CREDIT_NOTE' THEN -total ELSE total END ELSE 0 END) sales,
       SUM(CASE WHEN direction='PURCHASE' THEN CASE WHEN kind='CREDIT_NOTE' THEN -total ELSE total END ELSE 0 END) purchases
     FROM invoices WHERE company_id=$1 AND status='POSTED' AND kind IN ('INVOICE','CREDIT_NOTE') AND date >= $2${IB} GROUP BY 1 ORDER BY 1`, [companyId, start12]);
  const pnl = await t.rows(
    `SELECT to_char(e.date,'YYYY-MM') m, SUM(CASE WHEN a.type='REVENUE' THEN l.credit-l.debit ELSE 0 END) revenue, SUM(CASE WHEN a.type='EXPENSE' THEN l.debit-l.credit ELSE 0 END) expense
     FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND e.status='POSTED' AND e.type<>'CLOSING' AND e.date >= $2${EB} GROUP BY 1 ORDER BY 1`, [companyId, start12]);
  const topProducts = await t.rows(
    `SELECT p.name, SUM(l.qty * l.factor) qty, SUM(l.net_amount) net FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id JOIN products p ON p.id=l.product_id
     WHERE i.company_id=$1 AND i.direction='SALE' AND i.kind='INVOICE' AND i.status='POSTED' AND i.date >= $2${IIB} GROUP BY p.id ORDER BY net DESC LIMIT 8`, [companyId, addDays(td, -90)]);
  const topCustomers = await t.rows(
    `SELECT p.name, SUM(i.total) total FROM invoices i JOIN partners p ON p.id=i.partner_id WHERE i.company_id=$1 AND i.direction='SALE' AND i.kind='INVOICE' AND i.status='POSTED' AND i.date >= $2${IIB} GROUP BY p.id ORDER BY total DESC LIMIT 8`, [companyId, addDays(td, -90)]);
  const lowStock = await t.rows(`SELECT p.sku, p.name, p.reorder_level, COALESCE(SUM(b.qty),0) qty FROM products p LEFT JOIN stock_balances b ON b.product_id=p.id${B ? ` AND b.warehouse_id IN (SELECT id FROM warehouses WHERE branch_id=${B})` : ""} WHERE p.company_id=$1 AND p.type='STOCK' AND p.is_active GROUP BY p.id HAVING COALESCE(SUM(b.qty),0) <= p.reorder_level ORDER BY qty LIMIT 10`, [companyId]);
  const overdue = await t.rows(`SELECT i.number, p.name, i.due_date, i.total-i.amount_paid due FROM invoices i JOIN partners p ON p.id=i.partner_id WHERE i.company_id=$1 AND i.direction='SALE' AND i.kind='INVOICE' AND i.status='POSTED' AND i.total-i.amount_paid>0.001 AND i.due_date < $2${IIB} ORDER BY i.due_date LIMIT 10`, [companyId, td]);
  const recent = await t.rows(`SELECT id, number, kind, direction, partner_name, total, date, status, payment_status FROM invoices WHERE company_id=$1 AND status='POSTED'${IB} ORDER BY created_at DESC LIMIT 8`, [companyId]);
  const openSession = await t.maybe(`SELECT number, user_name, opened_at, cash_sales, card_sales, orders_count FROM pos_sessions WHERE company_id=$1 AND status='OPEN'${WB} ORDER BY opened_at DESC LIMIT 1`, [companyId]);
  const zatca = await t.rows(`SELECT zatca_status s, COUNT(*)::int c FROM invoices WHERE company_id=$1 AND direction='SALE' AND status='POSTED' AND zatca_status IS NOT NULL${IB} GROUP BY 1`, [companyId]);
  const alerts = B ? { items: [], vat: { filed: true } } : await accountantAlerts(t, companyId, td);
  return { alerts, salesMonth: r2(salesMonth), salesToday: r2(salesToday), purchMonth: r2(purchMonth), expMonth: r2(expMonth), ar: r2(ar), ap: r2(ap), cash: cash.map((c) => ({ ...c, bal: r2(c.bal) })), cashTotal: r2(cash.reduce((a, c) => a + Number(c.bal), 0)), vatDue: r2(vatOut - vatIn), inventory: r2(inventory), trend, pnl: pnl.map((p) => ({ ...p, revenue: r2(p.revenue), expense: r2(p.expense), profit: r2(p.revenue - p.expense) })), topProducts, topCustomers, lowStock, overdue, recent, openSession, zatca };
}

/** Things an accountant should act on today. */
export async function accountantAlerts(t: Db, companyId: string, td: string) {
  const co = await t.one(`SELECT vat_period, plan, subscription_ends_at, created_at FROM companies WHERE id=$1`, [companyId]);
  const n = async (sql: string, params: any[]) => (await t.one(sql, params));
  const drafts = await n(`SELECT COUNT(*)::int c, COALESCE(SUM(total),0) v FROM invoices WHERE company_id=$1 AND status='DRAFT' AND kind IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE')`, [companyId]);
  const overdue = await n(`SELECT COUNT(*)::int c, COALESCE(SUM(total-amount_paid),0) v FROM invoices WHERE company_id=$1 AND direction='SALE' AND kind='INVOICE' AND status='POSTED' AND total-amount_paid>0.001 AND due_date < $2`, [companyId, td]);
  const payables = await n(`SELECT COUNT(*)::int c, COALESCE(SUM(total-amount_paid),0) v FROM invoices WHERE company_id=$1 AND direction='PURCHASE' AND kind='INVOICE' AND status='POSTED' AND total-amount_paid>0.001 AND due_date <= $2`, [companyId, addDays(td, 7)]);
  const lowStock = await n(`SELECT COUNT(*)::int c FROM (SELECT p.id FROM products p LEFT JOIN stock_balances b ON b.product_id=p.id WHERE p.company_id=$1 AND p.type='STOCK' AND p.is_active GROUP BY p.id HAVING COALESCE(SUM(b.qty),0) <= p.reorder_level) x`, [companyId]);
  const zatcaPending = await n(`SELECT COUNT(*)::int c FROM invoices WHERE company_id=$1 AND status='POSTED' AND zatca_status IN ('PENDING','FAILED','REJECTED')`, [companyId]);
  const cheques = await n(`SELECT COUNT(*)::int c, COALESCE(SUM(amount),0) v FROM cheques WHERE company_id=$1 AND status IN ('PENDING','DEPOSITED') AND due_date <= $2`, [companyId, addDays(td, 7)]);
  const staleSessions = await n(`SELECT COUNT(*)::int c FROM pos_sessions WHERE company_id=$1 AND status='OPEN' AND opened_at < now() - interval '20 hours'`, [companyId]);
  const payroll = await n(`SELECT COUNT(*)::int c FROM payroll_runs WHERE company_id=$1 AND period=$2`, [companyId, td.slice(0, 7)]);
  const emps = await n(`SELECT COUNT(*)::int c FROM employees WHERE company_id=$1 AND is_active`, [companyId]);
  // next VAT return: last completed period (month or quarter) not yet filed
  const monthly = co.vatPeriod === "MONTHLY";
  const m = Number(td.slice(5, 7)), y = Number(td.slice(0, 4));
  const endMonth = monthly ? (m === 1 ? 12 : m - 1) : (Math.ceil(m / 3) - 1) * 3 || 12;
  const endYear = endMonth > m || (monthly ? m === 1 : m <= 3) ? y - 1 : y;
  const periodTo = monthEnd(`${endYear}-${String(endMonth).padStart(2, "0")}-01`);
  const periodFrom = monthly ? periodTo.slice(0, 8) + "01" : `${endYear}-${String(endMonth - 2).padStart(2, "0")}-01`;
  const dueDate = monthEnd(addDays(periodTo, 1));
  const filed = await t.maybe(`SELECT id FROM vat_returns WHERE company_id=$1 AND period_to >= $2`, [companyId, periodTo]);
  const daysToVat = Math.round((Date.parse(dueDate) - Date.parse(td)) / 86400000);
  const items: { level: "err" | "warn" | "info"; text: string; to: string; count?: number }[] = [];
  if (!filed) items.push({ level: daysToVat < 0 ? "err" : daysToVat <= 15 ? "warn" : "info", text: `إقرار ضريبة القيمة المضافة عن الفترة ${periodFrom} — ${periodTo} ${daysToVat < 0 ? `متأخر ${-daysToVat} يوم` : `مستحق خلال ${daysToVat} يوم (${dueDate})`}`, to: "/vat" });
  if (overdue.c) items.push({ level: "err", text: `${overdue.c} فاتورة مبيعات متأخرة السداد بإجمالي ${r2(overdue.v).toLocaleString("en-US", { minimumFractionDigits: 2 })} ر.س`, to: "/reports/aging", count: overdue.c });
  if (payables.c) items.push({ level: "warn", text: `${payables.c} فاتورة موردين تستحق خلال 7 أيام بإجمالي ${r2(payables.v).toLocaleString("en-US", { minimumFractionDigits: 2 })} ر.س`, to: "/purchases/invoices", count: payables.c });
  if (cheques.c) items.push({ level: "warn", text: `${cheques.c} شيك يستحق خلال 7 أيام (${r2(cheques.v).toLocaleString("en-US", { minimumFractionDigits: 2 })} ر.س)`, to: "/cheques", count: cheques.c });
  if (drafts.c) items.push({ level: "info", text: `${drafts.c} مستند غير مرحّل (مسودات) بقيمة ${r2(drafts.v).toLocaleString("en-US", { minimumFractionDigits: 2 })} ر.س`, to: "/sales/invoices", count: drafts.c });
  if (zatcaPending.c) items.push({ level: "warn", text: `${zatcaPending.c} فاتورة لم تُرسل أو رُفضت في منصة فاتورة`, to: "/zatca", count: zatcaPending.c });
  const exp = await n(`SELECT COUNT(*) FILTER (WHERE expiry_date < $2)::int expired, COUNT(*) FILTER (WHERE expiry_date BETWEEN $2 AND $3)::int soon FROM stock_lots WHERE company_id=$1 AND qty > 0`, [companyId, td, addDays(td, 30)]);
  if (exp.expired) items.push({ level: "err", text: `${exp.expired} دفعة منتهية الصلاحية ما زالت في المخزون — أتلفها أو أرجعها للمورد`, to: "/lots", count: exp.expired });
  if (exp.soon) items.push({ level: "warn", text: `${exp.soon} دفعة تنتهي صلاحيتها خلال 30 يوماً`, to: "/lots", count: exp.soon });
  if (lowStock.c) items.push({ level: "info", text: `${lowStock.c} صنف وصل حد إعادة الطلب`, to: "/inventory", count: lowStock.c });
  if (staleSessions.c) items.push({ level: "warn", text: `${staleSessions.c} وردية نقاط بيع مفتوحة منذ أكثر من 20 ساعة — أغلقها`, to: "/pos", count: staleSessions.c });
  if (emps.c && !payroll.c && Number(td.slice(8, 10)) >= 25) items.push({ level: "info", text: `لم يُنشأ مسير رواتب شهر ${td.slice(0, 7)} بعد`, to: "/payroll" });
  if (co.plan === "TRIAL" && co.subscriptionEndsAt) { const dl = Math.round((new Date(co.subscriptionEndsAt).getTime() - Date.parse(td)) / 86400000); if (dl <= 7) items.push({ level: dl < 0 ? "err" : "warn", text: dl < 0 ? "انتهت الفترة التجريبية — فعّل الترخيص" : `تنتهي الفترة التجريبية خلال ${dl} يوم`, to: "/settings/license" }); }
  return { items, vat: { periodFrom, periodTo, dueDate, filed: !!filed } };
}
