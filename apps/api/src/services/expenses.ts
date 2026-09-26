import { Db } from "../db/pool";
import { bad, conflict, r2, D, num, isDate, today, calcLine, TAX_CODES } from "../lib/core";
import { post, nextNumber, reverse } from "../accounting/engine";

export interface ExpenseInput {
  date?: string;
  accountId: string;
  payee?: string | null;
  partnerId?: string | null;
  supplierVat?: string | null;
  supplierRef?: string | null;
  description: string;
  amount: number; // net (before VAT) unless amountIncludesVat
  amountIncludesVat?: boolean;
  taxCode?: string;
  payAccountId?: string | null; // cash/bank; null → on credit to supplier (AP)
  costCenterId?: string | null;
  isDemo?: boolean;
}

export async function createExpense(t: Db, companyId: string, user: string, e: ExpenseInput) {
  const date = e.date || today();
  if (!isDate(date)) throw bad("التاريخ غير صحيح");
  const acc = await t.one(`SELECT * FROM accounts WHERE id=$1 AND company_id=$2 AND NOT is_group AND type='EXPENSE'`, [e.accountId, companyId], "اختر حساب مصروف صحيح");
  const taxCode = e.taxCode || "S";
  if (!TAX_CODES[taxCode]) throw bad("رمز ضريبي غير صحيح");
  const c = calcLine(1, r2(num(e.amount)), 0, taxCode, !!e.amountIncludesVat);
  if (c.net <= 0) throw bad("المبلغ يجب أن يكون أكبر من صفر");
  let pay: any = null;
  if (e.payAccountId) pay = await t.one(`SELECT * FROM accounts WHERE id=$1 AND company_id=$2 AND is_cash_bank`, [e.payAccountId, companyId], "اختر حساب دفع صحيح");
  else if (!e.partnerId) throw bad("المصروف الآجل يحتاج تحديد المورد");
  const number = await nextNumber(t, companyId, "EXP", date);
  const memo = `${e.description} — ${e.payee || ""}`.trim();
  const lines: any[] = [{ account: acc.id, debit: c.net, costCenterId: e.costCenterId, description: e.description }];
  if (c.vat) lines.push({ key: "VAT_IN", debit: c.vat, description: `ضريبة مدخلات ${number}` });
  if (taxCode === "RC") {
    const rc = r2(D(c.net).times(0.15));
    lines.push({ key: "VAT_IN", debit: rc, description: `احتساب عكسي ${number}` }, { key: "VAT_OUT", credit: rc, description: `احتساب عكسي ${number}` });
  }
  if (pay) lines.push({ account: pay.id, credit: c.total, description: memo });
  else lines.push({ key: "AP", credit: c.total, partnerId: e.partnerId, description: memo });
  const entry = await post(t, companyId, { date, type: "EXPENSE", sourceType: "EXPENSE", reference: e.supplierRef || number, memo: `مصروف ${number}: ${memo}`, isDemo: e.isDemo, createdBy: user, lines });
  const row = await t.insert("expenses", {
    companyId, number, date, accountId: acc.id, payee: e.payee || null, partnerId: e.partnerId || null, supplierVat: e.supplierVat || null,
    supplierRef: e.supplierRef || null, description: e.description, amount: c.net, taxCode, vatAmount: c.vat, total: c.total,
    payAccountId: pay?.id || null, costCenterId: e.costCenterId || null, journalId: entry!.id, isDemo: !!e.isDemo, createdBy: user,
  });
  await t.exec(`UPDATE journal_entries SET source_id=$2 WHERE id=$1`, [entry!.id, row.id]);
  return row;
}

export async function cancelExpense(t: Db, companyId: string, user: string, id: string) {
  const e = await t.one(`SELECT * FROM expenses WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "المصروف غير موجود");
  if (e.status !== "POSTED") throw conflict("المصروف ملغى مسبقاً");
  const rev = await reverse(t, companyId, e.journalId, today(), `إلغاء المصروف ${e.number}`, user);
  await t.exec(`UPDATE expenses SET status='CANCELLED' WHERE id=$1`, [id]);
  return rev;
}
