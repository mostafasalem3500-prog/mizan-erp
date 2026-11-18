/**
 * The day at a glance: what was sold, bought, spent, collected and paid on one date, the movement of every cash and bank
 * account, and — for today — the things waiting for someone to act on (overdue invoices, bills falling due, drafts…).
 * Used by the daily report screen, the quick-entry screen and the assistant.
 */
import { Db } from "../db/pool";
import { IS_EG } from "../lib/country";
import { isDate, today, addDays, addMonths, monthEnd, r2 } from "../lib/core";
import { checkPartner } from "../lib/partnerRules";
import { bad } from "../lib/core";

const n = (v: any) => r2(Number(v || 0));

export async function dailyReport(t: Db, C: string, dateIn?: string) {
  const date = isDate(dateIn) ? dateIn! : today();
  const docs = await t.rows(
    `SELECT direction, kind, channel, COUNT(*)::int c, COALESCE(SUM(taxable),0) net, COALESCE(SUM(vat_total),0) vat, COALESCE(SUM(total),0) total, COALESCE(SUM(cost_total),0) cost
       FROM invoices WHERE company_id=$1 AND status='POSTED' AND date=$2 AND kind IN ('INVOICE','CREDIT_NOTE') GROUP BY 1,2,3`, [C, date]);
  const pick = (dir: string, kind: string, pos?: boolean) => docs.filter((d: any) => d.direction === dir && d.kind === kind && (pos === undefined || (d.channel === "POS") === pos));
  const tot = (rs: any[]) => ({ count: rs.reduce((a, x) => a + x.c, 0), net: n(rs.reduce((a, x) => a + Number(x.net), 0)), vat: n(rs.reduce((a, x) => a + Number(x.vat), 0)), total: n(rs.reduce((a, x) => a + Number(x.total), 0)), cost: n(rs.reduce((a, x) => a + Number(x.cost), 0)) });
  const sales = tot(pick("SALE", "INVOICE")), salesReturns = tot(pick("SALE", "CREDIT_NOTE")), posSales = tot(pick("SALE", "INVOICE", true));
  const purchases = tot(pick("PURCHASE", "INVOICE")), purchaseReturns = tot(pick("PURCHASE", "CREDIT_NOTE"));
  const ex = await t.one(`SELECT COUNT(*)::int c, COALESCE(SUM(amount),0) net, COALESCE(SUM(vat_amount),0) vat, COALESCE(SUM(total),0) total FROM expenses WHERE company_id=$1 AND status='POSTED' AND date=$2`, [C, date]);
  const pay = await t.rows(`SELECT direction, COUNT(*)::int c, COALESCE(SUM(amount),0) total FROM payments WHERE company_id=$1 AND status='POSTED' AND date=$2 GROUP BY 1`, [C, date]);
  const pv = (d: string) => { const r = pay.find((x: any) => x.direction === d); return { count: r?.c || 0, total: n(r?.total) }; };
  const cash = (await t.rows(
    `SELECT a.id, a.code, a.name_ar,
        COALESCE(SUM(CASE WHEN e.date < $2 THEN l.debit-l.credit END),0) opening,
        COALESCE(SUM(CASE WHEN e.date = $2 THEN l.debit END),0) money_in,
        COALESCE(SUM(CASE WHEN e.date = $2 THEN l.credit END),0) money_out
       FROM accounts a LEFT JOIN journal_lines l ON l.account_id=a.id LEFT JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED' AND e.date <= $2
      WHERE a.company_id=$1 AND a.is_cash_bank AND NOT a.is_group AND a.is_active AND (l.id IS NULL OR e.id IS NOT NULL)
      GROUP BY a.id ORDER BY a.code`, [C, date])).map((a: any) => ({ id: a.id, code: a.code, name: a.nameAr, opening: n(a.opening), in: n(a.moneyIn), out: n(a.moneyOut), closing: n(Number(a.opening) + Number(a.moneyIn) - Number(a.moneyOut)) }))
    .filter((a: any) => a.opening || a.in || a.out);
  const topItems = (await t.rows(
    `SELECT l.description name, SUM(l.qty) qty, SUM(l.net_amount) net FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id
      WHERE i.company_id=$1 AND i.status='POSTED' AND i.date=$2 AND i.direction='SALE' AND i.kind='INVOICE' GROUP BY 1 ORDER BY 3 DESC LIMIT 5`, [C, date])).map((x: any) => ({ name: x.name, qty: n(x.qty), net: n(x.net) }));
  const netSales = n(sales.net - salesReturns.net), cost = n(sales.cost - salesReturns.cost);
  return {
    date, sales, posSales, salesReturns, purchases, purchaseReturns,
    expenses: { count: ex.c, net: n(ex.net), vat: n(ex.vat), total: n(ex.total) },
    receipts: pv("IN"), payments: pv("OUT"),
    netSales, grossProfit: n(netSales - cost), cash, cashTotal: { opening: n(cash.reduce((a: number, x: any) => a + x.opening, 0)), in: n(cash.reduce((a: number, x: any) => a + x.in, 0)), out: n(cash.reduce((a: number, x: any) => a + x.out, 0)), closing: n(cash.reduce((a: number, x: any) => a + x.closing, 0)) },
    topItems,
  };
}

/** What needs attention now. Each item: a plain sentence, how many / how much, and the screen that deals with it. */
export async function todoList(t: Db, C: string) {
  const d = today(), week = addDays(d, 7);
  const out: { key: string; text: string; count: number; amount?: number; to: string; level: "high" | "normal" }[] = [];
  const od = await t.one(`SELECT COUNT(*)::int c, COALESCE(SUM(total-amount_paid),0) s FROM invoices WHERE company_id=$1 AND status='POSTED' AND direction='SALE' AND kind IN ('INVOICE','DEBIT_NOTE') AND total-amount_paid > 0.005 AND COALESCE(due_date,date) < $2`, [C, d]);
  if (od.c) out.push({ key: "overdue", text: "فواتير عملاء تأخر سدادها — تابع التحصيل", count: od.c, amount: n(od.s), to: "/collections", level: "high" });
  const due = await t.one(`SELECT COUNT(*)::int c, COALESCE(SUM(total-amount_paid),0) s FROM invoices WHERE company_id=$1 AND status='POSTED' AND direction='PURCHASE' AND kind='INVOICE' AND total-amount_paid > 0.005 AND COALESCE(due_date,date) <= $2`, [C, week]);
  if (due.c) out.push({ key: "billsDue", text: "فواتير موردين مستحقة السداد خلال أسبوع أو متأخرة", count: due.c, amount: n(due.s), to: "/vouchers", level: "high" });
  const dr = await t.one(`SELECT COUNT(*)::int c FROM invoices WHERE company_id=$1 AND status='DRAFT' AND kind IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE')`, [C]);
  if (dr.c) out.push({ key: "drafts", text: "فواتير محفوظة مسودة لم تُرحَّل بعد", count: dr.c, to: "/sales/invoices", level: "normal" });
  const low = await t.one(`SELECT COUNT(*)::int c FROM products p WHERE p.company_id=$1 AND p.is_active AND p.type='STOCK' AND p.reorder_level > 0 AND COALESCE((SELECT SUM(b.qty) FROM stock_balances b WHERE b.product_id=p.id),0) <= p.reorder_level`, [C]);
  if (low.c) out.push({ key: "lowStock", text: "أصناف وصلت حد إعادة الطلب", count: low.c, to: "/reorder", level: "normal" });
  const ses = await t.one(`SELECT COUNT(*)::int c FROM pos_sessions WHERE company_id=$1 AND status='OPEN' AND opened_at < now() - interval '20 hours'`, [C]).catch(() => ({ c: 0 }));
  if (ses.c) out.push({ key: "posOpen", text: "وردية نقطة بيع مفتوحة منذ أمس — أغلقها وطابق الصندوق", count: ses.c, to: "/pos", level: "normal" });
  // manual amortisation schedules with a month that has ended (automatic ones post by themselves)
  const am = await t.rows(`SELECT months, posted_months, start_date FROM amortizations WHERE company_id=$1 AND status='ACTIVE' AND NOT auto`, [C]).catch(() => [] as any[]);
  const amDue = am.reduce((s: number, a: any) => { const st = String(a.startDate instanceof Date ? a.startDate.toISOString() : a.startDate).slice(0, 10); let k = 0; for (let i = a.postedMonths; i < a.months; i++) { if (monthEnd(addMonths(st.slice(0, 7) + "-01", i)) <= d) k++; else break; } return s + k; }, 0);
  if (amDue) out.push({ key: "amortization", text: "أشهر إطفاء مستحقة لم تُرحَّل (مدفوع مقدماً / إيرادات مؤجلة)", count: amDue, to: "/amortizations", level: "normal" });
  if (!IS_EG) {
    const ps = await t.rows(`SELECT * FROM partners WHERE company_id=$1 AND is_active AND code <> 'WALKIN'`, [C]);
    const bad1 = ps.filter((p: any) => { const c = checkPartner(p); return (p.isSupplier && !c.supplierReady) || (p.isCustomer && p.kind === "COMPANY" && !c.standardReady); }).length;
    if (bad1) out.push({ key: "partnerData", text: "عملاء أو موردون بياناتهم الضريبية ناقصة (الرقم الضريبي، العنوان الوطني، الجوال)", count: bad1, to: "/suppliers", level: "normal" });
  }
  const noCost = await t.one(`SELECT COUNT(*)::int c FROM products WHERE company_id=$1 AND is_active AND (COALESCE(sale_price,0) = 0)`, [C]);
  if (noCost.c) out.push({ key: "noPrice", text: "أصناف بلا سعر بيع", count: noCost.c, to: "/products", level: "normal" });
  return out;
}

export async function brief(t: Db, C: string) {
  const day = await dailyReport(t, C, today());
  return { ...day, todo: await todoList(t, C) };
}

/**
 * Everyday money movements a non-accountant records without knowing the entry: each kind maps to a fixed pair of accounts.
 * `money` is the cash or bank account the money entered or left.
 */
export const QUICK_KINDS: Record<string, { ar: string; dir: "IN" | "OUT"; key?: string; nameRe?: RegExp; why: string }> = {
  OWNER_DRAW: { ar: "سحب المالك مبلغاً لنفسه", dir: "OUT", key: "OWNER_CURRENT", nameRe: /جاري المالك/, why: "ما يأخذه المالك لنفسه ليس مصروفاً على المنشأة؛ يُسجَّل على حسابه الجاري." },
  OWNER_FUND: { ar: "المالك وضع مالاً في المنشأة (مؤقتاً)", dir: "IN", key: "OWNER_CURRENT", nameRe: /جاري المالك/, why: "ما يضعه المالك مؤقتاً يُسجَّل له في حسابه الجاري وليس إيراداً." },
  CAPITAL: { ar: "زيادة رأس المال", dir: "IN", key: "CAPITAL", nameRe: /رأس المال/, why: "رأس المال حق ملكية دائم وليس إيراداً." },
  LOAN_IN: { ar: "استلام قرض", dir: "IN", nameRe: /قروض/, why: "القرض التزام على المنشأة وليس إيراداً." },
  LOAN_PAY: { ar: "سداد قسط قرض (أصل القرض)", dir: "OUT", nameRe: /قروض/, why: "سداد أصل القرض يخفّض الالتزام وليس مصروفاً. الفوائد تُسجَّل مصروفاً منفصلاً." },
  BANK_FEES: { ar: "رسوم وعمولات بنكية", dir: "OUT", key: "BANK_FEES", nameRe: /عمولات|رسوم بنكية|مصاريف بنكية/, why: "الرسوم البنكية مصروف على المنشأة." },
  DIVIDENDS: { ar: "توزيع أرباح على الملاك", dir: "OUT", key: "RETAINED", nameRe: /المبقاة/, why: "توزيع الأرباح ليس مصروفاً؛ يُخصم من الأرباح المبقاة." },
  OTHER_INCOME: { ar: "إيراد آخر (غير المبيعات)", dir: "IN", key: "OTHER_INCOME", nameRe: /إيرادات أخرى/, why: "إيراد عرضي خارج النشاط الأساسي، بلا ضريبة. المبيعات تُسجَّل بفاتورة." },
};

export async function quickLines(t: Db, C: string, b: any) {
  const k = QUICK_KINDS[String(b.kind)];
  if (!k) throw bad("نوع العملية غير معروف");
  const amount = r2(Number(b.amount));
  if (!(amount > 0)) throw bad("أدخل المبلغ");
  const money = await t.maybe(`SELECT * FROM accounts WHERE id=$1 AND company_id=$2 AND is_cash_bank AND NOT is_group`, [b.accountId, C]);
  if (!money) throw bad(k.dir === "IN" ? "اختر الصندوق أو البنك الذي دخل فيه المبلغ" : "اختر الصندوق أو البنك الذي خرج منه المبلغ");
  const accs = await t.rows(`SELECT * FROM accounts WHERE company_id=$1 AND NOT is_group AND is_active`, [C]);
  const other = (k.key && accs.find((a: any) => a.systemKey === k.key)) || (k.nameRe && accs.find((a: any) => k.nameRe!.test(a.nameAr)));
  if (!other) throw bad(`لا يوجد في دليل الحسابات حساب مناسب لـ«${k.ar}» — أضفه من دليل الحسابات أو سجّل قيداً يدوياً`);
  const memo = `${k.ar}${b.note ? ` — ${String(b.note).trim().slice(0, 160)}` : ""}`;
  const dr = k.dir === "IN" ? money : other, cr = k.dir === "IN" ? other : money;
  return { date: isDate(b.date) ? b.date : today(), memo, lines: [{ accountId: dr.id, debit: amount, credit: 0, description: memo }, { accountId: cr.id, debit: 0, credit: amount, description: memo }] };
}
