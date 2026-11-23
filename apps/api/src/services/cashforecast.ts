/**
 * Cash flow forecast for the next 13 weeks (the treasury view of Dynamics 365 «cash flow forecasting» / SAP «liquidity
 * planning»): today's cash and bank balances, then week by week what is due in and out from the books —
 * customers' and suppliers' open invoices by due date, cheques by due date, the approved supplier payment runs,
 * salaries (the average of the last posted payrolls, at each month end), lease payments, recurring expenses, and the
 * VAT payable at its return deadline. Optionally the average weekly cash sales of the last eight weeks.
 * Overdue amounts fall in the first week. Customers' overdue invoices are counted at a collection rate the user sets.
 */
import { Db } from "../db/pool";
import { num, r2, today, addDays, addMonths, monthEnd, isDate } from "../lib/core";
import { VAT_RATE } from "../lib/country";
import { leaseSchedule } from "./leases";

const iso = (d: any) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
type Item = { date: string; kind: string; label: string; amount: number; to?: string };

export async function cashForecast(t: Db, company: any, q: { weeks?: number; overdueRate?: number; cashSales?: boolean; from?: string }) {
  const C = company.id;
  const start = isDate(q.from) ? String(q.from) : today();
  const weeks = Math.min(26, Math.max(4, Math.round(num(q.weeks) || 13)));
  const end = addDays(start, weeks * 7 - 1);
  const overdueRate = Math.min(100, Math.max(0, q.overdueRate === undefined ? 100 : num(q.overdueRate))) / 100;
  const ins: Item[] = [], outs: Item[] = [];
  const when = (d: string) => (d < start ? start : d);

  const [accounts, ar, ap, cheques, runs, payroll, leases, recurring, vat, sales] = await Promise.all([
    t.rows(`SELECT a.id, a.code, a.name_ar, COALESCE(SUM(l.debit - l.credit),0) b FROM accounts a LEFT JOIN journal_lines l ON l.account_id=a.id LEFT JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED'
              WHERE a.company_id=$1 AND a.is_cash_bank AND NOT a.is_group AND (e.id IS NOT NULL OR l.id IS NULL) GROUP BY a.id ORDER BY a.code`, [C]),
    t.rows(`SELECT i.id, i.number, i.partner_name, COALESCE(i.due_date,i.date) due, i.total - i.amount_paid open FROM invoices i
              WHERE i.company_id=$1 AND i.direction='SALE' AND i.kind IN ('INVOICE','DEBIT_NOTE') AND i.status='POSTED' AND i.total - i.amount_paid > 0.005 AND COALESCE(i.due_date,i.date) <= $2`, [C, end]),
    t.rows(`SELECT i.id, i.number, i.partner_name, COALESCE(i.due_date,i.date) due, i.total - i.amount_paid
                   - COALESCE((SELECT SUM(l.amount) FROM payment_run_lines l JOIN payment_runs r ON r.id=l.run_id WHERE l.invoice_id=i.id AND r.status='APPROVED'),0) open
              FROM invoices i WHERE i.company_id=$1 AND i.direction='PURCHASE' AND i.kind IN ('INVOICE','DEBIT_NOTE') AND i.status='POSTED' AND i.total - i.amount_paid > 0.005 AND COALESCE(i.due_date,i.date) <= $2`, [C, end]),
    t.rows(`SELECT c.direction, c.cheque_no, c.amount, c.due_date, p.name FROM cheques c JOIN partners p ON p.id=c.partner_id WHERE c.company_id=$1 AND c.status IN ('PENDING','DEPOSITED') AND c.due_date <= $2`, [C, end]),
    t.rows(`SELECT number, pay_date, total FROM payment_runs WHERE company_id=$1 AND status='APPROVED'`, [C]),
    t.rows(`SELECT period, total_net, total_gosi_emp + total_gosi_er gosi FROM payroll_runs WHERE company_id=$1 AND status IN ('POSTED','PAID') ORDER BY period DESC LIMIT 3`, [C]),
    t.rows(`SELECT l.*, (SELECT COALESCE(array_agg(n),'{}') FROM lease_posts p WHERE p.lease_id=l.id AND p.kind='PAYMENT') paid FROM leases l WHERE l.company_id=$1 AND l.status='ACTIVE'`, [C]).catch(() => [] as any[]),
    t.rows(`SELECT r.name, r.kind, r.frequency, r.next_date, r.end_date, r.payload, a.system_key acc_key, a.name_ar acc_name FROM recurring_templates r LEFT JOIN accounts a ON a.company_id=r.company_id AND a.id::text = r.payload->>'accountId' WHERE r.company_id=$1 AND r.is_active AND r.kind='EXPENSE' AND r.next_date <= $2`, [C, end]),
    t.one(`SELECT COALESCE(SUM(CASE WHEN a.system_key IN ('VAT_OUT','VAT_PAYABLE') THEN l.credit - l.debit WHEN a.system_key='VAT_IN' THEN l.credit - l.debit ELSE 0 END),0) net
             FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED' JOIN accounts a ON a.id=l.account_id WHERE e.company_id=$1 AND a.system_key IN ('VAT_OUT','VAT_PAYABLE','VAT_IN') AND e.date <= $2`, [C, start]),
    q.cashSales ? t.one(`SELECT COALESCE(SUM(total),0) s FROM invoices WHERE company_id=$1 AND direction='SALE' AND kind='INVOICE' AND status='POSTED' AND channel='POS' AND date BETWEEN $2 AND $3`, [C, addDays(start, -56), addDays(start, -1)]) : Promise.resolve(null),
  ]);

  const opening = r2(accounts.reduce((a, x) => a + Number(x.b), 0));
  // customers: overdue at the collection rate, in week 1
  for (const r of ar) {
    const due = iso(r.due), open = Number(r.open), late = due < start;
    const amount = r2(late ? open * overdueRate : open);
    if (amount > 0) ins.push({ date: when(due), kind: late ? "AR_OVERDUE" : "AR", label: `${r.partnerName} — ${r.number}`, amount, to: `/doc/${r.id}` });
  }
  for (const r of ap) { const amount = r2(Number(r.open)); if (amount > 0.005) outs.push({ date: when(iso(r.due)), kind: iso(r.due) < start ? "AP_OVERDUE" : "AP", label: `${r.partnerName} — ${r.number}`, amount, to: `/doc/${r.id}` }); }
  for (const r of runs) outs.push({ date: when(iso(r.payDate)), kind: "RUN", label: `دفعة سداد الموردين ${r.number}`, amount: Number(r.total), to: "/payment-runs" });
  for (const c of cheques) (c.direction === "IN" ? ins : outs).push({ date: when(iso(c.dueDate)), kind: c.direction === "IN" ? "CHEQUE_IN" : "CHEQUE_OUT", label: `شيك ${c.chequeNo} — ${c.name}`, amount: Number(c.amount), to: "/cheques" });

  // salaries: average net of the last posted payrolls, paid at each month end; social insurance on the 15th of the next month
  if (payroll.length) {
    const net = r2(payroll.reduce((a, r) => a + Number(r.totalNet), 0) / payroll.length), gosi = r2(payroll.reduce((a, r) => a + Number(r.gosi), 0) / payroll.length);
    const done = new Set(payroll.map((r) => r.period));
    for (let m = 0; m <= Math.ceil(weeks / 4) + 1; m++) {
      const me = monthEnd(addMonths(start.slice(0, 8) + "01", m));
      if (me >= start && me <= end && !done.has(me.slice(0, 7))) outs.push({ date: me, kind: "PAYROLL", label: `رواتب ${me.slice(0, 7)} (متوسط آخر ${payroll.length} مسيرات)`, amount: net, to: "/payroll" });
      const g = addMonths(start.slice(0, 8) + "15", m);
      if (gosi > 0 && g >= start && g <= end) outs.push({ date: g, kind: "GOSI", label: `التأمينات الاجتماعية عن ${addMonths(g, -1).slice(0, 7)}`, amount: gosi, to: "/payroll" });
    }
  }
  // leases: each payment of the schedule not yet recorded
  for (const l of leases) {
    const sch = leaseSchedule({ startDate: iso(l.startDate), months: l.months, payment: Number(l.payment), frequency: l.frequency, timing: l.timing, annualRate: Number(l.annualRate), directCosts: Number(l.directCosts || 0) });
    const paid = new Set((l.paid || []).map(Number));
    for (const p of sch.payments) {
      if (paid.has(p.n) || p.date > end) continue;
      outs.push({ date: when(p.date), kind: "LEASE", label: `إيجار ${l.name} — الدفعة ${p.n}`, amount: Number(p.amount), to: `/leases` });
    }
  }
  // recurring expenses: each future run inside the horizon
  const step: Record<string, (d: string) => string> = { WEEKLY: (d) => addDays(d, 7), MONTHLY: (d) => addMonths(d, 1), QUARTERLY: (d) => addMonths(d, 3), YEARLY: (d) => addMonths(d, 12) };
  // a recurring expense on the rent account (or named rent) is rent: it goes in the rent column with the lease payments
  const isRent = (r: any) => r.accKey === "RENT" || /ايجار|إيجار|أجرة|rent/i.test(`${r.accName || ""} ${r.name || ""}`);
  for (const r of recurring) {
    const p = r.payload || {}; const net = num(p.amount); if (!net) continue;
    const gross = r2(p.amountIncludesVat || ["E", "Z", "O", "X"].includes(p.taxCode) ? net : net * (1 + VAT_RATE / 100));
    let d = iso(r.nextDate); let guard = 0;
    while (d <= end && guard++ < 60) { if (!r.endDate || d <= iso(r.endDate)) outs.push(isRent(r) ? { date: when(d), kind: "RENT", label: `${r.name} (إيجار دوري)`, amount: gross, to: "/recurring" } : { date: when(d), kind: "RECURRING", label: `${r.name} (مصروف دوري)`, amount: gross, to: "/recurring" }); d = step[r.frequency]?.(d) || addMonths(d, 1); }
  }
  // VAT: what is owed today is paid at the next return deadline
  const vatNet = r2(Number(vat.net));
  if (vatNet > 0) {
    const monthly = company.vatPeriod === "MONTHLY";
    const m = Number(start.slice(5, 7)), y = Number(start.slice(0, 4));
    const lastEnd = monthly ? monthEnd(addMonths(`${start.slice(0, 7)}-01`, -1)) : monthEnd(`${(Math.ceil(m / 3) - 1) * 3 ? y : y - 1}-${String((Math.ceil(m / 3) - 1) * 3 || 12).padStart(2, "0")}-01`);
    const filed = await t.maybe(`SELECT 1 FROM vat_returns WHERE company_id=$1 AND period_to >= $2`, [C, lastEnd]);
    const periodEnd = filed ? (monthly ? monthEnd(start) : monthEnd(`${y}-${String(Math.ceil(m / 3) * 3).padStart(2, "0")}-01`)) : lastEnd;
    const due = monthEnd(addDays(periodEnd, 1));
    if (due <= end) outs.push({ date: when(due), kind: "VAT", label: `ضريبة القيمة المضافة المستحقة (إقرار حتى ${periodEnd})`, amount: vatNet, to: "/vat" });
  }
  const weeklySales = sales ? r2(Number(sales.s) / 8) : 0;

  const buckets = Array.from({ length: weeks }, (_, w) => {
    const from = addDays(start, w * 7), to = addDays(from, 6);
    const inn = ins.filter((x) => x.date >= from && x.date <= to), out = outs.filter((x) => x.date >= from && x.date <= to);
    const sum = (xs: Item[], k?: string) => r2(xs.filter((x) => !k || x.kind === k).reduce((a, x) => a + x.amount, 0));
    const inflow = r2(sum(inn) + weeklySales), outflow = sum(out);
    return { week: w + 1, from, to, inflow, outflow, net: r2(inflow - outflow), in: { ar: r2(sum(inn, "AR") + sum(inn, "AR_OVERDUE")), cheques: sum(inn, "CHEQUE_IN"), cashSales: weeklySales },
      out: { ap: r2(sum(out, "AP") + sum(out, "AP_OVERDUE") + sum(out, "RUN")), cheques: sum(out, "CHEQUE_OUT"), payroll: r2(sum(out, "PAYROLL") + sum(out, "GOSI")), leases: r2(sum(out, "LEASE") + sum(out, "RENT")), recurring: sum(out, "RECURRING"), vat: sum(out, "VAT") },
      items: [...inn.map((x) => ({ ...x, dir: "IN" })), ...out.map((x) => ({ ...x, dir: "OUT" }))].sort((a, b) => b.amount - a.amount).slice(0, 25), opening: 0, closing: 0 };
  });
  let bal = opening;
  for (const b of buckets) { b.opening = r2(bal); bal = r2(bal + b.net); b.closing = bal; }
  const low = buckets.reduce((m, b) => (b.closing < m.closing ? b : m), buckets[0]);
  const firstNegative = buckets.find((b) => b.closing < 0) || null;
  const warnings: string[] = [];
  if (firstNegative) warnings.push(`الرصيد المتوقع يصبح سالباً في الأسبوع ${firstNegative.week} (${firstNegative.from}) بمبلغ ${firstNegative.closing} — رتّب تحصيلاً أو تمويلاً أو أجّل سداداً قبل ذلك.`);
  const overdueAr = r2(ins.filter((x) => x.kind === "AR_OVERDUE").reduce((a, x) => a + x.amount, 0));
  if (overdueAr > 0) warnings.push(`الأسبوع الأول يفترض تحصيل ${Math.round(overdueAr * 100) / 100} من فواتير عملاء متأخرة (بنسبة ${Math.round(overdueRate * 100)}%) — غيّر النسبة إن كان التحصيل غير مؤكد.`);
  const overdueAp = r2(outs.filter((x) => x.kind === "AP_OVERDUE").reduce((a, x) => a + x.amount, 0));
  if (overdueAp > 0) warnings.push(`على المنشأة ${overdueAp} لموردين متأخرة السداد محسوبة في الأسبوع الأول.`);
  // rent the books show every month but nobody told the forecast about: say so, with the average, instead of an empty column
  const rentTemplates = recurring.filter(isRent).length;
  const rentHist = await t.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) v, COUNT(DISTINCT to_char(e.date,'YYYY-MM'))::int m FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id
    WHERE a.company_id=$1 AND a.system_key='RENT' AND e.status='POSTED' AND e.type<>'CLOSING' AND e.date > ($2::date - interval '3 months') AND e.date <= $2`, [C, start]);
  const rentMonthlyAvg = Number(rentHist.m) ? r2(Number(rentHist.v) / Number(rentHist.m)) : 0;
  const rentMissing = !leases.length && !rentTemplates && rentMonthlyAvg > 0;
  if (rentMissing) warnings.push(`سجّلت إيجاراً بمتوسط ${rentMonthlyAvg} شهرياً في آخر ثلاثة أشهر، لكنه غير معرَّف كمصروف دوري ولا كعقد إيجار، فعمود الإيجار فارغ — أضفه بزر «＋ إيجار دوري».`);
  return {
    from: start, to: end, weeks, opening, closing: bal, lowest: { week: low.week, from: low.from, closing: low.closing }, firstNegative: firstNegative ? { week: firstNegative.week, from: firstNegative.from, closing: firstNegative.closing } : null,
    totals: { inflow: r2(buckets.reduce((a, b) => a + b.inflow, 0)), outflow: r2(buckets.reduce((a, b) => a + b.outflow, 0)) },
    accounts: accounts.map((a) => ({ code: a.code, name: a.nameAr, balance: r2(Number(a.b)) })), assumptions: { overdueRate: Math.round(overdueRate * 100), cashSales: !!q.cashSales, weeklySales, payrollRuns: payroll.length, leases: leases.length, rentTemplates, recurringTemplates: recurring.length - rentTemplates, rentMonthlyAvg, rentMissing },
    buckets, warnings,
  };
}
