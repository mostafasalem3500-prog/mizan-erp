/**
 * HR accounting (Saudi Labor Law):
 *   • Leave register + annual-leave balance (art. 109: 21 days, 30 days after 5 years of service)
 *   • Employee loans (Dr employee advances) with automatic payroll installments
 *   • Monthly provisions: end-of-service benefit (art. 84) and accrued leave — "catch-up" method:
 *     each run brings every employee's provision to the full entitlement at period end
 *   • Final settlement (art. 84/85) releasing the provisions, deducting loans, paying the net
 * Per-employee provision sub-ledger (employee_provision_ledger) always equals the GL provision accounts.
 */
import { Db } from "../db/pool";
import { bad, conflict, r2, r3, D, num, isDate, today, monthEnd, addDays } from "../lib/core";
import { post, nextNumber, reverse } from "../accounting/engine";

export const SETTLEMENT_REASONS: Record<string, string> = { TERMINATION: "إنهاء من صاحب العمل", CONTRACT_END: "انتهاء العقد", RESIGNATION: "استقالة", ART80: "فصل وفق المادة 80 (بدون مكافأة)" };

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
export const yearsBetween = (a: string, b: string) => Math.max(0, daysBetween(a, b) / 365.25);
export const wageOf = (e: any) => r2(D(e.basic).plus(e.housing).plus(e.transport).plus(e.otherAllow));

/** Art. 84: half a month's wage per year for the first five years, a full month for each following year (pro-rata). */
export function eosbFull(wage: number, years: number) {
  const first = Math.min(years, 5), rest = Math.max(years - 5, 0);
  return r2(D(wage).times(0.5).times(first).plus(D(wage).times(rest)));
}
/** Art. 85 (resignation): nothing under 2 years, one third 2–5, two thirds 5–10, full after 10. Art. 80: nothing. */
export function eosbByReason(full: number, years: number, reason: string) {
  if (reason === "ART80") return 0;
  if (reason !== "RESIGNATION") return full;
  if (years < 2) return 0;
  if (years < 5) return r2(full / 3);
  if (years < 10) return r2((full * 2) / 3);
  return full;
}

/** Accrued annual-leave days since leave_balance_date (or hire date), with the 30-day rate after 5 years of service. */
export function leaveAccruedDays(e: any, asOf: string) {
  const start: string | null = e.leaveBalanceDate ? String(e.leaveBalanceDate).slice(0, 10) : e.hireDate ? String(e.hireDate).slice(0, 10) : null;
  if (!start || start >= asOf) return r3(e.leaveOpening || 0);
  const custom = Number(e.leaveDaysPerYear || 21);
  const d1 = Math.max(21, custom), d2 = Math.max(30, custom);
  let y5: string | null = null;
  if (e.hireDate) { const h = new Date(String(e.hireDate).slice(0, 10) + "T00:00:00Z"); h.setUTCFullYear(h.getUTCFullYear() + 5); y5 = h.toISOString().slice(0, 10); }
  let acc = 0;
  if (!y5 || y5 >= asOf) acc = d1 * yearsBetween(start, asOf);
  else if (y5 <= start) acc = d2 * yearsBetween(start, asOf);
  else acc = d1 * yearsBetween(start, y5) + d2 * yearsBetween(y5, asOf);
  return r3(Number(e.leaveOpening || 0) + acc);
}

export async function leaveTakenDays(t: Db, companyId: string, employeeId: string, e: any, asOf: string) {
  const start = e.leaveBalanceDate ? String(e.leaveBalanceDate).slice(0, 10) : "1900-01-01";
  const r = await t.one(`SELECT COALESCE(SUM(days),0) d FROM employee_leaves WHERE company_id=$1 AND employee_id=$2 AND type='ANNUAL' AND from_date >= $3 AND from_date <= $4`, [companyId, employeeId, start, asOf]);
  return r3(r.d);
}

export async function provisionBalance(t: Db, companyId: string, employeeId: string, type: "EOSB" | "LEAVE") {
  const r = await t.one(`SELECT COALESCE(SUM(amount),0) b FROM employee_provision_ledger WHERE company_id=$1 AND employee_id=$2 AND type=$3`, [companyId, employeeId, type]);
  return r2(r.b);
}

export async function loansOutstanding(t: Db, companyId: string, employeeId: string) {
  const r = await t.one(`SELECT COALESCE(SUM(amount-paid),0) b FROM employee_loans WHERE company_id=$1 AND employee_id=$2 AND status='ACTIVE'`, [companyId, employeeId]);
  return r2(r.b);
}

/** Snapshot of one employee's HR position at a date. */
export async function employeePosition(t: Db, companyId: string, e: any, asOf: string) {
  const wage = wageOf(e);
  const hire = e.hireDate ? String(e.hireDate).slice(0, 10) : null;
  const years = hire ? r3(yearsBetween(hire, asOf)) : 0;
  const eosbDue = eosbFull(wage, years);
  const eosbBal = await provisionBalance(t, companyId, e.id, "EOSB");
  const accrued = leaveAccruedDays(e, asOf);
  const taken = await leaveTakenDays(t, companyId, e.id, e, asOf);
  const leaveDays = r3(accrued - taken);
  const leaveDue = r2(D(wage).div(30).times(leaveDays));
  const leaveBal = await provisionBalance(t, companyId, e.id, "LEAVE");
  const loans = await loansOutstanding(t, companyId, e.id);
  return { employeeId: e.id, code: e.code, name: e.name, hireDate: hire, wage, years, eosbDue, eosbBal, leaveAccrued: accrued, leaveTaken: taken, leaveDays, leaveDue, leaveBal, loans };
}

// ─── leaves ────────────────────────────────────────────────────────────────
export async function addLeave(t: Db, companyId: string, user: string, b: any) {
  const e = await t.one(`SELECT * FROM employees WHERE id=$1 AND company_id=$2`, [b.employeeId, companyId], "الموظف غير موجود");
  if (!isDate(b.fromDate) || !isDate(b.toDate) || b.toDate < b.fromDate) throw bad("تاريخ الإجازة غير صحيح");
  const days = b.days ? r3(num(b.days)) : daysBetween(b.fromDate, b.toDate) + 1;
  if (days <= 0) throw bad("عدد الأيام يجب أن يكون أكبر من صفر");
  const type = ["ANNUAL", "SICK", "UNPAID", "OTHER"].includes(b.type) ? b.type : "ANNUAL";
  return t.insert("employee_leaves", { companyId, employeeId: e.id, type, fromDate: b.fromDate, toDate: b.toDate, days, notes: b.notes || null, isDemo: !!b.isDemo, createdBy: user });
}

// ─── loans ─────────────────────────────────────────────────────────────────
export async function createLoan(t: Db, companyId: string, user: string, b: any) {
  const e = await t.one(`SELECT * FROM employees WHERE id=$1 AND company_id=$2 AND is_active`, [b.employeeId, companyId], "الموظف غير موجود");
  const amount = r2(num(b.amount)), installment = r2(num(b.installment));
  if (amount <= 0) throw bad("مبلغ السلفة مطلوب");
  if (installment <= 0 || installment > amount) throw bad("قسط السداد يجب أن يكون بين 1 وقيمة السلفة");
  const date = isDate(b.date) ? b.date : today();
  const acc = await t.one(`SELECT id FROM accounts WHERE id=$1 AND company_id=$2 AND is_cash_bank`, [b.accountId, companyId], "اختر حساب الصرف (صندوق/بنك)");
  const number = await nextNumber(t, companyId, "LN", date, 4);
  const j = await post(t, companyId, { date, type: "PAYMENT", sourceType: "LOAN", reference: number, memo: `سلفة موظف ${e.name}`, createdBy: user, isDemo: !!b.isDemo, lines: [
    { key: "EMP_ADVANCES", debit: amount, description: `سلفة ${e.name}` },
    { account: acc.id, credit: amount, description: `صرف سلفة ${e.name}` },
  ] });
  const startPeriod = /^\d{4}-\d{2}$/.test(b.startPeriod || "") ? b.startPeriod : date.slice(0, 7) === today().slice(0, 7) ? addDays(monthEnd(date), 1).slice(0, 7) : date.slice(0, 7);
  return t.insert("employee_loans", { companyId, employeeId: e.id, number, date, amount, installment, startPeriod, accountId: acc.id, journalId: j!.id, notes: b.notes || null, isDemo: !!b.isDemo, createdBy: user });
}

export async function cancelLoan(t: Db, companyId: string, user: string, id: string) {
  const l = await t.one(`SELECT * FROM employee_loans WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "السلفة غير موجودة");
  if (l.status !== "ACTIVE") throw conflict("السلفة ليست نشطة");
  if (Number(l.paid) > 0) throw conflict("بدأ سداد السلفة من المسير — لا يمكن إلغاؤها");
  if (l.journalId) await reverse(t, companyId, l.journalId, today(), `إلغاء سلفة ${l.number}`, user);
  return t.update("employee_loans", { id }, { status: "CANCELLED" });
}

/** Installments due in a payroll period, keyed by employee id. */
export async function loanInstallments(t: Db, companyId: string, period: string) {
  const rows = await t.rows(`SELECT id, employee_id, installment, amount, paid FROM employee_loans WHERE company_id=$1 AND status='ACTIVE' AND amount-paid > 0 AND (start_period IS NULL OR start_period <= $2) ORDER BY date`, [companyId, period]);
  const by: Record<string, { id: string; amount: number }[]> = {};
  for (const l of rows) {
    const due = r2(Math.min(Number(l.installment), Number(l.amount) - Number(l.paid)));
    if (due > 0) (by[l.employeeId] ||= []).push({ id: l.id, amount: due });
  }
  return by;
}

/** Applies posted payroll installments to the loans. */
export async function applyLoanInstallments(t: Db, companyId: string, items: { id: string; amount: number }[]) {
  for (const it of items) {
    await t.exec(`UPDATE employee_loans SET paid = paid + $3, status = CASE WHEN paid + $3 >= amount - 0.005 THEN 'SETTLED' ELSE status END WHERE id=$1 AND company_id=$2`, [it.id, companyId, it.amount]);
  }
}

// ─── monthly provisions ────────────────────────────────────────────────────
export async function previewProvision(t: Db, companyId: string, period: string) {
  if (!/^\d{4}-\d{2}$/.test(period || "")) throw bad("الفترة يجب أن تكون بصيغة YYYY-MM");
  const asOf = monthEnd(period + "-01");
  const emps = await t.rows(`SELECT * FROM employees WHERE company_id=$1 AND is_active AND (hire_date IS NULL OR hire_date <= $2) ORDER BY code`, [companyId, asOf]);
  const lines: any[] = [];
  for (const e of emps) {
    const p = await employeePosition(t, companyId, e, asOf);
    lines.push({ ...p, eosbAmount: r2(p.eosbDue - p.eosbBal), leaveAmount: r2(p.leaveDue - p.leaveBal) });
  }
  return { period, date: asOf, lines, totalEosb: r2(lines.reduce((a, l) => a + l.eosbAmount, 0)), totalLeave: r2(lines.reduce((a, l) => a + l.leaveAmount, 0)) };
}

export async function createProvision(t: Db, companyId: string, user: string, b: any) {
  const pv = await previewProvision(t, companyId, b.period);
  const dup = await t.maybe(`SELECT id FROM hr_provisions WHERE company_id=$1 AND period=$2`, [companyId, pv.period]);
  if (dup) throw conflict(`يوجد قيد مخصصات لشهر ${pv.period} مسبقاً`);
  if (!pv.lines.length) throw bad("لا يوجد موظفون نشطون في هذه الفترة");
  const date = isDate(b.date) ? b.date : pv.date;
  return t.insert("hr_provisions", { companyId, period: pv.period, date, lines: pv.lines, totalEosb: pv.totalEosb, totalLeave: pv.totalLeave, notes: b.notes || null, isDemo: !!b.isDemo, createdBy: user });
}

export async function postProvision(t: Db, companyId: string, user: string, id: string) {
  const run = await t.one(`SELECT * FROM hr_provisions WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "القيد غير موجود");
  if (run.status !== "DRAFT") throw conflict("القيد مرحّل مسبقاً");
  // recompute against the live ledger so two runs can't double-provision
  const pv = await previewProvision(t, companyId, run.period);
  const lines = pv.lines;
  const eosb = pv.totalEosb, leave = pv.totalLeave;
  if (Math.abs(eosb) < 0.005 && Math.abs(leave) < 0.005) throw bad("لا توجد مبالغ لترحيلها — المخصصات مطابقة للاستحقاق");
  const e = await post(t, companyId, { date: run.date, type: "PAYROLL", sourceType: "HR_PROVISION", sourceId: run.id, reference: run.period, memo: `مخصصات نهاية الخدمة والإجازات ${run.period}`, createdBy: user, isDemo: run.isDemo, lines: [
    { key: "EOSB_EXPENSE", debit: eosb, description: `مصروف مكافأة نهاية الخدمة ${run.period}` },
    { key: "EOSB_PROVISION", credit: eosb, description: `مخصص نهاية الخدمة ${run.period}` },
    { key: "LEAVE_EXPENSE", debit: leave, description: `مصروف الإجازات ${run.period}` },
    { key: "LEAVE_PROVISION", credit: leave, description: `مخصص الإجازات ${run.period}` },
  ] });
  const ledger: any[] = [];
  for (const l of lines) {
    if (Math.abs(l.eosbAmount) >= 0.005) ledger.push({ companyId, employeeId: l.employeeId, type: "EOSB", date: run.date, amount: l.eosbAmount, sourceType: "PROVISION", sourceId: run.id, isDemo: run.isDemo });
    if (Math.abs(l.leaveAmount) >= 0.005) ledger.push({ companyId, employeeId: l.employeeId, type: "LEAVE", date: run.date, amount: l.leaveAmount, sourceType: "PROVISION", sourceId: run.id, isDemo: run.isDemo });
  }
  await t.insertMany("employee_provision_ledger", ledger);
  return t.update("hr_provisions", { id }, { status: "POSTED", journalId: e!.id, lines, totalEosb: eosb, totalLeave: leave });
}

export async function deleteProvision(t: Db, companyId: string, id: string) {
  const run = await t.one(`SELECT * FROM hr_provisions WHERE id=$1 AND company_id=$2`, [id, companyId], "القيد غير موجود");
  if (run.status !== "DRAFT") throw conflict("لا يمكن حذف قيد مرحّل — اعكسه من دفتر اليومية");
  await t.exec(`DELETE FROM hr_provisions WHERE id=$1`, [id]);
}

// ─── final settlement ──────────────────────────────────────────────────────
export async function computeSettlement(t: Db, companyId: string, b: any) {
  const e = await t.one(`SELECT * FROM employees WHERE id=$1 AND company_id=$2`, [b.employeeId, companyId], "الموظف غير موجود");
  const date = isDate(b.date) ? b.date : today();
  const reason = SETTLEMENT_REASONS[b.reason] ? b.reason : "TERMINATION";
  const p = await employeePosition(t, companyId, e, date);
  const eosbDue = eosbByReason(p.eosbDue, p.years, reason);
  const salaryDays = Math.max(0, Math.min(31, num(b.salaryDays)));
  const salaryAmount = r2(D(p.wage).div(30).times(salaryDays));
  const otherAdditions = r2(num(b.otherAdditions)), otherDeductions = r2(num(b.otherDeductions));
  const leaveDays = Math.max(0, p.leaveDays); // negative balances are not deducted automatically
  const leaveAmount = r2(D(p.wage).div(30).times(leaveDays));
  const net = r2(eosbDue + leaveAmount + salaryAmount + otherAdditions - p.loans - otherDeductions);
  return { ...p, date, reason, reasonAr: SETTLEMENT_REASONS[reason], eosbFull: p.eosbDue, eosbDue, salaryDays, salaryAmount, leaveDays, leaveAmount, otherAdditions, otherDeductions, net, notes: b.notes || null };
}

export async function createSettlement(t: Db, companyId: string, user: string, b: any) {
  const s = await computeSettlement(t, companyId, b);
  const open = await t.maybe(`SELECT id FROM employee_settlements WHERE company_id=$1 AND employee_id=$2 AND status<>'CANCELLED'`, [companyId, s.employeeId]);
  if (open) throw conflict("توجد تصفية مسجلة لهذا الموظف");
  if (s.net < 0) throw bad(`صافي التصفية سالب (${s.net}) — راجع السلف والخصومات`);
  const number = await nextNumber(t, companyId, "EOS", s.date, 4);
  return t.insert("employee_settlements", { companyId, employeeId: s.employeeId, number, date: s.date, reason: s.reason, data: s, net: s.net, notes: b.notes || null, isDemo: !!b.isDemo, createdBy: user });
}

export async function postSettlement(t: Db, companyId: string, user: string, id: string) {
  const st = await t.one(`SELECT * FROM employee_settlements WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "التصفية غير موجودة");
  if (st.status !== "DRAFT") throw conflict("التصفية مرحّلة مسبقاً");
  // recompute on the live ledger (provision balances / loans may have moved since the draft)
  const s = await computeSettlement(t, companyId, { employeeId: st.employeeId, date: String(st.date).slice(0, 10), reason: st.reason, salaryDays: st.data.salaryDays, otherAdditions: st.data.otherAdditions, otherDeductions: st.data.otherDeductions, notes: st.notes });
  if (s.net < 0) throw bad(`صافي التصفية سالب (${s.net}) — راجع السلف والخصومات`);
  const nm = s.name;
  const e = await post(t, companyId, { date: s.date, type: "PAYROLL", sourceType: "SETTLEMENT", sourceId: st.id, reference: st.number, memo: `تصفية مستحقات نهاية الخدمة — ${nm}`, createdBy: user, isDemo: st.isDemo, lines: [
    { key: "EOSB_PROVISION", debit: s.eosbBal, description: `تحرير مخصص نهاية الخدمة ${nm}` },
    { key: "EOSB_EXPENSE", debit: r2(s.eosbDue - s.eosbBal), description: `فرق مكافأة نهاية الخدمة ${nm}` },
    { key: "LEAVE_PROVISION", debit: s.leaveBal, description: `تحرير مخصص الإجازات ${nm}` },
    { key: "LEAVE_EXPENSE", debit: r2(s.leaveAmount - s.leaveBal), description: `فرق بدل الإجازات ${nm}` },
    { key: "SALARIES", debit: r2(s.salaryAmount + s.otherAdditions - s.otherDeductions), description: `راتب أيام العمل الأخيرة وتسويات ${nm}` },
    { key: "EMP_ADVANCES", credit: s.loans, description: `تسوية سلف ${nm}` },
    { key: "SALARIES_PAYABLE", credit: s.net, description: `صافي مستحقات نهاية الخدمة ${nm}` },
  ] });
  const ledger: any[] = [];
  if (Math.abs(s.eosbBal) >= 0.005) ledger.push({ companyId, employeeId: s.employeeId, type: "EOSB", date: s.date, amount: -s.eosbBal, sourceType: "SETTLEMENT", sourceId: st.id, isDemo: st.isDemo });
  if (Math.abs(s.leaveBal) >= 0.005) ledger.push({ companyId, employeeId: s.employeeId, type: "LEAVE", date: s.date, amount: -s.leaveBal, sourceType: "SETTLEMENT", sourceId: st.id, isDemo: st.isDemo });
  await t.insertMany("employee_provision_ledger", ledger);
  await t.exec(`UPDATE employee_loans SET paid=amount, status='SETTLED' WHERE company_id=$1 AND employee_id=$2 AND status='ACTIVE'`, [companyId, s.employeeId]);
  await t.exec(`UPDATE employees SET is_active=false, termination_date=$3, termination_reason=$4 WHERE id=$1 AND company_id=$2`, [s.employeeId, companyId, s.date, s.reason]);
  return t.update("employee_settlements", { id }, { status: "POSTED", journalId: e!.id, data: s, net: s.net });
}

export async function paySettlement(t: Db, companyId: string, user: string, id: string, accountId: string, date?: string) {
  const st = await t.one(`SELECT * FROM employee_settlements WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "التصفية غير موجودة");
  if (st.status !== "POSTED") throw conflict("رحّل التصفية أولاً");
  const acc = await t.one(`SELECT id FROM accounts WHERE id=$1 AND company_id=$2 AND is_cash_bank`, [accountId, companyId], "اختر حساب الصرف");
  const d = date && isDate(date) ? date : today();
  const e = await post(t, companyId, { date: d, type: "PAYMENT", sourceType: "SETTLEMENT", sourceId: st.id, reference: st.number, memo: `صرف مستحقات نهاية الخدمة — ${st.data.name}`, createdBy: user, isDemo: st.isDemo, lines: [
    { key: "SALARIES_PAYABLE", debit: Number(st.net), description: `صرف تصفية ${st.data.name}` },
    { account: acc.id, credit: Number(st.net), description: `صرف تصفية ${st.data.name}` },
  ] });
  return t.update("employee_settlements", { id }, { status: "PAID", payJournalId: e!.id });
}

export async function deleteSettlement(t: Db, companyId: string, id: string) {
  const st = await t.one(`SELECT * FROM employee_settlements WHERE id=$1 AND company_id=$2`, [id, companyId], "التصفية غير موجودة");
  if (st.status !== "DRAFT") throw conflict("لا يمكن حذف تصفية مرحّلة");
  await t.exec(`DELETE FROM employee_settlements WHERE id=$1`, [id]);
}

/** Provision sub-ledger vs GL, for the integrity report. */
export async function provisionTotals(t: Db, companyId: string) {
  const r = await t.rows(`SELECT type, COALESCE(SUM(amount),0) b FROM employee_provision_ledger WHERE company_id=$1 GROUP BY type`, [companyId]);
  return { EOSB: r2(r.find((x) => x.type === "EOSB")?.b || 0), LEAVE: r2(r.find((x) => x.type === "LEAVE")?.b || 0) };
}
