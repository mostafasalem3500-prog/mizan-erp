/** Point of sale: sessions (shifts), sales, returns, session close with cash count. */
import { Db } from "../db/pool";
import { bad, conflict, r2, D, num, today } from "../lib/core";
import { post, nextNumber } from "../accounting/engine";
import { saveDraft, postInvoice, getInvoice, defaultWarehouse } from "./invoices";

export async function openSession(t: Db, companyId: string, user: { id: string; name: string }, openingCash: number, warehouseId?: string) {
  const open = await t.maybe(`SELECT id, number FROM pos_sessions WHERE company_id=$1 AND user_id=$2 AND status='OPEN'`, [companyId, user.id]);
  if (open) throw conflict(`لديك وردية مفتوحة بالفعل (${open.number}) — أغلقها أولاً`);
  const number = await nextNumber(t, companyId, "SH", today(), 4);
  return t.insert("pos_sessions", { companyId, number, userId: user.id, userName: user.name, warehouseId: warehouseId || (await defaultWarehouse(t, companyId)), openingCash: r2(num(openingCash)) });
}

export async function currentSession(t: Db, companyId: string, userId: string) {
  return t.maybe(`SELECT * FROM pos_sessions WHERE company_id=$1 AND user_id=$2 AND status='OPEN'`, [companyId, userId]);
}

export interface PosSaleInput {
  sessionId: string;
  partnerId?: string | null;
  lines: { productId: string; qty: number; unitPrice?: number; discountPct?: number }[];
  tenders: { method: "CASH" | "CARD" | "BANK" | "CREDIT"; amount: number | null }[]; // amount null → the remainder
  discountPct?: number; // whole-ticket discount
  notes?: string;
  isDemo?: boolean;
  date?: string;
}

async function walkInCustomer(t: Db, companyId: string) {
  let p = await t.maybe(`SELECT * FROM partners WHERE company_id=$1 AND code='WALKIN'`, [companyId]);
  if (!p) p = await t.insert("partners", { companyId, code: "WALKIN", name: "عميل نقدي", isCustomer: true, kind: "INDIVIDUAL" });
  return p;
}

export async function posSale(t: Db, company: any, user: { id: string; name: string }, s: PosSaleInput) {
  const companyId = company.id;
  const session = await t.one(`SELECT * FROM pos_sessions WHERE id=$1 AND company_id=$2 FOR UPDATE`, [s.sessionId, companyId], "الوردية غير موجودة");
  if (session.status !== "OPEN") throw conflict("الوردية مغلقة");
  const partner = s.partnerId ? await t.one(`SELECT * FROM partners WHERE id=$1 AND company_id=$2`, [s.partnerId, companyId], "العميل غير موجود") : await walkInCustomer(t, companyId);
  const ids = s.lines.map((l) => l.productId);
  const products = await t.rows(`SELECT * FROM products WHERE company_id=$1 AND id = ANY($2) AND is_active`, [companyId, ids]);
  const pm = new Map(products.map((p) => [p.id, p]));
  const ticketDisc = num(s.discountPct);
  const lines = s.lines.map((l) => {
    const p = pm.get(l.productId);
    if (!p) throw bad("صنف غير موجود أو موقوف");
    const unit = l.unitPrice !== undefined && l.unitPrice !== null ? num(l.unitPrice) : Number(p.salePrice);
    const disc = r2(100 - (100 - num(l.discountPct)) * (100 - ticketDisc) / 100);
    return { productId: p.id, qty: num(l.qty), unitPrice: unit, discountPct: disc, taxCode: p.taxCode };
  });
  const draft = await saveDraft(t, company, user.name, {
    direction: "SALE", kind: "INVOICE", channel: "POS", date: s.date || today(), partnerId: partner.id, warehouseId: session.warehouseId,
    invoiceType: partner.vatNumber ? "STANDARD" : "SIMPLIFIED", notes: s.notes || null, lines, isDemo: !!s.isDemo,
    pricesIncludeVat: !!company.pricesIncludeVat,
  });
  const inv = await t.one(`SELECT total FROM invoices WHERE id=$1`, [draft.id]);
  const total = Number(inv.total);
  const fixed = (s.tenders || []).filter((x) => x.amount !== null && x.amount !== undefined).reduce((a, x) => a + num(x.amount), 0);
  const tenders = (s.tenders || []).map((x) => ({ method: x.method, amount: x.amount === null || x.amount === undefined ? r2(total - fixed) : r2(num(x.amount)) })).filter((x) => x.amount > 0);
  const paid = r2(tenders.reduce((a, x) => a + x.amount, 0));
  const credit = tenders.find((x) => x.method === "CREDIT");
  let cashChange = 0;
  if (credit) {
    if (partner.code === "WALKIN") throw bad("البيع الآجل يتطلب اختيار عميل مسجل");
    // credit portion goes to AR: post other tenders + AR
  }
  if (paid < total - 0.001 && !credit) throw bad(`المبلغ المدفوع (${paid}) أقل من الإجمالي (${total})`);
  // overpayment in cash → change returned
  if (paid > total + 0.001) {
    const cash = tenders.find((x) => x.method === "CASH");
    if (!cash) throw bad("المبلغ المدفوع أكبر من الإجمالي");
    cashChange = r2(paid - total);
    cash.amount = r2(cash.amount - cashChange);
  }
  let postTenders: any[] | undefined = tenders.filter((x) => x.method !== "CREDIT");
  const creditAmount = credit ? r2(total - postTenders.reduce((a, x) => a + x.amount, 0)) : 0;
  let posted: any;
  if (credit) {
    // mixed: post invoice on AR then a receipt for the paid part
    posted = await postInvoice(t, company, draft.id, user.name, { posSessionId: session.id });
    if (postTenders.length) {
      const { createPayment } = require("./payments") as typeof import("./payments");
      const cashAcc = await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND system_key='POS_CASH'`, [companyId]);
      const cardAcc = await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND system_key='CARD_CLEARING'`, [companyId]);
      for (const x of postTenders) {
        await createPayment(t, companyId, user.name, { direction: "IN", partnerId: partner.id, date: posted.date, amount: x.amount, method: x.method, accountId: x.method === "CASH" ? cashAcc.id : cardAcc.id, reference: posted.number, allocations: [{ invoiceId: posted.id, amount: x.amount }], isDemo: !!s.isDemo });
      }
      await t.exec(`UPDATE invoices SET tenders=$2, pos_session_id=$3 WHERE id=$1`, [posted.id, JSON.stringify([...postTenders, { method: "CREDIT", amount: creditAmount }]), session.id]);
    }
  } else {
    posted = await postInvoice(t, company, draft.id, user.name, { tenders: postTenders, posSessionId: session.id });
  }
  const cashPart = r2(postTenders.filter((x) => x.method === "CASH").reduce((a, x) => a + x.amount, 0));
  const cardPart = r2(postTenders.filter((x) => x.method !== "CASH").reduce((a, x) => a + x.amount, 0));
  await t.exec(`UPDATE pos_sessions SET cash_sales=cash_sales+$2, card_sales=card_sales+$3, orders_count=orders_count+1 WHERE id=$1`, [session.id, cashPart, cardPart]);
  return { ...(await getInvoice(t, companyId, posted.id)), cashChange };
}

export async function posReturn(t: Db, company: any, user: { id: string; name: string }, sessionId: string, originId: string, lines: { productId: string; qty: number }[], reason: string, isDemo = false) {
  const companyId = company.id;
  const session = await t.one(`SELECT * FROM pos_sessions WHERE id=$1 AND company_id=$2 FOR UPDATE`, [sessionId, companyId], "الوردية غير موجودة");
  if (session.status !== "OPEN") throw conflict("الوردية مغلقة");
  const origin = await getInvoice(t, companyId, originId);
  if (origin.direction !== "SALE" || origin.kind !== "INVOICE" || origin.status !== "POSTED") throw bad("الفاتورة الأصلية غير صالحة للإرجاع");
  const retLines = lines.map((l) => {
    const ol = origin.lines.find((x: any) => x.productId === l.productId);
    if (!ol) throw bad("الصنف غير موجود في الفاتورة الأصلية");
    return { productId: l.productId, qty: num(l.qty), unitPrice: Number(ol.unitPrice), discountPct: Number(ol.discountPct), taxCode: ol.taxCode, description: ol.description };
  });
  const draft = await saveDraft(t, company, user.name, {
    direction: "SALE", kind: "CREDIT_NOTE", channel: "POS", date: today(), partnerId: origin.partnerId, warehouseId: session.warehouseId,
    invoiceType: origin.invoiceType, originId: origin.id, reason: reason || "إرجاع بضاعة", lines: retLines, isDemo, pricesIncludeVat: false,
  });
  const inv = await t.one(`SELECT total FROM invoices WHERE id=$1`, [draft.id]);
  const total = Number(inv.total);
  // refund the way the customer paid: card portion first, rest cash (if origin was credit, settle AR)
  const origTenders: any[] = origin.tenders || [];
  const wasCredit = origTenders.some((x) => x.method === "CREDIT") || !origTenders.length;
  let tenders: any[] | undefined;
  if (!wasCredit) {
    const cardPaid = r2(origTenders.filter((x) => x.method !== "CASH").reduce((a, x) => a + x.amount, 0));
    const card = Math.min(cardPaid, total);
    tenders = [];
    if (card > 0) tenders.push({ method: "CARD", amount: card });
    if (total - card > 0.001) tenders.push({ method: "CASH", amount: r2(total - card) });
  }
  const posted = await postInvoice(t, company, draft.id, user.name, { tenders, posSessionId: session.id });
  const cashPart = r2((tenders || []).filter((x) => x.method === "CASH").reduce((a, x) => a + x.amount, 0));
  await t.exec(`UPDATE pos_sessions SET returns_total=returns_total+$2, cash_sales=cash_sales-$3 WHERE id=$1`, [session.id, total, cashPart]);
  return posted;
}

/** Close: compare counted cash with expected; post cash over/short; move POS cash to main cash. */
export async function closeSession(t: Db, companyId: string, user: string, sessionId: string, countedCash: number, moveToMainCash = true) {
  const s = await t.one(`SELECT * FROM pos_sessions WHERE id=$1 AND company_id=$2 FOR UPDATE`, [sessionId, companyId], "الوردية غير موجودة");
  if (s.status !== "OPEN") throw conflict("الوردية مغلقة مسبقاً");
  const expected = r2(D(s.openingCash).plus(s.cashSales));
  const counted = r2(num(countedCash));
  const diff = r2(counted - expected);
  const lines: any[] = [];
  if (diff !== 0) {
    lines.push(diff > 0 ? { key: "POS_CASH", debit: diff, description: `زيادة صندوق الوردية ${s.number}` } : { key: "POS_CASH", credit: -diff, description: `عجز صندوق الوردية ${s.number}` });
    lines.push(diff > 0 ? { key: "CASH_DIFF", credit: diff, description: `زيادة صندوق ${s.number}` } : { key: "CASH_DIFF", debit: -diff, description: `عجز صندوق ${s.number}` });
  }
  if (moveToMainCash && s.cashSales > 0) {
    const move = r2(D(s.cashSales).plus(diff > 0 ? diff : 0)); // hand over the sales cash (keep float)
    if (move > 0) lines.push({ key: "CASH", debit: move, description: `توريد نقدية الوردية ${s.number}` }, { key: "POS_CASH", credit: move, description: `توريد نقدية الوردية ${s.number}` });
  }
  let journalId: string | null = null;
  if (lines.length) {
    const e = await post(t, companyId, { date: today(), type: "POS_CLOSE", sourceType: "POS_SESSION", sourceId: s.id, reference: s.number, memo: `إغلاق وردية ${s.number} — ${s.userName || ""}`, createdBy: user, isDemo: s.isDemo, lines });
    journalId = e?.id || null;
  }
  return t.update("pos_sessions", { id: s.id }, { status: "CLOSED", closedAt: new Date(), expectedCash: expected, countedCash: counted, difference: diff, journalId });
}
