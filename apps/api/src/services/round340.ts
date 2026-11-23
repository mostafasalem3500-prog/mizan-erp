/**
 * 3.40.0 —
 *   • Taking back a posted sales return. A posted credit note is never deleted (it is a tax document, reported to the
 *     authority): it is reversed by a debit note against the same invoice, for the same lines. The goods leave stock again
 *     at today's average cost, the returns account is credited back, output VAT is restored, and the customer either owes
 *     the amount again or pays it at once.
 *   • Staff numbers, shown on the printed document.
 */
import { Db } from "../db/pool";
import { bad, conflict, today } from "../lib/core";
import { saveDraft, postInvoice, getInvoice } from "./invoices";

export async function reverseReturn(t: Db, company: any, user: string, id: string, b: any) {
  const companyId = company.id;
  const cn = await getInvoice(t, companyId, id);
  await t.one(`SELECT id FROM invoices WHERE id=$1 FOR UPDATE`, [id]);
  if (cn.direction !== "SALE" || cn.kind !== "CREDIT_NOTE") throw bad("هذا الإجراء لمرتجعات المبيعات (الإشعار الدائن) فقط");
  if (cn.status !== "POSTED") throw conflict("المرتجع غير مرحّل — احذف المسودة مباشرة");
  if (cn.reversedBy) throw conflict("هذا المرتجع أُلغي من قبل بإشعار مدين");
  if (!cn.originId) throw bad("المرتجع غير مرتبط بفاتورة أصلية");
  const reason = String(b?.reason || "").trim();
  if (reason.length < 3) throw bad("اكتب سبب إلغاء المرتجع");
  const partner = await t.one(`SELECT code FROM partners WHERE id=$1`, [cn.partnerId]);
  const refunded = Array.isArray(cn.tenders) && cn.tenders.length > 0; // the money went back to the customer at the till
  let collect = String(b?.collect || (refunded ? "SAME" : "AR")).toUpperCase();
  if (!["AR", "SAME", "CASH", "CARD"].includes(collect)) collect = "AR";
  if (collect === "AR" && partner.code === "WALKIN") throw bad("العميل النقدي بلا حساب — اختر استلام المبلغ نقداً أو بالشبكة");
  if (collect === "SAME" && !refunded) collect = "AR";
  const draft = await saveDraft(t, company, user, {
    direction: "SALE", kind: "DEBIT_NOTE", channel: cn.channel, date: today(), partnerId: cn.partnerId, warehouseId: cn.warehouseId, branchId: cn.branchId,
    invoiceType: cn.invoiceType, originId: cn.originId, reason: `إلغاء المرتجع ${cn.number}: ${reason}`.slice(0, 300), pricesIncludeVat: false,
    lines: cn.lines.map((l: any) => ({ productId: l.productId, accountId: l.productId ? undefined : l.accountId, description: l.description, qty: Number(l.qty), unitPrice: Number(l.unitPrice), discountPct: Number(l.discountPct), taxCode: l.taxCode, uomId: l.uomId || null, modifiers: l.modifiers || null })),
  } as any);
  const total = Number((await t.one(`SELECT total FROM invoices WHERE id=$1`, [draft.id])).total);
  if (Math.abs(total - Number(cn.total)) > 0.05) throw conflict(`إجمالي الإشعار المدين (${total}) لا يطابق المرتجع (${cn.total}) — راجع الأسعار`);
  let tenders: any[] | undefined;
  if (collect !== "AR") {
    const cash = await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND system_key='CASH'`, [companyId]);
    const card = await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND system_key='CARD_CLEARING'`, [companyId]);
    if (collect === "SAME") {
      const cardPart = Math.min(total, (cn.tenders as any[]).filter((x) => x.method !== "CASH").reduce((a, x) => a + Number(x.amount), 0));
      tenders = [];
      if (cardPart > 0.001) tenders.push({ method: "CARD", amount: Math.round(cardPart * 100) / 100, accountId: card.id });
      if (total - cardPart > 0.001) tenders.push({ method: "CASH", amount: Math.round((total - cardPart) * 100) / 100, accountId: cash.id });
    } else tenders = [{ method: collect, amount: total, accountId: collect === "CASH" ? cash.id : card.id }];
  }
  const dn = await postInvoice(t, company, draft.id, user, { tenders, reversesReturn: true });
  await t.exec(`UPDATE invoices SET reversed_by=$2, updated_at=now() WHERE id=$1`, [id, dn.id]);
  return { ...dn, reversedReturn: cn.number, collect };
}

export async function setStaffNo(t: Db, companyId: string, membershipId: string, staffNo: any) {
  const v = String(staffNo ?? "").trim().slice(0, 20) || null;
  if (v && !/^[\w\-\/؀-ۿ]+$/.test(v)) throw bad("رقم الموظف حروف وأرقام فقط");
  if (v && (await t.maybe(`SELECT 1 FROM memberships WHERE company_id=$1 AND staff_no=$2 AND id<>$3`, [companyId, v, membershipId]))) throw conflict(`رقم الموظف ${v} مستخدم لمستخدم آخر`);
  await t.one(`SELECT id FROM memberships WHERE id=$1 AND company_id=$2`, [membershipId, companyId], "المستخدم غير موجود");
  await t.exec(`UPDATE memberships SET staff_no=$2 WHERE id=$1`, [membershipId, v]);
  return { ok: true, staffNo: v };
}
