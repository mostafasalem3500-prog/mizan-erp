/**
 * Round 17 — charity: financial custody (العهد), purchase requests & receiving reports, refund requests.
 *   • صرف العهدة   : Dr 110390 العهد المالية المؤقتة   Cr الصندوق/البنك   (سند صرف مرتبط)
 *   • تسوية العهدة : Dr المصروفات المؤيدة + Dr الصندوق (المعاد)   Cr العهدة   [+ Cr البنك للمبلغ المستكمل لصاحب العهدة]
 *   • الاسترداد    : سند صرف من حساب الإيراد/الحساب المختار إلى الصندوق/البنك
 */
import { Db } from "../db/pool";
import { bad, r2, num, isDate, today } from "../lib/core";
import { post, reverse, nextNumber } from "../accounting/engine";
import { ensureCharity, acct, project, createDisbursement } from "./charity";

const date = (v: any) => (isDate(v) ? v : today());
const pick = <T extends string>(v: any, list: T[], def: T): T => (list.includes(v) ? v : def);
const KIND_OF = (m: string) => (m === "CASH" ? "CASH" : m === "CHEQUE" ? "CHEQUE" : "TRANSFER");

// ─── custody ───────────────────────────────────────────────────────────────
export async function listCustody(t: Db, companyId: string, q: any) {
  const params: any[] = [companyId];
  const w = ["c.company_id=$1"];
  if (q.status) { params.push(q.status); w.push(`c.status=$${params.length}`); }
  if (isDate(q.from)) { params.push(q.from); w.push(`c.date >= $${params.length}`); }
  if (isDate(q.to)) { params.push(q.to); w.push(`c.date <= $${params.length}`); }
  return t.rows(
    `SELECT c.*, pr.name project_name, pa.name_ar pay_account_name, d.number disbursement_number, d.id disbursement_id,
       (c.status='DISBURSED' AND c.settle_due IS NOT NULL AND c.settle_due < CURRENT_DATE) overdue,
       sj.number settle_journal_number
     FROM charity_custody c LEFT JOIN charity_projects pr ON pr.id=c.project_id LEFT JOIN accounts pa ON pa.id=c.pay_account_id
     LEFT JOIN charity_disbursements d ON d.source_type='CUSTODY' AND d.source_id=c.id AND d.status='POSTED'
     LEFT JOIN journal_entries sj ON sj.id=c.settle_journal_id
     WHERE ${w.join(" AND ")} ORDER BY c.date DESC, c.number DESC LIMIT 5000`, params);
}

export async function saveCustody(t: Db, companyId: string, user: string, b: any, id?: string) {
  await ensureCharity(t, companyId);
  const amount = r2(num(b.amount));
  if (!(amount > 0)) throw bad("مبلغ العهدة يجب أن يكون أكبر من صفر");
  const holder = String(b.holderName || "").trim();
  if (!holder) throw bad("اسم مقدم الطلب / صاحب العهدة مطلوب");
  const purpose = String(b.purpose || "").trim();
  if (!purpose) throw bad("الغرض من العهدة مطلوب");
  const pr = await project(t, companyId, b.projectId);
  const data: any = {
    holderName: holder, partnerId: b.partnerId || null, idNo: b.idNo || null, phone: b.phone || null, department: b.department || null, jobTitle: b.jobTitle || null,
    projectId: pr?.id || null, purpose, funding: b.funding || null, amount, neededDate: isDate(b.neededDate) ? b.neededDate : null, settleDue: isDate(b.settleDue) ? b.settleDue : null,
    method: pick(b.method, ["TRANSFER", "CHEQUE", "CASH"], "TRANSFER"), justification: b.justification || null,
  };
  if (id) {
    const c = await t.one(`SELECT status FROM charity_custody WHERE id=$1 AND company_id=$2`, [id, companyId], "العهدة غير موجودة");
    if (!["REQUESTED", "REJECTED", "REVIEWED"].includes(c.status)) throw bad("لا يمكن تعديل عهدة معتمدة أو مصروفة");
    return t.update("charity_custody", { id, companyId }, { ...data, status: "REQUESTED" });
  }
  const d = date(b.date);
  const number = await nextNumber(t, companyId, "CST", d);
  return t.insert("charity_custody", { companyId, number, date: d, ...data, status: "REQUESTED", isDemo: !!b.isDemo, createdBy: user });
}

export async function actCustody(t: Db, companyId: string, user: string, id: string, action: string, b: any) {
  const c = await t.one(`SELECT * FROM charity_custody WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "العهدة غير موجودة");
  const set = (o: any) => t.update("charity_custody", { id, companyId }, o);
  switch (action) {
    case "review":
      if (!["REQUESTED", "REVIEWED"].includes(c.status)) throw bad("العهدة ليست بانتظار المراجعة");
      return set({ status: "REVIEWED", reviewNote: b.note ?? c.reviewNote });
    case "approve": {
      if (!["REQUESTED", "REVIEWED"].includes(c.status)) throw bad("لا يمكن اعتماد العهدة في حالتها الحالية");
      const amt = b.approvedAmount !== undefined && b.approvedAmount !== "" ? r2(num(b.approvedAmount)) : r2(c.amount);
      if (!(amt > 0)) throw bad("المبلغ المعتمد غير صحيح");
      return set({ status: "APPROVED", approvedAmount: amt, approvedBy: user, approvedAt: new Date(), reviewNote: b.note ?? c.reviewNote });
    }
    case "reject":
      if (!["REQUESTED", "REVIEWED", "APPROVED"].includes(c.status)) throw bad("لا يمكن رفض العهدة بعد صرفها");
      return set({ status: "REJECTED", reviewNote: b.note || "مرفوض", approvedBy: user, approvedAt: new Date() });
    case "delete":
      if (!["REQUESTED", "REJECTED", "REVIEWED"].includes(c.status)) throw bad("لا يمكن حذف عهدة معتمدة أو مصروفة");
      await t.exec(`DELETE FROM charity_custody WHERE id=$1`, [id]);
      return { ok: true };
    default:
      throw bad("إجراء غير معروف");
  }
}

export async function disburseCustody(t: Db, companyId: string, user: string, id: string, b: any) {
  await ensureCharity(t, companyId);
  const c = await t.one(`SELECT * FROM charity_custody WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "العهدة غير موجودة");
  if (c.status !== "APPROVED") throw bad("يجب اعتماد العهدة قبل صرفها");
  const custodyAcc = await acct(t, companyId, null, "CH_CUSTODY", "حساب العهد");
  const amount = r2(c.approvedAmount ?? c.amount);
  const kind = KIND_OF(b.method || c.method);
  const d = date(b.date);
  const dsb = await createDisbursement(t, companyId, user, {
    date: d, kind, partnerId: c.partnerId, beneficiaryName: c.holderName, beneficiaryIdNo: c.idNo, beneficiaryPhone: c.phone, capacity: "EMPLOYEE", department: c.department,
    amount, reason: `صرف عهدة مالية ${c.number} — ${c.purpose}`, projectId: c.projectId, expenseAccountId: custodyAcc.id, payAccountId: b.payAccountId,
    refNo: b.refNo || (kind === "CASH" ? null : c.number), iban: b.iban, bankName: b.bankName, accountHolder: c.holderName, docs: ["طلب عهدة معتمد"], sourceType: "CUSTODY", sourceId: c.id, isDemo: c.isDemo,
  });
  await t.update("charity_custody", { id, companyId }, { status: "DISBURSED", disbursedAmount: amount, disbursedDate: d, payAccountId: dsb.payAccountId, refNo: dsb.refNo, disburseJournalId: dsb.journalId });
  return { ...c, status: "DISBURSED", disbursement: dsb };
}

export async function settleCustody(t: Db, companyId: string, user: string, id: string, b: any) {
  const c = await t.one(`SELECT * FROM charity_custody WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "العهدة غير موجودة");
  if (c.status !== "DISBURSED") throw bad("التسوية متاحة للعهد المصروفة غير المسوّاة فقط");
  const custodyAcc = await acct(t, companyId, null, "CH_CUSTODY", "حساب العهد");
  const pr = await project(t, companyId, c.projectId);
  const raw: any[] = Array.isArray(b.lines) ? b.lines.filter((l: any) => num(l.amount) > 0).slice(0, 200) : [];
  const lines: any[] = [];
  for (const l of raw) {
    const a = await acct(t, companyId, l.accountId || null, l.accountId ? null : "CH_PROGRAMS", `حساب المصروف «${l.description || ""}»`);
    if (a.isCashBank) throw bad("حساب المصروف لا يمكن أن يكون صندوقاً أو بنكاً");
    lines.push({ date: isDate(l.date) ? l.date : null, description: String(l.description || "").slice(0, 300), docNo: l.docNo || null, amount: r2(num(l.amount)), accountId: a.id, accountName: a.nameAr });
  }
  const adv = r2(c.disbursedAmount);
  const spent = r2(lines.reduce((s, l) => s + l.amount, 0));
  const returned = spent < adv ? r2(adv - spent) : 0;
  const extra = spent > adv ? r2(spent - adv) : 0;
  const d = date(b.date);
  const jl: any[] = lines.map((l) => ({ account: l.accountId, debit: l.amount, costCenterId: pr?.costCenterId || null, partnerId: c.partnerId, description: `${c.number}: ${l.description}${l.docNo ? " — مستند " + l.docNo : ""}` }));
  let retAcc: any = null, extraAcc: any = null;
  if (returned > 0) { retAcc = await acct(t, companyId, b.returnAccountId, "CASH", "حساب إعادة المتبقي", { cash: true }); jl.push({ account: retAcc.id, debit: returned, description: `إعادة متبقي العهدة ${c.number}` }); }
  jl.push({ account: custodyAcc.id, credit: adv, partnerId: c.partnerId, description: `تسوية العهدة ${c.number} — ${c.holderName}` });
  if (extra > 0) {
    if (!b.allowExtra) throw bad(`المصروفات تزيد عن العهدة بمبلغ ${extra} — فعّل «صرف الفرق لصاحب العهدة» بعد الاعتماد`);
    extraAcc = await acct(t, companyId, b.extraAccountId || c.payAccountId, "CASH", "حساب صرف الفرق", { cash: true });
    jl.push({ account: extraAcc.id, credit: extra, description: `استكمال عهدة ${c.number} لصاحبها` });
  }
  const je = await post(t, companyId, { date: d, type: "CUSTODY_SETTLE", sourceType: "CHARITY_CUSTODY", sourceId: c.id, reference: c.number, memo: `تسوية العهدة ${c.number} — ${c.holderName}`, createdBy: user, isDemo: c.isDemo, lines: jl });
  const settlement = { date: d, lines, spent, returned, extra, returnAccountId: retAcc?.id || null, returnAccountName: retAcc?.nameAr || null, extraAccountName: extraAcc?.nameAr || null, receiptRef: b.receiptRef || null, note: b.note || null, result: returned > 0 ? "RETURNED" : extra > 0 ? "EXTRA" : "FULL" };
  return t.update("charity_custody", { id, companyId }, { status: "SETTLED", settlement: JSON.stringify(settlement), settleJournalId: je!.id, settledBy: user, settledAt: new Date() });
}

export async function unsettleCustody(t: Db, companyId: string, user: string, id: string) {
  const c = await t.one(`SELECT * FROM charity_custody WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "العهدة غير موجودة");
  if (c.status !== "SETTLED" || !c.settleJournalId) throw bad("العهدة غير مسوّاة");
  await reverse(t, companyId, c.settleJournalId, today(), `إلغاء تسوية العهدة ${c.number}`, user);
  return t.update("charity_custody", { id, companyId }, { status: "DISBURSED", settleJournalId: null, settlement: null, settledBy: null, settledAt: null });
}

// ─── generic forms: PURCHASE (طلب شراء) · RECEIVING (محضر استلام) · REFUND (طلب استرداد) ──────────
const PREFIX: Record<string, string> = { PURCHASE: "PRQ", RECEIVING: "GRN", REFUND: "RFD" };
export const FORM_KINDS = Object.keys(PREFIX);

function cleanItems(items: any, receiving = false) {
  if (!Array.isArray(items)) return [];
  return items.filter((i) => i && String(i.name || "").trim()).slice(0, 100).map((i) => receiving
    ? { name: String(i.name).trim(), spec: i.spec || "", qtyReq: num(i.qtyReq), qtyRec: num(i.qtyRec), condition: i.condition || "سليم", notes: i.notes || "", price: num(i.price) }
    : { name: String(i.name).trim(), spec: i.spec || "", qty: num(i.qty), price: r2(num(i.price)), total: r2(num(i.qty) * num(i.price)) });
}

export async function listForms(t: Db, companyId: string, kind: string, q: any) {
  if (!FORM_KINDS.includes(kind)) throw bad("نوع النموذج غير معروف");
  const params: any[] = [companyId, kind];
  const w = ["f.company_id=$1", "f.kind=$2"];
  if (q.status) { params.push(q.status); w.push(`f.status=$${params.length}`); }
  if (isDate(q.from)) { params.push(q.from); w.push(`f.date >= $${params.length}`); }
  if (isDate(q.to)) { params.push(q.to); w.push(`f.date <= $${params.length}`); }
  return t.rows(
    `SELECT f.*, pr.name project_name, p.number parent_number, d.number disbursement_number,
       (SELECT json_agg(json_build_object('id', c.id, 'number', c.number)) FROM charity_forms c WHERE c.parent_id=f.id) children
     FROM charity_forms f LEFT JOIN charity_projects pr ON pr.id=f.project_id LEFT JOIN charity_forms p ON p.id=f.parent_id LEFT JOIN charity_disbursements d ON d.id=f.disbursement_id
     WHERE ${w.join(" AND ")} ORDER BY f.date DESC, f.number DESC LIMIT 5000`, params);
}

export async function saveForm(t: Db, companyId: string, user: string, kind: string, b: any, id?: string) {
  if (!FORM_KINDS.includes(kind)) throw bad("نوع النموذج غير معروف");
  await ensureCharity(t, companyId);
  const d0: any = b.data && typeof b.data === "object" ? { ...b.data } : {};
  if (JSON.stringify(d0).length > 100_000) throw bad("بيانات النموذج كبيرة جداً");
  const pr = await project(t, companyId, b.projectId);
  let amount = 0, party = "", parent: any = null;
  if (kind === "PURCHASE") {
    d0.items = cleanItems(d0.items);
    if (!d0.items.length) throw bad("أضف صنفاً أو خدمة واحدة على الأقل");
    d0.subtotal = r2(d0.items.reduce((s: number, i: any) => s + i.total, 0));
    d0.vat = d0.vatIncluded === false ? 0 : r2(num(d0.vat ?? (d0.applyVat ? d0.subtotal * 0.15 : 0)));
    d0.total = r2(d0.subtotal + d0.vat);
    amount = d0.total; party = String(d0.requester || user).trim();
    if (!String(d0.purpose || "").trim()) throw bad("الغرض من الشراء مطلوب");
  } else if (kind === "RECEIVING") {
    d0.items = cleanItems(d0.items, true);
    if (!d0.items.length) throw bad("أضف الأصناف المستلمة");
    party = String(d0.supplier || "").trim();
    if (!party) throw bad("اسم المورد مطلوب");
    d0.subtotal = r2(num(d0.subtotal)); d0.vat = r2(num(d0.vat)); d0.total = r2(num(d0.total) || d0.subtotal + d0.vat); d0.due = r2(num(d0.due) || d0.total);
    amount = d0.total;
    if (b.parentId) {
      parent = await t.one(`SELECT * FROM charity_forms WHERE id=$1 AND company_id=$2 AND kind='PURCHASE'`, [b.parentId, companyId], "طلب الشراء غير موجود");
      if (!["APPROVED", "ORDERED", "RECEIVED"].includes(parent.status)) throw bad("طلب الشراء غير معتمد بعد");
    }
  } else {
    amount = r2(num(d0.amount));
    if (!(amount > 0)) throw bad("مبلغ الاسترداد يجب أن يكون أكبر من صفر");
    party = String(d0.requester || "").trim();
    if (!party) throw bad("اسم مقدم الطلب مطلوب");
    if (d0.iban && !/^SA\d{22}$/.test(String(d0.iban).replace(/\s/g, "").toUpperCase())) throw bad("رقم الآيبان يجب أن يبدأ بـ SA ويتكون من 24 خانة");
    if (d0.iban) d0.iban = String(d0.iban).replace(/\s/g, "").toUpperCase();
  }
  const row: any = { party, amount, projectId: pr?.id || null, data: JSON.stringify(d0) };
  if (id) {
    const f = await t.one(`SELECT * FROM charity_forms WHERE id=$1 AND company_id=$2 AND kind=$3`, [id, companyId, kind], "النموذج غير موجود");
    if (kind !== "RECEIVING" && !["SUBMITTED", "REVIEWED", "REJECTED", "DRAFT"].includes(f.status)) throw bad("لا يمكن تعديل نموذج معتمد");
    return t.update("charity_forms", { id, companyId }, { ...row, ...(kind !== "RECEIVING" ? { status: "SUBMITTED" } : {}) });
  }
  const dt = date(b.date);
  const number = await nextNumber(t, companyId, PREFIX[kind], dt);
  const ins = await t.insert("charity_forms", { companyId, kind, number, date: dt, ...row, parentId: parent?.id || null, status: kind === "RECEIVING" ? "DONE" : "SUBMITTED", isDemo: !!b.isDemo, createdBy: user });
  if (parent) {
    const pd = { ...(parent.data || {}), receivingNo: number, receivedDate: dt, invoiceNo: d0.invoiceNo || parent.data?.invoiceNo || null };
    await t.update("charity_forms", { id: parent.id, companyId }, { status: "RECEIVED", data: JSON.stringify(pd) });
  }
  return ins;
}

export async function actForm(t: Db, companyId: string, user: string, kind: string, id: string, action: string, b: any) {
  const f = await t.one(`SELECT * FROM charity_forms WHERE id=$1 AND company_id=$2 AND kind=$3 FOR UPDATE`, [id, companyId, kind], "النموذج غير موجود");
  const review = { ...(f.review || {}) };
  const set = (o: any) => t.update("charity_forms", { id, companyId }, o);
  switch (action) {
    case "review":
      if (!["SUBMITTED", "REVIEWED"].includes(f.status)) throw bad("النموذج ليس بانتظار المراجعة");
      Object.assign(review, b.review && typeof b.review === "object" ? b.review : {}, { reviewNote: b.note ?? review.reviewNote, reviewedBy: user, reviewedAt: new Date().toISOString() });
      return set({ status: "REVIEWED", review: JSON.stringify(review) });
    case "approve": {
      if (!["SUBMITTED", "REVIEWED"].includes(f.status)) throw bad("لا يمكن اعتماد النموذج في حالته الحالية");
      const amt = b.approvedAmount !== undefined && b.approvedAmount !== "" ? r2(num(b.approvedAmount)) : r2(f.amount);
      if (amt > r2(f.amount) && kind === "REFUND") throw bad("المبلغ المعتمد أكبر من المطلوب");
      Object.assign(review, { approvedAmount: amt, decision: "APPROVED", decisionNote: b.note || null });
      return set({ status: "APPROVED", review: JSON.stringify(review), decidedBy: user, decidedAt: new Date() });
    }
    case "reject":
      if (["ORDERED", "RECEIVED", "PAID", "DONE"].includes(f.status)) throw bad("لا يمكن رفض نموذج منفّذ");
      Object.assign(review, { decision: "REJECTED", decisionNote: b.note || "مرفوض" });
      return set({ status: "REJECTED", review: JSON.stringify(review), decidedBy: user, decidedAt: new Date() });
    case "order": {
      if (kind !== "PURCHASE" || f.status !== "APPROVED") throw bad("أمر الشراء يصدر لطلب شراء معتمد");
      const data = { ...(f.data || {}), poNumber: String(b.poNumber || "").trim() || `PO-${f.number}`, poDate: isDate(b.poDate) ? b.poDate : today(), approvedSupplier: b.supplier || f.data?.supplier || null };
      return set({ status: "ORDERED", data: JSON.stringify(data) });
    }
    case "delete":
      if (kind === "RECEIVING") {
        if (f.parentId) await t.exec(`UPDATE charity_forms SET status=CASE WHEN data->>'poNumber' IS NOT NULL THEN 'ORDERED' ELSE 'APPROVED' END WHERE id=$1 AND (SELECT COUNT(*) FROM charity_forms WHERE parent_id=$1)=1`, [f.parentId]);
      } else if (!["SUBMITTED", "REVIEWED", "REJECTED", "DRAFT"].includes(f.status)) throw bad("لا يمكن حذف نموذج معتمد أو منفّذ");
      await t.exec(`DELETE FROM charity_forms WHERE id=$1`, [id]);
      return { ok: true };
    default:
      throw bad("إجراء غير معروف");
  }
}

export async function payRefund(t: Db, companyId: string, user: string, id: string, b: any) {
  const f = await t.one(`SELECT * FROM charity_forms WHERE id=$1 AND company_id=$2 AND kind='REFUND' FOR UPDATE`, [id, companyId], "طلب الاسترداد غير موجود");
  if (f.status !== "APPROVED") throw bad("يجب اعتماد طلب الاسترداد قبل تنفيذه");
  const d = f.data || {};
  const amount = r2(f.review?.approvedAmount ?? f.amount);
  const exp = await acct(t, companyId, b.accountId || null, b.accountId ? null : "OTHER_INCOME", "الحساب المدين للاسترداد");
  const kind = KIND_OF(b.method || d.refundMethod || "TRANSFER");
  const dsb = await createDisbursement(t, companyId, user, {
    date: b.date, kind, beneficiaryName: d.beneficiary || f.party, beneficiaryIdNo: d.idNo, beneficiaryPhone: d.phone, capacity: "OTHER", department: d.department,
    amount, reason: `استرداد مبلغ — طلب ${f.number}${d.reasonText ? " — " + d.reasonText : ""}`, projectId: f.projectId, expenseAccountId: exp.id, payAccountId: b.payAccountId,
    refNo: b.refNo || (kind === "CASH" ? null : f.number), iban: d.iban, bankName: d.bank, accountHolder: d.holder || d.beneficiary || f.party, docs: ["طلب استرداد معتمد"], sourceType: "REFUND", sourceId: f.id, isDemo: f.isDemo,
  });
  const data = { ...d, executedDate: dsb.date, executedAmount: amount, executedRef: dsb.refNo, disbursementNo: dsb.number };
  await t.update("charity_forms", { id, companyId }, { status: "PAID", disbursementId: dsb.id, data: JSON.stringify(data) });
  return dsb;
}
