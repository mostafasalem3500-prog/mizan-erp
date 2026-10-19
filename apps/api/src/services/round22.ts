/**
 * Round 22 — correcting a POSTED purchase invoice.
 *
 * Accounting basis: a purchase invoice is the supplier's document recorded in our books; a data-entry error
 * (price, quantity, item, VAT code, supplier reference, date) may be corrected as long as the trail is kept.
 * The correction never deletes history: the original entry is reversed, the corrected invoice is re-posted
 * under the SAME number, stock is reversed exactly and received again, and every revision is logged with a
 * mandatory reason and before/after snapshots.
 *
 * Blocked when the correction would break something already reported or settled:
 *  - the period (old or new date) is closed, or a filed VAT return covers either date (input VAT already claimed →
 *    the supplier must issue a credit/debit note, which is then recorded as a return / debit note);
 *  - posted returns / notes reference the invoice, posted landed costs were allocated to it, or customs VAT was paid;
 *  - payments already allocated exceed the corrected total, or the supplier changes after payments;
 *  - the received quantity was already issued so the corrected quantity would make stock negative.
 * Price differences on units already sold go to cost of sales (IAS 2), the rest stays in inventory.
 */
import { Db } from "../db/pool";
import { bad, conflict, r2, r3, D, today } from "../lib/core";
import { post, reverse, assertOpenDate } from "../accounting/engine";
import { stockReverseExact, stockIn } from "../accounting/stock";
import { saveDraft, postInvoice, getInvoice } from "./invoices";

const snap = (inv: any) => ({
  date: inv.date, dueDate: inv.dueDate, partnerId: inv.partnerId, partnerName: inv.partnerName, supplierRef: inv.supplierRef, warehouseId: inv.warehouseId,
  taxable: Number(inv.taxable), vatTotal: Number(inv.vatTotal), total: Number(inv.total), notes: inv.notes,
  lines: (inv.lines || []).map((l: any) => ({ productId: l.productId, accountId: l.accountId, description: l.description, qty: Number(l.qty), uom: l.uom, unitPrice: Number(l.unitPrice), discountPct: Number(l.discountPct || 0), taxCode: l.taxCode, net: Number(l.netAmount), vat: Number(l.vatAmount), total: Number(l.total) })),
});

async function vatFiled(t: Db, companyId: string, date: string) {
  return t.maybe(`SELECT period_from, period_to FROM vat_returns WHERE company_id=$1 AND status='FILED' AND $2::date BETWEEN period_from AND period_to LIMIT 1`, [companyId, date]);
}

/** What blocks a correction (shown in the UI before the user starts). */
export async function revisionCheck(t: Db, companyId: string, id: string) {
  const inv = await t.one(`SELECT * FROM invoices WHERE id=$1 AND company_id=$2`, [id, companyId], "المستند غير موجود");
  const why: string[] = [];
  if (inv.direction !== "PURCHASE" || inv.kind !== "INVOICE") why.push("التعديل بعد الترحيل متاح لفواتير المشتريات فقط؛ فاتورة المبيعات تُصحَّح بإشعار دائن/مدين (اشتراط هيئة الزكاة والضريبة والجمارك)");
  if (inv.status !== "POSTED") why.push("الفاتورة غير مرحّلة — عدّلها كمسودة");
  const per = await t.maybe(`SELECT p.name FROM periods p WHERE p.company_id=$1 AND $2::date BETWEEN p.start_date AND p.end_date AND p.status<>'OPEN'`, [companyId, inv.date]);
  const fy = await t.maybe(`SELECT name FROM fiscal_years WHERE company_id=$1 AND $2::date BETWEEN start_date AND end_date AND status<>'OPEN'`, [companyId, inv.date]);
  if (per || fy) why.push(`الفترة المحاسبية لتاريخ الفاتورة مقفلة (${(per || fy).name})`);
  const vr = await vatFiled(t, companyId, String(inv.date).slice(0, 10));
  if (vr) why.push(`الإقرار الضريبي للفترة ${String(vr.periodFrom).slice(0, 10)} – ${String(vr.periodTo).slice(0, 10)} مُقدَّم — ضريبة المدخلات استُردّت؛ يُسجَّل التصحيح بإشعار من المورد (مرتجع / إشعار مدين)`);
  const notes = await t.one(`SELECT COUNT(*)::int n FROM invoices WHERE origin_id=$1 AND status='POSTED'`, [id]);
  if (notes.n) why.push(`توجد ${notes.n} مرتجعات/إشعارات مرحّلة على الفاتورة — ألغِها أولاً`);
  const lc = await t.one(`SELECT COUNT(*)::int n FROM landed_costs WHERE invoice_id=$1 AND status='POSTED'`, [id]);
  if (lc.n) why.push("وُزّعت تكاليف استيراد (Landed cost) على الفاتورة");
  if (inv.customsPaidJournalId) why.push("سُدّدت ضريبة الجمارك لهذه الفاتورة");
  return { allowed: !why.length, reasons: why, amountPaid: Number(inv.amountPaid), revision: Number(inv.revision || 0) };
}

export async function revisePurchase(t: Db, company: any, user: string, id: string, input: any) {
  const companyId = company.id;
  const reason = String(input?.revisionReason || "").trim();
  if (reason.length < 5) throw bad("سبب التعديل مطلوب (5 أحرف على الأقل) — يُحفظ في سجل المراجعة");
  const cur = await t.one(`SELECT * FROM invoices WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "المستند غير موجود");
  const chk = await revisionCheck(t, companyId, id);
  if (!chk.allowed) throw conflict(chk.reasons.join(" — "));
  const newDate = input.date || String(cur.date).slice(0, 10);
  await assertOpenDate(t, companyId, String(cur.date).slice(0, 10));
  await assertOpenDate(t, companyId, newDate);
  const vr = await vatFiled(t, companyId, newDate);
  if (vr) throw conflict("التاريخ الجديد يقع في فترة إقرار ضريبي مُقدَّم");
  if (Number(cur.amountPaid) > 0 && input.partnerId && input.partnerId !== cur.partnerId) throw conflict("لا يمكن تغيير المورد بعد تسجيل مدفوعات على الفاتورة — ألغِ تخصيص السداد أولاً");
  const before = snap(await getInvoice(t, companyId, id));

  // 1) stock received by this invoice so far (original receipt + earlier corrections), per product & warehouse
  const moves = await t.rows(`SELECT product_id, warehouse_id, qty, value, lots FROM stock_moves WHERE company_id=$1 AND source_id=$2 AND source_type IN ('PURCHASE','PURCHASE_REVISION')`, [companyId, id]);
  const groups = new Map<string, { productId: string; warehouseId: string; q: number; v: number; lots: Map<string, any> }>();
  for (const m of moves) {
    const k = m.productId + "|" + m.warehouseId;
    const g = groups.get(k) || { productId: m.productId, warehouseId: m.warehouseId, q: 0, v: 0, lots: new Map() };
    g.q = r3(g.q + Number(m.qty)); g.v = r2(D(g.v).plus(m.value));
    for (const l of m.lots || []) { const x = g.lots.get(l.lotNo) || { lotNo: l.lotNo, expiry: l.expiry, qty: 0 }; x.qty = r3(x.qty + Number(l.qty)); g.lots.set(l.lotNo, x); }
    groups.set(k, g);
  }
  const onHand = new Map<string, number>();
  for (const g of groups.values()) {
    const b = await t.maybe(`SELECT qty FROM stock_balances WHERE company_id=$1 AND product_id=$2 AND warehouse_id=$3`, [companyId, g.productId, g.warehouseId]);
    onHand.set(g.productId + "|" + g.warehouseId, Number(b?.qty || 0));
  }

  // 2) reverse the original journal on its own date and take the received stock out exactly
  const oldJournal = cur.journalId;
  const rev = oldJournal ? await reverse(t, companyId, oldJournal, String(cur.date).slice(0, 10), `عكس قيد فاتورة المشتريات ${cur.number} — تعديل رقم ${chk.revision + 1}: ${reason}`, user) : null;
  for (const g of groups.values()) {
    if (Math.abs(g.q) < 1e-9 && Math.abs(g.v) < 0.005) continue;
    await stockReverseExact(t, companyId, { productId: g.productId, warehouseId: g.warehouseId, qty: g.q, value: g.v, date: String(cur.date).slice(0, 10), sourceType: "PURCHASE_REVISION", sourceId: id, reference: `${cur.number} (تعديل ${chk.revision + 1})`, lots: [...g.lots.values()].filter((l) => Math.abs(l.qty) > 1e-9), isDemo: cur.isDemo });
  }

  // 3) the corrected document replaces the lines, then is posted again under the same number
  await t.exec(`UPDATE invoices SET status='DRAFT' WHERE id=$1`, [id]);
  await saveDraft(t, company, user, { ...input, direction: "PURCHASE", kind: "INVOICE", date: newDate, partnerId: input.partnerId || cur.partnerId, isDemo: cur.isDemo }, id);
  const posted = await postInvoice(t, company, id, user, { keepNumber: cur.number, issuedAt: cur.issuedAt });

  // 4) price difference on units already issued → cost of sales; quantities may not go below zero
  const newLines = await t.rows(`SELECT l.product_id, l.qty, l.factor, l.net_amount FROM invoice_lines l JOIN products p ON p.id=l.product_id WHERE l.invoice_id=$1 AND p.type='STOCK'`, [id]);
  const wh = posted.warehouseId;
  let cogs = 0;
  const adj: { productId: string; warehouseId: string; amount: number }[] = [];
  for (const g of groups.values()) {
    const nl = g.warehouseId === wh ? newLines.filter((l: any) => l.productId === g.productId) : [];
    const qn = r3(nl.reduce((a: number, l: any) => a + Number(l.qty) * Number(l.factor || 1), 0));
    const vn = r2(nl.reduce((a: number, l: any) => D(a).plus(l.netAmount).toNumber(), 0));
    if (g.q <= 0 || qn <= 0) continue;
    const issued = Math.max(0, r3(g.q - (onHand.get(g.productId + "|" + g.warehouseId) || 0)));
    const common = Math.min(issued, qn);
    const diff = r2(D(common).times(D(vn).div(qn).minus(D(g.v).div(g.q))));
    if (Math.abs(diff) >= 0.01) { adj.push({ productId: g.productId, warehouseId: g.warehouseId, amount: diff }); cogs = r2(D(cogs).plus(diff)); }
  }
  let cogsEntry: any = null;
  if (adj.length) {
    for (const a of adj) await stockIn(t, companyId, { productId: a.productId, warehouseId: a.warehouseId, qty: 0, value: -a.amount, date: newDate, sourceType: "PURCHASE_REV_COST", sourceId: id, reference: cur.number, isDemo: cur.isDemo });
    const lines = cogs > 0
      ? [{ key: "COGS", debit: cogs, description: `فرق سعر الكميات المباعة — ${cur.number}` }, { key: "INVENTORY", credit: cogs, description: `فرق سعر الكميات المباعة — ${cur.number}` }]
      : [{ key: "INVENTORY", debit: -cogs, description: `فرق سعر الكميات المباعة — ${cur.number}` }, { key: "COGS", credit: -cogs, description: `فرق سعر الكميات المباعة — ${cur.number}` }];
    cogsEntry = await post(t, companyId, { date: newDate, type: "STOCK", sourceType: "INVOICE", sourceId: id, branchId: posted.branchId, reference: cur.number, memo: `تحميل فرق تعديل فاتورة المشتريات ${cur.number} على تكلفة المبيعات`, createdBy: user, isDemo: cur.isDemo, lines } as any);
  }
  const neg = await t.rows(
    `SELECT p.name, b.qty FROM stock_balances b JOIN products p ON p.id=b.product_id WHERE b.company_id=$1 AND b.qty < 0 AND (b.product_id, b.warehouse_id) IN (SELECT product_id, warehouse_id FROM stock_moves WHERE source_id=$2)`,
    [companyId, id],
  );
  if (neg.length && !company.allowNegativeStock) throw conflict(`لا يمكن تخفيض الكمية: صُرف جزء من الكمية المستلمة — «${neg[0].name}» سيصبح رصيده ${Number(neg[0].qty)}. سجّل مرتجع مشتريات للكمية المتبقية بدلاً من التعديل.`);

  // 5) payments stay allocated; the corrected total may not fall below what was already paid
  const paid = Number(cur.amountPaid);
  if (paid > Number(posted.total) + 0.001) throw conflict(`المسدد على الفاتورة ${paid.toFixed(2)} أكبر من الإجمالي بعد التعديل ${Number(posted.total).toFixed(2)} — عدّل تخصيص السداد أولاً`);
  const status = paid <= 0 ? "UNPAID" : paid >= Number(posted.total) - 0.001 ? "PAID" : "PARTIAL";
  const revNo = chk.revision + 1;
  await t.exec(`UPDATE invoices SET amount_paid=$2, payment_status=$3, revision=$4, updated_at=now() WHERE id=$1`, [id, paid, status, revNo]);
  const after = snap(await getInvoice(t, companyId, id));
  await t.insert("invoice_revisions", { companyId, invoiceId: id, revNo, reason, before: JSON.stringify(before), after: JSON.stringify(after), oldJournalId: oldJournal, reversalJournalId: rev?.id || null, newJournalId: posted.journalId, cogsJournalId: cogsEntry?.id || null, cogsAdjustment: cogs, createdBy: user });
  return { invoice: await getInvoice(t, companyId, id), revision: revNo, cogsAdjustment: cogs };
}

export async function listRevisions(t: Db, companyId: string, id: string) {
  return t.rows(
    `SELECT r.*, j1.number old_journal, j2.number reversal_journal, j3.number new_journal, j4.number cogs_journal FROM invoice_revisions r
       LEFT JOIN journal_entries j1 ON j1.id=r.old_journal_id LEFT JOIN journal_entries j2 ON j2.id=r.reversal_journal_id
       LEFT JOIN journal_entries j3 ON j3.id=r.new_journal_id LEFT JOIN journal_entries j4 ON j4.id=r.cogs_journal_id
     WHERE r.company_id=$1 AND r.invoice_id=$2 ORDER BY r.rev_no DESC`, [companyId, id]);
}
