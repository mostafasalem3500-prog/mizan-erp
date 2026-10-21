/**
 * Round 23 — Saudi zakat base assessment and withholding tax (ضريبة الاستقطاع).
 *
 * ZAKAT (simplified per the Zakat Collection Implementing Regulations, 1445H):
 *   base = sources of funds that were in hand for the year − assets held for use (non-current)
 *   sources : capital, reserves & other equity and retained earnings at the start of the year, opening-balance equity,
 *             owner/partner current account (credit), provisions brought forward (end of service, leave, doubtful debts),
 *             long-term loans, and the adjusted net profit of the year
 *   deducted: net property & equipment (cost − accumulated depreciation), a debit owner current account, accumulated losses
 *   the base may not fall below the adjusted net profit; rate 2.5% for a Hijri year or 2.5776% (2.5% × 365/354) for a Gregorian year.
 *   Every line is editable and manual adjustments can be added — the final figure is the one in the return filed with ZATCA.
 *
 * WITHHOLDING TAX (Income Tax Law art. 68 / implementing regulations art. 63): a resident paying a NON-RESIDENT
 *   for a service sourced in the Kingdom withholds tax at the statutory rate and remits it by the 10th of the next month.
 *   Supplier bears it : Dr AP (gross)          Cr Bank (net)     Cr WHT payable (tax)
 *   Company bears it  : Dr AP (full) + Dr WHT expense (grossed-up tax)  Cr Bank (full)  Cr WHT payable
 */
import { Db } from "../db/pool";
import { bad, conflict, r2, D, num, isDate, today } from "../lib/core";
import { post, reverse, nextNumber } from "../accounting/engine";

// ─── withholding tax ───────────────────────────────────────────────────────
export const WHT_TYPES: Record<string, { ar: string; rate: number }> = {
  MANAGEMENT: { ar: "أتعاب إدارة", rate: 0.2 },
  ROYALTIES: { ar: "إتاوات / ريع (حقوق ملكية فكرية، برمجيات)", rate: 0.15 },
  RELATED_SERVICES: { ar: "خدمات مدفوعة لشخص مرتبط", rate: 0.15 },
  RENT: { ar: "إيجار", rate: 0.05 },
  TECHNICAL: { ar: "خدمات فنية أو استشارية", rate: 0.05 },
  TICKETS_FREIGHT: { ar: "تذاكر طيران أو شحن جوي أو بحري", rate: 0.05 },
  TELECOM: { ar: "خدمات اتصالات هاتفية دولية", rate: 0.05 },
  DIVIDENDS: { ar: "توزيعات أرباح", rate: 0.05 },
  LOAN_RETURNS: { ar: "عوائد قروض", rate: 0.05 },
  INSURANCE: { ar: "أقساط تأمين أو إعادة تأمين", rate: 0.05 },
  OTHER: { ar: "دفعات أخرى", rate: 0.15 },
};

/** Lines for a supplier payment with withholding; returns the extra lines and the figures to store. */
export function whtLines(p: { amount: number; type: string; borne?: boolean; rate?: number; memo: string }) {
  const t = WHT_TYPES[p.type];
  if (!t) throw bad("نوع ضريبة الاستقطاع غير صحيح");
  const rate = p.rate && p.rate > 0 && p.rate < 1 ? p.rate : t.rate;
  if (p.borne) {
    // the supplier receives the full amount; the company bears the tax on the grossed-up base
    const gross = r2(D(p.amount).div(D(1).minus(rate)));
    const tax = r2(D(gross).minus(p.amount));
    return { rate, tax, net: p.amount, base: gross, borne: true, extra: [{ key: "WHT_EXPENSE", debit: tax, description: `ضريبة استقطاع تتحملها المنشأة — ${p.memo}` }, { key: "WHT_PAYABLE", credit: tax, description: `ضريبة استقطاع ${t.ar} ${(rate * 100).toFixed(0)}% — ${p.memo}` }] };
  }
  const tax = r2(D(p.amount).times(rate));
  return { rate, tax, net: r2(D(p.amount).minus(tax)), base: p.amount, borne: false, extra: [{ key: "WHT_PAYABLE", credit: tax, description: `ضريبة استقطاع ${t.ar} ${(rate * 100).toFixed(0)}% — ${p.memo}` }] };
}

const monthEnd = (period: string) => { const [y, m] = period.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const nextMonth10 = (period: string) => { const [y, m] = period.split("-").map(Number); return new Date(Date.UTC(y, m, 10)).toISOString().slice(0, 10); };

export async function whtReport(t: Db, companyId: string, q: any) {
  const period = /^\d{4}-\d{2}$/.test(String(q.period || "")) ? String(q.period) : today().slice(0, 7);
  const from = period + "-01", to = monthEnd(period);
  const rows = await t.rows(
    `SELECT p.id, p.number, p.date, p.amount, p.net_paid, p.wht_type, p.wht_rate, p.wht_amount, p.wht_borne, p.wht_return_id, p.reference,
            pt.name partner_name, pt.country, pt.vat_number, pt.cr_number
       FROM payments p JOIN partners pt ON pt.id=p.partner_id
      WHERE p.company_id=$1 AND p.status='POSTED' AND p.wht_amount > 0 AND p.date BETWEEN $2 AND $3 ORDER BY p.date, p.number`, [companyId, from, to]);
  const byType: Record<string, any> = {};
  for (const r of rows) {
    const k = r.whtType || "OTHER";
    const g = (byType[k] ||= { type: k, typeAr: WHT_TYPES[k]?.ar || k, rate: Number(r.whtRate), count: 0, base: 0, tax: 0 });
    g.count++; g.base = r2(D(g.base).plus(r.whtBorne ? D(r.whtAmount).plus(r.amount) : r.amount)); g.tax = r2(D(g.tax).plus(r.whtAmount));
  }
  const ret = await t.maybe(`SELECT w.*, j.number journal_number, a.name_ar account_name FROM wht_returns w LEFT JOIN journal_entries j ON j.id=w.journal_id LEFT JOIN accounts a ON a.id=w.pay_account_id WHERE w.company_id=$1 AND w.period=$2 AND w.status='POSTED'`, [companyId, period]);
  const bal = await t.one(`SELECT COALESCE(SUM(l.credit-l.debit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE l.company_id=$1 AND a.system_key='WHT_PAYABLE' AND e.status='POSTED'`, [companyId]);
  const history = await t.rows(`SELECT w.id, w.number, w.period, w.date, w.tax_total, w.status, j.number journal_number FROM wht_returns w LEFT JOIN journal_entries j ON j.id=w.journal_id WHERE w.company_id=$1 ORDER BY w.period DESC LIMIT 24`, [companyId]);
  const tax = r2(rows.reduce((a: any, r: any) => D(a).plus(r.whtAmount), D(0)));
  return { period, from, to, dueDate: nextMonth10(period), rows, byType: Object.values(byType), baseTotal: r2(Object.values(byType).reduce((a: any, g: any) => D(a).plus(g.base), D(0))), taxTotal: tax, filed: ret, payableBalance: r2(bal.b), history, types: WHT_TYPES };
}

/** Files (and pays) the month's withholding return: Dr WHT payable / Cr bank. */
export async function fileWht(t: Db, companyId: string, user: string, b: any) {
  const period = String(b.period || "");
  if (!/^\d{4}-\d{2}$/.test(period)) throw bad("حدد الشهر (YYYY-MM)");
  if (period >= today().slice(0, 7) && !b.allowCurrent) throw bad("يُقدَّم إقرار الاستقطاع بعد انتهاء الشهر (خلال العشرة أيام الأولى من الشهر التالي)");
  const dup = await t.maybe(`SELECT number FROM wht_returns WHERE company_id=$1 AND period=$2 AND status='POSTED'`, [companyId, period]);
  if (dup) throw conflict(`إقرار الاستقطاع لشهر ${period} مقدَّم مسبقاً (${dup.number})`);
  const rep = await whtReport(t, companyId, { period });
  if (!(rep.taxTotal > 0)) throw bad("لا توجد ضريبة استقطاع على مدفوعات هذا الشهر");
  const acc = await t.one(`SELECT * FROM accounts WHERE id=$1 AND company_id=$2 AND is_cash_bank AND NOT is_group`, [b.accountId, companyId], "اختر حساب البنك الذي سُددت منه الضريبة");
  const date = isDate(b.date) ? b.date : today();
  const number = await nextNumber(t, companyId, "WHT", date);
  const memo = `سداد ضريبة الاستقطاع لشهر ${period} لهيئة الزكاة والضريبة والجمارك — ${number}`;
  const je = await post(t, companyId, { date, type: "WHT", sourceType: "WHT_RETURN", reference: b.reference || number, memo, createdBy: user, lines: [{ key: "WHT_PAYABLE", debit: rep.taxTotal, description: memo }, { account: acc.id, credit: rep.taxTotal, description: memo }] });
  const row = await t.insert("wht_returns", { companyId, number, period, date, baseTotal: rep.baseTotal, taxTotal: rep.taxTotal, payAccountId: acc.id, reference: b.reference || null, journalId: je!.id, lines: JSON.stringify(rep.byType), createdBy: user });
  await t.exec(`UPDATE journal_entries SET source_id=$2 WHERE id=$1`, [je!.id, row.id]);
  await t.exec(`UPDATE payments SET wht_return_id=$2 WHERE company_id=$1 AND status='POSTED' AND wht_amount>0 AND date BETWEEN $3 AND $4`, [companyId, row.id, rep.from, rep.to]);
  return row;
}

export async function cancelWht(t: Db, companyId: string, user: string, id: string) {
  const w = await t.one(`SELECT * FROM wht_returns WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "الإقرار غير موجود");
  if (w.status !== "POSTED") throw conflict("الإقرار ملغى مسبقاً");
  if (w.journalId) await reverse(t, companyId, w.journalId, today(), `إلغاء سداد ضريبة الاستقطاع ${w.number}`, user);
  await t.exec(`UPDATE wht_returns SET status='CANCELLED' WHERE id=$1`, [id]);
  await t.exec(`UPDATE payments SET wht_return_id=NULL WHERE wht_return_id=$1`, [id]);
  return { ok: true };
}

// ─── zakat base ────────────────────────────────────────────────────────────
const RATES = { HIJRI: 0.025, GREGORIAN: 0.025776 };

async function balances(t: Db, companyId: string, asOf: string, before = false) {
  return t.rows(
    `SELECT a.id, a.code, a.name_ar, a.type, a.subtype, a.system_key, COALESCE(SUM(l.debit-l.credit),0) bal
       FROM accounts a JOIN journal_lines l ON l.account_id=a.id JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED'
      WHERE a.company_id=$1 AND e.date ${before ? "<" : "<="} $2 GROUP BY a.id HAVING ABS(COALESCE(SUM(l.debit-l.credit),0)) > 0.004 ORDER BY a.code`, [companyId, asOf]);
}

/** Proposed zakat computation for a financial year (nothing is posted). */
export async function zakatCompute(t: Db, companyId: string, q: any) {
  const year = String(q.year || today().slice(0, 4));
  const from = isDate(q.from) ? q.from : `${year}-01-01`;
  const to = isDate(q.to) ? q.to : `${year}-12-31`;
  if (from > to) throw bad("بداية الفترة بعد نهايتها");
  const method: "HIJRI" | "GREGORIAN" = q.method === "HIJRI" ? "HIJRI" : "GREGORIAN";
  const open = await balances(t, companyId, from, true);   // start of the year
  const close = await balances(t, companyId, to);          // end of the year
  // adjusted net profit: revenue − expenses of the year, excluding zakat itself and year-end closing entries
  const pl = await t.one(
    `SELECT COALESCE(SUM(CASE WHEN a.type='REVENUE' THEN l.credit-l.debit ELSE 0 END),0) rev,
            COALESCE(SUM(CASE WHEN a.type='EXPENSE' AND COALESCE(a.system_key,'')<>'ZAKAT' AND a.subtype<>'ZAKAT' THEN l.debit-l.credit ELSE 0 END),0) exp
       FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED'
      WHERE l.company_id=$1 AND e.date BETWEEN $2 AND $3 AND e.type<>'CLOSING'`, [companyId, from, to]);
  const profit = r2(D(pl.rev).minus(pl.exp));
  const items: any[] = [];
  const add = (group: "ADD" | "DEDUCT", key: string, label: string, amount: number, basis: string) => { if (Math.abs(amount) >= 0.01) items.push({ group, key, label, amount: r2(amount), basis }); };
  const credit = (rows: any[], f: (a: any) => boolean) => r2(rows.filter(f).reduce((s, a) => D(s).minus(a.bal), D(0)));
  const debit = (rows: any[], f: (a: any) => boolean) => r2(rows.filter(f).reduce((s, a) => D(s).plus(a.bal), D(0)));
  // equity basis: END (default — balance at year end, current-year profit added separately) or START (balance in hand at the start)
  const basis = q.basis === "START" ? "START" : "END";
  const eq = basis === "START" ? open : close, eqLbl = basis === "START" ? "رصيد أول السنة" : "رصيد آخر السنة";
  add("ADD", "capital", "رأس المال", credit(eq, (a) => a.systemKey === "CAPITAL" || a.code === "3101"), eqLbl);
  add("ADD", "reserves", "الاحتياطيات وحقوق الملكية الأخرى", credit(eq, (a) => a.type === "EQUITY" && !["CAPITAL", "RETAINED", "OWNER_CURRENT", "OPENING_EQUITY"].includes(a.systemKey || "") && !["3101", "3103", "3104", "3105"].includes(a.code)), eqLbl);
  // prior years not yet closed still sit in revenue/expense accounts — they belong to retained earnings
  const unclosed = credit(open, (a) => a.type === "REVENUE" || a.type === "EXPENSE");
  const retained = r2(D(credit(open, (a) => a.systemKey === "RETAINED" || a.code === "3104")).plus(unclosed));
  if (retained >= 0) add("ADD", "retained", "الأرباح المبقاة (المرحّلة)", retained, "رصيد أول السنة");
  else add("DEDUCT", "losses", "الخسائر المرحّلة", -retained, "رصيد أول السنة");
  add("ADD", "opening", "أرصدة افتتاحية (حقوق ملكية)", credit(eq, (a) => a.systemKey === "OPENING_EQUITY" || a.code === "3105"), eqLbl);
  const owner = credit(close, (a) => a.systemKey === "OWNER_CURRENT" || a.code === "3103");
  if (owner > 0) add("ADD", "owner", "جاري المالك / الشركاء (دائن)", owner, "رصيد آخر السنة");
  else add("DEDUCT", "owner", "جاري المالك / الشركاء (مسحوبات)", -owner, "رصيد آخر السنة");
  add("ADD", "provisions", "المخصصات المرحّلة (نهاية الخدمة، الإجازات)", credit(open, (a) => ["EOSB_PROVISION", "LEAVE_PROVISION"].includes(a.systemKey || "")), "رصيد أول السنة");
  add("ADD", "doubtful", "مخصص الديون المشكوك فيها", credit(open, (a) => a.code === "110304"), "رصيد أول السنة");
  add("ADD", "loans", "القروض طويلة الأجل", credit(close, (a) => a.subtype === "LONG_TERM_LIABILITY" && a.systemKey !== "EOSB_PROVISION"), "رصيد آخر السنة");
  add("ADD", "profit", "صافي الربح المعدّل للسنة", Math.max(0, profit), "قائمة الدخل قبل الزكاة");
  add("DEDUCT", "fixed", "صافي الممتلكات والمعدات (التكلفة − مجمع الإهلاك)", debit(close, (a) => a.subtype === "FIXED_ASSET" || a.subtype === "ACC_DEPRECIATION"), "رصيد آخر السنة");
  if (profit < 0) items.push({ group: "INFO", key: "loss", label: "صافي خسارة السنة (لا تُخصم من الوعاء، تُرحّل للسنوات التالية)", amount: r2(-profit), basis: "قائمة الدخل" });
  const existing = await t.rows(`SELECT z.*, j.number journal_number FROM zakat_assessments z LEFT JOIN journal_entries j ON j.id=z.journal_id WHERE z.company_id=$1 ORDER BY z.period_to DESC, z.created_at DESC LIMIT 20`, [companyId]);
  return { from, to, method, basis, rate: RATES[method], adjustedProfit: Math.max(0, profit), netProfit: profit, items, history: existing, ...summarize(items, Math.max(0, profit), RATES[method]) };
}

function summarize(items: any[], adjustedProfit: number, rate: number) {
  const adds = r2(items.filter((i) => i.group === "ADD").reduce((a, i) => D(a).plus(i.amount), D(0)));
  const deds = r2(items.filter((i) => i.group === "DEDUCT").reduce((a, i) => D(a).plus(i.amount), D(0)));
  const raw = r2(D(adds).minus(deds));
  const base = r2(Math.max(raw, adjustedProfit, 0));
  return { additions: adds, deductions: deds, rawBase: raw, base, floorApplied: base > raw, zakat: r2(D(base).times(rate)) };
}

/** Saves the (possibly adjusted) assessment and posts the provision: Dr zakat expense / Cr zakat provision. */
export async function zakatPost(t: Db, companyId: string, user: string, b: any) {
  const from = b.from, to = b.to;
  if (!isDate(from) || !isDate(to) || from > to) throw bad("فترة غير صحيحة");
  const method: "HIJRI" | "GREGORIAN" = b.method === "HIJRI" ? "HIJRI" : "GREGORIAN";
  const items = (Array.isArray(b.items) ? b.items : []).filter((i: any) => ["ADD", "DEDUCT", "INFO"].includes(i.group)).map((i: any) => ({ group: i.group, key: String(i.key || "manual"), label: String(i.label || "تعديل يدوي").slice(0, 200), amount: r2(Math.abs(num(i.amount))), basis: String(i.basis || "تعديل يدوي").slice(0, 120) }));
  if (!items.length) throw bad("لا توجد بنود للوعاء");
  const adjustedProfit = r2(Math.max(0, num(b.adjustedProfit)));
  const s = summarize(items, adjustedProfit, RATES[method]);
  if (!(s.zakat > 0)) throw bad("الزكاة المستحقة صفر — لا يوجد ما يُرحّل");
  const dup = await t.maybe(`SELECT number FROM zakat_assessments WHERE company_id=$1 AND period_from=$2 AND period_to=$3 AND status='POSTED'`, [companyId, from, to]);
  if (dup) throw conflict(`يوجد احتساب زكاة مرحّل لنفس الفترة (${dup.number}) — ألغِه أولاً لإعادة الاحتساب`);
  const number = await nextNumber(t, companyId, "ZKT", to);
  const memo = `مخصص الزكاة الشرعية للفترة ${from} – ${to} (الوعاء ${s.base.toFixed(2)} × ${(RATES[method] * 100).toFixed(4)}%) — ${number}`;
  const je = await post(t, companyId, { date: to, type: "ZAKAT", sourceType: "ZAKAT", reference: number, memo, createdBy: user, lines: [{ key: "ZAKAT", debit: s.zakat, description: memo }, { key: "ZAKAT_PAYABLE", credit: s.zakat, description: memo }] });
  const row = await t.insert("zakat_assessments", { companyId, number, periodFrom: from, periodTo: to, method, rate: RATES[method], items: JSON.stringify(items), adjustedProfit, base: s.base, zakat: s.zakat, journalId: je!.id, notes: b.notes || null, createdBy: user });
  await t.exec(`UPDATE journal_entries SET source_id=$2 WHERE id=$1`, [je!.id, row.id]);
  return { ...row, ...s };
}

export async function zakatGet(t: Db, companyId: string, id: string) {
  const z = await t.one(`SELECT z.*, j.number journal_number FROM zakat_assessments z LEFT JOIN journal_entries j ON j.id=z.journal_id WHERE z.id=$1 AND z.company_id=$2`, [id, companyId], "الاحتساب غير موجود");
  z.payments = await t.rows(`SELECT p.*, a.name_ar account_name, j.number journal_number FROM zakat_payments p JOIN accounts a ON a.id=p.account_id LEFT JOIN journal_entries j ON j.id=p.journal_id WHERE p.assessment_id=$1 ORDER BY p.date`, [id]);
  return { ...z, ...summarize(z.items, Number(z.adjustedProfit), Number(z.rate)) };
}

export async function zakatCancel(t: Db, companyId: string, user: string, id: string) {
  const z = await t.one(`SELECT * FROM zakat_assessments WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "الاحتساب غير موجود");
  if (z.status !== "POSTED") throw conflict("الاحتساب ملغى مسبقاً");
  if (Number(z.paid) > 0) throw conflict("سُدّد جزء من الزكاة — لا يمكن إلغاء الاحتساب");
  if (z.journalId) await reverse(t, companyId, z.journalId, String(z.periodTo).slice(0, 10) <= today() ? today() : z.periodTo, `إلغاء مخصص الزكاة ${z.number}`, user);
  await t.exec(`UPDATE zakat_assessments SET status='CANCELLED' WHERE id=$1`, [id]);
  return { ok: true };
}

/** Payment of zakat to ZATCA: Dr zakat provision / Cr bank (cannot exceed the outstanding provision). */
export async function zakatPay(t: Db, companyId: string, user: string, id: string, b: any) {
  const z = await t.one(`SELECT * FROM zakat_assessments WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "الاحتساب غير موجود");
  if (z.status !== "POSTED") throw conflict("الاحتساب ملغى");
  const amount = r2(num(b.amount) || D(z.zakat).minus(z.paid).toNumber());
  const due = r2(D(z.zakat).minus(z.paid));
  if (!(amount > 0)) throw bad("المبلغ يجب أن يكون أكبر من صفر");
  if (amount > due + 0.001) throw bad(`المبلغ أكبر من المتبقي من الزكاة (${due.toFixed(2)})`);
  const acc = await t.one(`SELECT * FROM accounts WHERE id=$1 AND company_id=$2 AND is_cash_bank AND NOT is_group`, [b.accountId, companyId], "اختر حساب البنك");
  const date = isDate(b.date) ? b.date : today();
  const memo = `سداد الزكاة لهيئة الزكاة والضريبة والجمارك — ${z.number}${b.reference ? " — مرجع " + b.reference : ""}`;
  const je = await post(t, companyId, { date, type: "ZAKAT", sourceType: "ZAKAT_PAYMENT", sourceId: z.id, reference: b.reference || z.number, memo, createdBy: user, lines: [{ key: "ZAKAT_PAYABLE", debit: amount, description: memo }, { account: acc.id, credit: amount, description: memo }] });
  await t.insert("zakat_payments", { companyId, assessmentId: z.id, date, amount, accountId: acc.id, reference: b.reference || null, journalId: je!.id, createdBy: user });
  await t.exec(`UPDATE zakat_assessments SET paid=paid+$2 WHERE id=$1`, [z.id, amount]);
  return zakatGet(t, companyId, z.id);
}
