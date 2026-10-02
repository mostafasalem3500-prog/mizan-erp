/** Receipt / payment vouchers with allocation to open invoices (FIFO by default). */
import { Db } from "../db/pool";
import { bad, conflict, r2, r6, D, num, isDate, today } from "../lib/core";
import { post, nextNumber, reverse, Line } from "../accounting/engine";
import { applySettlement } from "./invoices";
import { BASE, toBase, toFc } from "./currency";
import { currentCtx } from "../lib/context";

export interface PaymentInput {
  direction: "IN" | "OUT";
  partnerId: string;
  date?: string;
  amount: number;
  method?: string;
  accountId: string;
  reference?: string | null;
  notes?: string | null;
  allocations?: { invoiceId: string; amount: number }[] | null; // null/undefined → FIFO. For foreign-currency invoices `amount` is in the invoice currency.
  isDemo?: boolean;
  currency?: string; // payment currency (default SAR). When foreign: fcAmount = foreign amount, amount = SAR actually paid/received
  fcAmount?: number;
  branchId?: string | null;
}

/** When every settled document belongs to one branch, the voucher follows it (collections stay on the selling branch's books). */
async function allocationBranch(t: Db, invoiceIds: string[]): Promise<string | null> {
  if (!invoiceIds.length) return null;
  const r = await t.rows(`SELECT DISTINCT branch_id FROM invoices WHERE id = ANY($1) AND branch_id IS NOT NULL`, [invoiceIds]);
  return r.length === 1 ? r[0].branchId : null;
}

export async function createPayment(t: Db, companyId: string, user: string, p: PaymentInput) {
  const date = p.date || today();
  if (!isDate(date)) throw bad("التاريخ غير صحيح");
  const amount = r2(num(p.amount));
  if (amount <= 0) throw bad("المبلغ يجب أن يكون أكبر من صفر");
  const partner = await t.one(`SELECT * FROM partners WHERE id=$1 AND company_id=$2`, [p.partnerId, companyId], "الطرف غير موجود");
  const account = await t.one(`SELECT * FROM accounts WHERE id=$1 AND company_id=$2 AND (is_cash_bank OR system_key IN ('NOTES_REC','NOTES_PAY')) AND NOT is_group`, [p.accountId, companyId], "اختر حساب صندوق أو بنك صحيح");
  const role = p.direction === "IN" ? "CUSTOMER" : "SUPPLIER";
  const dir = p.direction === "IN" ? "SALE" : "PURCHASE";

  const currency = String(p.currency || BASE).toUpperCase();
  let fcAmount = 0, rate = 1;
  if (currency !== BASE) {
    fcAmount = r2(num(p.fcAmount));
    if (fcAmount <= 0) throw bad("أدخل المبلغ بالعملة الأجنبية");
    rate = r6(D(amount).div(fcAmount)); // effective rate of this payment (SAR per unit)
  }

  // open documents: invoices (+) and credit notes (−) not yet settled
  const open = await t.rows(
    `SELECT id, number, kind, total, amount_paid, date, currency, exchange_rate, fc_total, fc_paid FROM invoices
     WHERE company_id=$1 AND partner_id=$2 AND direction=$3 AND status='POSTED' AND kind IN ('INVOICE','DEBIT_NOTE')
       AND total - amount_paid > 0.001 ORDER BY date, created_at`,
    [companyId, partner.id, dir],
  );
  // allocation = { invoiceId, amount: SAR book value settled, fcAmount: invoice-currency amount (FC invoices), paidSar: SAR of this payment used }
  type Alloc = { invoiceId: string; amount: number; fcAmount: number | null; paidSar: number };
  const allocations: Alloc[] = [];
  const settleFc = (inv: any, fc: number): Alloc => {
    const dueFc = r2(D(inv.fcTotal).minus(inv.fcPaid));
    if (fc > dueFc + 0.005) throw bad(`المبلغ المخصص للمستند ${inv.number} يتجاوز المتبقي عليه (${dueFc} ${inv.currency})`);
    const full = fc >= dueFc - 0.005;
    const book = full ? r2(D(inv.total).minus(inv.amountPaid)) : toBase(fc, Number(inv.exchangeRate));
    const paidSar = currency === inv.currency ? r2(D(fc).times(rate)) : book; // SAR payment settles at book value (no FX difference)
    return { invoiceId: inv.id, amount: book, fcAmount: full ? dueFc : fc, paidSar };
  };
  if (p.allocations && p.allocations.length) {
    for (const a of p.allocations) {
      const inv = open.find((o) => o.id === a.invoiceId);
      if (!inv) throw bad("أحد المستندات المخصصة غير مفتوح أو لا يخص هذا الطرف");
      const amt = r2(num(a.amount));
      if (amt <= 0) continue;
      if (inv.currency !== BASE) { if (currency !== BASE && currency !== inv.currency) throw bad(`المستند ${inv.number} بعملة ${inv.currency} — استخدم نفس العملة أو الريال`); allocations.push(settleFc(inv, amt)); continue; }
      if (currency !== BASE) throw bad(`المستند ${inv.number} بالريال — سدده بسند بالريال`);
      if (amt > r2(D(inv.total).minus(inv.amountPaid)) + 0.001) throw bad(`المبلغ المخصص للمستند ${inv.number} يتجاوز المتبقي عليه`);
      allocations.push({ invoiceId: inv.id, amount: amt, fcAmount: null, paidSar: amt });
    }
  } else if (p.allocations === undefined) {
    if (currency === BASE) {
      let rest = amount;
      for (const inv of open) {
        if (rest <= 0) break;
        const due = r2(D(inv.total).minus(inv.amountPaid));
        const amt = Math.min(due, rest);
        allocations.push(inv.currency !== BASE ? settleFc(inv, amt >= due - 0.001 ? r2(D(inv.fcTotal).minus(inv.fcPaid)) : toFc(amt, Number(inv.exchangeRate))) : { invoiceId: inv.id, amount: amt, fcAmount: null, paidSar: amt });
        rest = r2(D(rest).minus(amt));
      }
    } else {
      let rest = fcAmount;
      for (const inv of open.filter((o) => o.currency === currency)) {
        if (rest <= 0) break;
        const dueFc = r2(D(inv.fcTotal).minus(inv.fcPaid));
        const fc = Math.min(dueFc, rest);
        allocations.push(settleFc(inv, fc));
        rest = r2(D(rest).minus(fc));
      }
    }
  }
  const book = allocations.reduce((a, x) => r2(D(a).plus(x.amount)), 0);
  const paidAlloc = allocations.reduce((a, x) => r2(D(a).plus(x.paidSar)), 0);
  const unalloc = r2(D(amount).minus(paidAlloc));
  if (unalloc < -0.001) throw bad("مجموع التخصيصات يتجاوز مبلغ السند");
  const fxDiff = r2(D(paidAlloc).minus(book)); // + : more SAR moved than the book value of what was settled

  const number = await nextNumber(t, companyId, p.direction === "IN" ? "RV" : "PV", date);
  const fcNote = currency !== BASE ? ` (${fcAmount} ${currency} @ ${rate})` : "";
  const memo = (p.direction === "IN" ? `سند قبض ${number} — ${partner.name}` : `سند صرف ${number} — ${partner.name}`) + fcNote;
  const partnerLine = r2(D(book).plus(unalloc));
  const lines: Line[] = p.direction === "IN"
    ? [{ account: account.id, debit: amount, description: memo }, { key: "AR", credit: partnerLine, partnerId: partner.id, description: memo }]
    : [{ key: "AP", debit: partnerLine, partnerId: partner.id, description: memo }, { account: account.id, credit: amount, description: memo }];
  if (fxDiff !== 0) {
    const gain = p.direction === "IN" ? fxDiff > 0 : fxDiff < 0;
    lines.push(gain ? { key: "FX_GAIN", credit: Math.abs(fxDiff), description: `فرق سعر صرف ${number}` } : { key: "FX_LOSS", debit: Math.abs(fxDiff), description: `فرق سعر صرف ${number}` });
  }
  const entry = await post(t, companyId, { date, type: p.direction === "IN" ? "RECEIPT" : "PAYMENT", sourceType: "PAYMENT", branchId: p.branchId || (currentCtx().bodyBranchId ? null : await allocationBranch(t, allocations.map((a) => a.invoiceId))), reference: p.reference || number, memo, isDemo: p.isDemo, createdBy: user, lines });
  const pay = await t.insert("payments", {
    companyId, number, direction: p.direction, partnerRole: role, partnerId: partner.id, date, amount, allocated: r2(D(amount).minus(unalloc)),
    method: p.method || (account.subtype === "CASH" ? "CASH" : "BANK"), accountId: account.id, reference: p.reference || null,
    notes: p.notes || null, allocations, journalId: entry!.id, isDemo: !!p.isDemo, createdBy: user,
    currency, exchangeRate: rate, fcAmount: currency !== BASE ? fcAmount : null, fxDiff,
  });
  await t.exec(`UPDATE journal_entries SET source_id=$2 WHERE id=$1`, [entry!.id, pay.id]);
  for (const a of allocations) await applySettlement(t, a.invoiceId, a.amount, a.fcAmount ?? undefined);
  return pay;
}

export async function cancelPayment(t: Db, companyId: string, user: string, id: string, date?: string) {
  const pay = await t.one(`SELECT * FROM payments WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "السند غير موجود");
  if (pay.status !== "POSTED") throw conflict("السند ملغى مسبقاً");
  for (const a of pay.allocations || []) await applySettlement(t, a.invoiceId, -a.amount, a.fcAmount ? -a.fcAmount : undefined);
  const rev = await reverse(t, companyId, pay.journalId, date || today(), `إلغاء السند ${pay.number}`, user);
  await t.exec(`UPDATE payments SET status='CANCELLED', allocated=0, allocations='[]' WHERE id=$1`, [id]);
  return rev;
}
