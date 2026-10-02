/**
 * E-store payouts (Salla / Zid): the platform collects prepaid orders, keeps its commission and
 * transfers the rest. One voucher clears the e-store clearing account:
 *     Dr Bank (net received) · Dr Platform fees 5304 · Dr Input VAT (VAT on the fees)  /  Cr E-store clearing (gross)
 */
import { Db } from "../db/pool";
import { bad, conflict, r2, D, num, isDate, today } from "../lib/core";
import { post, nextNumber, reverse } from "../accounting/engine";
import { PLATFORMS } from "./salla";

export interface PayoutInput {
  platform: string;
  date?: string;
  net: number; // amount that reached the bank
  fees?: number; // platform commission / payment fees, excluding VAT
  feeVat?: number; // VAT charged on the fees (default 15% of fees)
  bankAccountId: string;
  reference?: string | null;
  notes?: string | null;
  isDemo?: boolean;
}

export async function createPayout(t: Db, companyId: string, user: string, p: PayoutInput) {
  const pf = PLATFORMS[p.platform];
  if (!pf) throw bad("المنصة غير مدعومة");
  const date = p.date || today();
  if (!isDate(date)) throw bad("التاريخ غير صحيح");
  const net = r2(num(p.net));
  const fees = r2(num(p.fees));
  const feeVat = p.feeVat === undefined || p.feeVat === null || (p.feeVat as any) === "" ? r2(D(fees).times(0.15)) : r2(num(p.feeVat));
  if (net <= 0) throw bad("أدخل المبلغ المحوَّل إلى البنك");
  if (fees < 0 || feeVat < 0) throw bad("العمولة والضريبة لا تكون سالبة");
  const gross = r2(D(net).plus(fees).plus(feeVat));
  const bank = await t.one(`SELECT * FROM accounts WHERE id=$1 AND company_id=$2 AND is_cash_bank AND NOT is_group`, [p.bankAccountId, companyId], "اختر حساب البنك المستلم");
  const conn = await t.maybe(`SELECT deposit_account_id FROM salla_connections WHERE company_id=$1 AND platform=$2`, [companyId, p.platform]);
  const clearing = conn?.depositAccountId
    ? await t.one(`SELECT * FROM accounts WHERE id=$1`, [conn.depositAccountId])
    : await t.one(`SELECT * FROM accounts WHERE company_id=$1 AND system_key='ESTORE_CLEARING'`, [companyId], "حساب تسوية المتجر غير معرف");
  if (clearing.id === bank.id) throw bad("حساب البنك يجب أن يختلف عن حساب تسوية المتجر");
  const number = await nextNumber(t, companyId, "STL", date);
  const memo = `تحويل مستحقات ${pf.ar} ${number}${p.reference ? ` — ${p.reference}` : ""}`;
  const lines: any[] = [{ account: bank.id, debit: net, description: memo }];
  if (fees) lines.push({ key: "ESTORE_FEES", debit: fees, description: `عمولة ورسوم ${pf.ar} ${number}` });
  if (feeVat) lines.push({ key: "VAT_IN", debit: feeVat, description: `ضريبة مدخلات على عمولة ${pf.ar} ${number}` });
  lines.push({ account: clearing.id, credit: gross, description: memo });
  const e = await post(t, companyId, { date, type: "RECEIPT", sourceType: "ESTORE_PAYOUT", reference: p.reference || number, memo, createdBy: user, isDemo: !!p.isDemo, lines });
  const row = await t.insert("estore_payouts", {
    companyId, platform: p.platform, number, date, reference: p.reference || null, gross, fees, feeVat, net,
    bankAccountId: bank.id, clearingAccountId: clearing.id, journalId: e!.id, notes: p.notes || null, isDemo: !!p.isDemo, createdBy: user,
  });
  await t.exec(`UPDATE journal_entries SET source_id=$2 WHERE id=$1`, [e!.id, row.id]);
  return row;
}

export async function cancelPayout(t: Db, companyId: string, user: string, id: string) {
  const p = await t.one(`SELECT * FROM estore_payouts WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "التحويل غير موجود");
  if (p.status !== "POSTED") throw conflict("التحويل ملغى مسبقاً");
  if (p.journalId) await reverse(t, companyId, p.journalId, today(), `إلغاء تحويل ${p.number}`, user);
  return t.update("estore_payouts", { id }, { status: "CANCELLED" });
}
