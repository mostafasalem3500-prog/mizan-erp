/** Cheques register (received & issued) with full accounting lifecycle. */
import { Db } from "../db/pool";
import { bad, conflict, r2, num, isDate, today } from "../lib/core";
import { post, accountByKey } from "../accounting/engine";
import { createPayment, cancelPayment } from "./payments";

export interface ChequeInput {
  direction: "IN" | "OUT";
  chequeNo: string;
  bankName?: string;
  partnerId: string;
  amount: number;
  receivedDate?: string;
  dueDate: string;
  notes?: string;
  allocations?: { invoiceId: string; amount: number }[] | null;
  isDemo?: boolean;
}

/** Register a cheque: IN → Dr Notes receivable / Cr AR ; OUT → Dr AP / Cr Notes payable (via a payment voucher). */
export async function registerCheque(t: Db, companyId: string, user: string, c: ChequeInput) {
  if (!c.chequeNo?.trim()) throw bad("رقم الشيك مطلوب");
  if (!isDate(c.dueDate)) throw bad("تاريخ استحقاق الشيك غير صحيح");
  const received = c.receivedDate && isDate(c.receivedDate) ? c.receivedDate : today();
  const notes = await accountByKey(t, companyId, c.direction === "IN" ? "NOTES_REC" : "NOTES_PAY");
  const dup = await t.maybe(`SELECT id FROM cheques WHERE company_id=$1 AND direction=$2 AND cheque_no=$3 AND partner_id=$4 AND status<>'CANCELLED'`, [companyId, c.direction, c.chequeNo.trim(), c.partnerId]);
  if (dup) throw conflict("هذا الشيك مسجل مسبقاً لنفس الطرف");
  const pay = await createPayment(t, companyId, user, {
    direction: c.direction, partnerId: c.partnerId, date: received, amount: r2(num(c.amount)), method: "CHEQUE", accountId: notes.id,
    reference: `شيك ${c.chequeNo.trim()}${c.bankName ? " — " + c.bankName : ""}`, notes: c.notes || null, allocations: c.allocations, isDemo: c.isDemo,
  });
  return t.insert("cheques", { companyId, direction: c.direction, chequeNo: c.chequeNo.trim(), bankName: c.bankName || null, partnerId: c.partnerId, amount: pay.amount, receivedDate: received, dueDate: c.dueDate, paymentId: pay.id, notes: c.notes || null, isDemo: !!c.isDemo, createdBy: user });
}

/** IN: deposit & clear → Dr Bank / Cr Notes receivable.  OUT: cleared by bank → Dr Notes payable / Cr Bank. */
export async function clearCheque(t: Db, companyId: string, user: string, id: string, bankAccountId: string, date?: string) {
  const ch = await t.one(`SELECT * FROM cheques WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "الشيك غير موجود");
  if (!["PENDING", "DEPOSITED"].includes(ch.status)) throw conflict("حالة الشيك لا تسمح بالتحصيل/الصرف");
  const bank = await t.one(`SELECT * FROM accounts WHERE id=$1 AND company_id=$2 AND is_cash_bank AND NOT is_group`, [bankAccountId, companyId], "اختر حساب البنك");
  const d = date && isDate(date) ? date : today();
  const partner = await t.one(`SELECT name FROM partners WHERE id=$1`, [ch.partnerId]);
  const memo = ch.direction === "IN" ? `تحصيل شيك ${ch.chequeNo} — ${partner.name}` : `صرف شيك ${ch.chequeNo} — ${partner.name}`;
  const e = await post(t, companyId, {
    date: d, type: "CHEQUE", sourceType: "CHEQUE", sourceId: ch.id, reference: `شيك ${ch.chequeNo}`, memo, createdBy: user, isDemo: ch.isDemo,
    lines: ch.direction === "IN"
      ? [{ account: bank.id, debit: Number(ch.amount), description: memo }, { key: "NOTES_REC", credit: Number(ch.amount), description: memo }]
      : [{ key: "NOTES_PAY", debit: Number(ch.amount), description: memo }, { account: bank.id, credit: Number(ch.amount), description: memo }],
  });
  return t.update("cheques", { id }, { status: "CLEARED", bankAccountId: bank.id, clearJournalId: e!.id, updatedAt: new Date() });
}

export async function depositCheque(t: Db, companyId: string, id: string, bankAccountId: string) {
  const ch = await t.one(`SELECT * FROM cheques WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "الشيك غير موجود");
  if (ch.direction !== "IN" || ch.status !== "PENDING") throw conflict("الإيداع للشيكات المستلمة قيد الانتظار فقط");
  return t.update("cheques", { id }, { status: "DEPOSITED", bankAccountId, updatedAt: new Date() });
}

/** Bounced / cancelled before clearing: reverse the registration voucher (re-opens the invoices). */
export async function bounceCheque(t: Db, companyId: string, user: string, id: string, bounced = true) {
  const ch = await t.one(`SELECT * FROM cheques WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "الشيك غير موجود");
  if (!["PENDING", "DEPOSITED"].includes(ch.status)) throw conflict("لا يمكن إرجاع شيك محصّل — سجّل قيداً يدوياً أو شيكاً جديداً");
  if (ch.paymentId) await cancelPayment(t, companyId, user, ch.paymentId);
  return t.update("cheques", { id }, { status: bounced ? "BOUNCED" : "CANCELLED", updatedAt: new Date() });
}
