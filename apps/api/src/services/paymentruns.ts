/**
 * Supplier payment run (SAP «automatic payment program» F110, Dynamics «vendor payment proposal»): the open purchase
 * invoices due by a date are proposed per supplier; the user removes or reduces lines and saves the run; someone with
 * approval rights approves it (not the person who prepared it, when the establishment has more than one user); posting
 * issues one payment voucher per supplier from the chosen bank or cash account, allocated to the run's invoices —
 * through the ordinary createPayment, so withholding tax, branches and the subledger work as for any voucher.
 * Foreign-currency invoices are left out (their settlement needs the rate of the day, entered on a voucher).
 */
import { Db } from "../db/pool";
import { bad, conflict, num, r2, isDate, today, addDays } from "../lib/core";
import { nextNumber } from "../accounting/engine";
import { createPayment, cancelPayment } from "./payments";
import { BASE } from "./currency";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (d: any) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);

/** Open purchase invoices due by `dueUntil` (and the overdue), grouped by supplier, minus what other open runs hold. */
export async function propose(t: Db, C: string, q: { dueUntil?: string; partnerId?: string; minAmount?: number }) {
  const dueUntil = isDate(q.dueUntil) ? String(q.dueUntil) : addDays(today(), 7);
  const rows = await t.rows(
    `SELECT i.id, i.number, i.supplier_ref, i.date, i.due_date, i.total, i.amount_paid, i.partner_id, p.name partner_name, p.is_non_resident, p.wht_type,
            COALESCE((SELECT SUM(l.amount) FROM payment_run_lines l JOIN payment_runs r ON r.id=l.run_id WHERE l.invoice_id=i.id AND r.status IN ('DRAFT','APPROVED')),0) held,
            -- an earlier posted bill of the same supplier with the same supplier invoice number: this one may be a duplicate
            (SELECT d.number FROM invoices d WHERE d.company_id=i.company_id AND d.partner_id=i.partner_id AND d.id<>i.id AND d.direction='PURCHASE' AND d.kind='INVOICE' AND d.status='POSTED'
               AND COALESCE(trim(i.supplier_ref),'')<>'' AND lower(trim(d.supplier_ref))=lower(trim(i.supplier_ref)) AND (d.created_at, d.id) < (i.created_at, i.id) ORDER BY d.created_at LIMIT 1) dup_of
       FROM invoices i JOIN partners p ON p.id=i.partner_id
      WHERE i.company_id=$1 AND i.direction='PURCHASE' AND i.kind IN ('INVOICE','DEBIT_NOTE') AND i.status='POSTED'
        AND i.total - i.amount_paid > 0.005 AND COALESCE(i.currency,$3)=$3 AND COALESCE(i.due_date, i.date) <= $2
        ${q.partnerId && UUID.test(q.partnerId) ? "AND i.partner_id=$4" : ""}
      ORDER BY p.name, COALESCE(i.due_date, i.date), i.number`,
    q.partnerId && UUID.test(q.partnerId) ? [C, dueUntil, BASE, q.partnerId] : [C, dueUntil, BASE]);
  const credits = await t.rows(
    `SELECT partner_id, SUM(total - amount_paid) open FROM invoices WHERE company_id=$1 AND direction='PURCHASE' AND kind='CREDIT_NOTE' AND status='POSTED' AND total - amount_paid > 0.005 GROUP BY 1`, [C]);
  const credit = new Map(credits.map((c) => [c.partnerId, r2(Number(c.open))]));
  const fx = await t.one(`SELECT COUNT(*)::int n FROM invoices WHERE company_id=$1 AND direction='PURCHASE' AND kind='INVOICE' AND status='POSTED' AND total - amount_paid > 0.005 AND COALESCE(currency,$3)<>$3 AND COALESCE(due_date,date) <= $2`, [C, dueUntil, BASE]);
  const groups = new Map<string, any>();
  for (const r of rows) {
    const balance = r2(Number(r.total) - Number(r.amountPaid)), held = r2(Number(r.held)), free = r2(balance - held);
    if (free <= 0) continue;
    const g = groups.get(r.partnerId) || { partnerId: r.partnerId, partnerName: r.partnerName, wht: !!(r.isNonResident && r.whtType), openCredit: credit.get(r.partnerId) || 0, invoices: [] as any[], total: 0 };
    const due = iso(r.dueDate || r.date);
    g.invoices.push({ invoiceId: r.id, number: r.number, supplierRef: r.supplierRef, date: iso(r.date), dueDate: due, overdueDays: Math.max(0, Math.round((Date.parse(today()) - Date.parse(due)) / 86400000)), balance, held, amount: free, duplicateOf: r.dupOf || null });
    g.total = r2(g.total + free);
    groups.set(r.partnerId, g);
  }
  const suppliers = [...groups.values()].filter((g) => g.total >= num(q.minAmount));
  const duplicates = suppliers.reduce((a, g) => a + g.invoices.filter((i: any) => i.duplicateOf).length, 0);
  return { dueUntil, suppliers, total: r2(suppliers.reduce((a, g) => a + g.total, 0)), count: suppliers.reduce((a, g) => a + g.invoices.length, 0), foreignLeftOut: fx.n, duplicates };
}

async function cashAccount(t: Db, C: string, id: string) {
  return t.one(`SELECT id, code, name_ar, subtype FROM accounts WHERE id=$1 AND company_id=$2 AND is_cash_bank AND NOT is_group`, [UUID.test(id || "") ? id : null, C], "اختر حساب البنك أو الصندوق الذي يُسدَّد منه");
}
async function balanceOf(t: Db, C: string, accountId: string) {
  const r = await t.one(`SELECT COALESCE(SUM(l.debit - l.credit),0) b FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE e.company_id=$1 AND e.status='POSTED' AND l.account_id=$2`, [C, accountId]);
  return r2(Number(r.b));
}

/** Validates lines against the invoices as they are now: open, the run's currency, not more than what is left. */
async function checkLines(t: Db, C: string, lines: any[], exceptRun?: string) {
  if (!Array.isArray(lines) || !lines.length) throw bad("اختر فاتورة واحدة على الأقل");
  if (lines.length > 500) throw bad("حتى 500 فاتورة في الدفعة");
  const ids = [...new Set(lines.map((l) => String(l.invoiceId || "")))];
  if (ids.length !== lines.length || ids.some((x) => !UUID.test(x))) throw bad("الفواتير مكررة أو غير صحيحة");
  const inv = await t.rows(
    `SELECT i.id, i.number, i.partner_id, i.total, i.amount_paid, i.status, i.direction, i.kind, COALESCE(i.currency,$3) currency,
            COALESCE((SELECT SUM(l.amount) FROM payment_run_lines l JOIN payment_runs r ON r.id=l.run_id WHERE l.invoice_id=i.id AND r.status IN ('DRAFT','APPROVED') AND r.id IS DISTINCT FROM $4::uuid),0) held
       FROM invoices i WHERE i.company_id=$1 AND i.id = ANY($2) FOR UPDATE OF i`, [C, ids, BASE, exceptRun || null]);
  const m = new Map(inv.map((x) => [x.id, x]));
  return lines.map((l) => {
    const x = m.get(l.invoiceId);
    if (!x || x.direction !== "PURCHASE" || !["INVOICE", "DEBIT_NOTE"].includes(x.kind) || x.status !== "POSTED") throw bad("إحدى الفواتير ليست فاتورة مشتريات مرحّلة");
    if (x.currency !== BASE) throw bad(`الفاتورة ${x.number} بعملة أجنبية — تُسدَّد بسند صرف بسعر يومها`);
    const left = r2(Number(x.total) - Number(x.amountPaid) - Number(x.held));
    const amount = r2(num(l.amount));
    if (amount <= 0) throw bad(`مبلغ الفاتورة ${x.number} يجب أن يكون أكبر من صفر`);
    if (amount > left + 0.005) throw bad(`مبلغ الفاتورة ${x.number} (${amount}) أكبر من المتبقي عليها (${Math.max(0, left)})`);
    return { invoiceId: x.id, partnerId: x.partnerId, amount };
  });
}

export async function createRun(t: Db, C: string, user: { id: string; name: string }, b: any) {
  const payDate = isDate(b?.payDate) ? b.payDate : today();
  const acc = await cashAccount(t, C, b?.accountId);
  const lines = await checkLines(t, C, b?.lines);
  const total = r2(lines.reduce((a, l) => a + l.amount, 0));
  const number = await nextNumber(t, C, "PRUN", payDate, 4);
  const run = await t.insert("payment_runs", { companyId: C, number, payDate, dueUntil: isDate(b?.dueUntil) ? b.dueUntil : payDate, accountId: acc.id, method: acc.subtype === "CASH" ? "CASH" : "BANK", total, notes: b?.notes ? String(b.notes).slice(0, 300) : null, createdBy: user.name, createdById: user.id, isDemo: !!b?.isDemo });
  for (const l of lines) await t.insert("payment_run_lines", { runId: run.id, ...l });
  return getRun(t, C, run.id);
}

export async function listRuns(t: Db, C: string) {
  const rows = await t.rows(`SELECT r.*, a.name_ar account_name, (SELECT COUNT(DISTINCT partner_id)::int FROM payment_run_lines WHERE run_id=r.id) suppliers, (SELECT COUNT(*)::int FROM payment_run_lines WHERE run_id=r.id) invoices
      FROM payment_runs r JOIN accounts a ON a.id=r.account_id WHERE r.company_id=$1 ORDER BY r.created_at DESC LIMIT 200`, [C]);
  return rows.map((r) => ({ ...r, payDate: iso(r.payDate), dueUntil: iso(r.dueUntil), total: Number(r.total) }));
}

export async function getRun(t: Db, C: string, id: string) {
  const r = await t.one(`SELECT r.*, a.name_ar account_name, a.code account_code FROM payment_runs r JOIN accounts a ON a.id=r.account_id WHERE r.id=$1 AND r.company_id=$2`, [UUID.test(id) ? id : null, C], "الدفعة غير موجودة");
  const lines = await t.rows(
    `SELECT l.*, p.name partner_name, i.number, i.supplier_ref, i.date, i.due_date, i.total inv_total, i.amount_paid, pay.number payment_number, pay.status payment_status, pay.net_paid, pay.wht_amount
       FROM payment_run_lines l JOIN partners p ON p.id=l.partner_id JOIN invoices i ON i.id=l.invoice_id LEFT JOIN payments pay ON pay.id=l.payment_id
      WHERE l.run_id=$1 ORDER BY p.name, i.due_date, i.number`, [r.id]);
  const bySupplier = new Map<string, any>();
  for (const l of lines) {
    const g = bySupplier.get(l.partnerId) || { partnerId: l.partnerId, partnerName: l.partnerName, total: 0, paymentNumber: l.paymentNumber, paymentStatus: l.paymentStatus, netPaid: l.netPaid === null || l.netPaid === undefined ? null : Number(l.netPaid), wht: Number(l.whtAmount || 0), invoices: [] as any[] };
    g.invoices.push({ id: l.id, invoiceId: l.invoiceId, number: l.number, supplierRef: l.supplierRef, date: iso(l.date), dueDate: iso(l.dueDate || l.date), amount: Number(l.amount), balance: r2(Number(l.invTotal) - Number(l.amountPaid)) });
    g.total = r2(g.total + Number(l.amount));
    bySupplier.set(l.partnerId, g);
  }
  const accountBalance = await balanceOf(t, C, r.accountId);
  return { ...r, payDate: iso(r.payDate), dueUntil: iso(r.dueUntil), total: Number(r.total), accountBalance, shortfall: r.status === "POSTED" ? 0 : r2(Math.max(0, Number(r.total) - accountBalance)), suppliers: [...bySupplier.values()] };
}

/** Replaces the lines of a run not yet approved. */
export async function updateRun(t: Db, C: string, id: string, b: any) {
  const r = await t.one(`SELECT * FROM payment_runs WHERE id=$1 AND company_id=$2 FOR UPDATE`, [UUID.test(id) ? id : null, C], "الدفعة غير موجودة");
  if (r.status !== "DRAFT") throw conflict("لا تُعدَّل الدفعة بعد اعتمادها — أعدها مسودة أولاً");
  const lines = await checkLines(t, C, b?.lines, r.id);
  const acc = b?.accountId ? await cashAccount(t, C, b.accountId) : null;
  await t.exec(`DELETE FROM payment_run_lines WHERE run_id=$1`, [r.id]);
  for (const l of lines) await t.insert("payment_run_lines", { runId: r.id, ...l });
  await t.update("payment_runs", { id: r.id }, { total: r2(lines.reduce((a, l) => a + l.amount, 0)), payDate: isDate(b?.payDate) ? b.payDate : undefined, ...(acc ? { accountId: acc.id, method: acc.subtype === "CASH" ? "CASH" : "BANK" } : {}), notes: b?.notes === undefined ? undefined : String(b.notes || "").slice(0, 300) || null });
  return getRun(t, C, r.id);
}

/** Approval: four eyes — the preparer cannot approve when the establishment has other users who can. */
export async function approveRun(t: Db, C: string, user: { id: string; name: string; role: string | null }, id: string) {
  const r = await t.one(`SELECT * FROM payment_runs WHERE id=$1 AND company_id=$2 FOR UPDATE`, [UUID.test(id) ? id : null, C], "الدفعة غير موجودة");
  if (r.status !== "DRAFT") throw conflict("الدفعة ليست مسودة");
  if (!["OWNER", "ADMIN"].includes(user.role || "")) throw bad("الاعتماد للمالك أو المدير");
  if (r.createdById === user.id) {
    const others = await t.one(`SELECT COUNT(*)::int n FROM memberships WHERE company_id=$1 AND user_id<>$2 AND role IN ('OWNER','ADMIN')`, [C, user.id]);
    if (others.n > 0) throw conflict("من أعدّ الدفعة لا يعتمدها — يعتمدها مالك أو مدير آخر (فصل المهام)");
  }
  await checkLines(t, C, (await t.rows(`SELECT invoice_id, amount FROM payment_run_lines WHERE run_id=$1`, [r.id])).map((l) => ({ invoiceId: l.invoiceId, amount: l.amount })), r.id);
  await t.update("payment_runs", { id: r.id }, { status: "APPROVED", approvedBy: user.name, approvedAt: new Date() });
  return getRun(t, C, r.id);
}
export async function reopenRun(t: Db, C: string, id: string) {
  const r = await t.one(`SELECT * FROM payment_runs WHERE id=$1 AND company_id=$2 FOR UPDATE`, [UUID.test(id) ? id : null, C], "الدفعة غير موجودة");
  if (r.status !== "APPROVED") throw conflict("الدفعة ليست معتمدة");
  await t.update("payment_runs", { id: r.id }, { status: "DRAFT", approvedBy: null, approvedAt: null });
  return getRun(t, C, r.id);
}

/** One voucher per supplier, allocated to the run's invoices. */
export async function postRun(t: Db, C: string, user: string, id: string) {
  const r = await t.one(`SELECT * FROM payment_runs WHERE id=$1 AND company_id=$2 FOR UPDATE`, [UUID.test(id) ? id : null, C], "الدفعة غير موجودة");
  if (r.status !== "APPROVED") throw conflict(r.status === "POSTED" ? "الدفعة مرحّلة مسبقاً" : "اعتمد الدفعة قبل الترحيل");
  const lines = await t.rows(`SELECT * FROM payment_run_lines WHERE run_id=$1 ORDER BY partner_id`, [r.id]);
  await checkLines(t, C, lines.map((l) => ({ invoiceId: l.invoiceId, amount: l.amount })), r.id);
  const byPartner = new Map<string, any[]>();
  for (const l of lines) byPartner.set(l.partnerId, [...(byPartner.get(l.partnerId) || []), l]);
  const vouchers: any[] = [];
  for (const [partnerId, ls] of byPartner) {
    const amount = r2(ls.reduce((a, l) => a + Number(l.amount), 0));
    const pay = await createPayment(t, C, user, { direction: "OUT", partnerId, date: iso(r.payDate), amount, method: r.method, accountId: r.accountId, reference: r.number, notes: `دفعة سداد الموردين ${r.number}`, allocations: ls.map((l) => ({ invoiceId: l.invoiceId, amount: Number(l.amount) })), isDemo: r.isDemo });
    await t.exec(`UPDATE payment_run_lines SET payment_id=$2 WHERE run_id=$1 AND partner_id=$3`, [r.id, pay.id, partnerId]);
    vouchers.push({ partnerId, number: pay.number, amount, netPaid: Number(pay.netPaid ?? amount) });
  }
  await t.update("payment_runs", { id: r.id }, { status: "POSTED", postedAt: new Date() });
  return { ...(await getRun(t, C, r.id)), vouchers };
}

/** A run not posted is cancelled; a posted one is reversed voucher by voucher (each through cancelPayment). */
export async function cancelRun(t: Db, C: string, user: string, id: string) {
  const r = await t.one(`SELECT * FROM payment_runs WHERE id=$1 AND company_id=$2 FOR UPDATE`, [UUID.test(id) ? id : null, C], "الدفعة غير موجودة");
  if (r.status === "CANCELLED") throw conflict("الدفعة ملغاة مسبقاً");
  if (r.status === "POSTED") {
    const pays = await t.rows(`SELECT DISTINCT l.payment_id FROM payment_run_lines l JOIN payments p ON p.id=l.payment_id WHERE l.run_id=$1 AND p.status='POSTED'`, [r.id]);
    for (const p of pays) await cancelPayment(t, C, user, p.paymentId);
  }
  await t.update("payment_runs", { id: r.id }, { status: "CANCELLED" });
  return getRun(t, C, r.id);
}
