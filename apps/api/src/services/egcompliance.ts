/**
 * Egypt edition — compliance beyond the monthly ledger (MIZAN_COUNTRY=EG):
 *   • Simplified regime for small projects (Law 6/2025): turnover up to EGP 20m, tax on turnover instead of profit,
 *     VAT return every quarter. Opt-in (the establishment registers for it with the Tax Authority).
 *   • Solidarity contribution to universal health insurance (Law 2/2018 art. 40, as amended): 2.5 per thousand of the
 *     year's total revenue, paid with the income-tax return.
 *   • Legal reserve (Companies Law 159/1981): 5% of the year's net profit until the reserve reaches half the capital.
 *   • Salary-tax report: per-employee totals for the quarterly Form 4 and the annual settlement (tax due on the
 *     year's actual income against what the monthly payroll withheld).
 * Rates live here so a change in the law is a one-line edit.
 */
import { Db } from "../db/pool";
import { bad, conflict, r2, D, num, isDate, today } from "../lib/core";
import { post, reverse } from "../accounting/engine";
import { incomeStatement } from "./reports";
import { EG_PAYROLL, salaryTaxDetail, EG_SIMPLIFIED, simplifiedTax } from "./egypt";
void EG_SIMPLIFIED; void simplifiedTax;

export { EG_SIMPLIFIED, simplifiedTax } from "./egypt";

// ─── accounts older charts do not have ───────────────────────────────────
async function ensure(t: Db, companyId: string, key: string, parentCode: string, nameAr: string, nameEn: string, type: string, subtype: string, from: number) {
  const a = await t.maybe(`SELECT id FROM accounts WHERE company_id=$1 AND system_key=$2`, [companyId, key]);
  if (a) return a.id;
  const parent = await t.one(`SELECT id, level FROM accounts WHERE company_id=$1 AND code=$2`, [companyId, parentCode], `الحساب ${parentCode} غير موجود في دليل الحسابات`);
  const used = new Set((await t.rows(`SELECT code FROM accounts WHERE company_id=$1 AND code LIKE $2`, [companyId, `${parentCode}%`])).map((x) => x.code));
  let code = ""; for (let n = from; n < 100 && !code; n++) if (!used.has(`${parentCode}${String(n).padStart(2, "0")}`)) code = `${parentCode}${String(n).padStart(2, "0")}`;
  if (!code) throw bad(`لا يوجد رمز متاح لحساب جديد تحت ${parentCode}`);
  return (await t.insert("accounts", { companyId, code, nameAr, nameEn, type, subtype, parentId: parent.id, level: Number(parent.level) + 1, isGroup: false, isSystem: true, systemKey: key, isCashBank: false })).id;
}
const solidarityAccounts = async (t: Db, c: string) => ({
  expense: await ensure(t, c, "SOLIDARITY_EXPENSE", "52", "المساهمة التكافلية (التأمين الصحي الشامل)", "Solidarity Contribution (Health Insurance)", "EXPENSE", "EXPENSE", 18),
  payable: await ensure(t, c, "SOLIDARITY_PAYABLE", "2103", "المساهمة التكافلية المستحقة", "Solidarity Contribution Payable", "LIABILITY", "CURRENT_LIABILITY", 7),
});
async function legalReserveAccount(t: Db, c: string) {
  const k = await t.maybe(`SELECT id FROM accounts WHERE company_id=$1 AND system_key='LEGAL_RESERVE'`, [c]);
  if (k) return k.id;
  const a = await t.maybe(`SELECT id FROM accounts WHERE company_id=$1 AND code='3102' AND NOT is_group AND system_key IS NULL`, [c]);
  if (a) { await t.exec(`UPDATE accounts SET system_key='LEGAL_RESERVE' WHERE id=$1`, [a.id]); return a.id; }
  return ensure(t, c, "LEGAL_RESERVE", "31", "الاحتياطي القانوني", "Legal Reserve", "EQUITY", "EQUITY", 2);
}

const yearRange = async (t: Db, companyId: string, q: any) => {
  const year = /^\d{4}$/.test(String(q.year || "")) ? String(q.year) : String(Number(today().slice(0, 4)) - 1);
  const fy = await t.maybe(`SELECT * FROM fiscal_years WHERE company_id=$1 AND name=$2`, [companyId, year]);
  return { year, from: String(fy?.startDate || `${year}-01-01`).slice(0, 10), to: String(fy?.endDate || `${year}-12-31`).slice(0, 10) };
};
const entriesOf = (t: Db, companyId: string, sourceType: string, year: string) =>
  t.rows(`SELECT e.id, e.number, e.date, e.memo, COALESCE((SELECT SUM(l.debit) FROM journal_lines l WHERE l.entry_id=e.id),0) amount FROM journal_entries e
           WHERE e.company_id=$1 AND e.source_type=$2 AND e.reference=$3 AND e.status='POSTED' AND e.type<>'REVERSAL' AND e.reversed_by IS NULL ORDER BY e.date`, [companyId, sourceType, year]);
async function creditOf(t: Db, companyId: string, where: string, params: any[], to: string) {
  const r = await t.one(`SELECT COALESCE(SUM(l.credit-l.debit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND e.status='POSTED' AND e.date <= $2 AND ${where}`, [companyId, to, ...params]);
  return r2(r.b);
}

// ─── solidarity contribution ─────────────────────────────────────────────
export const EG_SOLIDARITY_RATE = 0.0025;
export async function solidarityCompute(t: Db, companyId: string, q: any) {
  const { year, from, to } = await yearRange(t, companyId, q);
  const is = await incomeStatement(t, companyId, { from, to });
  const revenue = r2(is.netSales + is.otherIncome.total);
  const rate = num(q.rate) > 0 && num(q.rate) < 0.05 ? num(q.rate) : EG_SOLIDARITY_RATE;
  const base = q.base !== undefined && q.base !== "" && num(q.base) >= 0 ? r2(num(q.base)) : revenue;
  const posted = (await entriesOf(t, companyId, "EG_SOLIDARITY", year))[0] || null;
  const payments = await entriesOf(t, companyId, "EG_SOLIDARITY_PAY", year);
  const paid = r2(payments.reduce((a, p) => a + Number(p.amount), 0));
  return { year, from, to, sales: is.netSales, otherIncome: is.otherIncome.total, revenue, base, rate, amount: r2(D(base).times(rate)), posted, payments, paid, due: posted ? r2(Number(posted.amount) - paid) : 0, dueDate: `${Number(year) + 1}-04-30` };
}
export async function solidarityPost(t: Db, companyId: string, user: string, b: any) {
  const c = await solidarityCompute(t, companyId, b);
  if (c.posted) throw conflict(`المساهمة التكافلية لسنة ${c.year} مرحّلة (${c.posted.number}) — ألغِها أولاً`);
  if (!(c.amount > 0)) throw bad("المساهمة صفر — لا يوجد ما يُرحّل");
  const acc = await solidarityAccounts(t, companyId);
  const memo = `المساهمة التكافلية للتأمين الصحي الشامل لسنة ${c.year} (${c.base.toFixed(2)} × ${(c.rate * 1000).toFixed(2)} في الألف)`;
  const je = await post(t, companyId, { date: c.to, type: "INCOME_TAX", sourceType: "EG_SOLIDARITY", reference: c.year, memo, createdBy: user, lines: [{ account: acc.expense, debit: c.amount, description: memo }, { account: acc.payable, credit: c.amount, description: memo }] });
  return { ...c, journalId: je!.id, number: je!.number };
}
export async function solidarityCancel(t: Db, companyId: string, user: string, b: any) {
  const c = await solidarityCompute(t, companyId, b);
  if (!c.posted) throw bad("لا توجد مساهمة مرحّلة لهذه السنة");
  if (c.paid > 0) throw conflict("سُدّدت المساهمة — ألغِ قيد السداد من دفتر اليومية أولاً");
  await reverse(t, companyId, c.posted.id, c.to <= today() ? today() : c.to, `إلغاء المساهمة التكافلية ${c.year}`, user);
  return { ok: true };
}
export async function solidarityPay(t: Db, companyId: string, user: string, b: any) {
  const c = await solidarityCompute(t, companyId, b);
  if (!c.posted) throw bad("رحّل المساهمة أولاً");
  if (!(c.due > 0)) throw conflict("المساهمة مسددة بالكامل");
  const acc = await solidarityAccounts(t, companyId);
  const bank = await t.one(`SELECT id FROM accounts WHERE id=$1 AND company_id=$2 AND is_cash_bank AND NOT is_group`, [b.accountId, companyId], "اختر حساب البنك");
  const date = isDate(b.date) ? b.date : today();
  const memo = `سداد المساهمة التكافلية لسنة ${c.year} لمصلحة الضرائب${b.reference ? " — " + b.reference : ""}`;
  const je = await post(t, companyId, { date, type: "PAYMENT", sourceType: "EG_SOLIDARITY_PAY", reference: c.year, memo, createdBy: user, lines: [{ account: acc.payable, debit: c.due, description: memo }, { account: bank.id, credit: c.due, description: memo }] });
  return { ok: true, paid: c.due, journalId: je!.id };
}

// ─── legal reserve ───────────────────────────────────────────────────────
export const EG_LEGAL_RESERVE = { rate: 0.05, capOfCapital: 0.5 };
export async function legalReserveCompute(t: Db, companyId: string, q: any) {
  const { year, from, to } = await yearRange(t, companyId, q);
  const is = await incomeStatement(t, companyId, { from, to });
  const reserve = await creditOf(t, companyId, `(a.system_key='LEGAL_RESERVE' OR (a.code='3102' AND a.system_key IS NULL))`, [], today());
  const capital = await creditOf(t, companyId, `a.subtype='CAPITAL'`, [], today());
  const cap = r2(capital * EG_LEGAL_RESERVE.capOfCapital);
  const posted = (await entriesOf(t, companyId, "EG_LEGAL_RESERVE", year))[0] || null;
  const room = Math.max(0, r2(cap - reserve));
  const amount = is.net > 0 ? r2(Math.min(D(is.net).times(EG_LEGAL_RESERVE.rate).toNumber(), room)) : 0;
  const closed = !!(await t.maybe(`SELECT 1 FROM fiscal_years WHERE company_id=$1 AND name=$2 AND status<>'OPEN'`, [companyId, year]));
  return { year, from, to, netProfit: is.net, rate: EG_LEGAL_RESERVE.rate, capital, cap, reserve, room, amount, posted, closed };
}
export async function legalReservePost(t: Db, companyId: string, user: string, b: any) {
  const c = await legalReserveCompute(t, companyId, b);
  if (c.posted) throw conflict(`الاحتياطي القانوني لسنة ${c.year} مكوَّن (${c.posted.number})`);
  if (!(c.netProfit > 0)) throw bad("لا يُكوَّن احتياطي قانوني في سنة لم تحقق ربحاً");
  if (!(c.amount > 0)) throw bad("الاحتياطي القانوني بلغ نصف رأس المال — لا يلزم تكوين جديد");
  const reserveAcc = await legalReserveAccount(t, companyId);
  const date = isDate(b.date) ? b.date : today();
  const memo = `تكوين الاحتياطي القانوني 5% من صافي ربح سنة ${c.year}`;
  const je = await post(t, companyId, { date, type: "MANUAL", sourceType: "EG_LEGAL_RESERVE", reference: c.year, memo, createdBy: user, lines: [{ key: "RETAINED", debit: c.amount, description: memo }, { account: reserveAcc, credit: c.amount, description: memo }] });
  return { ...c, journalId: je!.id, number: je!.number };
}
export async function legalReserveCancel(t: Db, companyId: string, user: string, b: any) {
  const c = await legalReserveCompute(t, companyId, b);
  if (!c.posted) throw bad("لا يوجد احتياطي مكوَّن لهذه السنة");
  await reverse(t, companyId, c.posted.id, today(), `إلغاء تكوين الاحتياطي القانوني ${c.year}`, user);
  return { ok: true };
}

// ─── salary-tax report (Form 4 quarterly, annual settlement) ──────────────
export async function salaryTaxReport(t: Db, companyId: string, q: any) {
  const year = /^\d{4}$/.test(String(q.year || "")) ? String(q.year) : today().slice(0, 4);
  const quarter = /^[1-4]$/.test(String(q.quarter || "")) ? Number(q.quarter) : 0;
  const months = quarter ? [0, 1, 2].map((i) => `${year}-${String((quarter - 1) * 3 + 1 + i).padStart(2, "0")}`) : Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const runs = await t.rows(`SELECT period, lines FROM payroll_runs WHERE company_id=$1 AND status IN ('POSTED','PAID') AND period = ANY($2) ORDER BY period`, [companyId, `{${months.join(",")}}`]);
  const by: Record<string, any> = {};
  for (const run of runs) for (const l of (run.lines || []) as any[]) {
    const e = (by[l.employeeId] ||= { employeeId: l.employeeId, code: l.code, name: l.name, months: 0, gross: 0, insurance: 0, cuts: 0, taxable: 0, tax: 0, martyrs: 0, net: 0 });
    const cuts = num(l.deduction) + num(l.absence);
    e.months++; e.gross += num(l.gross); e.insurance += num(l.gosiEmp); e.cuts += cuts; e.taxable += num(l.gross) - cuts - num(l.gosiEmp); e.tax += num(l.salaryTax); e.martyrs += num(l.martyrs); e.net += num(l.net);
  }
  const rows = Object.values(by).map((e: any) => {
    const r: any = { ...e, gross: r2(e.gross), insurance: r2(e.insurance), cuts: r2(e.cuts), taxable: r2(e.taxable), tax: r2(e.tax), martyrs: r2(e.martyrs), net: r2(e.net) };
    if (!quarter) {
      // annual settlement: the tax on what was actually earned in the months worked, annualised the way the monthly payroll does it
      const annualised = e.months ? (e.taxable / e.months) * 12 : 0;
      const due = r2((salaryTaxDetail(annualised - EG_PAYROLL.personalExemption).tax / 12) * e.months);
      r.taxDue = due; r.difference = r2(due - r.tax);
    }
    return r;
  }).sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const tot = (k: string) => r2(rows.reduce((a, r) => a + (r[k] || 0), 0));
  return { year, quarter, periods: runs.map((r) => r.period), exemption: EG_PAYROLL.personalExemption, rows, totals: { gross: tot("gross"), insurance: tot("insurance"), cuts: tot("cuts"), taxable: tot("taxable"), tax: tot("tax"), martyrs: tot("martyrs"), net: tot("net"), taxDue: quarter ? undefined : tot("taxDue"), difference: quarter ? undefined : tot("difference") },
    due: quarter ? new Date(Date.UTC(Number(year), quarter * 3 + 1, 0)).toISOString().slice(0, 10) : `${Number(year) + 1}-01-31` };
}
