import { Db } from "../db/pool";
import { VAT_F } from "../lib/country";
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
  /** the net amount shared between several cost centres / projects; what is not shared stays general (no centre) */
  allocations?: { costCenterId: string; amount: number }[];
  isDemo?: boolean;
  branchId?: string | null;
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
  // the cost centre / project is a tag on the expense line only (never on VAT or the payment side). One centre takes the
  // whole net amount; several take their shares, and any remainder is posted with no centre (a general expense).
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let shares = (Array.isArray(e.allocations) ? e.allocations : []).map((a) => ({ costCenterId: String(a?.costCenterId || ""), amount: r2(num(a?.amount)) })).filter((a) => a.amount !== 0 || a.costCenterId);
  if (!shares.length && e.costCenterId) shares = [{ costCenterId: String(e.costCenterId), amount: c.net }];
  if (shares.some((a) => !UUID.test(a.costCenterId))) throw bad("اختر مركز التكلفة أو المشروع لكل سطر في التوزيع");
  if (shares.some((a) => a.amount <= 0)) throw bad("مبلغ كل مركز في التوزيع يجب أن يكون أكبر من صفر");
  if (new Set(shares.map((a) => a.costCenterId)).size !== shares.length) throw bad("مركز تكلفة مكرر في التوزيع");
  if (shares.length) {
    const ok = await t.rows(`SELECT id, status FROM cost_centers WHERE company_id=$1 AND id = ANY($2::uuid[])`, [companyId, `{${shares.map((a) => a.costCenterId).join(",")}}`]);
    if (ok.length !== shares.length) throw bad("مركز تكلفة غير موجود");
    if (ok.some((x) => x.status === "DONE")) throw bad("لا يُحمَّل مصروف على مشروع أو مركز منتهٍ");
  }
  const shared = r2(shares.reduce((a, x) => a + x.amount, 0));
  if (shared > c.net + 0.005) throw bad(`مجموع التوزيع (${shared}) أكبر من صافي المصروف قبل الضريبة (${c.net})`);
  const rest = r2(c.net - shared);
  const lines: any[] = shares.map((a) => ({ account: acc.id, debit: a.amount, costCenterId: a.costCenterId, description: e.description }));
  if (rest > 0 || !lines.length) lines.push({ account: acc.id, debit: lines.length ? rest : c.net, costCenterId: null, description: e.description });
  if (c.vat) lines.push({ key: "VAT_IN", debit: c.vat, description: `ضريبة مدخلات ${number}` });
  if (taxCode === "RC") {
    const rc = r2(D(c.net).times(VAT_F));
    lines.push({ key: "VAT_IN", debit: rc, description: `احتساب عكسي ${number}` }, { key: "VAT_OUT", credit: rc, description: `احتساب عكسي ${number}` });
  }
  if (pay) lines.push({ account: pay.id, credit: c.total, description: memo });
  else lines.push({ key: "AP", credit: c.total, partnerId: e.partnerId, description: memo });
  const entry = await post(t, companyId, { date, type: "EXPENSE", sourceType: "EXPENSE", branchId: e.branchId, reference: e.supplierRef || number, memo: `مصروف ${number}: ${memo}`, isDemo: e.isDemo, createdBy: user, lines });
  const row = await t.insert("expenses", {
    companyId, number, date, accountId: acc.id, payee: e.payee || null, partnerId: e.partnerId || null, supplierVat: e.supplierVat || null,
    supplierRef: e.supplierRef || null, description: e.description, amount: c.net, taxCode, vatAmount: c.vat, total: c.total,
    payAccountId: pay?.id || null, costCenterId: shares.length === 1 && rest === 0 ? shares[0].costCenterId : null, allocations: shares.length > 1 || (shares.length === 1 && rest > 0) ? JSON.stringify(shares) : null, journalId: entry!.id, isDemo: !!e.isDemo, createdBy: user,
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
