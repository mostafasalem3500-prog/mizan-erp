/**
 * Round 27 — final accounts (الحسابات الختامية) and the year-end closing checklist.
 *
 * finalAccounts(): the full statement set for one fiscal year with the prior year as comparative —
 *   balance sheet, income statement, statement of changes in equity, cash flows (direct + indirect) —
 *   and a list of linkage checks proving the statements tie to each other and to the ledger.
 * closeCheck(): what must / should be done before closing a year, plus a preview of the closing entry.
 */
import { Db } from "../db/pool";
import { bad, r2, D, today, addDays, addMonths, monthEnd } from "../lib/core";
import { balanceSheet, incomeStatement, cashFlow, trialBalance, integrity } from "./reports";
import { SUBTYPE_AR, SUBTYPES_BY_TYPE } from "../accounting/coa";

const near = (a: number, b: number, eps = 0.01) => Math.abs(Number(a) - Number(b)) < eps;

async function pickYear(t: Db, companyId: string, fiscalYearId?: string) {
  const years = await t.rows(`SELECT * FROM fiscal_years WHERE company_id=$1 ORDER BY start_date`, [companyId]);
  if (!years.length) throw bad("لا توجد سنوات مالية بعد — تُنشأ تلقائياً مع أول قيد");
  const td = today();
  const fy = fiscalYearId ? years.find((y) => y.id === fiscalYearId) : years.find((y) => td >= y.startDate && td <= y.endDate) || years[years.length - 1];
  if (!fy) throw bad("السنة المالية غير موجودة");
  const prevTo = addDays(fy.startDate, -1);
  const prev = years.find((y) => y.endDate === prevTo) || null;
  const prevFrom = prev ? prev.startDate : addMonths(fy.startDate, -12);
  return { years, fy, prev, prevFrom, prevTo };
}

/** Merge two grouped statements (sections → items) into one comparative table keyed by account code. */
function compare(cur: any, prev: any) {
  const names = new Map<string, string>();
  for (const g of [cur, prev]) for (const s of g.sections) names.set(s.subtype, s.name);
  return [...names.entries()].map(([subtype, name]) => {
    const c = cur.sections.find((s: any) => s.subtype === subtype);
    const p = prev.sections.find((s: any) => s.subtype === subtype);
    const items = new Map<string, any>();
    for (const i of c?.items || []) items.set(i.code, { code: i.code, name: i.name, cur: i.amount, prev: 0 });
    for (const i of p?.items || []) { const x = items.get(i.code) || { code: i.code, name: i.name, cur: 0, prev: 0 }; x.prev = i.amount; items.set(i.code, x); }
    return { subtype, name, items: [...items.values()].sort((a, b) => a.code.localeCompare(b.code)), cur: c?.total || 0, prev: p?.total || 0 };
  });
}

const EQ_COL = (subtype: string) => (subtype === "CAPITAL" ? "capital" : subtype === "RETAINED" ? "retained" : "other");

/** Statement of changes in equity for [from, to]. Columns: capital, retained earnings, other equity, unclosed result. */
async function equityStatement(t: Db, companyId: string, from: string, to: string) {
  const zero = () => ({ capital: 0, retained: 0, other: 0, result: 0 });
  const opening = zero();
  const ob = await t.rows(
    `SELECT a.type, a.subtype, COALESCE(SUM(l.credit - l.debit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id
     WHERE a.company_id=$1 AND e.status='POSTED' AND e.date < $2 AND a.type IN ('EQUITY','REVENUE','EXPENSE') GROUP BY a.type, a.subtype`, [companyId, from]);
  for (const r of ob) { if (r.type === "EQUITY") (opening as any)[EQ_COL(r.subtype)] += Number(r.b); else opening.result += Number(r.b); }
  // equity-account movements in the year, by account and by whether they come from the closing entry
  const mv = await t.rows(
    `SELECT a.code, a.name_ar, a.subtype, a.system_key, (e.type='CLOSING') closing, COALESCE(SUM(l.credit - l.debit),0) b
     FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id
     WHERE a.company_id=$1 AND e.status='POSTED' AND e.date BETWEEN $2 AND $3 AND a.type='EQUITY'
     GROUP BY a.code, a.name_ar, a.subtype, a.system_key, (e.type='CLOSING') HAVING COALESCE(SUM(l.credit - l.debit),0) <> 0 ORDER BY a.code`, [companyId, from, to]);
  const pl = await t.one(
    `SELECT COALESCE(SUM(CASE WHEN e.type<>'CLOSING' THEN l.credit - l.debit END),0) net, COALESCE(SUM(CASE WHEN e.type='CLOSING' THEN l.credit - l.debit END),0) closing
     FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id
     WHERE a.company_id=$1 AND e.status='POSTED' AND e.date BETWEEN $2 AND $3 AND a.type IN ('REVENUE','EXPENSE')`, [companyId, from, to]);
  const rows: any[] = [];
  const row = (label: string, kind: string, vals: Partial<ReturnType<typeof zero>>) => rows.push({ label, kind, ...zero(), ...vals });
  for (const m of mv.filter((x) => !x.closing)) {
    const amt = r2(m.b);
    const label = m.systemKey === "OWNER_CURRENT" ? (amt < 0 ? "مسحوبات المالك / الشركاء" : "إضافات المالك / الشركاء") : m.systemKey === "OPENING_EQUITY" ? "أرصدة افتتاحية" : m.subtype === "CAPITAL" ? (amt >= 0 ? "زيادة رأس المال" : "تخفيض رأس المال") : m.subtype === "RETAINED" ? (amt < 0 ? "توزيعات أرباح / تسويات على الأرباح المبقاة" : "تسويات على الأرباح المبقاة") : m.nameAr;
    row(`${label} (${m.code})`, "movement", { [EQ_COL(m.subtype)]: amt } as any);
  }
  row("صافي ربح (خسارة) السنة", "net", { result: r2(pl.net) });
  const closeEq = mv.filter((x) => x.closing);
  if (closeEq.length || Number(pl.closing) !== 0) {
    const v = zero();
    for (const m of closeEq) (v as any)[EQ_COL(m.subtype)] += Number(m.b);
    v.result = Number(pl.closing);
    row("ترحيل نتيجة السنة إلى الأرباح المبقاة (قيد الإقفال)", "closing", { capital: r2(v.capital), retained: r2(v.retained), other: r2(v.other), result: r2(v.result) });
  }
  const tot = (o: any) => r2(o.capital + o.retained + o.other + o.result);
  const op = { capital: r2(opening.capital), retained: r2(opening.retained), other: r2(opening.other), result: r2(opening.result) };
  const closing = { ...op };
  for (const r of rows) for (const k of ["capital", "retained", "other", "result"] as const) closing[k] = r2(closing[k] + r[k]);
  for (const r of rows) r.total = tot(r);
  return { opening: { ...op, total: tot(op) }, rows, closing: { ...closing, total: tot(closing) }, netIncome: r2(pl.net), closingTransfer: r2(-pl.closing) };
}

/** Indirect-method cash flow from balance movements of every non-cash account (closing entries excluded). */
async function indirectCashFlow(t: Db, companyId: string, from: string, to: string) {
  const mv = await t.rows(
    `SELECT a.code, a.name_ar, a.type, a.subtype, a.system_key, COALESCE(SUM(l.debit - l.credit),0) d
     FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id
     WHERE a.company_id=$1 AND e.status='POSTED' AND e.type<>'CLOSING' AND e.date BETWEEN $2 AND $3 AND NOT a.is_cash_bank
     GROUP BY a.code, a.name_ar, a.type, a.subtype, a.system_key HAVING COALESCE(SUM(l.debit - l.credit),0) <> 0`, [companyId, from, to]);
  let net = D(0);
  const adj = new Map<string, number>(), wc = new Map<string, number>(), inv: any[] = [], fin: any[] = [];
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, r2((m.get(k) || 0) + v));
  for (const r of mv) {
    const cash = -Number(r.d); // effect on cash of this account's movement
    if (r.type === "REVENUE" || r.type === "EXPENSE") { net = net.plus(cash); continue; }
    if (r.subtype === "ACC_DEPRECIATION") add(adj, "الإهلاك (مصروف غير نقدي)", cash);
    else if (["EOSB_PROVISION", "LEAVE_PROVISION"].includes(r.systemKey)) add(adj, "المخصصات (نهاية الخدمة والإجازات)", cash);
    else if (r.subtype === "FIXED_ASSET") inv.push({ code: r.code, name: cash < 0 ? `شراء ${r.nameAr}` : `استبعاد/بيع ${r.nameAr}`, amount: r2(cash) });
    else if (r.type === "EQUITY" || r.subtype === "LONG_TERM_LIABILITY") fin.push({ code: r.code, name: r.nameAr, amount: r2(cash) });
    else add(wc, r.type === "ASSET" ? `(الزيادة) النقص في ${SUBTYPE_AR[r.subtype] || r.subtype}` : `الزيادة (النقص) في ${SUBTYPE_AR[r.subtype] || r.subtype}`, cash);
  }
  const ni = r2(net);
  const adjustments = [...adj.entries()].map(([name, amount]) => ({ name, amount }));
  const workingCapital = [...wc.entries()].map(([name, amount]) => ({ name, amount })).filter((x) => x.amount !== 0);
  const s = (a: any[]) => r2(a.reduce((x, y) => x + y.amount, 0));
  const operating = r2(ni + s(adjustments) + s(workingCapital));
  const investing = s(inv), financing = s(fin);
  return { netIncome: ni, adjustments, workingCapital, operating, investing: inv, financing: fin, totals: { operating, investing, financing }, net: r2(operating + investing + financing) };
}

async function cashBalance(t: Db, companyId: string, to: string) {
  return r2((await t.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND a.is_cash_bank AND e.status='POSTED' AND e.date <= $2`, [companyId, to])).b);
}

export async function finalAccounts(t: Db, companyId: string, q: any) {
  const { years, fy, prev, prevFrom, prevTo } = await pickYear(t, companyId, q.fiscalYearId);
  const from = fy.startDate, to = fy.endDate;
  const [bs, bsP, is, isP, cfd] = [await balanceSheet(t, companyId, { to }), await balanceSheet(t, companyId, { to: prevTo }), await incomeStatement(t, companyId, { from, to }), await incomeStatement(t, companyId, { from: prevFrom, to: prevTo }), await cashFlow(t, companyId, { from, to })];
  const eq = await equityStatement(t, companyId, from, to);
  const cfi = await indirectCashFlow(t, companyId, from, to);
  const tb = await trialBalance(t, companyId, { from, to });
  const cashEnd = await cashBalance(t, companyId, to), cashStart = await cashBalance(t, companyId, prevTo);
  const bsCash = r2((bs.currentAssets.sections || []).filter((s: any) => ["CASH", "BANK"].includes(s.subtype)).reduce((a: number, s: any) => a + s.total, 0));
  const misclassified = await t.rows(`SELECT code, name_ar, type, subtype FROM accounts WHERE company_id=$1 AND NOT is_group`, [companyId]).then((r) => r.filter((a) => !SUBTYPES_BY_TYPE[a.type]?.includes(a.subtype)));
  const tempAfterClose = fy.status === "CLOSED" ? r2((await t.one(`SELECT COALESCE(SUM(ABS(b)),0) s FROM (SELECT SUM(l.debit-l.credit) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND e.status='POSTED' AND e.date BETWEEN $2 AND $3 AND a.type IN ('REVENUE','EXPENSE') GROUP BY a.id) x`, [companyId, from, to])).s) : null;
  const ig = await integrity(t, companyId);

  const checks: { key: string; name: string; ok: boolean; a: any; b: any; note?: string }[] = [];
  const c = (key: string, name: string, ok: boolean, a: any, b: any, note?: string) => checks.push({ key, name, ok, a, b, note });
  c("tb", "ميزان المراجعة للسنة متوازن (مدين = دائن)", tb.balanced, tb.totals.debit, tb.totals.credit);
  c("class", "كل الحسابات مصنفة تصنيفاً يناسب نوعها فتظهر في القوائم", misclassified.length === 0, misclassified.length, 0, misclassified.map((m) => m.code).join("، ") || undefined);
  c("bs", "قائمة المركز المالي متوازنة في نهاية السنة", bs.balanced, bs.totalAssets, bs.totalLiabEquity);
  c("bsPrev", "قائمة المركز المالي متوازنة في نهاية السنة السابقة (المقارنة)", bsP.balanced, bsP.totalAssets, bsP.totalLiabEquity);
  c("niEq", "صافي ربح قائمة الدخل = صافي الربح في قائمة التغيرات في حقوق الملكية", near(is.net, eq.netIncome), is.net, eq.netIncome);
  c("eqClose", "رصيد حقوق الملكية آخر السنة (قائمة التغيرات) = إجمالي حقوق الملكية في المركز المالي", near(eq.closing.total, bs.totalEquity), eq.closing.total, bs.totalEquity);
  c("eqOpen", "رصيد حقوق الملكية أول السنة = إجمالي حقوق الملكية في المركز المالي للسنة السابقة", near(eq.opening.total, bsP.totalEquity), eq.opening.total, bsP.totalEquity);
  c("cfNet", "صافي التغير في النقدية: الطريقة المباشرة = الطريقة غير المباشرة", near(cfd.net, cfi.net), cfd.net, cfi.net);
  c("cfOpen", "نقدية أول المدة في قائمة التدفقات = أرصدة النقدية والبنوك في نهاية السنة السابقة", near(cfd.opening, cashStart), cfd.opening, cashStart);
  c("cfClose", "نقدية آخر المدة في قائمة التدفقات = النقدية والبنوك في المركز المالي", near(cfd.closing, cashEnd) && near(cashEnd, bsCash), cfd.closing, bsCash, near(cashEnd, bsCash) ? undefined : "حساب مصنف نقدية/بنوك غير معلَّم «حساب نقدية» أو العكس");
  c("result", "نتيجة السنة غير المقفلة في المركز المالي = صافي الربح − المحوَّل للأرباح المبقاة + نتيجة السنوات السابقة غير المقفلة", near(bs.currentResult, r2(eq.closing.result)), bs.currentResult, eq.closing.result);
  if (fy.status === "CLOSED") c("closed", "بعد قيد الإقفال: أرصدة الإيرادات والمصروفات للسنة صفر وصافي الربح حُوّل للأرباح المبقاة", near(tempAfterClose!, 0) && near(eq.closingTransfer, is.net), tempAfterClose, eq.closingTransfer);
  c("sub", "الدفاتر المساعدة (العملاء، الموردون، المخزون، الضريبة، الأصول، المخصصات) تطابق الأستاذ العام", ig.ok, ig.checks.filter((x) => !x.ok).length, 0, ig.checks.filter((x) => !x.ok).map((x) => x.name).join(" | ") || undefined);

  return {
    fiscalYear: { id: fy.id, name: fy.name, from, to, status: fy.status, closedAt: fy.closedAt },
    prior: { name: prev?.name || `${prevFrom.slice(0, 4)}`, from: prevFrom, to: prevTo, exists: !!prev },
    years: years.map((y) => ({ id: y.id, name: y.name, status: y.status })),
    balanceSheet: {
      currentAssets: compare(bs.currentAssets, bsP.currentAssets), fixedAssets: compare(bs.fixedAssets, bsP.fixedAssets),
      currentLiab: compare(bs.currentLiab, bsP.currentLiab), ltLiab: compare(bs.ltLiab, bsP.ltLiab), equity: compare(bs.equity, bsP.equity),
      totals: {
        currentAssets: [bs.currentAssets.total, bsP.currentAssets.total], fixedAssets: [bs.fixedAssets.total, bsP.fixedAssets.total], assets: [bs.totalAssets, bsP.totalAssets],
        currentLiab: [bs.currentLiab.total, bsP.currentLiab.total], ltLiab: [bs.ltLiab.total, bsP.ltLiab.total], liab: [bs.totalLiab, bsP.totalLiab],
        equityAccounts: [bs.equity.total, bsP.equity.total], currentResult: [bs.currentResult, bsP.currentResult], equity: [bs.totalEquity, bsP.totalEquity], liabEquity: [bs.totalLiabEquity, bsP.totalLiabEquity],
      },
    },
    incomeStatement: {
      sales: compare(is.sales, isP.sales), returns: compare(is.returns, isP.returns), cogs: compare(is.cogs, isP.cogs), opex: compare(is.opex, isP.opex),
      otherIncome: compare(is.otherIncome, isP.otherIncome), otherExp: compare(is.otherExp, isP.otherExp), zakat: compare(is.zakat, isP.zakat),
      totals: { netSales: [is.netSales, isP.netSales], cogs: [is.cogs.total, isP.cogs.total], gross: [is.grossProfit, isP.grossProfit], opex: [is.opex.total, isP.opex.total], operating: [is.operating, isP.operating], otherIncome: [is.otherIncome.total, isP.otherIncome.total], otherExp: [is.otherExp.total, isP.otherExp.total], beforeZakat: [is.beforeZakat, isP.beforeZakat], zakat: [is.zakat.total, isP.zakat.total], net: [is.net, isP.net], grossMargin: [is.grossMargin, isP.grossMargin], netMargin: [is.netMargin, isP.netMargin] },
    },
    equity: eq,
    cashFlow: { direct: cfd, indirect: cfi },
    checks,
    ok: checks.every((x) => x.ok),
  };
}

// ─── closing checklist ────────────────────────────────────────────────────
type Level = "ok" | "warn" | "block";

export async function closingPreview(t: Db, companyId: string, fy: any) {
  const bals = await t.rows(
    `SELECT a.code, a.name_ar, a.type, COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c
     FROM accounts a JOIN journal_lines l ON l.account_id=a.id JOIN journal_entries e ON e.id=l.entry_id
     WHERE a.company_id=$1 AND a.type IN ('REVENUE','EXPENSE') AND e.status='POSTED' AND e.type<>'CLOSING' AND e.date BETWEEN $2 AND $3
     GROUP BY a.code, a.name_ar, a.type HAVING COALESCE(SUM(l.debit),0) <> COALESCE(SUM(l.credit),0) ORDER BY a.code`, [companyId, fy.startDate, fy.endDate]);
  let net = D(0);
  const lines = bals.map((b) => { const bal = D(b.c).minus(b.d); net = net.plus(bal); return { code: b.code, name: b.nameAr, debit: bal.gt(0) ? r2(bal) : 0, credit: bal.lt(0) ? r2(bal.neg()) : 0 }; });
  const retained = await t.maybe(`SELECT code, name_ar FROM accounts WHERE company_id=$1 AND system_key='RETAINED'`, [companyId]);
  const n = r2(net);
  if (lines.length) lines.push({ code: retained?.code || "", name: retained?.nameAr || "الأرباح المبقاة", debit: n < 0 ? -n : 0, credit: n > 0 ? n : 0 });
  return { lines, netIncome: n, debit: r2(lines.reduce((a, l) => a + l.debit, 0)), credit: r2(lines.reduce((a, l) => a + l.credit, 0)) };
}

export async function closeCheck(t: Db, companyId: string, fiscalYearId: string) {
  const fy = await t.one(`SELECT * FROM fiscal_years WHERE id=$1 AND company_id=$2`, [fiscalYearId, companyId], "السنة المالية غير موجودة");
  const from = fy.startDate, to = fy.endDate;
  const company = await t.one(`SELECT * FROM companies WHERE id=$1`, [companyId]);
  const isCharity = !!(await t.maybe(`SELECT 1 FROM charity_settings WHERE company_id=$1`, [companyId]));
  const items: { key: string; label: string; level: Level; detail?: string; to?: string }[] = [];
  const it = (key: string, label: string, level: Level, detail?: string, to?: string) => items.push({ key, label, level, detail, to });
  const one = async (sql: string, params: any[]) => t.one(sql, params);

  const prevOpen = await t.rows(`SELECT y.name FROM fiscal_years y WHERE y.company_id=$1 AND y.start_date < $2 AND y.status='OPEN' AND EXISTS (SELECT 1 FROM journal_entries e WHERE e.company_id=$1 AND e.status='POSTED' AND e.date BETWEEN y.start_date AND y.end_date)`, [companyId, from]);
  it("prevYears", "السنوات السابقة مقفلة (الإقفال بالتسلسل)", prevOpen.length ? "block" : "ok", prevOpen.length ? `أقفل أولاً: ${prevOpen.map((y) => y.name).join("، ")}` : undefined, "/periods");
  const drafts = await one(`SELECT COUNT(*)::int c FROM invoices WHERE company_id=$1 AND status='DRAFT' AND kind IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE') AND date BETWEEN $2 AND $3`, [companyId, from, to]);
  it("drafts", "لا توجد فواتير أو إشعارات غير مرحّلة داخل السنة", drafts.c ? "block" : "ok", drafts.c ? `${drafts.c} مستند مسودة` : undefined, "/sales");
  const pos = await one(`SELECT COUNT(*)::int c FROM pos_sessions WHERE company_id=$1 AND status='OPEN'`, [companyId]);
  it("pos", "ورديات نقاط البيع مغلقة", pos.c ? "block" : "ok", pos.c ? `${pos.c} وردية مفتوحة` : undefined, "/pos");
  const unb = await one(`SELECT COUNT(*)::int c FROM (SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id WHERE e.company_id=$1 AND e.status='POSTED' AND e.date BETWEEN $2 AND $3 GROUP BY e.id HAVING SUM(l.debit)<>SUM(l.credit)) x`, [companyId, from, to]);
  it("balanced", "كل قيود السنة متوازنة", unb.c ? "block" : "ok", unb.c ? `${unb.c} قيد غير متوازن` : undefined, "/journals");

  const dep = await t.rows(`SELECT code, name FROM fixed_assets WHERE company_id=$1 AND status='ACTIVE' AND acquisition_date <= $2 AND (last_depreciation IS NULL OR last_depreciation < $3) AND accumulated < cost - COALESCE(salvage_value,0)`, [companyId, to, monthEnd(to)]);
  it("depreciation", "إهلاك الأصول الثابتة محسوب حتى نهاية السنة", dep.length ? "warn" : "ok", dep.length ? `${dep.length} أصل لم يُهلك حتى ${to}: ${dep.slice(0, 5).map((a) => a.code).join("، ")}` : undefined, "/assets");
  const emp = await one(`SELECT COUNT(*)::int c FROM employees WHERE company_id=$1 AND is_active AND hire_date <= $2`, [companyId, to]);
  if (emp.c) {
    const prov = await t.maybe(`SELECT 1 FROM hr_provisions WHERE company_id=$1 AND status='POSTED' AND date BETWEEN $2 AND $3`, [companyId, addDays(to, -40), addDays(to, 31)]);
    it("provisions", "مخصصات نهاية الخدمة والإجازات مستحقة حتى نهاية السنة", prov ? "ok" : "warn", prov ? undefined : `${emp.c} موظف — لا يوجد قيد استحقاق مخصصات لآخر شهر في السنة`, "/hr/provisions");
  }
  const vatMonths = await t.rows(
    `SELECT DISTINCT to_char(e.date,'YYYY-MM') m FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id JOIN accounts a ON a.id=l.account_id
     WHERE e.company_id=$1 AND e.status='POSTED' AND e.date BETWEEN $2 AND $3 AND a.system_key IN ('VAT_OUT','VAT_IN') AND e.type<>'VAT_SETTLEMENT'
       AND NOT EXISTS (SELECT 1 FROM vat_returns v WHERE v.company_id=$1 AND v.status='FILED' AND e.date BETWEEN v.period_from AND v.period_to) ORDER BY 1`, [companyId, from, to]);
  it("vat", "إقرارات ضريبة القيمة المضافة مقدّمة لكل فترات السنة", vatMonths.length ? "warn" : "ok", vatMonths.length ? `أشهر بها ضريبة بلا إقرار مقدَّم: ${vatMonths.map((m) => m.m).join("، ")}` : undefined, "/vat");
  if (!isCharity) {
    const zk = await t.maybe(`SELECT number FROM zakat_assessments WHERE company_id=$1 AND status NOT IN ('CANCELLED','VOID') AND period_to BETWEEN $2 AND $3 LIMIT 1`, [companyId, from, addDays(to, 1)]);
    it("zakat", "مخصص الزكاة الشرعية للسنة محسوب ومرحّل", zk ? "ok" : "warn", zk ? zk.number : "لم يُرحَّل وعاء/مخصص الزكاة لهذه السنة — يؤثر على صافي الربح", "/zakat");
  }
  const banks = await t.rows(
    `SELECT a.id, a.code, a.name_ar FROM accounts a WHERE a.company_id=$1 AND a.subtype='BANK' AND a.is_cash_bank AND a.system_key IS DISTINCT FROM 'CARD_CLEARING' AND a.system_key IS DISTINCT FROM 'ESTORE_CLEARING'
       AND EXISTS (SELECT 1 FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id=a.id AND e.status='POSTED' AND e.date BETWEEN $2 AND $3)
       AND NOT EXISTS (SELECT 1 FROM bank_reconciliations r WHERE r.company_id=$1 AND r.account_id=a.id AND r.statement_date >= $4)`, [companyId, from, to, addDays(monthEnd(to), -6)]);
  it("bankRec", "مطابقة كشوف البنوك في نهاية السنة", banks.length ? "warn" : "ok", banks.length ? `بدون مطابقة بتاريخ ${to}: ${banks.map((b) => `${b.code} ${b.nameAr}`).join("، ")}` : undefined, "/bank");
  const stock = await one(`SELECT COUNT(*)::int c FROM stock_balances WHERE company_id=$1 AND qty > 0`, [companyId]);
  if (stock.c) {
    const cnt = await t.maybe(`SELECT number FROM stock_adjustments WHERE company_id=$1 AND kind='COUNT' AND date BETWEEN $2 AND $3 LIMIT 1`, [companyId, addDays(to, -45), addDays(to, 30)]);
    it("count", "جرد فعلي للمخزون قرب نهاية السنة", cnt ? "ok" : "warn", cnt ? cnt.number : "لا يوجد جرد مسجل خلال 45 يوماً قبل نهاية السنة أو 30 يوماً بعدها", "/stock");
  }
  const neg = await one(`SELECT COUNT(*)::int c FROM stock_balances WHERE company_id=$1 AND qty < 0`, [companyId]);
  it("negStock", "لا توجد كميات مخزون سالبة", neg.c ? "warn" : "ok", neg.c ? `${neg.c} صنف/مستودع برصيد سالب` : undefined, "/stock");
  const negCash = await t.rows(`SELECT a.code, a.name_ar, SUM(l.debit-l.credit) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND a.is_cash_bank AND e.status='POSTED' AND e.date <= $2 GROUP BY a.code, a.name_ar HAVING SUM(l.debit-l.credit) < -0.005`, [companyId, to]);
  it("negCash", "لا توجد صناديق أو بنوك برصيد دائن (سالب)", negCash.length ? "warn" : "ok", negCash.length ? negCash.map((x) => `${x.code} ${x.nameAr}: ${r2(x.b)}`).join("، ") : undefined, "/accounts");
  const clearing = await t.rows(`SELECT a.code, a.name_ar, a.system_key, SUM(l.debit-l.credit) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND a.system_key IN ('OPENING_EQUITY','INTER_BRANCH','CARD_CLEARING','ESTORE_CLEARING') AND e.status='POSTED' AND e.date <= $2 GROUP BY a.code, a.name_ar, a.system_key HAVING ABS(SUM(l.debit-l.credit)) >= 0.01`, [companyId, to]);
  it("clearing", "الحسابات الوسيطة مصفّاة (الأرصدة الافتتاحية، جاري الفروع، تسوية البطاقات والمتاجر)", clearing.length ? "warn" : "ok", clearing.length ? clearing.map((x) => `${x.nameAr}: ${r2(x.b)}`).join("، ") + (clearing.some((x) => x.systemKey === "OPENING_EQUITY") ? " — حوّل رصيد «أرصدة افتتاحية» إلى رأس المال أو الأرباح المبقاة بقيد يومية" : "") : undefined, "/journals");
  if (isCharity) {
    const cus = await one(`SELECT COUNT(*)::int c, COALESCE(SUM(disbursed_amount),0) s FROM charity_custody WHERE company_id=$1 AND status='DISBURSED' AND disbursed_date <= $2`, [companyId, to]);
    it("custody", "العهد المالية المصروفة مسوّاة", cus.c ? "warn" : "ok", cus.c ? `${cus.c} عهدة غير مسوّاة بمبلغ ${r2(cus.s)}` : undefined, "/charity/custody");
  }
  const ig = await integrity(t, companyId);
  const bad = ig.checks.filter((x) => !x.ok);
  it("integrity", "الدفاتر المساعدة تطابق الأستاذ العام", bad.length ? "warn" : "ok", bad.length ? bad.map((x) => x.name).join(" | ") : undefined, "/reports");
  const preview = await closingPreview(t, companyId, fy);
  const cnt = (l: Level) => items.filter((i) => i.level === l).length;
  return { fiscalYear: { id: fy.id, name: fy.name, from, to, status: fy.status }, company: { name: company.nameAr, isCharity }, items, summary: { ok: cnt("ok"), warn: cnt("warn"), block: cnt("block") }, canClose: fy.status === "OPEN" && cnt("block") === 0, preview };
}
