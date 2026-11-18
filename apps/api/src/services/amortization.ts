/**
 * Amortisation schedules — one amount spread evenly over the months it covers.
 *
 *  PREPAID  (مصروف مدفوع مقدماً): a year's rent, insurance or subscription paid in advance sits in the prepaid asset and
 *           moves to its expense one month at a time:      Dr expense / Cr prepaid expenses.
 *  DEFERRED (إيراد مؤجل): money received for a service still to be delivered sits in deferred revenue and becomes
 *           revenue as each month is earned:               Dr deferred revenue / Cr revenue.
 *
 * The amount may already be in the balance-sheet account, or the payment / receipt is recorded with the schedule
 * (with its VAT). Each month is posted at month end; the last month takes the rounding remainder, so the months add up
 * to the total exactly. Posting is idempotent per month (amortization_posts is unique on schedule + month).
 */
import { Db } from "../db/pool";
import { bad, conflict, isDate, today, addMonths, monthEnd, r2, num, D, DEMO_LOADING } from "../lib/core";
import { post, nextNumber, reverse } from "../accounting/engine";

export type AmortInput = {
  kind: "PREPAID" | "DEFERRED"; name: string; total: number; months: number; startDate: string;
  sourceAccountId?: string; targetAccountId: string; costCenterId?: string | null; partnerId?: string | null; branchId?: string | null;
  auto?: boolean; notes?: string; payAccountId?: string | null; vat?: number; isDemo?: boolean;
};

const KIND_AR = { PREPAID: "مصروف مدفوع مقدماً", DEFERRED: "إيراد مؤجل" } as const;

/** The month-end dates and amounts of a schedule: equal months, the remainder on the last one. */
export function scheduleOf(total: number, months: number, startDate: string) {
  const each = r2(D(total).div(months));
  const out: { periodEnd: string; amount: number }[] = [];
  let used = D(0);
  for (let i = 0; i < months; i++) {
    const amount = i === months - 1 ? r2(D(total).minus(used)) : each;
    used = used.plus(amount);
    out.push({ periodEnd: monthEnd(addMonths(startDate.slice(0, 7) + "-01", i)), amount });
  }
  return out;
}

async function account(t: Db, C: string, id: string | null | undefined, what: string) {
  if (!id) throw bad(`${what} مطلوب`);
  const a = await t.maybe(`SELECT id, code, name_ar, type, is_group, is_active, is_cash_bank FROM accounts WHERE id=$1 AND company_id=$2`, [id, C]);
  if (!a) throw bad(`${what}: الحساب غير موجود`);
  if (a.isGroup || !a.isActive) throw bad(`${what}: الحساب ${a.code} ${a.nameAr} رئيسي أو موقوف`);
  return a;
}

export async function createAmortization(t: Db, C: string, user: string, b: AmortInput) {
  const kind = b.kind === "DEFERRED" ? "DEFERRED" : b.kind === "PREPAID" ? "PREPAID" : null;
  if (!kind) throw bad("اختر النوع: مصروف مدفوع مقدماً أو إيراد مؤجل");
  const name = String(b.name || "").trim().slice(0, 200);
  if (!name) throw bad("اكتب وصف الجدول (مثال: إيجار المعرض لسنة)");
  const total = r2(num(b.total)), months = Math.trunc(num(b.months)), vat = r2(num(b.vat));
  if (!(total > 0)) throw bad("المبلغ يجب أن يكون أكبر من صفر");
  if (!(months >= 1 && months <= 120)) throw bad("عدد الأشهر بين 1 و120");
  if (vat < 0) throw bad("الضريبة لا تكون سالبة");
  if (!isDate(b.startDate)) throw bad("تاريخ البداية غير صحيح");

  const srcId = b.sourceAccountId || (await t.maybe(`SELECT id FROM accounts WHERE company_id=$1 AND system_key=$2`, [C, kind === "PREPAID" ? "PREPAID" : "DEFERRED_REVENUE"]))?.id;
  const src = await account(t, C, srcId, kind === "PREPAID" ? "حساب المصروفات المدفوعة مقدماً" : "حساب الإيرادات المؤجلة");
  const tgt = await account(t, C, b.targetAccountId, kind === "PREPAID" ? "حساب المصروف" : "حساب الإيراد");
  if (kind === "PREPAID" && (src.type !== "ASSET" || tgt.type !== "EXPENSE")) throw bad("المصروف المدفوع مقدماً: الحساب الوسيط من الأصول وحساب الإطفاء من المصروفات");
  if (kind === "DEFERRED" && (src.type !== "LIABILITY" || tgt.type !== "REVENUE")) throw bad("الإيراد المؤجل: الحساب الوسيط من الخصوم وحساب الإطفاء من الإيرادات");
  if (b.costCenterId && !(await t.maybe(`SELECT 1 FROM cost_centers WHERE id=$1 AND company_id=$2`, [b.costCenterId, C]))) throw bad("مركز التكلفة غير موجود");
  if (b.partnerId && !(await t.maybe(`SELECT 1 FROM partners WHERE id=$1 AND company_id=$2`, [b.partnerId, C]))) throw bad("الطرف غير موجود");

  const number = await nextNumber(t, C, "AMR", b.startDate);
  // the payment (prepaid) or receipt (deferred) recorded with the schedule, on its start date
  let payEntryId: string | null = null;
  if (b.payAccountId) {
    const cash = await account(t, C, b.payAccountId, "حساب الصندوق أو البنك");
    if (!cash.isCashBank) throw bad("حساب الدفع يجب أن يكون صندوقاً أو حساباً بنكياً");
    const gross = r2(total + vat);
    const lines = kind === "PREPAID"
      ? [{ account: src.id, debit: total, description: name }, ...(vat ? [{ key: "VAT_IN", debit: vat, description: `ضريبة مدخلات — ${name}` }] : []), { account: cash.id, credit: gross, description: name, partnerId: b.partnerId || null }]
      : [{ account: cash.id, debit: gross, description: name, partnerId: b.partnerId || null }, { account: src.id, credit: total, description: name }, ...(vat ? [{ key: "VAT_OUT", credit: vat, description: `ضريبة مخرجات — ${name}` }] : [])];
    const e = await post(t, C, { date: b.startDate, type: "AMORTIZATION", sourceType: "AMORTIZATION", reference: number, memo: `${kind === "PREPAID" ? "دفع مقدم" : "قبض مقدم"} — ${name}`, branchId: b.branchId || null, isDemo: b.isDemo, createdBy: user, lines: lines as any });
    payEntryId = e!.id;
  }
  const row = await t.insert("amortizations", {
    companyId: C, number, kind, name, partnerId: b.partnerId || null, total, months, startDate: b.startDate,
    sourceAccountId: src.id, targetAccountId: tgt.id, costCenterId: b.costCenterId || null, branchId: b.branchId || null,
    auto: b.auto !== false, payEntryId, notes: b.notes ? String(b.notes).slice(0, 500) : null, isDemo: !!b.isDemo, createdBy: user,
  });
  if (payEntryId) await t.exec(`UPDATE journal_entries SET source_id=$2 WHERE id=$1`, [payEntryId, row.id]);
  return getAmortization(t, C, row.id);
}

export async function listAmortizations(t: Db, C: string) {
  const rows = await t.rows(
    `SELECT a.*, s.code src_code, s.name_ar src_name, g.code tgt_code, g.name_ar tgt_name, p.name partner_name, c.name cost_center_name
       FROM amortizations a JOIN accounts s ON s.id=a.source_account_id JOIN accounts g ON g.id=a.target_account_id
       LEFT JOIN partners p ON p.id=a.partner_id LEFT JOIN cost_centers c ON c.id=a.cost_center_id
      WHERE a.company_id=$1 ORDER BY (a.status='ACTIVE') DESC, a.start_date DESC, a.number DESC`, [C]);
  const now = today();
  return rows.map((a) => {
    const sch = scheduleOf(Number(a.total), a.months, String(a.startDate));
    const due = a.status === "ACTIVE" ? sch.slice(a.postedMonths).filter((x) => x.periodEnd <= monthEnd(now) && x.periodEnd <= now).length : 0;
    const next = a.status === "ACTIVE" ? sch[a.postedMonths] || null : null;
    return { ...a, total: Number(a.total), postedAmount: Number(a.postedAmount), remaining: r2(Number(a.total) - Number(a.postedAmount)), monthly: sch[0]?.amount || 0, endDate: sch[sch.length - 1].periodEnd, dueMonths: due, next };
  });
}

export async function getAmortization(t: Db, C: string, id: string) {
  const a = (await listAmortizations(t, C)).find((x) => x.id === id);
  if (!a) throw bad("الجدول غير موجود");
  const posts = await t.rows(`SELECT p.period_end, p.amount, e.id entry_id, e.number, e.reversed_by FROM amortization_posts p JOIN journal_entries e ON e.id=p.entry_id WHERE p.amortization_id=$1 ORDER BY p.period_end`, [id]);
  const byEnd = new Map(posts.map((p) => [String(p.periodEnd instanceof Date ? p.periodEnd.toISOString() : p.periodEnd).slice(0, 10), p]));
  const pay = a.payEntryId ? await t.maybe(`SELECT id, number, date FROM journal_entries WHERE id=$1`, [a.payEntryId]) : null;
  let balance = a.total;
  const lines = scheduleOf(a.total, a.months, String(a.startDate)).map((x, i) => {
    const p: any = byEnd.get(x.periodEnd);
    if (p) balance = r2(balance - Number(p.amount));
    return { n: i + 1, periodEnd: x.periodEnd, amount: x.amount, posted: !!p, entryId: p?.entryId || null, entryNumber: p?.number || null, balanceAfter: p ? balance : null };
  });
  return { ...a, payEntry: pay, lines };
}

/** Posts every month that has ended up to `through` (month-end dated), for one schedule or all active ones. */
export async function runAmortization(t: Db, C: string, user: string, through = today(), onlyId?: string, opts: { autoOnly?: boolean } = {}) {
  if (!isDate(through)) throw bad("التاريخ غير صحيح");
  const list = await t.rows(`SELECT * FROM amortizations WHERE company_id=$1 AND status='ACTIVE'${onlyId ? " AND id=$2" : ""}${opts.autoOnly ? " AND auto" : ""} ORDER BY start_date FOR UPDATE`, onlyId ? [C, onlyId] : [C]);
  const done: any[] = [];
  for (const a of list) {
    const sch = scheduleOf(Number(a.total), a.months, String(a.startDate instanceof Date ? a.startDate.toISOString() : a.startDate).slice(0, 10));
    let posted = a.postedMonths, amount = D(a.postedAmount);
    for (const m of sch.slice(posted)) {
      if (m.periodEnd > through) break;
      const e = await postMonth(t, C, user, a, m.periodEnd, m.amount, `${a.name} — ${m.periodEnd.slice(0, 7)} (${posted + 1}/${a.months})`);
      posted++; amount = amount.plus(m.amount);
      done.push({ number: a.number, name: a.name, period: m.periodEnd, amount: m.amount, entry: e.number });
    }
    if (posted !== a.postedMonths) await t.exec(`UPDATE amortizations SET posted_months=$2, posted_amount=$3, status=$4 WHERE id=$1`, [a.id, posted, amount.toFixed(2), posted >= a.months ? "DONE" : "ACTIVE"]);
  }
  return done;
}

async function postMonth(t: Db, C: string, user: string, a: any, date: string, amount: number, memo: string) {
  const exp = { account: a.targetAccountId, costCenterId: a.costCenterId || null, description: memo };
  const lines = a.kind === "PREPAID"
    ? [{ ...exp, debit: amount }, { account: a.sourceAccountId, credit: amount, description: memo }]
    : [{ account: a.sourceAccountId, debit: amount, description: memo }, { ...exp, credit: amount }];
  const e = await post(t, C, { date, type: "AMORTIZATION", sourceType: "AMORTIZATION", sourceId: a.id, reference: a.number, memo: `إطفاء ${KIND_AR[a.kind as "PREPAID"]}: ${memo}`, branchId: a.branchId || null, isDemo: a.isDemo, createdBy: user, lines });
  await t.insert("amortization_posts", { companyId: C, amortizationId: a.id, periodEnd: date, amount, entryId: e!.id });
  return e!;
}

/** Ends a schedule early (contract ended, asset sold…): the whole remaining amount is posted on `date`. */
export async function finishAmortization(t: Db, C: string, user: string, id: string, date: string) {
  if (!isDate(date)) throw bad("التاريخ غير صحيح");
  const a = await t.maybe(`SELECT * FROM amortizations WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, C]);
  if (!a) throw bad("الجدول غير موجود");
  if (a.status !== "ACTIVE") throw conflict("الجدول غير نشط");
  await runAmortization(t, C, user, addDays1(date), id); // months already ended first, each on its own month end
  const b = await t.one(`SELECT * FROM amortizations WHERE id=$1`, [id]);
  const rest = r2(Number(b.total) - Number(b.postedAmount));
  if (b.status === "ACTIVE" && rest > 0) {
    const last = await t.maybe(`SELECT MAX(period_end) d FROM amortization_posts WHERE amortization_id=$1`, [id]);
    const lastD = last?.d ? String(last.d instanceof Date ? last.d.toISOString() : last.d).slice(0, 10) : "";
    if (lastD && date <= lastD) throw bad(`تاريخ الإنهاء يجب أن يكون بعد آخر شهر مُطفأ (${lastD})`);
    await postMonth(t, C, user, b, date, rest, `${b.name} — إنهاء مبكر بالمتبقي`);
    await t.exec(`UPDATE amortizations SET posted_months=months, posted_amount=total, status='DONE' WHERE id=$1`, [id]);
  }
  return getAmortization(t, C, id);
}
const addDays1 = (d: string) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); }; // months that ended before the end date

/** Stops a schedule: nothing more is posted; what is left stays in the balance-sheet account. */
export async function cancelAmortization(t: Db, C: string, id: string) {
  const r = await t.maybe(`UPDATE amortizations SET status='CANCELLED' WHERE id=$1 AND company_id=$2 AND status='ACTIVE' RETURNING id`, [id, C]);
  if (!r) throw bad("الجدول غير موجود أو غير نشط");
  return { ok: true };
}

/** Deletes a schedule nothing has been posted from yet; the payment / receipt recorded with it is reversed. */
export async function deleteAmortization(t: Db, C: string, user: string, id: string) {
  const a = await t.maybe(`SELECT * FROM amortizations WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, C]);
  if (!a) throw bad("الجدول غير موجود");
  if (a.postedMonths > 0) throw conflict("رُحّلت أشهر من هذا الجدول — أوقفه بدلاً من حذفه، أو اعكس قيوده أولاً");
  if (a.payEntryId) {
    const e = await t.one(`SELECT date, reversed_by FROM journal_entries WHERE id=$1`, [a.payEntryId]);
    if (!e.reversedBy) await reverse(t, C, a.payEntryId, String(e.date instanceof Date ? e.date.toISOString() : e.date).slice(0, 10), `إلغاء ${a.number} — ${a.name}`, user);
  }
  await t.exec(`DELETE FROM amortizations WHERE id=$1`, [id]);
  return { ok: true };
}

/** Companies with automatic schedules that have a month due — for the hourly scheduler. */
/** Establishments the scheduler posts for — not while their demo data is loading (the load posts its own months; running both deadlocked). */
export async function companiesWithDueAmortization(t: Db) {
  const rows = await t.rows(`SELECT DISTINCT a.company_id FROM amortizations a JOIN companies c ON c.id=a.company_id WHERE a.status='ACTIVE' AND a.auto AND c.status='ACTIVE' AND (c.subscription_ends_at IS NULL OR c.subscription_ends_at > now()) AND NOT ${DEMO_LOADING}`);
  return rows.map((r) => r.companyId);
}

/**
 * A month's entry reversed from the journal: the schedule takes the month back so it can be posted again. Months are
 * taken back from the last one, so the schedule never has a hole in the middle.
 */
export async function unpostOnReverse(t: Db, C: string, entryId: string) {
  const p = await t.maybe(`SELECT p.*, a.number FROM amortization_posts p JOIN amortizations a ON a.id=p.amortization_id WHERE p.entry_id=$1 AND p.company_id=$2`, [entryId, C]);
  if (!p) return;
  const last = await t.one(`SELECT MAX(period_end) d FROM amortization_posts WHERE amortization_id=$1`, [p.amortizationId]);
  if (String(last.d instanceof Date ? last.d.toISOString() : last.d).slice(0, 10) !== String(p.periodEnd instanceof Date ? p.periodEnd.toISOString() : p.periodEnd).slice(0, 10)) throw conflict(`هذا قيد شهر من الجدول ${p.number} — اعكس قيود الأشهر الأحدث أولاً`);
  await t.exec(`DELETE FROM amortization_posts WHERE id=$1`, [p.id]);
  const n = await t.one(`SELECT COUNT(*)::int c, COALESCE(SUM(amount),0) s FROM amortization_posts WHERE amortization_id=$1`, [p.amortizationId]);
  await t.exec(`UPDATE amortizations SET posted_months=$2, posted_amount=$3, status=CASE WHEN status='DONE' THEN 'ACTIVE' ELSE status END WHERE id=$1`, [p.amortizationId, n.c, n.s]);
}
