/** Payroll lite: employees, monthly run with GOSI, accrual journal, salary payment, WPS file. */
import { Db } from "../db/pool";
import { bad, conflict, r2, D, num, isDate, today, monthEnd } from "../lib/core";
import { post, accountByKey } from "../accounting/engine";

// GOSI (2024+ new rates for Saudis: total 21.5% on basic+housing → 9.75% employee / 11.75% employer incl. hazards & SANED;
// non-Saudis: 2% occupational hazards, employer only). Rates are configurable per company later; sane defaults here.
export const GOSI = { SAUDI: { employee: 0.0975, employer: 0.1175 }, NON_SAUDI: { employee: 0, employer: 0.02 } };

export interface RunInput {
  period: string; // YYYY-MM
  date?: string; // posting date (default: month end)
  adjustments?: Record<string, { bonus?: number; overtime?: number; deduction?: number; absence?: number; note?: string }>; // by employee id
  notes?: string;
  isDemo?: boolean;
}

export function computeLine(e: any, adj: any = {}) {
  const basic = Number(e.basic), housing = Number(e.housing), transport = Number(e.transport), other = Number(e.otherAllow);
  const bonus = r2(num(adj.bonus)), overtime = r2(num(adj.overtime)), deduction = r2(num(adj.deduction)), absence = r2(num(adj.absence));
  const gross = r2(D(basic).plus(housing).plus(transport).plus(other).plus(bonus).plus(overtime));
  const rates = e.gosi ? (GOSI as any)[e.nationality] || GOSI.NON_SAUDI : { employee: 0, employer: 0 };
  const gosiBase = Math.min(r2(D(basic).plus(housing)), 45000); // GOSI ceiling
  const gosiEmp = r2(gosiBase * rates.employee);
  const gosiEr = r2(gosiBase * rates.employer);
  const net = r2(D(gross).minus(gosiEmp).minus(deduction).minus(absence));
  return { employeeId: e.id, code: e.code, name: e.name, iban: e.iban, bankName: e.bankName, nationality: e.nationality, basic, housing, transport, other, bonus, overtime, deduction, absence, gross, gosiBase, gosiEmp, gosiEr, net, note: adj.note || null };
}

export async function createRun(t: Db, companyId: string, user: string, r: RunInput) {
  if (!/^\d{4}-\d{2}$/.test(r.period || "")) throw bad("الفترة يجب أن تكون بصيغة YYYY-MM");
  const date = r.date && isDate(r.date) ? r.date : monthEnd(r.period + "-01");
  const dup = await t.maybe(`SELECT id FROM payroll_runs WHERE company_id=$1 AND period=$2`, [companyId, r.period]);
  if (dup) throw conflict(`يوجد مسير رواتب لشهر ${r.period} مسبقاً`);
  const emps = await t.rows(`SELECT * FROM employees WHERE company_id=$1 AND is_active ORDER BY code`, [companyId]);
  if (!emps.length) throw bad("لا يوجد موظفون نشطون");
  const lines = emps.map((e) => computeLine(e, r.adjustments?.[e.id]));
  const sum = (k: string) => r2(lines.reduce((a, l: any) => a + l[k], 0));
  return t.insert("payroll_runs", { companyId, period: r.period, date, lines, totalGross: sum("gross"), totalGosiEmp: sum("gosiEmp"), totalGosiEr: sum("gosiEr"), totalDeductions: r2(sum("deduction") + sum("absence")), totalNet: sum("net"), notes: r.notes || null, isDemo: !!r.isDemo, createdBy: user });
}

/** Accrual: Dr salaries (basic) + allowances + GOSI employer / Cr salaries payable (net) + GOSI payable (emp+er) + other deductions → salaries payable is net only; deductions reduce expense? No: deductions/absence reduce the expense (unpaid days). */
export async function postRun(t: Db, companyId: string, user: string, id: string) {
  const run = await t.one(`SELECT * FROM payroll_runs WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "المسير غير موجود");
  if (run.status !== "DRAFT") throw conflict("المسير مرحّل مسبقاً");
  const L: any[] = run.lines;
  const basic = r2(L.reduce((a, l) => a + l.basic + l.bonus + l.overtime - l.deduction - l.absence, 0));
  const allow = r2(L.reduce((a, l) => a + l.housing + l.transport + l.other, 0));
  const gosiEmp = Number(run.totalGosiEmp), gosiEr = Number(run.totalGosiEr), net = Number(run.totalNet);
  const lines: any[] = [
    { key: "SALARIES", debit: basic, description: `رواتب أساسية ${run.period}` },
    { key: "ALLOWANCES", debit: allow, description: `بدلات ${run.period}` },
    { key: "GOSI_EXPENSE", debit: gosiEr, description: `تأمينات حصة المنشأة ${run.period}` },
    { key: "SALARIES_PAYABLE", credit: net, description: `صافي رواتب مستحقة ${run.period}` },
    { key: "GOSI_PAYABLE", credit: r2(gosiEmp + gosiEr), description: `تأمينات مستحقة ${run.period}` },
  ];
  const e = await post(t, companyId, { date: run.date, type: "PAYROLL", sourceType: "PAYROLL", sourceId: run.id, reference: run.period, memo: `مسير رواتب ${run.period}`, createdBy: user, isDemo: run.isDemo, lines });
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
  await t.exec(`DELETE FROM payroll_runs WHERE id=$1`, [id]);
}

/** WPS (Wage Protection System) salary file — the common bank CSV layout (Mudad/SARIE style columns). */
export function wpsCsv(company: any, run: any): string {
  const L: any[] = run.lines;
  const head = ["Employee Name", "Employee ID", "IBAN", "Bank Name", "Basic Salary", "Housing Allowance", "Other Earnings", "Deductions", "Net Salary", "Period", "Employer Name", "Employer CR", "Establishment ID"];
  const rows = L.map((l) => [l.name, l.code, l.iban || "", l.bankName || "", l.basic.toFixed(2), l.housing.toFixed(2), (l.transport + l.other + l.bonus + l.overtime).toFixed(2), (l.gosiEmp + l.deduction + l.absence).toFixed(2), l.net.toFixed(2), run.period, company.nameAr, company.crNumber || "", ""]);
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return "﻿" + [head, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}
