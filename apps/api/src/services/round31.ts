/**
 * Round 31 — ideas taken from the large ERPs and fitted to this program:
 *  • parked journals with approval and auto-reversing accruals (SAP park/post, Dynamics journal workflow, Odoo auto-reverse)
 *  • bank reconciliation rules, one-statement-line-to-many matching, reconciliation statement (Odoo reconciliation models)
 *  • month-end close cockpit (Dynamics «Financial period close», SAP closing cockpit, Odoo lock dates)
 *  • cost allocation between cost centres (SAP assessment / distribution, Dynamics allocation rules)
 *  • cost-volume-profit: contribution margin and break-even
 */
import { Db } from "../db/pool";
import { bad, conflict, notFound, forbidden, r2, num, isDate, today, addDays, monthEnd } from "../lib/core";
import { post, reverse, accountByKey } from "../accounting/engine";
import { manualJournal } from "./misc";
import { createExpense } from "./expenses";
import { integrity } from "./reports";
import { confirmMatch } from "./bankimport";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL = "00000000-0000-0000-0000-000000000000";
const id = (v: any) => (UUID.test(String(v || "")) ? String(v) : NIL);
const arr = (ids: string[]) => `{${ids.filter((x) => UUID.test(x)).join(",")}}`;
type Who = { userId: string; userName: string; role: string | null; superAdmin?: boolean };

// ─── parked journals ───────────────────────────────────────────────────────
async function cleanLines(t: Db, C: string, lines: any[]) {
  if (!Array.isArray(lines)) throw bad("سطور القيد مطلوبة");
  const rows = lines.map((l) => ({ accountId: id(l.accountId), debit: r2(num(l.debit)), credit: r2(num(l.credit)), partnerId: UUID.test(l.partnerId || "") ? l.partnerId : null, costCenterId: UUID.test(l.costCenterId || "") ? l.costCenterId : null, description: l.description ? String(l.description).slice(0, 300) : null }))
    .filter((l) => l.accountId !== NIL && (l.debit || l.credit));
  if (rows.length < 2) throw bad("القيد يحتاج سطرين على الأقل");
  if (rows.some((l) => l.debit < 0 || l.credit < 0 || (l.debit && l.credit))) throw bad("كل سطر مدين أو دائن بمبلغ موجب");
  const dr = r2(rows.reduce((s, l) => s + l.debit, 0)), cr = r2(rows.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(dr - cr) > 0.005) throw bad(`القيد غير متوازن: المدين ${dr.toFixed(2)} والدائن ${cr.toFixed(2)}`);
  const ok = await t.rows(`SELECT id FROM accounts WHERE company_id=$1 AND NOT is_group AND is_active AND id = ANY($2::uuid[])`, [C, arr(rows.map((l) => l.accountId))]);
  if (rows.some((l) => !ok.find((a) => a.id === l.accountId))) throw bad("أحد الحسابات غير موجود أو موقوف أو حساب رئيسي");
  return { rows, total: dr };
}
const draftHead = (b: any) => {
  if (!isDate(b.date)) throw bad("تاريخ القيد مطلوب");
  if (b.reverseOn && (!isDate(b.reverseOn) || b.reverseOn <= b.date)) throw bad("تاريخ العكس يجب أن يكون بعد تاريخ القيد");
  return { date: b.date, memo: b.memo ? String(b.memo).slice(0, 300) : null, reference: b.reference ? String(b.reference).slice(0, 100) : null, reverseOn: b.reverseOn || null };
};
export async function listDrafts(t: Db, C: string, status?: string) {
  const rows = await t.rows(`SELECT * FROM journal_drafts WHERE company_id=$1 ${status ? "AND status=$2" : ""} ORDER BY (status='SUBMITTED') DESC, date DESC, created_at DESC LIMIT 300`, status ? [C, status] : [C]);
  const counts = await t.one(`SELECT COUNT(*) FILTER (WHERE status='SUBMITTED')::int submitted, COUNT(*) FILTER (WHERE status='DRAFT')::int draft, COUNT(*) FILTER (WHERE status='REJECTED')::int rejected, COUNT(*) FILTER (WHERE status='POSTED')::int posted FROM journal_drafts WHERE company_id=$1`, [C]);
  const ids = [...new Set(rows.flatMap((r) => (r.lines || []).map((l: any) => l.accountId)))];
  const accs = ids.length ? await t.rows(`SELECT id, code, name_ar FROM accounts WHERE company_id=$1 AND id = ANY($2::uuid[])`, [C, arr(ids)]) : [];
  const name = (i: string) => { const a = accs.find((x) => x.id === i); return a ? `${a.code} ${a.nameAr}` : "—"; };
  return { rows: rows.map((r) => ({ ...r, lines: (r.lines || []).map((l: any) => ({ ...l, account: name(l.accountId) })) })), counts };
}
export async function saveDraft(t: Db, C: string, who: Who, b: any, draftId?: string) {
  const head = draftHead(b); const { rows, total } = await cleanLines(t, C, b.lines);
  const submit = !!b.submit;
  const fields = { ...head, lines: JSON.stringify(rows), total, status: submit ? "SUBMITTED" : "DRAFT", submittedAt: submit ? new Date() : null, rejectReason: null, updatedAt: new Date() };
  if (!draftId) return t.insert("journal_drafts", { companyId: C, ...fields, createdBy: who.userId, createdName: who.userName });
  const d = await t.one(`SELECT * FROM journal_drafts WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id(draftId), C], "المسودة غير موجودة");
  if (!["DRAFT", "REJECTED"].includes(d.status)) throw conflict("لا تُعدَّل المسودة بعد إرسالها للاعتماد — اسحبها أولاً");
  return t.update("journal_drafts", { id: d.id }, fields);
}
export async function draftAction(t: Db, C: string, who: Who, draftId: string, action: string, body: any, company: any) {
  const d = await t.one(`SELECT * FROM journal_drafts WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id(draftId), C], "المسودة غير موجودة");
  if (action === "submit") { if (!["DRAFT", "REJECTED"].includes(d.status)) throw conflict("المسودة مرسلة أو مرحّلة"); return t.update("journal_drafts", { id: d.id }, { status: "SUBMITTED", submittedAt: new Date(), rejectReason: null }); }
  if (action === "withdraw") { if (d.status !== "SUBMITTED") throw conflict("ليست بانتظار الاعتماد"); return t.update("journal_drafts", { id: d.id }, { status: "DRAFT", submittedAt: null }); }
  if (action === "delete") { if (d.status === "POSTED") throw conflict("القيد مرحّل — اعكسه من القيود اليومية"); await t.exec(`DELETE FROM journal_drafts WHERE id=$1`, [d.id]); return { ok: true }; }
  if (action === "reject") {
    if (d.status !== "SUBMITTED") throw conflict("ليست بانتظار الاعتماد");
    const reason = String(body?.reason || "").trim().slice(0, 300); if (!reason) throw bad("اكتب سبب الرفض");
    return t.update("journal_drafts", { id: d.id }, { status: "REJECTED", rejectReason: reason, decidedBy: who.userId, decidedName: who.userName, decidedAt: new Date() });
  }
  if (action === "approve") {
    if (d.status === "POSTED") throw conflict("القيد مرحّل مسبقاً");
    // segregation of duties: with approval on, whoever prepared the entry cannot be the one who posts it
    if (company.accounting?.journalApproval) {
      if (d.status !== "SUBMITTED") throw conflict("أرسل القيد للاعتماد أولاً");
      if (d.createdBy === who.userId) throw forbidden("الفصل بين المهام مفعّل: يعتمد القيد مستخدم غير الذي أعدّه");
      if (!who.superAdmin && !["OWNER", "ADMIN", "ACCOUNTANT"].includes(who.role || "")) throw forbidden("اعتماد القيود للمالك أو المدير أو المحاسب");
    }
    const e = await manualJournal(t, C, d.createdName || who.userName, { date: String(d.date instanceof Date ? d.date.toISOString() : d.date).slice(0, 10), memo: d.memo, reference: d.reference, lines: d.lines });
    let rev: any = null;
    if (d.reverseOn) rev = await reverse(t, C, e!.id, String(d.reverseOn instanceof Date ? d.reverseOn.toISOString() : d.reverseOn).slice(0, 10), `عكس تلقائي لقيد الاستحقاق ${e!.number}`, who.userName);
    await t.update("journal_drafts", { id: d.id }, { status: "POSTED", entryId: e!.id, reversalId: rev?.id || null, decidedBy: who.userId, decidedName: who.userName, decidedAt: new Date() });
    return { ok: true, entryId: e!.id, number: e!.number, reversal: rev?.number || null };
  }
  throw bad("إجراء غير معروف");
}

// ─── bank: rules, group matching, reconciliation statement ─────────────────
const nrm = (s: any) => String(s || "").replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").toLowerCase().replace(/\s+/g, " ").trim();
export async function listRules(t: Db, C: string) {
  return t.rows(`SELECT r.*, a.code account_code, a.name_ar account_name, a.type account_type FROM bank_rules r JOIN accounts a ON a.id=r.account_id WHERE r.company_id=$1 ORDER BY r.sort, r.created_at`, [C]);
}
export async function saveRule(t: Db, C: string, b: any, ruleId?: string) {
  const name = String(b.name || "").trim().slice(0, 80), contains = String(b.contains || "").trim().slice(0, 120);
  if (!name || contains.length < 2) throw bad("اسم القاعدة والنص المطلوب البحث عنه مطلوبان");
  const acc = await t.one(`SELECT id, type FROM accounts WHERE id=$1 AND company_id=$2 AND NOT is_group AND is_active AND NOT is_cash_bank`, [id(b.accountId), C], "اختر الحساب المقابل (غير نقدي)");
  const data = { name, contains, direction: ["IN", "OUT"].includes(b.direction) ? b.direction : "ANY", accountId: acc.id, taxCode: acc.type === "EXPENSE" && ["S", "O", "E", "Z"].includes(b.taxCode) ? b.taxCode : null, isActive: b.isActive !== false, sort: Math.round(num(b.sort)) };
  if (ruleId) { const r = await t.update("bank_rules", { id: id(ruleId), companyId: C }, data); if (!r) throw notFound("القاعدة غير موجودة"); return r; }
  return t.insert("bank_rules", { companyId: C, ...data });
}
/** The first active rule whose words all appear in the line's description / reference, for the line's direction. */
export function ruleFor(rules: any[], s: any) {
  const text = nrm(`${s.description || ""} ${s.reference || ""}`); const dir = Number(s.amount) > 0 ? "IN" : "OUT";
  return rules.find((r) => r.isActive && (r.direction === "ANY" || r.direction === dir) && nrm(r.contains).split(/[،,|]/).map((x) => x.trim()).filter(Boolean).some((alt) => alt.split(" ").every((w) => text.includes(w)))) || null;
}
/** Several book entries that add up to one bank line (a day's card settlement, a batch transfer): smallest set, nearest dates. */
export function groupFor(s: any, candidates: any[], used: Set<string>, windowDays: number) {
  const amt = Math.abs(Number(s.amount)); const side = Number(s.amount) > 0 ? "debit" : "credit";
  const day = Date.parse(String(s.date instanceof Date ? s.date.toISOString() : s.date).slice(0, 10));
  const pool = candidates.filter((c) => !used.has(c.id) && Number(c[side]) > 0 && Number(c[side]) < amt - 0.004)
    .map((c) => ({ c, v: Math.round(Number(c[side]) * 100), dist: Math.abs((Date.parse(String(c.date instanceof Date ? c.date.toISOString() : c.date).slice(0, 10)) - day) / 86400000) }))
    .filter((x) => x.dist <= windowDays).sort((a, b) => a.dist - b.dist || b.v - a.v).slice(0, 22);
  const target = Math.round(amt * 100); let best: typeof pool | null = null; let steps = 0;
  const walk = (i: number, left: number, pick: typeof pool) => {
    if (++steps > 60000 || (best && pick.length >= best.length)) return;
    if (left === 0) { best = [...pick]; return; }
    if (i >= pool.length || left < 0 || pick.length >= 8) return;
    pick.push(pool[i]); walk(i + 1, left - pool[i].v, pick); pick.pop();
    walk(i + 1, left, pick);
  };
  walk(0, target, []);
  return best && (best as typeof pool).length > 1 ? (best as typeof pool).map((x) => x.c) : null;
}
export async function matchGroup(t: Db, C: string, statementLineId: string, lineIds: string[]) {
  const s = await t.one(`SELECT * FROM bank_statement_lines WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id(statementLineId), C], "سطر الكشف غير موجود");
  if (s.status !== "OPEN") throw bad("سطر الكشف مطابَق مسبقاً");
  const ids = [...new Set((lineIds || []).filter((x) => UUID.test(x)))];
  if (ids.length < 2) throw bad("اختر حركتين على الأقل");
  const ls = await t.rows(`SELECT l.id, l.debit, l.credit FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id LEFT JOIN bank_cleared_lines c ON c.line_id=l.id WHERE l.id = ANY($1::uuid[]) AND l.account_id=$2 AND l.company_id=$3 AND e.status='POSTED' AND c.line_id IS NULL`, [arr(ids), s.accountId, C]);
  if (ls.length !== ids.length) throw bad("إحدى الحركات غير موجودة أو مطابقة من قبل");
  const amt = Number(s.amount); const total = r2(ls.reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0));
  if (Math.abs(total - amt) > 0.005) throw bad(`مجموع الحركات ${total.toFixed(2)} لا يساوي مبلغ سطر الكشف ${amt.toFixed(2)}`);
  const day = String(s.date instanceof Date ? s.date.toISOString() : s.date).slice(0, 10);
  await t.exec(`INSERT INTO bank_cleared_lines(line_id, company_id, cleared_date) SELECT unnest($1::uuid[]), $2, $3 ON CONFLICT (line_id) DO UPDATE SET cleared_date=EXCLUDED.cleared_date`, [arr(ids), C, day]);
  await t.exec(`UPDATE bank_statement_lines SET status='MATCHED', matched_line_id=$2, matched_line_ids=$3::uuid[] WHERE id=$1`, [s.id, ids[0], arr(ids)]);
  return { ok: true, lines: ids.length };
}
/** Book a bank line that is not in the books yet (fee, interest, settlement difference) and match it in the same step. */
export async function postStatementLine(t: Db, C: string, user: string, statementLineId: string, b: any) {
  const s = await t.one(`SELECT * FROM bank_statement_lines WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id(statementLineId), C], "سطر الكشف غير موجود");
  if (s.status !== "OPEN") throw bad("سطر الكشف مطابَق مسبقاً");
  const acc = await t.one(`SELECT id, type, name_ar FROM accounts WHERE id=$1 AND company_id=$2 AND NOT is_group AND is_active AND NOT is_cash_bank`, [id(b.accountId), C], "اختر الحساب المقابل");
  const amt = Number(s.amount), abs = Math.abs(amt); const day = String(s.date instanceof Date ? s.date.toISOString() : s.date).slice(0, 10);
  const memo = String(b.memo || s.description || acc.nameAr).slice(0, 200);
  let entryId: string;
  if (amt < 0 && acc.type === "EXPENSE") {
    // through the expenses register, so its VAT reaches the return
    const e = await createExpense(t, C, user, { date: day, accountId: acc.id, amount: abs, taxCode: ["S", "O", "E", "Z"].includes(b.taxCode) ? b.taxCode : "O", amountIncludesVat: true, payAccountId: s.accountId, description: memo, supplierRef: s.reference || null, payee: b.payee || null } as any);
    entryId = e.journalId;
  } else {
    const e = await manualJournal(t, C, user, { date: day, memo, reference: s.reference || undefined, lines: amt > 0 ? [{ accountId: s.accountId, debit: abs, credit: 0, description: memo }, { accountId: acc.id, debit: 0, credit: abs, description: memo }] : [{ accountId: acc.id, debit: abs, credit: 0, description: memo }, { accountId: s.accountId, debit: 0, credit: abs, description: memo }] });
    entryId = e!.id;
  }
  const line = await t.one(`SELECT id FROM journal_lines WHERE entry_id=$1 AND account_id=$2 LIMIT 1`, [entryId, s.accountId]);
  await confirmMatch(t, C, s.id, line.id);
  await t.exec(`UPDATE bank_statement_lines SET posted_entry_id=$2 WHERE id=$1`, [s.id, entryId]);
  const e = await t.one(`SELECT number FROM journal_entries WHERE id=$1`, [entryId]);
  return { ok: true, entryId, number: e.number };
}
/** Reconciliation statement at a date: bank balance → adjusted for what the bank has not seen yet = book balance, and what the books have not seen. */
export async function bankReport(t: Db, C: string, accountId: string, q: any) {
  const acc = await t.one(`SELECT id, code, name_ar, bank_name, iban FROM accounts WHERE id=$1 AND company_id=$2 AND is_cash_bank`, [id(accountId), C], "الحساب غير موجود");
  const to = isDate(q.to) ? q.to : today();
  const lines = await t.rows(`SELECT l.id, e.number, e.date, e.type, COALESCE(l.description, e.memo) memo, e.reference, l.debit, l.credit, c.cleared_date FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id LEFT JOIN bank_cleared_lines c ON c.line_id=l.id WHERE l.account_id=$1 AND e.status='POSTED' AND e.date <= $2 ORDER BY e.date, e.created_at`, [acc.id, to]);
  const book = r2(lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0));
  const open = lines.filter((l) => !l.clearedDate || String(l.clearedDate instanceof Date ? l.clearedDate.toISOString() : l.clearedDate).slice(0, 10) > to);
  const inTransit = open.filter((l) => Number(l.debit) > 0), outstanding = open.filter((l) => Number(l.credit) > 0);
  const sIn = r2(inTransit.reduce((s, l) => s + Number(l.debit), 0)), sOut = r2(outstanding.reduce((s, l) => s + Number(l.credit), 0));
  const bankOnly = await t.rows(`SELECT id, date, description, reference, amount FROM bank_statement_lines WHERE company_id=$1 AND account_id=$2 AND status='OPEN' AND date <= $3 ORDER BY date`, [C, acc.id, to]);
  const sBank = r2(bankOnly.reduce((s, l) => s + Number(l.amount), 0));
  const last = await t.maybe(`SELECT balance, date FROM bank_statement_lines WHERE company_id=$1 AND account_id=$2 AND date <= $3 AND balance IS NOT NULL ORDER BY date DESC, created_at DESC LIMIT 1`, [C, acc.id, to]);
  const stmt = q.statementBalance !== undefined && q.statementBalance !== "" ? r2(num(q.statementBalance)) : last ? Number(last.balance) : null;
  const adjustedBank = stmt === null ? null : r2(stmt + sIn - sOut);
  const adjustedBook = r2(book + sBank);
  const rec = await t.maybe(`SELECT statement_date, statement_balance, difference, created_by FROM bank_reconciliations WHERE company_id=$1 AND account_id=$2 ORDER BY statement_date DESC LIMIT 1`, [C, acc.id]);
  return { account: acc, to, bookBalance: book, statementBalance: stmt, statementBalanceFrom: q.statementBalance !== undefined && q.statementBalance !== "" ? "input" : last ? "statement" : null,
    depositsInTransit: { total: sIn, rows: inTransit.slice(0, 300) }, outstandingPayments: { total: sOut, rows: outstanding.slice(0, 300) }, bankOnly: { total: sBank, rows: bankOnly.slice(0, 300) },
    adjustedBank, adjustedBook, difference: adjustedBank === null ? null : r2(adjustedBank - adjustedBook), reconciled: adjustedBank !== null && Math.abs(adjustedBank - adjustedBook) < 0.005, lastReconciliation: rec };
}

// ─── month-end close cockpit ───────────────────────────────────────────────
type Level = "ok" | "warn" | "block" | "info";
const MANUAL: [string, string][] = [["tb", "مراجعة ميزان المراجعة ومقارنته بالشهر السابق"], ["subledgers", "مطابقة كشوف كبار العملاء والموردين مع أرصدتهم"], ["accruals", "تسجيل المصروفات المستحقة وإطفاء المدفوع مقدماً"], ["cashcount", "جرد الصندوق فعلياً ومطابقته برصيد الدفاتر"], ["review", "مراجعة قائمة الدخل وتفسير الانحرافات الكبيرة"], ["backup", "أخذ نسخة احتياطية بعد اكتمال الشهر"]];
export async function closeCockpit(t: Db, C: string, periodId?: string) {
  const periods = await t.rows(`SELECT p.id, p.name, p.start_date, p.end_date, p.status, y.name year_name, y.status year_status FROM periods p JOIN fiscal_years y ON y.id=p.fiscal_year_id WHERE p.company_id=$1 AND p.start_date <= CURRENT_DATE ORDER BY p.start_date DESC LIMIT 36`, [C]);
  if (!periods.length) return { periods: [], period: null, items: [], manual: [], progress: 0 };
  // default: the oldest open month that has entries — that is the one waiting to be closed
  const withData = await t.rows(`SELECT DISTINCT p.id FROM periods p JOIN journal_entries e ON e.company_id=p.company_id AND e.status='POSTED' AND e.date BETWEEN p.start_date AND p.end_date WHERE p.company_id=$1`, [C]);
  const has = new Set(withData.map((x) => x.id));
  const pick = periods.find((p) => p.id === periodId) || [...periods].reverse().find((p) => p.status === "OPEN" && has.has(p.id) && String(p.endDate instanceof Date ? p.endDate.toISOString() : p.endDate).slice(0, 10) < today()) || periods[0];
  const D = (v: any) => String(v instanceof Date ? v.toISOString() : v).slice(0, 10);
  const from = D(pick.startDate), to = D(pick.endDate);
  const items: { key: string; label: string; level: Level; detail?: string; to?: string }[] = [];
  const it = (key: string, label: string, level: Level, detail?: string, link?: string) => items.push({ key, label, level, detail, to: link });
  const one = (sql: string, params: any[]) => t.one(sql, params);

  const drafts = await one(`SELECT COUNT(*) FILTER (WHERE direction='SALE')::int s, COUNT(*) FILTER (WHERE direction='PURCHASE')::int p FROM invoices WHERE company_id=$1 AND status='DRAFT' AND kind IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE') AND date BETWEEN $2 AND $3`, [C, from, to]);
  it("drafts", "كل فواتير الشهر مرحّلة", drafts.s + drafts.p ? "block" : "ok", drafts.s + drafts.p ? `مسودات: مبيعات ${drafts.s}، مشتريات ${drafts.p}` : undefined, drafts.s ? "/sales/invoices" : "/purchases/invoices");
  const parked = await one(`SELECT COUNT(*) FILTER (WHERE status='SUBMITTED')::int s, COUNT(*) FILTER (WHERE status IN ('DRAFT','REJECTED'))::int d FROM journal_drafts WHERE company_id=$1 AND date BETWEEN $2 AND $3`, [C, from, to]);
  it("parked", "لا توجد قيود معلّقة بانتظار الاعتماد", parked.s ? "block" : parked.d ? "warn" : "ok", parked.s + parked.d ? `بانتظار الاعتماد ${parked.s}، مسودات ${parked.d}` : undefined, "/journal-approvals");
  const pos = await one(`SELECT COUNT(*)::int c FROM pos_sessions WHERE company_id=$1 AND status='OPEN' AND opened_at::date <= $2`, [C, to]);
  it("pos", "ورديات نقاط البيع مغلقة", pos.c ? "block" : "ok", pos.c ? `${pos.c} وردية مفتوحة` : undefined, "/pos");
  const rec = await t.rows(`SELECT name, next_date FROM recurring_templates WHERE company_id=$1 AND is_active AND next_date <= $2 AND (end_date IS NULL OR end_date >= next_date)`, [C, to]);
  it("recurring", "القيود والمصروفات الدورية المستحقة نُفّذت", rec.length ? "warn" : "ok", rec.length ? rec.slice(0, 4).map((r) => r.name).join("، ") + (rec.length > 4 ? ` و${rec.length - 4} أخرى` : "") : undefined, "/recurring");
  const dep = await t.rows(`SELECT code FROM fixed_assets WHERE company_id=$1 AND status='ACTIVE' AND acquisition_date <= $2 AND (last_depreciation IS NULL OR last_depreciation < $3) AND accumulated < cost - COALESCE(salvage_value,0)`, [C, to, monthEnd(to)]);
  it("depreciation", "إهلاك الأصول الثابتة محسوب حتى نهاية الشهر", dep.length ? "warn" : "ok", dep.length ? `${dep.length} أصل لم يُهلك لهذا الشهر` : undefined, "/assets");
  const emp = await one(`SELECT COUNT(*)::int c FROM employees WHERE company_id=$1 AND is_active AND hire_date <= $2`, [C, to]);
  if (emp.c) {
    const run = await t.maybe(`SELECT status FROM payroll_runs WHERE company_id=$1 AND period=$2 ORDER BY (status='DRAFT') LIMIT 1`, [C, from.slice(0, 7)]);
    it("payroll", "مسير رواتب الشهر مرحّل", !run ? "warn" : run.status === "DRAFT" ? "warn" : "ok", !run ? `${emp.c} موظف — لا يوجد مسير لشهر ${from.slice(0, 7)}` : run.status === "DRAFT" ? "المسير محفوظ ولم يُرحَّل" : undefined, "/payroll");
  }
  const banks = await t.rows(
    `SELECT a.code, a.name_ar, (SELECT COUNT(*)::int FROM bank_statement_lines s WHERE s.account_id=a.id AND s.status='OPEN' AND s.date <= $3) open_lines,
        EXISTS (SELECT 1 FROM bank_reconciliations r WHERE r.company_id=$1 AND r.account_id=a.id AND r.statement_date >= $4) done
     FROM accounts a WHERE a.company_id=$1 AND a.subtype='BANK' AND a.is_cash_bank AND a.system_key IS DISTINCT FROM 'CARD_CLEARING' AND a.system_key IS DISTINCT FROM 'ESTORE_CLEARING'
       AND EXISTS (SELECT 1 FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id=a.id AND e.status='POSTED' AND e.date BETWEEN $2 AND $3)`, [C, from, to, addDays(to, -6)]);
  const notRec = banks.filter((b) => !b.done || b.openLines);
  it("bank", "كشوف البنوك مطابقة ومعتمدة حتى نهاية الشهر", notRec.length ? "warn" : "ok", notRec.length ? notRec.map((b) => `${b.nameAr}${b.openLines ? ` (${b.openLines} سطر كشف مفتوح)` : " (لا تسوية معتمدة)"}`).join("، ") : banks.length ? undefined : "لا حركة بنكية في الشهر", "/bank");
  const vat = await one(`SELECT EXISTS (SELECT 1 FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id JOIN accounts a ON a.id=l.account_id WHERE e.company_id=$1 AND e.status='POSTED' AND e.date BETWEEN $2 AND $3 AND a.system_key IN ('VAT_OUT','VAT_IN') AND e.type<>'VAT_SETTLEMENT') act, EXISTS (SELECT 1 FROM vat_returns v WHERE v.company_id=$1 AND v.status='FILED' AND v.period_from <= $2 AND v.period_to >= $3) filed`, [C, from, to]);
  if (vat.act) it("vat", "الإقرار الضريبي للفترة مقدَّم ومسوّى", vat.filed ? "ok" : "info", vat.filed ? undefined : "لم يُقدَّم إقرار يغطي هذا الشهر بعد (شهري أو ربع سنوي حسب دوريتك)", "/vat");
  const neg = await one(`SELECT COUNT(*)::int c FROM stock_balances WHERE company_id=$1 AND qty < -0.0001`, [C]);
  it("negStock", "لا توجد كميات مخزون سالبة", neg.c ? "warn" : "ok", neg.c ? `${neg.c} صنف برصيد سالب — تكلفة مبيعاته غير دقيقة` : undefined, "/inventory?tab=adj");
  const negCash = await t.rows(`SELECT a.name_ar, SUM(l.debit-l.credit) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND a.is_cash_bank AND e.status='POSTED' AND e.date <= $2 GROUP BY a.name_ar HAVING SUM(l.debit-l.credit) < -0.005`, [C, to]);
  it("negCash", "لا يوجد صندوق أو بنك برصيد سالب في نهاية الشهر", negCash.length ? "warn" : "ok", negCash.length ? negCash.map((x) => `${x.nameAr}: ${Number(x.b).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join("، ") : undefined, "/treasury");
  const noPartner = await one(`SELECT COUNT(*)::int c FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE l.company_id=$1 AND a.system_key IN ('AR','AP') AND e.status='POSTED' AND l.partner_id IS NULL AND e.type NOT IN ('OPENING','CLOSING') AND e.date BETWEEN $2 AND $3`, [C, from, to]);
  it("noPartner", "كل سطور العملاء والموردين محددة الطرف", noPartner.c ? "warn" : "ok", noPartner.c ? `${noPartner.c} سطر بلا عميل/مورد` : undefined, "/journals");
  const ig = await integrity(t, C);
  const failed = ig.checks.filter((x: any) => !x.ok);
  it("integrity", "الدفاتر المساعدة تطابق الأستاذ العام", failed.length ? "block" : "ok", failed.length ? failed.map((x: any) => x.name).slice(0, 3).join(" | ") : `${ig.checks.length} فحصاً`, "/reports/integrity");
  const prevOpen = await t.rows(`SELECT name FROM periods p WHERE p.company_id=$1 AND p.status='OPEN' AND p.end_date < $2 AND EXISTS (SELECT 1 FROM journal_entries e WHERE e.company_id=$1 AND e.status='POSTED' AND e.date BETWEEN p.start_date AND p.end_date) ORDER BY p.start_date`, [C, from]);
  it("prev", "الأشهر السابقة مقفلة", prevOpen.length ? "info" : "ok", prevOpen.length ? `ما زال مفتوحاً: ${prevOpen.slice(0, 6).map((x) => x.name).join("، ")}` : undefined);

  const saved = await t.rows(`SELECT key, done, note, done_by, done_at FROM period_close_tasks WHERE period_id=$1 AND company_id=$2`, [pick.id, C]);
  const manual = MANUAL.map(([key, label]) => { const s = saved.find((x) => x.key === key); return { key, label, done: !!s?.done, note: s?.note || null, doneBy: s?.doneBy || null, doneAt: s?.doneAt || null }; });
  const totals = await one(`SELECT COUNT(DISTINCT e.id)::int entries, COALESCE(SUM(CASE WHEN a.type='REVENUE' THEN l.credit-l.debit END),0) revenue, COALESCE(SUM(CASE WHEN a.type='EXPENSE' THEN l.debit-l.credit END),0) expense FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id JOIN accounts a ON a.id=l.account_id WHERE e.company_id=$1 AND e.status='POSTED' AND e.type<>'CLOSING' AND e.date BETWEEN $2 AND $3`, [C, from, to]);
  const autoDone = items.filter((i) => i.level === "ok" || i.level === "info").length, doneAll = autoDone + manual.filter((m) => m.done).length;
  return { periods: periods.map((p) => ({ id: p.id, name: p.name, year: p.yearName, status: p.status, from: D(p.startDate), to: D(p.endDate), hasEntries: has.has(p.id) })),
    period: { id: pick.id, name: pick.name, year: pick.yearName, yearStatus: pick.yearStatus, status: pick.status, from, to, ended: to < today() }, items, manual,
    blockers: items.filter((i) => i.level === "block").length, warnings: items.filter((i) => i.level === "warn").length, progress: Math.round((doneAll / (items.length + manual.length)) * 100),
    totals: { entries: totals.entries, revenue: r2(totals.revenue), expense: r2(totals.expense), net: r2(totals.revenue - totals.expense) } };
}
export async function setCloseTask(t: Db, C: string, periodId: string, key: string, b: any, user: string) {
  if (!MANUAL.some(([k]) => k === key)) throw bad("بند غير معروف");
  await t.one(`SELECT id FROM periods WHERE id=$1 AND company_id=$2`, [id(periodId), C], "الفترة غير موجودة");
  const done = !!b.done, note = b.note === undefined ? undefined : String(b.note || "").slice(0, 300) || null;
  await t.exec(`INSERT INTO period_close_tasks(period_id, company_id, key, done, note, done_by, done_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (period_id, key) DO UPDATE SET done=EXCLUDED.done, note=COALESCE($5, period_close_tasks.note), done_by=EXCLUDED.done_by, done_at=EXCLUDED.done_at`, [id(periodId), C, key, done, note ?? null, done ? user : null, done ? new Date() : null]);
  return { ok: true };
}
/** Lock a month: refused while a blocking check is open, unless explicitly forced (recorded in the audit trail by the caller). */
export async function lockPeriod(t: Db, C: string, periodId: string, lock: boolean, force: boolean) {
  const p = await t.one(`SELECT p.*, y.status year_status FROM periods p JOIN fiscal_years y ON y.id=p.fiscal_year_id WHERE p.id=$1 AND p.company_id=$2 FOR UPDATE OF p`, [id(periodId), C], "الفترة غير موجودة");
  if (!lock) { if (p.yearStatus === "CLOSED") throw conflict("السنة المالية مقفلة — أعد فتح السنة أولاً"); await t.exec(`UPDATE periods SET status='OPEN' WHERE id=$1`, [p.id]); return { ok: true, status: "OPEN" }; }
  const c = await closeCockpit(t, C, p.id);
  if (c.blockers && !force) throw conflict(`لا يُقفل الشهر وفيه ${c.blockers} بند مانع: ${c.items.filter((i: any) => i.level === "block").map((i: any) => i.label).join("، ")}`);
  await t.exec(`UPDATE periods SET status='LOCKED' WHERE id=$1`, [p.id]);
  return { ok: true, status: "LOCKED", blockers: c.blockers, warnings: c.warnings };
}

// ─── cost allocation ───────────────────────────────────────────────────────
export async function listAllocations(t: Db, C: string) {
  const rows = await t.rows(`SELECT a.*, c.name source_name, (SELECT json_agg(json_build_object('id', r.id, 'from', r.period_from, 'to', r.period_to, 'amount', r.amount, 'journalId', r.journal_id, 'number', e.number, 'reversed', e.reversed_by IS NOT NULL, 'by', r.created_by) ORDER BY r.created_at DESC) FROM cost_allocation_runs r LEFT JOIN journal_entries e ON e.id=r.journal_id WHERE r.allocation_id=a.id) runs FROM cost_allocations a LEFT JOIN cost_centers c ON c.id=a.source_cc WHERE a.company_id=$1 ORDER BY a.created_at`, [C]);
  const ccs = await t.rows(`SELECT id, code, name FROM cost_centers WHERE company_id=$1 AND is_active ORDER BY code`, [C]);
  return { rows: rows.map((r) => ({ ...r, runs: r.runs || [], targets: (r.targets || []).map((x: any) => ({ ...x, name: ccs.find((c) => c.id === x.costCenterId)?.name || "—" })) })), costCenters: ccs };
}
export async function saveAllocation(t: Db, C: string, b: any, allocId?: string) {
  const name = String(b.name || "").trim().slice(0, 100); if (!name) throw bad("اسم قاعدة التوزيع مطلوب");
  const targets = (Array.isArray(b.targets) ? b.targets : []).map((x: any) => ({ costCenterId: id(x.costCenterId), pct: r2(num(x.pct)) })).filter((x: any) => x.costCenterId !== NIL && x.pct > 0);
  if (!targets.length) throw bad("حدد مراكز التكلفة المستفيدة ونسبة كل منها");
  if (new Set(targets.map((x: any) => x.costCenterId)).size !== targets.length) throw bad("مركز تكلفة مكرر في التوزيع");
  if (Math.abs(targets.reduce((s: number, x: any) => s + x.pct, 0) - 100) > 0.01) throw bad("مجموع النسب يجب أن يساوي 100%");
  const source = UUID.test(b.sourceCc || "") ? b.sourceCc : null;
  if (source && targets.some((x: any) => x.costCenterId === source)) throw bad("المركز المصدر لا يكون ضمن المستفيدين");
  const ok = await t.rows(`SELECT id FROM cost_centers WHERE company_id=$1 AND id = ANY($2::uuid[])`, [C, arr([...targets.map((x: any) => x.costCenterId), ...(source ? [source] : [])])]);
  if (ok.length !== targets.length + (source ? 1 : 0)) throw bad("مركز تكلفة غير موجود");
  const accountIds = Array.isArray(b.accountIds) && b.accountIds.filter((x: any) => UUID.test(x)).length ? arr(b.accountIds) : null;
  const data = { name, sourceCc: source, accountIds, targets: JSON.stringify(targets), isActive: b.isActive !== false };
  if (allocId) { const r = await t.update("cost_allocations", { id: id(allocId), companyId: C }, data); if (!r) throw notFound("القاعدة غير موجودة"); return r; }
  return t.insert("cost_allocations", { companyId: C, ...data });
}
/** What the rule would move for a period: the net expense still sitting on the source, per account, and each target's share. */
export async function allocationPreview(t: Db, C: string, allocId: string, from: string, to: string) {
  if (!isDate(from) || !isDate(to) || from > to) throw bad("حدد فترة صحيحة");
  const a = await t.one(`SELECT * FROM cost_allocations WHERE id=$1 AND company_id=$2`, [id(allocId), C], "القاعدة غير موجودة");
  const params: any[] = [C, from, to]; let w = a.sourceCc ? (params.push(a.sourceCc), `l.cost_center_id=$${params.length}`) : "l.cost_center_id IS NULL";
  if (a.accountIds?.length) { params.push(arr(a.accountIds)); w += ` AND l.account_id = ANY($${params.length}::uuid[])`; }
  const rows = await t.rows(`SELECT ac.id, ac.code, ac.name_ar, SUM(l.debit-l.credit) amount FROM journal_lines l JOIN accounts ac ON ac.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE l.company_id=$1 AND ac.type='EXPENSE' AND ac.subtype<>'COGS' AND e.status='POSTED' AND e.type<>'CLOSING' AND e.date BETWEEN $2 AND $3 AND ${w} GROUP BY ac.id, ac.code, ac.name_ar HAVING ABS(SUM(l.debit-l.credit)) > 0.005 ORDER BY ac.code`, params);
  const targets: any[] = a.targets || [];
  const ccs = await t.rows(`SELECT id, name FROM cost_centers WHERE company_id=$1`, [C]);
  const accounts = rows.map((r) => {
    const amount = r2(r.amount); let left = amount;
    const shares = targets.map((x, i) => { const v = i === targets.length - 1 ? r2(left) : r2((amount * x.pct) / 100); left = r2(left - v); return { costCenterId: x.costCenterId, amount: v }; });
    return { id: r.id, code: r.code, name: r.nameAr, amount, shares };
  });
  const total = r2(accounts.reduce((s, x) => s + x.amount, 0));
  return { allocation: { id: a.id, name: a.name, sourceCc: a.sourceCc, sourceName: a.sourceCc ? ccs.find((c) => c.id === a.sourceCc)?.name : "غير موزع على مركز تكلفة" }, from, to, total, accounts,
    targets: targets.map((x) => ({ costCenterId: x.costCenterId, name: ccs.find((c) => c.id === x.costCenterId)?.name || "—", pct: x.pct, amount: r2(accounts.reduce((s, ac) => s + (ac.shares.find((sh) => sh.costCenterId === x.costCenterId)?.amount || 0), 0)) })) };
}
export async function runAllocation(t: Db, C: string, user: string, allocId: string, from: string, to: string) {
  const p = await allocationPreview(t, C, allocId, from, to);
  if (!p.accounts.length || Math.abs(p.total) < 0.005) throw bad("لا توجد مصروفات على المصدر في هذه الفترة — ربما وُزّعت من قبل");
  const lines: any[] = [];
  for (const ac of p.accounts) {
    const memo = `توزيع ${ac.name}`;
    // take the amount off the source (same account, source centre) and put each share on its centre: the account totals do not change
    lines.push(ac.amount > 0 ? { account: ac.id, debit: 0, credit: ac.amount, costCenterId: p.allocation.sourceCc, description: memo } : { account: ac.id, debit: -ac.amount, credit: 0, costCenterId: p.allocation.sourceCc, description: memo });
    for (const sh of ac.shares) if (Math.abs(sh.amount) > 0.004) lines.push(sh.amount > 0 ? { account: ac.id, debit: sh.amount, credit: 0, costCenterId: sh.costCenterId, description: memo } : { account: ac.id, debit: 0, credit: -sh.amount, costCenterId: sh.costCenterId, description: memo });
  }
  const e = await post(t, C, { date: to, type: "MANUAL", sourceType: "ALLOCATION", sourceId: p.allocation.id, memo: `توزيع تكاليف: ${p.allocation.name} (${from} → ${to})`, reference: "ALLOC", createdBy: user, lines });
  const run = await t.insert("cost_allocation_runs", { companyId: C, allocationId: p.allocation.id, periodFrom: from, periodTo: to, amount: p.total, journalId: e!.id, createdBy: user });
  return { ok: true, runId: run.id, entryId: e!.id, number: e!.number, total: p.total };
}

// ─── cost-volume-profit ────────────────────────────────────────────────────
export async function cvp(t: Db, C: string, q: any) {
  const to = isDate(q.to) ? q.to : today(); const from = isDate(q.from) ? q.from : `${to.slice(0, 4)}-01-01`;
  const rows = await t.rows(`SELECT a.id, a.code, a.name_ar, a.type, a.subtype, a.cost_behavior, SUM(CASE WHEN a.type='REVENUE' THEN l.credit-l.debit ELSE l.debit-l.credit END) amount FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE l.company_id=$1 AND a.type IN ('REVENUE','EXPENSE') AND e.status='POSTED' AND e.type<>'CLOSING' AND e.date BETWEEN $2 AND $3 GROUP BY a.id HAVING ABS(SUM(l.debit-l.credit)) > 0.005 ORDER BY a.code`, [C, from, to]);
  const behave = (a: any) => a.costBehavior === "FIXED" || a.costBehavior === "VARIABLE" || a.costBehavior === "MIXED" ? a.costBehavior : a.subtype === "COGS" ? "VARIABLE" : "FIXED";
  const sales = r2(rows.filter((r) => r.type === "REVENUE").reduce((s, r) => s + Number(r.amount), 0));
  const costs = rows.filter((r) => r.type === "EXPENSE").map((r) => { const b = behave(r), amount = r2(r.amount); return { id: r.id, code: r.code, name: r.nameAr, amount, behavior: b, isDefault: !r.costBehavior, variable: b === "VARIABLE" ? amount : b === "MIXED" ? r2(amount / 2) : 0, fixed: b === "FIXED" ? amount : b === "MIXED" ? r2(amount - r2(amount / 2)) : 0 }; });
  const variable = r2(costs.reduce((s, c) => s + c.variable, 0)), fixed = r2(costs.reduce((s, c) => s + c.fixed, 0));
  const cm = r2(sales - variable); const cmRatio = sales > 0 ? cm / sales : 0;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const breakEven = cmRatio > 0 ? r2(fixed / cmRatio) : null;
  const target = Math.max(0, num(q.targetProfit));
  return { from, to, days, sales, variable, contribution: cm, cmRatio: Math.round(cmRatio * 10000) / 100, fixed, profit: r2(cm - fixed), breakEven, breakEvenMonthly: breakEven === null ? null : r2((breakEven / days) * 30.4375), breakEvenDaily: breakEven === null ? null : r2(breakEven / days),
    safety: breakEven === null || sales <= 0 ? null : Math.round(((sales - breakEven) / sales) * 10000) / 100, operatingLeverage: cm - fixed > 0 ? Math.round((cm / (cm - fixed)) * 100) / 100 : null,
    targetProfit: target, salesForTarget: cmRatio > 0 ? r2((fixed + target) / cmRatio) : null, costs };
}
export async function setBehavior(t: Db, C: string, accountId: string, behavior: any) {
  const v = ["FIXED", "VARIABLE", "MIXED"].includes(behavior) ? behavior : null;
  const n = await t.exec(`UPDATE accounts SET cost_behavior=$3 WHERE id=$1 AND company_id=$2 AND type='EXPENSE'`, [id(accountId), C, v]);
  if (!n) throw notFound("حساب المصروف غير موجود");
  return { ok: true, behavior: v };
}
