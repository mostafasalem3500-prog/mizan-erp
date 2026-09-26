/** Receipt / payment vouchers with allocation to open invoices (FIFO by default). */
import { Db } from "../db/pool";
import { bad, conflict, r2, D, num, isDate, today } from "../lib/core";
import { post, nextNumber, reverse } from "../accounting/engine";
import { applySettlement } from "./invoices";

export interface PaymentInput {
  direction: "IN" | "OUT";
  partnerId: string;
  date?: string;
  amount: number;
  method?: string;
  accountId: string;
  reference?: string | null;
  notes?: string | null;
  allocations?: { invoiceId: string; amount: number }[] | null; // null/undefined → FIFO
  isDemo?: boolean;
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

  // open documents: invoices (+) and credit notes (−) not yet settled
  const open = await t.rows(
    `SELECT id, number, kind, total, amount_paid, date FROM invoices
     WHERE company_id=$1 AND partner_id=$2 AND direction=$3 AND status='POSTED' AND kind IN ('INVOICE','DEBIT_NOTE')
       AND total - amount_paid > 0.001 ORDER BY date, created_at`,
    [companyId, partner.id, dir],
  );
  let allocations: { invoiceId: string; amount: number }[] = [];
  if (p.allocations && p.allocations.length) {
    for (const a of p.allocations) {
      const inv = open.find((o) => o.id === a.invoiceId);
      if (!inv) throw bad("أحد المستندات المخصصة غير مفتوح أو لا يخص هذا الطرف");
      const amt = r2(num(a.amount));
      if (amt <= 0) continue;
      if (amt > r2(D(inv.total).minus(inv.amountPaid)) + 0.001) throw bad(`المبلغ المخصص للمستند ${inv.number} يتجاوز المتبقي عليه`);
      allocations.push({ invoiceId: inv.id, amount: amt });
    }
  } else if (p.allocations === undefined) {
    let rest = amount;
    for (const inv of open) {
      if (rest <= 0) break;
      const due = r2(D(inv.total).minus(inv.amountPaid));
      const amt = Math.min(due, rest);
      allocations.push({ invoiceId: inv.id, amount: amt });
      rest = r2(D(rest).minus(amt));
    }
  }
  const allocated = allocations.reduce((a, x) => r2(D(a).plus(x.amount)), 0);
  if (allocated > amount + 0.001) throw bad("مجموع التخصيصات يتجاوز مبلغ السند");

  const number = await nextNumber(t, companyId, p.direction === "IN" ? "RV" : "PV", date);
  const memo = p.direction === "IN" ? `سند قبض ${number} — ${partner.name}` : `سند صرف ${number} — ${partner.name}`;
  const entry = await post(t, companyId, {
    date,
    type: p.direction === "IN" ? "RECEIPT" : "PAYMENT",
    sourceType: "PAYMENT",
    reference: p.reference || number,
    memo,
    isDemo: p.isDemo,
    createdBy: user,
    lines:
      p.direction === "IN"
        ? [
            { account: account.id, debit: amount, description: memo },
            { key: "AR", credit: amount, partnerId: partner.id, description: memo },
          ]
        : [
            { key: "AP", debit: amount, partnerId: partner.id, description: memo },
            { account: account.id, credit: amount, description: memo },
          ],
  });
  const pay = await t.insert("payments", {
    companyId, number, direction: p.direction, partnerRole: role, partnerId: partner.id, date, amount, allocated,
    method: p.method || (account.subtype === "CASH" ? "CASH" : "BANK"), accountId: account.id, reference: p.reference || null,
    notes: p.notes || null, allocations, journalId: entry!.id, isDemo: !!p.isDemo, createdBy: user,
  });
  await t.exec(`UPDATE journal_entries SET source_id=$2 WHERE id=$1`, [entry!.id, pay.id]);
  for (const a of allocations) await applySettlement(t, a.invoiceId, a.amount);
  return pay;
}

export async function cancelPayment(t: Db, companyId: string, user: string, id: string, date?: string) {
  const pay = await t.one(`SELECT * FROM payments WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "السند غير موجود");
  if (pay.status !== "POSTED") throw conflict("السند ملغى مسبقاً");
  for (const a of pay.allocations || []) await applySettlement(t, a.invoiceId, -a.amount);
  const rev = await reverse(t, companyId, pay.journalId, date || today(), `إلغاء السند ${pay.number}`, user);
  await t.exec(`UPDATE payments SET status='CANCELLED', allocated=0, allocations='[]' WHERE id=$1`, [id]);
  return rev;
}
