/** Payroll lite: employees, monthly run with GOSI, accrual journal, salary payment, WPS file. */
import { Db } from "../db/pool";
import { bad, conflict, r2, D, num, isDate, today, monthEnd } from "../lib/core";
import { post } from "../accounting/engine";
import { loanInstallments, applyLoanInstallments } from "./hr";
import { IS_EG } from "../lib/country";
import { computeLineEG } from "./egypt";

// GOSI (2024+ new rates for Saudis: total 21.5% on basic+housing → 9.75% employee / 11.75% employer incl. hazards & SANED;
// non-Saudis: 2% occupational hazards, employer only). Rates are configurable per company later; sane defaults here.
export const GOSI = { SAUDI: { employee: 0.0975, employer: 0.1175 }, NON_SAUDI: { employee: 0, employer: 0.02 } };

export interface RunInput {
  period: string; // YYYY-MM
  date?: string; // posting date (default: month end)
  adjustments?: Record<string, { bonus?: number; overtime?: number; deduction?: number; absence?: number; loan?: number; note?: string }>; // by employee id; loan overrides the automatic installment
  notes?: string;
  isDemo?: boolean;
}

export function computeLine(e: any, adj: any = {}, loans: { id: string; amount: number }[] = []) {
  const basic = Number(e.basic), housing = Number(e.housing), transport = Number(e.transport), other = Number(e.otherAllow);
  const bonus = r2(num(adj.bonus)), overtime = r2(num(adj.overtime)), deduction = r2(num(adj.deduction)), absence = r2(num(adj.absence));
  const autoLoan = r2(loans.reduce((a, l) => a + l.amount, 0));
  const loan = adj.loan === undefined || adj.loan === null || adj.loan === "" ? autoLoan : Math.max(0, Math.min(autoLoan, r2(num(adj.loan))));
  // spread an overridden (smaller) installment over the loans in order
  let rem = loan; const loanItems = loans.map((l) => { const a = r2(Math.min(l.amount, rem)); rem = r2(rem - a); return { id: l.id, amount: a }; }).filter((l) => l.amount > 0);
  const gross = r2(D(basic).plus(housing).plus(transport).plus(other).plus(bonus).plus(overtime));
  const rates = e.gosi ? (GOSI as any)[e.nationality] || GOSI.NON_SAUDI : { employee: 0, employer: 0 };
  const gosiBase = Math.min(r2(D(basic).plus(housing)), 45000); // GOSI ceiling
  const gosiEmp = r2(gosiBase * rates.employee);
  const gosiEr = r2(gosiBase * rates.employer);
  const net = r2(D(gross).minus(gosiEmp).minus(deduction).minus(absence).minus(loan));
  return { employeeId: e.id, code: e.code, name: e.name, iban: e.iban, bankName: e.bankName, nationality: e.nationality, basic, housing, transport, other, bonus, overtime, deduction, absence, loan, loanItems, gross, gosiBase, gosiEmp, gosiEr, net, note: adj.note || null };
}

export async function createRun(t: Db, companyId: string, user: string, r: RunInput) {
  if (!/^\d{4}-\d{2}$/.test(r.period || "")) throw bad("الفترة يجب أن تكون بصيغة YYYY-MM");
  const date = r.date && isDate(r.date) ? r.date : monthEnd(r.period + "-01");
  const dup = await t.maybe(`SELECT id FROM payroll_runs WHERE company_id=$1 AND period=$2`, [companyId, r.period]);
  if (dup) throw conflict(`يوجد مسير رواتب لشهر ${r.period} مسبقاً`);
  const emps = await t.rows(`SELECT * FROM employees WHERE company_id=$1 AND is_active ORDER BY code`, [companyId]);
  if (!emps.length) throw bad("لا يوجد موظفون نشطون");
  const lines = await buildLines(t, companyId, r.period, emps, r.adjustments || {});
  const sum = (k: string) => r2(lines.reduce((a, l: any) => a + l[k], 0));
  const run = await t.insert("payroll_runs", { companyId, period: r.period, date, lines, totalGross: sum("gross"), totalGosiEmp: sum("gosiEmp"), totalGosiEr: sum("gosiEr"), totalDeductions: r2(sum("deduction") + sum("absence") + sum("loan")), totalNet: sum("net"), totalSalaryTax: IS_EG ? sum("salaryTax") : 0, totalMartyrs: IS_EG ? sum("martyrs") : 0, notes: r.notes || null, isDemo: !!r.isDemo, createdBy: user });
  await claimItems(t, companyId, run.id, lines);
  return run;
}

// ─── payroll transactions (overtime, bonuses, absence, lateness, penalties) ─
export const ITEM_KINDS: Record<string, { ar: string; side: "EARN" | "DEDUCT"; unit: "hours" | "days" | null; bucket: "overtime" | "bonus" | "absence" | "deduction" }> = {
  OVERTIME: { ar: "عمل إضافي", side: "EARN", unit: "hours", bucket: "overtime" }, BONUS: { ar: "مكافأة", side: "EARN", unit: null, bucket: "bonus" }, COMMISSION: { ar: "عمولة", side: "EARN", unit: null, bucket: "bonus" }, ALLOWANCE: { ar: "بدل لمرة واحدة", side: "EARN", unit: null, bucket: "bonus" },
  ABSENCE: { ar: "غياب", side: "DEDUCT", unit: "days", bucket: "absence" }, LATE: { ar: "تأخير", side: "DEDUCT", unit: "hours", bucket: "deduction" }, PENALTY: { ar: "جزاء", side: "DEDUCT", unit: "days", bucket: "deduction" }, DEDUCTION: { ar: "خصم آخر", side: "DEDUCT", unit: null, bucket: "deduction" },
};
export const OVERTIME_FACTOR = IS_EG ? 1.35 : 1.5;
/**
 * Amount of a transaction from the employee's wage. Month = 30 days of 8 hours.
 * Overtime (Saudi labour law art. 107): the hourly wage plus 50% of the basic hourly wage → hours × (wage + (factor − 1) × basic) / 240.
 * Absence and penalty days: wage / 30 per day. Lateness: wage / 240 per hour.
 */
export function itemAmount(e: any, kind: string, qty: number, factor?: number | null) {
  const basic = Number(e.basic), wage = basic + Number(e.housing) + Number(e.transport) + Number(e.otherAllow);
  if (kind === "OVERTIME") return r2((qty * (wage + ((factor || OVERTIME_FACTOR) - 1) * basic)) / 240);
  if (kind === "ABSENCE" || kind === "PENALTY") return r2((qty * wage) / 30);
  if (kind === "LATE") return r2((qty * wage) / 240);
  return 0;
}
export async function saveItem(t: Db, companyId: string, user: string, b: any, itemId?: string) {
  const K = ITEM_KINDS[b.kind]; if (!K) throw bad("نوع الحركة غير صحيح");
  const e = await t.one(`SELECT * FROM employees WHERE id=$1 AND company_id=$2`, [b.employeeId, companyId], "الموظف غير موجود");
  const date = isDate(b.date) ? b.date : today();
  const period = /^\d{4}-\d{2}$/.test(b.period || "") ? b.period : date.slice(0, 7);
  const qty = K.unit ? r2(num(b.qty)) : null;
  const typed = b.amount !== undefined && b.amount !== null && b.amount !== "" ? r2(num(b.amount)) : null;
  if (K.unit && !(qty! > 0) && !(typed! > 0)) throw bad(K.unit === "hours" ? "أدخل عدد الساعات" : "أدخل عدد الأيام");
  if (K.unit === "hours" && qty! > 300) throw bad("عدد الساعات غير منطقي");
  if (K.unit === "days" && qty! > 31) throw bad("عدد الأيام أكبر من الشهر");
  const factor = b.kind === "OVERTIME" ? Math.min(3, Math.max(1, num(b.factor) || OVERTIME_FACTOR)) : null;
  const computed = K.unit && qty! > 0 ? itemAmount(e, b.kind, qty!, factor) : 0;
  const amount = typed !== null && typed > 0 ? typed : computed;
  if (!(amount > 0)) throw bad("المبلغ مطلوب");
  const data = { employeeId: e.id, period, date, kind: b.kind, qty: qty && qty > 0 ? qty : null, factor, amount, manual: typed !== null && typed > 0 && Math.abs(typed - computed) > 0.005, note: b.note ? String(b.note).slice(0, 300) : null };
  if (itemId) {
    const cur = await t.one(`SELECT status FROM payroll_items WHERE id=$1 AND company_id=$2 FOR UPDATE`, [itemId, companyId], "الحركة غير موجودة");
    if (cur.status !== "OPEN") throw conflict("الحركة دخلت في مسير — احذف المسير المسودة أو أعد احتسابه أولاً");
    return t.update("payroll_items", { id: itemId }, data);
  }
  return t.insert("payroll_items", { companyId, ...data, createdBy: user });
}
export async function deleteItem(t: Db, companyId: string, itemId: string) {
  const cur = await t.one(`SELECT status FROM payroll_items WHERE id=$1 AND company_id=$2 FOR UPDATE`, [itemId, companyId], "الحركة غير موجودة");
  if (cur.status !== "OPEN") throw conflict("الحركة دخلت في مسير — لا تُحذف");
  await t.exec(`DELETE FROM payroll_items WHERE id=$1`, [itemId]);
}
/** The month's lines: fixed pay, the open transactions up to that month, manual adjustments typed on the run, and loan instalments. */
export async function buildLines(t: Db, companyId: string, period: string, emps: any[], manual: Record<string, any>) {
  const loans = await loanInstallments(t, companyId, period);
  const items = await t.rows(`SELECT id, employee_id, kind, qty, factor, amount, note, date, period FROM payroll_items WHERE company_id=$1 AND status='OPEN' AND period <= $2 ORDER BY date, created_at`, [companyId, period]);
  return emps.map((e) => {
    const mine = items.filter((i) => i.employeeId === e.id); const m = manual?.[e.id] || {};
    const bucket = (k: string) => r2(mine.filter((i) => ITEM_KINDS[i.kind]?.bucket === k).reduce((a, i) => a + Number(i.amount), 0) + num(m[k]));
    const adj = { bonus: bucket("bonus"), overtime: bucket("overtime"), deduction: bucket("deduction"), absence: bucket("absence"), loan: m.loan, note: m.note };
    const line: any = (IS_EG ? computeLineEG : computeLine)(e, adj, loans[e.id] || []);
    line.items = mine.map((i) => ({ id: i.id, kind: i.kind, qty: i.qty === null ? null : Number(i.qty), factor: i.factor === null ? null : Number(i.factor), amount: Number(i.amount), note: i.note, date: String(i.date instanceof Date ? i.date.toISOString() : i.date).slice(0, 10) }));
    line.manual = { bonus: r2(num(m.bonus)), overtime: r2(num(m.overtime)), deduction: r2(num(m.deduction)), absence: r2(num(m.absence)), loan: m.loan === undefined || m.loan === null || m.loan === "" ? null : r2(num(m.loan)) };
    line.costCenterId = e.costCenterId || null; line.jobTitle = e.jobTitle || null; line.department = e.department || null;
    // labour law art. 93: what is taken from the wage (other than statutory items) should not pass half of it
    line.deductTotal = r2(line.deduction + line.absence + (line.loan || 0));
    line.overHalf = line.deductTotal > r2(line.gross / 2) + 0.005;
    return line;
  });
}
async function claimItems(t: Db, companyId: string, runId: string, lines: any[]) {
  const ids = lines.flatMap((l) => (l.items || []).map((i: any) => i.id));
  if (ids.length) await t.exec(`UPDATE payroll_items SET status='INCLUDED', run_id=$2 WHERE company_id=$1 AND id = ANY($3::uuid[])`, [companyId, runId, `{${ids.join(",")}}`]);
}
/** A draft run is recomputed from today's employees, transactions and loans — keeping what was typed on the run itself. */
export async function recalcRun(t: Db, companyId: string, id: string) {
  const run = await t.one(`SELECT * FROM payroll_runs WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "المسير غير موجود");
  if (run.status !== "DRAFT") throw conflict("المسير مرحّل — لا يُعاد احتسابه");
  await t.exec(`UPDATE payroll_items SET status='OPEN', run_id=NULL WHERE company_id=$1 AND run_id=$2`, [companyId, id]);
  const manual: Record<string, any> = {}; for (const l of run.lines as any[]) if (l.manual) manual[l.employeeId] = { ...l.manual, loan: l.manual.loan ?? undefined, note: l.note };
  const emps = await t.rows(`SELECT * FROM employees WHERE company_id=$1 AND is_active ORDER BY code`, [companyId]);
  const lines = await buildLines(t, companyId, run.period, emps, manual);
  const sum = (k: string) => r2(lines.reduce((a, l: any) => a + l[k], 0));
  const r = await t.update("payroll_runs", { id }, { lines: JSON.stringify(lines), totalGross: sum("gross"), totalGosiEmp: sum("gosiEmp"), totalGosiEr: sum("gosiEr"), totalDeductions: r2(sum("deduction") + sum("absence") + sum("loan")), totalNet: sum("net"), totalSalaryTax: IS_EG ? sum("salaryTax") : 0, totalMartyrs: IS_EG ? sum("martyrs") : 0 });
  await claimItems(t, companyId, id, lines);
  return r;
}
/** Expense accounts the payroll journal needs that older charts do not have yet: created next to «الرواتب والأجور». */
async function ensureExpense(t: Db, companyId: string, key: string, nameAr: string, nameEn: string) {
  const a = await t.maybe(`SELECT id FROM accounts WHERE company_id=$1 AND system_key=$2`, [companyId, key]);
  if (a) return a.id;
  const base = await t.one(`SELECT * FROM accounts WHERE company_id=$1 AND system_key='SALARIES'`, [companyId], "حساب الرواتب والأجور غير موجود في الدليل");
  const prefix = String(base.code).slice(0, -2); const used = new Set((await t.rows(`SELECT code FROM accounts WHERE company_id=$1 AND code LIKE $2`, [companyId, `${prefix}%`])).map((x) => x.code));
  let code = ""; for (let n = 17; n < 100 && !code; n++) if (!used.has(`${prefix}${n}`)) code = `${prefix}${n}`;
  if (!code) throw bad("لا يوجد رمز متاح لحساب جديد بجوار الرواتب");
  const r = await t.insert("accounts", { companyId, code, nameAr, nameEn, type: base.type, subtype: base.subtype, parentId: base.parentId, level: base.level, isGroup: false, isSystem: true, systemKey: key, isActive: true });
  return r.id;
}

/** Accrual: Dr salaries (basic) + allowances + GOSI employer / Cr salaries payable (net) + GOSI payable (emp+er) + other deductions → salaries payable is net only; deductions reduce expense? No: deductions/absence reduce the expense (unpaid days). */
export async function postRun(t: Db, companyId: string, user: string, id: string) {
  const run = await t.one(`SELECT * FROM payroll_runs WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "المسير غير موجود");
  if (run.status !== "DRAFT") throw conflict("المسير مرحّل مسبقاً");
  const L: any[] = run.lines;
  const gosiEmp = Number(run.totalGosiEmp), gosiEr = Number(run.totalGosiEr), net = Number(run.totalNet);
  const loans = r2(L.reduce((a, l) => a + (l.loan || 0), 0));
  const hasOt = L.some((l) => l.overtime > 0), hasBonus = L.some((l) => l.bonus > 0);
  const otAcc = hasOt ? await ensureExpense(t, companyId, "OVERTIME_EXPENSE", "أجور العمل الإضافي", "Overtime") : null;
  const bonusAcc = hasBonus ? await ensureExpense(t, companyId, "BONUS_EXPENSE", "مكافآت وحوافز وعمولات الموظفين", "Bonuses & Incentives") : null;
  // expenses are booked per employee cost centre, so each branch / department carries its own payroll
  const ccs = [...new Set(L.map((l) => l.costCenterId || ""))];
  const lines: any[] = [];
  for (const cc of ccs) {
    const G = L.filter((l) => (l.costCenterId || "") === cc); const S = (f: (l: any) => number) => r2(G.reduce((a, l) => a + f(l), 0)); const c = cc || null;
    lines.push({ key: "SALARIES", debit: S((l) => l.basic - l.deduction - l.absence), costCenterId: c, description: `رواتب أساسية ${run.period}` });
    if (otAcc) lines.push({ account: otAcc, debit: S((l) => l.overtime), costCenterId: c, description: `عمل إضافي ${run.period}` });
    if (bonusAcc) lines.push({ account: bonusAcc, debit: S((l) => l.bonus), costCenterId: c, description: `مكافآت وعمولات ${run.period}` });
    lines.push({ key: "ALLOWANCES", debit: S((l) => l.housing + l.transport + l.other), costCenterId: c, description: `بدلات ${run.period}` });
    lines.push({ key: "GOSI_EXPENSE", debit: S((l) => l.gosiEr), costCenterId: c, description: `${IS_EG ? "حصة صاحب العمل في التأمينات الاجتماعية" : "تأمينات حصة المنشأة"} ${run.period}` });
  }
  // a month where deductions exceed the basic pay of a cost centre would give a negative debit: show it as a credit instead
  for (const l of lines) if (l.debit < 0) { l.credit = -l.debit; l.debit = 0; }
  lines.push({ key: "SALARIES_PAYABLE", credit: net, description: `صافي رواتب مستحقة ${run.period}` }, { key: "GOSI_PAYABLE", credit: r2(gosiEmp + gosiEr), description: `${IS_EG ? "التأمينات الاجتماعية المستحقة (عامل + صاحب عمل)" : "تأمينات مستحقة"} ${run.period}` }, { key: "EMP_ADVANCES", credit: loans, description: `أقساط سلف الموظفين ${run.period}` });
  if (IS_EG) {
    const tax = r2(L.reduce((a, l) => a + (l.salaryTax || 0), 0)), mart = r2(L.reduce((a, l) => a + (l.martyrs || 0), 0));
    lines.push({ key: "SALARY_TAX_PAYABLE", credit: tax, description: `ضريبة كسب العمل ${run.period}` }, { key: "MARTYRS_PAYABLE", credit: mart, description: `صندوق تكريم الشهداء 0.05% ${run.period}` });
  }
  const e = await post(t, companyId, { date: run.date, type: "PAYROLL", sourceType: "PAYROLL", sourceId: run.id, reference: run.period, memo: `مسير رواتب ${run.period}`, createdBy: user, isDemo: run.isDemo, lines });
  await applyLoanInstallments(t, companyId, L.flatMap((l) => l.loanItems || []));
  return t.update("payroll_runs", { id }, { status: "POSTED", journalId: e!.id });
}

export async function payRun(t: Db, companyId: string, user: string, id: string, accountId: string, date?: string) {
  const run = await t.one(`SELECT * FROM payroll_runs WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "المسير غير موجود");
  if (run.status !== "POSTED") throw conflict("رحّل المسير أولاً");
  const acc = await t.one(`SELECT id FROM accounts WHERE id=$1 AND company_id=$2 AND is_cash_bank`, [accountId, companyId], "اختر حساب البنك");
  const d = date && isDate(date) ? date : today();
  const e = await post(t, companyId, { date: d, type: "PAYMENT", sourceType: "PAYROLL", sourceId: run.id, reference: run.period, memo: `صرف رواتب ${run.period}`, createdBy: user, isDemo: run.isDemo, lines: [
    { key: "SALARIES_PAYABLE", debit: Number(run.totalNet), description: `صرف رواتب ${run.period}` },
    { account: acc.id, credit: Number(run.totalNet), description: `صرف رواتب ${run.period}` },
  ] });
  return t.update("payroll_runs", { id }, { status: "PAID", payJournalId: e!.id });
}

export async function deleteRun(t: Db, companyId: string, id: string) {
  const run = await t.one(`SELECT * FROM payroll_runs WHERE id=$1 AND company_id=$2`, [id, companyId], "المسير غير موجود");
  if (run.status !== "DRAFT") throw conflict("لا يمكن حذف مسير مرحّل — اعكس قيده من دفتر اليومية");
  await t.exec(`UPDATE payroll_items SET status='OPEN', run_id=NULL WHERE company_id=$1 AND run_id=$2`, [companyId, id]);
  await t.exec(`DELETE FROM payroll_runs WHERE id=$1`, [id]);
}

/** WPS (Wage Protection System) salary file — the common bank CSV layout (Mudad/SARIE style columns). */
export function wpsCsv(company: any, run: any): string {
  const L: any[] = run.lines;
  const head = ["Employee Name", "Employee ID", "IBAN", "Bank Name", "Basic Salary", "Housing Allowance", "Other Earnings", "Deductions", "Net Salary", "Period", "Employer Name", "Employer CR", "Establishment ID"];
  const rows = L.map((l) => [l.name, l.code, l.iban || "", l.bankName || "", l.basic.toFixed(2), l.housing.toFixed(2), (l.transport + l.other + l.bonus + l.overtime).toFixed(2), (l.gosiEmp + l.deduction + l.absence + (l.loan || 0)).toFixed(2), l.net.toFixed(2), run.period, company.nameAr, company.crNumber || "", ""]);
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return "﻿" + [head, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}
