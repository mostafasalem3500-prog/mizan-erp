/**
 * Egypt edition — the Egyptian tax rules the ledger applies (MIZAN_COUNTRY=EG).
 *
 * • VAT (Law 67/2016): 14% general rate; zero rate on exports; exempt goods & services (schedule).
 * • Withholding under the tax account system (الخصم تحت حساب الضريبة، Income Tax Law 91/2005 art. 59 & exec. regs):
 *   the payer deducts a % of the net invoice value (transactions above EGP 300) and remits it quarterly with Form 41.
 *   The payee books what was deducted from it as a credit against its own income tax.
 * • Salary tax (Income Tax Law as amended by Law 7/2024): EGP 20,000 personal exemption for employees, then the progressive
 *   brackets below; above EGP 600,000 of annual taxable income the lower brackets are progressively lost.
 * • Social insurance (Law 148/2019): employee 11%, employer 18.75% of the insurable wage, clamped to the year's min/max
 *   (2026: EGP 2,700 – 16,700 a month). Martyrs & victims fund (Law 16/2018): 0.05% of gross salary, borne by the employee.
 * • Corporate income tax: 22.5% of taxable profit; withholding credits and advance payments reduce what is paid.
 * All rates live in this file so a change in the law is a one-line edit.
 */
import { Db } from "../db/pool";
import { bad, conflict, r2, D, num, isDate, today, addDays } from "../lib/core";
import { post, reverse, nextNumber } from "../accounting/engine";
import { incomeStatement } from "./reports";

// ─── withholding (خصم وإضافة) ────────────────────────────────────────────
export const EG_WHT_TYPES: Record<string, { ar: string; rate: number }> = {
  SUPPLIES: { ar: "توريدات ومقاولات ومشتريات", rate: 0.01 },
  SERVICES: { ar: "خدمات", rate: 0.03 },
  COMMISSIONS: { ar: "عمولات وسمسرة", rate: 0.05 },
  PROFESSIONAL: { ar: "مهن حرة وأتعاب (عدا المحامين والأطباء)", rate: 0.05 },
  DISCOUNTS: { ar: "خصومات وعمولات تمنحها الشركات المخاطبة", rate: 0.02 },
  TRANSPORT_COOP: { ar: "خدمات نقل الجمعيات التعاونية", rate: 0.01 },
};
export const EG_WHT_THRESHOLD = 300; // EGP — no deduction on transactions of 300 or less

/** Payer side: supplier payment with deduction. Receiver side: a customer deducted tax from what it paid us. */
export function egWhtLines(p: { amount: number; base?: number; type: string; rate?: number; direction: "IN" | "OUT"; memo: string }) {
  const t = EG_WHT_TYPES[p.type];
  if (!t) throw bad("نوع الخصم تحت حساب الضريبة غير صحيح");
  const rate = p.rate && p.rate > 0 && p.rate < 1 ? p.rate : t.rate;
  const base = r2(p.base ?? p.amount);
  if (!(base > EG_WHT_THRESHOLD)) throw bad(`لا يُخصم تحت حساب الضريبة على التعاملات التي لا تتجاوز ${EG_WHT_THRESHOLD} جنيه (قبل الضريبة)`);
  const tax = r2(D(base).times(rate));
  const pct = `${(rate * 100).toFixed(rate * 100 % 1 ? 1 : 0)}%`;
  return p.direction === "OUT"
    ? { rate, tax, net: r2(D(p.amount).minus(tax)), base, borne: false, extra: [{ key: "WHT_PAYABLE", credit: tax, description: `خصم تحت حساب الضريبة ${t.ar} ${pct} — ${p.memo}` }] }
    : { rate, tax, net: r2(D(p.amount).minus(tax)), base, borne: false, extra: [{ key: "EG_WHT_CREDIT", debit: tax, description: `خصم من المنبع لدى العميل ${t.ar} ${pct} — ${p.memo}` }] };
}

const quarterRange = (y: number, q: number) => {
  const from = `${y}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(y, q * 3, 0)).toISOString().slice(0, 10);
  const due = new Date(Date.UTC(y, q * 3 + 1, 0)).toISOString().slice(0, 10); // end of the month after the quarter
  return { from, to: end, due };
};
export const quarterOf = (date: string) => `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;

/** Form 41 (quarterly): deductions we made from suppliers (payable) and deductions customers made from us (credits). */
export async function form41(t: Db, companyId: string, q: any) {
  const m = /^(\d{4})-Q([1-4])$/.exec(String(q.period || ""));
  const period = m ? String(q.period) : quarterOf(today());
  const [y, qq] = [Number(period.slice(0, 4)), Number(period.slice(-1))];
  const { from, to, due } = quarterRange(y, qq);
  const rows = await t.rows(
    `SELECT p.id, p.number, p.direction, p.date, p.amount, p.net_paid, p.wht_type, p.wht_rate, p.wht_amount, p.wht_return_id, p.reference,
            pt.name partner_name, pt.vat_number, pt.id_number, pt.street, pt.city
       FROM payments p JOIN partners pt ON pt.id=p.partner_id
      WHERE p.company_id=$1 AND p.status='POSTED' AND p.wht_amount > 0 AND p.date BETWEEN $2 AND $3 ORDER BY p.direction DESC, p.date, p.number`, [companyId, from, to]);
  const out = rows.filter((r) => r.direction === "OUT"), inn = rows.filter((r) => r.direction === "IN");
  const byType: Record<string, any> = {};
  for (const r of out) {
    const k = r.whtType || "SUPPLIES";
    const g = (byType[k] ||= { type: k, typeAr: EG_WHT_TYPES[k]?.ar || k, rate: Number(r.whtRate), count: 0, base: 0, tax: 0 });
    g.count++; g.base = r2(g.base + Number(r.amount)); g.tax = r2(g.tax + Number(r.whtAmount));
  }
  const sum = (a: any[], k: string) => r2(a.reduce((s, r) => s + Number(r[k]), 0));
  const filed = await t.maybe(`SELECT w.*, j.number journal_number FROM wht_returns w LEFT JOIN journal_entries j ON j.id=w.journal_id WHERE w.company_id=$1 AND w.period=$2 AND w.status='POSTED'`, [companyId, period]);
  const bal = await t.one(`SELECT COALESCE(SUM(CASE WHEN a.system_key='WHT_PAYABLE' THEN l.credit-l.debit END),0) payable, COALESCE(SUM(CASE WHEN a.system_key='EG_WHT_CREDIT' THEN l.debit-l.credit END),0) credit FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND e.status='POSTED' AND a.system_key IN ('WHT_PAYABLE','EG_WHT_CREDIT')`, [companyId]);
  const history = await t.rows(`SELECT w.id, w.number, w.period, w.date, w.tax_total, w.status, j.number journal_number FROM wht_returns w LEFT JOIN journal_entries j ON j.id=w.journal_id WHERE w.company_id=$1 ORDER BY w.period DESC LIMIT 12`, [companyId]);
  return { period, from, to, dueDate: due, deducted: out, deductedFromUs: inn, byType: Object.values(byType), baseTotal: sum(out, "amount"), taxTotal: sum(out, "whtAmount"), creditsTotal: sum(inn, "whtAmount"), filed, payableBalance: r2(bal.payable), creditBalance: r2(bal.credit), history, types: EG_WHT_TYPES, threshold: EG_WHT_THRESHOLD };
}

/** Files Form 41 for a quarter and remits the deducted tax: Dr WHT payable / Cr bank. */
export async function fileForm41(t: Db, companyId: string, user: string, b: any) {
  const period = String(b.period || "");
  const m = /^(\d{4})-Q([1-4])$/.exec(period);
  if (!m) throw bad("حدد الربع (مثل 2026-Q3)");
  const { from, to } = quarterRange(Number(m[1]), Number(m[2]));
  if (to >= today() && !b.allowCurrent) throw bad("يُقدَّم نموذج 41 بعد انتهاء الربع (حتى نهاية الشهر التالي له)");
  const dup = await t.maybe(`SELECT number FROM wht_returns WHERE company_id=$1 AND period=$2 AND status='POSTED'`, [companyId, period]);
  if (dup) throw conflict(`نموذج 41 للربع ${period} مقدَّم مسبقاً (${dup.number})`);
  const rows = await t.rows(`SELECT id, number, amount, wht_amount, wht_type FROM payments WHERE company_id=$1 AND status='POSTED' AND direction='OUT' AND wht_amount > 0 AND wht_return_id IS NULL AND date BETWEEN $2 AND $3 FOR UPDATE`, [companyId, from, to]);
  if (!rows.length) throw bad("لا توجد مبالغ مخصومة في هذا الربع");
  const tax = r2(rows.reduce((a, r) => a + Number(r.whtAmount), 0)), base = r2(rows.reduce((a, r) => a + Number(r.amount), 0));
  const acc = await t.one(`SELECT * FROM accounts WHERE id=$1 AND company_id=$2 AND is_cash_bank AND NOT is_group`, [b.accountId, companyId], "اختر حساب البنك");
  const date = isDate(b.date) ? b.date : today();
  const number = await nextNumber(t, companyId, "F41", date);
  const memo = `توريد الخصم تحت حساب الضريبة — نموذج 41 للربع ${period} — ${number}${b.reference ? " — مرجع " + b.reference : ""}`;
  const je = await post(t, companyId, { date, type: "WHT", sourceType: "WHT_RETURN", reference: b.reference || number, memo, createdBy: user, lines: [{ key: "WHT_PAYABLE", debit: tax, description: memo }, { account: acc.id, credit: tax, description: memo }] });
  const ret = await t.insert("wht_returns", { companyId, number, period, date, baseTotal: base, taxTotal: tax, payAccountId: acc.id, reference: b.reference || null, journalId: je!.id, lines: JSON.stringify(rows.map((r) => ({ id: r.id, number: r.number, tax: Number(r.whtAmount) }))), createdBy: user });
  await t.exec(`UPDATE journal_entries SET source_id=$2 WHERE id=$1`, [je!.id, ret.id]);
  await t.exec(`UPDATE payments SET wht_return_id=$2 WHERE id = ANY($1)`, [rows.map((r) => r.id), ret.id]);
  return ret;
}

export async function cancelForm41(t: Db, companyId: string, user: string, id: string) {
  const w = await t.one(`SELECT * FROM wht_returns WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "النموذج غير موجود");
  if (w.status !== "POSTED") throw conflict("النموذج ملغى مسبقاً");
  await reverse(t, companyId, w.journalId, today(), `إلغاء توريد نموذج 41 ${w.number}`, user);
  await t.exec(`UPDATE wht_returns SET status='CANCELLED' WHERE id=$1`, [id]);
  await t.exec(`UPDATE payments SET wht_return_id=NULL WHERE wht_return_id=$1`, [id]);
  return { ok: true };
}

// ─── payroll: salary tax & social insurance ─────────────────────────────
export const EG_PAYROLL = {
  personalExemption: 20000,
  brackets: [[40000, 0], [55000, 0.10], [70000, 0.15], [200000, 0.20], [400000, 0.225], [1200000, 0.25], [Infinity, 0.275]] as [number, number][],
  /** above these annual incomes the first N brackets are taxed at the next bracket's rate (Law 7/2024) */
  phaseOut: [[600000, 1], [700000, 2], [800000, 3], [900000, 4], [1200000, 5]] as [number, number][],
  insurance: { employee: 0.11, employer: 0.1875, minWage: 2700, maxWage: 16700 },
  martyrs: 0.0005,
};

/** Annual salary tax on annual taxable income (after social insurance and the personal exemption). */
export const annualSalaryTax = (taxable: number) => salaryTaxDetail(taxable).tax;
export function salaryTaxDetail(taxable: number) {
  const T = Math.max(0, taxable);
  const B = EG_PAYROLL.brackets;
  let merged = 0;
  for (const [limit, n] of EG_PAYROLL.phaseOut) if (T > limit) merged = n;
  const parts: { from: number; to: number; rate: number; tax: number }[] = [];
  let lower = 0;
  for (let i = 0; i < B.length; i++) {
    const [upper, rate] = B[i];
    if (i < merged) { lower = upper; continue; }
    const from = i === merged ? 0 : lower;
    if (T <= from) break;
    const to = Math.min(T, upper);
    parts.push({ from, to, rate, tax: r2((to - from) * rate) });
    lower = upper;
  }
  return { taxable: r2(T), parts, tax: r2(parts.reduce((a, p) => a + p.tax, 0)) };
}

/** One employee's Egyptian payroll line. */
export function computeLineEG(e: any, adj: any = {}, loans: { id: string; amount: number }[] = []) {
  const basic = Number(e.basic), housing = Number(e.housing), transport = Number(e.transport), other = Number(e.otherAllow);
  const bonus = r2(num(adj.bonus)), overtime = r2(num(adj.overtime)), deduction = r2(num(adj.deduction)), absence = r2(num(adj.absence));
  const autoLoan = r2(loans.reduce((a, l) => a + l.amount, 0));
  const loan = adj.loan === undefined || adj.loan === null || adj.loan === "" ? autoLoan : Math.max(0, Math.min(autoLoan, r2(num(adj.loan))));
  let rem = loan; const loanItems = loans.map((l) => { const a = r2(Math.min(l.amount, rem)); rem = r2(rem - a); return { id: l.id, amount: a }; }).filter((l) => l.amount > 0);
  const gross = r2(D(basic).plus(housing).plus(transport).plus(other).plus(bonus).plus(overtime));
  const I = EG_PAYROLL.insurance;
  const fixed = r2(basic + housing + transport + other);
  const insWage = e.gosi ? Math.min(I.maxWage, Math.max(I.minWage, fixed)) : 0;
  const gosiEmp = r2(insWage * I.employee), gosiEr = r2(insWage * I.employer);
  const taxableMonth = r2(D(gross).minus(deduction).minus(absence).minus(gosiEmp));
  const annual = r2(taxableMonth * 12 - EG_PAYROLL.personalExemption);
  const salaryTax = r2(salaryTaxDetail(annual).tax / 12);
  const martyrs = r2(D(gross).minus(deduction).minus(absence).times(EG_PAYROLL.martyrs));
  const net = r2(D(gross).minus(gosiEmp).minus(salaryTax).minus(martyrs).minus(deduction).minus(absence).minus(loan));
  return { employeeId: e.id, code: e.code, name: e.name, iban: e.iban, bankName: e.bankName, nationality: e.nationality, basic, housing, transport, other, bonus, overtime, deduction, absence, loan, loanItems, gross, gosiBase: insWage, gosiEmp, gosiEr, salaryTax, martyrs, taxableAnnual: Math.max(0, annual), net, note: adj.note || null };
}

// ─── corporate income tax (ضريبة الدخل على الأشخاص الاعتبارية) ─────────────
export const EG_CIT_RATE = 0.225;

async function balanceOf(t: Db, companyId: string, key: string, to: string, debitPositive = true) {
  const r = await t.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND a.system_key=$2 AND e.status='POSTED' AND e.date <= $3`, [companyId, key, to]);
  return r2(debitPositive ? r.b : -r.b);
}

/** Taxable profit = accounting profit before income tax ± adjustments; tax 22.5%; less withholding credits & advances. */
export async function incomeTaxCompute(t: Db, companyId: string, q: any) {
  const year = /^\d{4}$/.test(String(q.year || "")) ? String(q.year) : String(Number(today().slice(0, 4)) - 1);
  const fy = await t.maybe(`SELECT * FROM fiscal_years WHERE company_id=$1 AND name=$2`, [companyId, year]);
  const from = fy?.startDate || `${year}-01-01`, to = fy?.endDate || `${year}-12-31`;
  const is = await incomeStatement(t, companyId, { from, to });
  const credits = await balanceOf(t, companyId, "EG_WHT_CREDIT", to);
  const advances = await balanceOf(t, companyId, "INCOME_TAX_ADVANCE", to);
  const posted = await t.maybe(`SELECT z.*, j.number journal_number FROM zakat_assessments z LEFT JOIN journal_entries j ON j.id=z.journal_id WHERE z.company_id=$1 AND z.method='EG_CIT' AND z.period_from=$2 AND z.period_to=$3 AND z.status='POSTED'`, [companyId, from, to]);
  const history = await t.rows(`SELECT id, number, period_from, period_to, base, zakat tax, paid, status FROM zakat_assessments WHERE company_id=$1 AND method='EG_CIT' ORDER BY period_to DESC LIMIT 10`, [companyId]);
  return { year, from, to, profitBeforeTax: is.beforeZakat, revenue: is.netSales, rate: EG_CIT_RATE, credits, advances, posted, history, dueDate: `${Number(year) + 1}-04-30` };
}

export function incomeTaxSummary(profit: number, items: any[], rate = EG_CIT_RATE) {
  const add = r2(items.filter((i) => i.group === "ADD").reduce((a, i) => a + num(i.amount), 0));
  const ded = r2(items.filter((i) => i.group === "DEDUCT").reduce((a, i) => a + num(i.amount), 0));
  const taxable = r2(Math.max(0, profit + add - ded));
  return { profit: r2(profit), add, deduct: ded, taxable, tax: r2(taxable * rate) };
}

export async function incomeTaxPost(t: Db, companyId: string, user: string, b: any) {
  const c = await incomeTaxCompute(t, companyId, { year: b.year });
  if (c.posted) throw conflict(`يوجد مخصص ضريبة دخل مرحّل لسنة ${c.year} (${c.posted.number}) — ألغِه أولاً`);
  const items = (Array.isArray(b.items) ? b.items : []).filter((i: any) => ["ADD", "DEDUCT"].includes(i.group) && num(i.amount) > 0).map((i: any) => ({ group: i.group, label: String(i.label || "تسوية").slice(0, 200), amount: r2(num(i.amount)) }));
  const s = incomeTaxSummary(c.profitBeforeTax, items);
  if (!(s.tax > 0)) throw bad("الضريبة المستحقة صفر (لا يوجد وعاء خاضع) — لا يوجد ما يُرحّل");
  const number = await nextNumber(t, companyId, "CIT", c.to);
  const memo = `مخصص ضريبة الدخل لسنة ${c.year} (الوعاء ${s.taxable.toFixed(2)} × 22.5%) — ${number}`;
  const je = await post(t, companyId, { date: c.to, type: "INCOME_TAX", sourceType: "INCOME_TAX", reference: number, memo, createdBy: user, allowClosed: false, lines: [{ key: "INCOME_TAX", debit: s.tax, description: memo }, { key: "INCOME_TAX_PAYABLE", credit: s.tax, description: memo }] });
  const row = await t.insert("zakat_assessments", { companyId, number, periodFrom: c.from, periodTo: c.to, method: "EG_CIT", rate: EG_CIT_RATE, items: JSON.stringify(items), adjustedProfit: s.profit, base: s.taxable, zakat: s.tax, journalId: je!.id, notes: b.notes || null, createdBy: user });
  await t.exec(`UPDATE journal_entries SET source_id=$2 WHERE id=$1`, [je!.id, row.id]);
  return { ...row, ...s };
}

export async function incomeTaxCancel(t: Db, companyId: string, user: string, id: string) {
  const z = await t.one(`SELECT * FROM zakat_assessments WHERE id=$1 AND company_id=$2 AND method='EG_CIT' FOR UPDATE`, [id, companyId], "المخصص غير موجود");
  if (z.status !== "POSTED") throw conflict("المخصص ملغى مسبقاً");
  if (Number(z.paid) > 0) throw conflict("سُدّد جزء من الضريبة — لا يمكن الإلغاء");
  await reverse(t, companyId, z.journalId, String(z.periodTo).slice(0, 10) <= today() ? today() : z.periodTo, `إلغاء مخصص ضريبة الدخل ${z.number}`, user);
  await t.exec(`UPDATE zakat_assessments SET status='CANCELLED' WHERE id=$1`, [id]);
  return { ok: true };
}

/** Settles the return: withholding credits and advance payments are applied first, the rest is paid from the bank. */
export async function incomeTaxSettle(t: Db, companyId: string, user: string, id: string, b: any) {
  const z = await t.one(`SELECT * FROM zakat_assessments WHERE id=$1 AND company_id=$2 AND method='EG_CIT' FOR UPDATE`, [id, companyId], "المخصص غير موجود");
  if (z.status !== "POSTED") throw conflict("المخصص ملغى");
  const due = r2(D(z.zakat).minus(z.paid));
  if (!(due > 0)) throw conflict("الضريبة مسددة بالكامل");
  const date = isDate(b.date) ? b.date : today();
  const credits = await balanceOf(t, companyId, "EG_WHT_CREDIT", date), advances = await balanceOf(t, companyId, "INCOME_TAX_ADVANCE", date);
  const useCredit = b.useCredits === false ? 0 : r2(Math.min(credits, due));
  const useAdv = b.useCredits === false ? 0 : r2(Math.min(advances, due - useCredit));
  const cash = r2(due - useCredit - useAdv);
  const lines: any[] = [{ key: "INCOME_TAX_PAYABLE", debit: due, description: `تسوية ضريبة الدخل ${z.number}` }];
  if (useCredit > 0) lines.push({ key: "EG_WHT_CREDIT", credit: useCredit, description: `خصم الضرائب المخصومة منا (خصم من المنبع) — ${z.number}` });
  if (useAdv > 0) lines.push({ key: "INCOME_TAX_ADVANCE", credit: useAdv, description: `خصم الدفعات المقدمة — ${z.number}` });
  if (cash > 0) {
    const acc = await t.one(`SELECT * FROM accounts WHERE id=$1 AND company_id=$2 AND is_cash_bank AND NOT is_group`, [b.accountId, companyId], "اختر حساب البنك لسداد الباقي");
    lines.push({ account: acc.id, credit: cash, description: `سداد ضريبة الدخل لمصلحة الضرائب — ${z.number}${b.reference ? " — " + b.reference : ""}` });
  }
  const je = await post(t, companyId, { date, type: "INCOME_TAX", sourceType: "INCOME_TAX_PAYMENT", sourceId: z.id, reference: b.reference || z.number, memo: `تسوية وسداد ضريبة الدخل ${z.number}`, createdBy: user, lines });
  await t.insert("zakat_payments", { companyId, assessmentId: z.id, date, amount: due, accountId: cash > 0 ? lines[lines.length - 1].account : (await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND system_key='EG_WHT_CREDIT'`, [companyId])).id, reference: b.reference || null, journalId: je!.id, createdBy: user });
  await t.exec(`UPDATE zakat_assessments SET paid=paid+$2 WHERE id=$1`, [z.id, due]);
  return { due, credits: useCredit, advances: useAdv, cash };
}

export const nextQuarterDue = (d: string) => quarterRange(Number(d.slice(0, 4)), Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1).due;
export { addDays };
