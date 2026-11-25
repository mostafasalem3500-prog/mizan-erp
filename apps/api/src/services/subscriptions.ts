/**
 * 3.51.0 — Subscriptions (الاشتراكات): memberships, service plans, software seats, boxes — anything billed again and
 * again for a period.
 *
 *  • Plans: a period (week, month, quarter, half year, year), a price, a one-off setup fee, a free trial, a quota of
 *    uses or visits per period with an optional price per use above it, and a grace period before a subscriber with
 *    an unpaid invoice is past due.
 *  • Subscribers: trial → active → (paused) → cancelled or expired. Every period is invoiced on its first day by the
 *    hourly scheduler (or at once on demand), a fixed term stops renewing at its end, and a cancellation can wait for
 *    the period end or take effect now with a credit note for the unused days.
 *  • Accounting: periods of a month or less go straight to «إيرادات الاشتراكات». Longer periods are cash received for
 *    service still to come: the invoice credits deferred revenue and a monthly schedule moves it to revenue
 *    (Dr deferred revenue / Cr subscription revenue), so a year paid in January is earned a twelfth a month.
 *  • Plan changes: a higher plan of the same period takes effect now with a prorated charge for the days left; a lower
 *    plan, or another period, from the next period. Pausing keeps the paid days that were left.
 *  • Usage: check-ins against the quota; above it a per-use charge goes on the next invoice, or entry is refused.
 *  • Metrics: MRR and ARR, active, trials, churn and its rate, new subscribers, revenue, deferred balance, renewals due.
 */
import { Db } from "../db/pool";
import { AppError, bad, conflict, num, r2, isDate, today, addDays, addMonths } from "../lib/core";
import { post, assertOpenDate, nextNumber } from "../accounting/engine";
import { saveDraft, postInvoice } from "./invoices";
import { ensureNear } from "./manufacturing";
import { createAmortization, runAmortization, finishAmortization } from "./amortization";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uid = (x: any) => (UUID.test(String(x || "")) ? String(x) : null);
const n = (x: any) => Number(x || 0);
const iso = (d: any) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);
const txt = (x: any, max = 300) => (x === undefined || x === null || String(x).trim() === "" ? null : String(x).trim().slice(0, max));
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1; // inclusive

export const PERIODS: Record<string, { months: number; ar: string }> = { WEEK: { months: 0, ar: "أسبوع" }, MONTH: { months: 1, ar: "شهر" }, QUARTER: { months: 3, ar: "ربع سنة" }, HALF: { months: 6, ar: "نصف سنة" }, YEAR: { months: 12, ar: "سنة" } };
export const periodEnd = (from: string, period: string) => (period === "WEEK" ? addDays(from, 6) : addDays(addMonths(from, PERIODS[period]?.months || 1), -1));
/** A period's price expressed per month (for MRR). */
export const monthlyOf = (amount: number, period: string) => (period === "WEEK" ? (amount * 52) / 12 : amount / (PERIODS[period]?.months || 1));
const deferredPeriod = (period: string) => (PERIODS[period]?.months || 0) > 1;
const LIVE = ["TRIAL", "ACTIVE", "PAUSED"];

export async function subAccounts(t: Db, C: string) {
  return {
    revenue: await ensureNear(t, C, "SUBSCRIPTION_REVENUE", "SERVICE_REVENUE", "إيرادات الاشتراكات", "Subscription Revenue", 20),
    deferred: await ensureNear(t, C, "DEFERRED_REVENUE", "SALARIES_PAYABLE", "إيرادات مؤجلة (مقبوضة مقدماً)", "Deferred Revenue", 40),
  };
}

// ───────────────────────── plans ─────────────────────────
const shapePlan = (p: any) => ({ ...p, price: n(p.price), setupFee: n(p.setupFee), quota: p.quota === null ? null : n(p.quota), overagePrice: n(p.overagePrice), monthly: r2(monthlyOf(n(p.price), p.period)), deferred: deferredPeriod(p.period), periodAr: PERIODS[p.period]?.ar });
export async function savePlan(t: Db, C: string, b: any, id?: string, opts: { isDemo?: boolean } = {}) {
  const name = txt(b.name, 120); if (!name) throw bad("اسم الخطة مطلوب");
  const period = PERIODS[b.period] ? b.period : "MONTH";
  const price = r2(num(b.price)), setupFee = r2(num(b.setupFee)), overagePrice = r2(num(b.overagePrice));
  if (price < 0 || setupFee < 0 || overagePrice < 0) throw bad("الأسعار لا تكون سالبة");
  if (!(price > 0)) throw bad("اكتب سعر الخطة للفترة");
  const trialDays = Math.trunc(num(b.trialDays)); if (trialDays < 0 || trialDays > 365) throw bad("أيام التجربة بين 0 و365");
  const graceDays = b.graceDays === undefined || b.graceDays === "" ? 7 : Math.trunc(num(b.graceDays)); if (graceDays < 0 || graceDays > 120) throw bad("أيام السماح بين 0 و120");
  const quota = b.quota === undefined || b.quota === null || b.quota === "" ? null : num(b.quota);
  if (quota !== null && !(quota > 0)) throw bad("الحد يكون أكبر من صفر، أو اتركه فارغاً لاستخدام غير محدود");
  let code = txt(b.code, 20);
  if (!code && !id) { const c = await t.one(`SELECT COUNT(*)::int c FROM sub_plans WHERE company_id=$1`, [C]); code = `PL-${String(c.c + 1).padStart(3, "0")}`; }
  if (code && await t.maybe(`SELECT 1 FROM sub_plans WHERE company_id=$1 AND code=$2 AND id <> COALESCE($3::uuid,'00000000-0000-0000-0000-000000000000')`, [C, code, uid(id)])) throw conflict(`الرمز ${code} مستخدم لخطة أخرى`);
  const row: any = { name, category: txt(b.category, 60), period, price, setupFee, trialDays, taxCode: ["S", "Z", "E", "O"].includes(b.taxCode) ? b.taxCode : "S", quota, quotaUnit: txt(b.quotaUnit, 30), overagePrice, graceDays, pausable: b.pausable === undefined ? true : !!b.pausable, description: txt(b.description, 1000), isActive: b.isActive === undefined ? true : !!b.isActive, ...(code ? { code } : {}) };
  if (id) {
    const old = await t.one(`SELECT * FROM sub_plans WHERE id=$1 AND company_id=$2`, [uid(id), C], "الخطة غير موجودة");
    if (old.period !== period && await t.maybe(`SELECT 1 FROM subscriptions WHERE plan_id=$1 AND status IN ('TRIAL','ACTIVE','PAUSED')`, [old.id])) throw conflict("للخطة مشتركون: لا تُغيَّر مدتها — أنشئ خطة جديدة وانقلهم إليها");
    return shapePlan(await t.update("sub_plans", { id: old.id }, row));
  }
  return shapePlan(await t.insert("sub_plans", { companyId: C, ...row, isDemo: !!opts.isDemo }));
}
export async function listPlans(t: Db, C: string) {
  const rows = await t.rows(`SELECT p.*, (SELECT COUNT(*)::int FROM subscriptions s WHERE s.plan_id=p.id AND s.status IN ('TRIAL','ACTIVE','PAUSED')) subscribers,
      (SELECT COALESCE(SUM(s.price*s.qty*(1-s.discount_pct/100)),0) FROM subscriptions s WHERE s.plan_id=p.id AND s.status IN ('ACTIVE','PAUSED')) billing
    FROM sub_plans p WHERE p.company_id=$1 ORDER BY p.is_active DESC, p.code`, [C]);
  return rows.map((p: any) => ({ ...shapePlan(p), subscribers: p.subscribers, mrr: r2(monthlyOf(n(p.billing), p.period)) }));
}

// ───────────────────────── subscribers ─────────────────────────
async function lockSub(t: Db, C: string, id: string) {
  const s = await t.one(`SELECT s.*, p.period, p.name plan_name, p.tax_code, p.setup_fee, p.quota, p.quota_unit, p.overage_price, p.grace_days, p.pausable FROM subscriptions s JOIN sub_plans p ON p.id=s.plan_id WHERE s.id=$1 AND s.company_id=$2 FOR UPDATE OF s`, [uid(id), C], "الاشتراك غير موجود");
  for (const k of ["startDate", "trialEnd", "currentFrom", "currentTo", "nextBillDate", "endDate", "cancelledDate", "pausedFrom", "pausedUntil"]) s[k] = iso(s[k]);
  return s;
}
const move = (t: Db, C: string, s: any, kind: string, date: string, user: string, x: any = {}) => t.insert("sub_moves", { companyId: C, subscriptionId: s.id, kind, date, createdBy: user, isDemo: !!s.isDemo, ...x });

export async function createSubscription(t: Db, company: any, user: string, b: any, opts: { isDemo?: boolean } = {}) {
  const C = company.id;
  const partner = await t.one(`SELECT id, name FROM partners WHERE id=$1 AND company_id=$2`, [uid(b.partnerId), C], "اختر المشترك (العميل)");
  const plan = await t.one(`SELECT * FROM sub_plans WHERE id=$1 AND company_id=$2`, [uid(b.planId), C], "اختر الخطة");
  if (!plan.isActive) throw bad(`الخطة «${plan.name}» موقوفة`);
  const start = isDate(b.startDate) ? String(b.startDate) : today();
  const qty = b.qty === undefined || b.qty === "" ? 1 : num(b.qty); if (!(qty > 0) || qty > 100000) throw bad("العدد يكون أكبر من صفر");
  const price = b.price === undefined || b.price === null || b.price === "" ? n(plan.price) : r2(num(b.price)); if (!(price >= 0)) throw bad("السعر لا يكون سالباً");
  const discountPct = Math.max(0, Math.min(100, num(b.discountPct)));
  const endDate = isDate(b.endDate) ? String(b.endDate) : null; if (endDate && endDate < start) throw bad("نهاية الاشتراك قبل بدايته");
  const trial = b.trial === false ? 0 : n(plan.trialDays);
  const number = await nextNumber(t, C, "SUB", start);
  const trialEnd = trial > 0 ? addDays(start, trial - 1) : null;
  const s = await t.insert("subscriptions", { companyId: C, number, partnerId: partner.id, planId: plan.id, status: trial > 0 ? "TRIAL" : "ACTIVE", price, qty, discountPct, startDate: start, trialEnd,
    currentFrom: trial > 0 ? start : null, currentTo: trialEnd, nextBillDate: trial > 0 ? addDays(trialEnd!, 1) : start, endDate, autoRenew: b.autoRenew === undefined ? true : !!b.autoRenew,
    setupBilled: n(plan.setupFee) <= 0 || b.waiveSetup === true, costCenterId: uid(b.costCenterId), notes: txt(b.notes, 1000), createdBy: user, isDemo: !!opts.isDemo });
  await move(t, C, s, "START", start, user, { notes: trial > 0 ? `تجربة مجانية ${trial} يوماً حتى ${trialEnd}` : `خطة ${plan.name}` });
  if (b.bill !== false) await billDue(t, company, user, today(), s.id);
  return s;
}

/** The invoice for one period (+ the setup fee and the uses above the quota of the period before). */
async function billPeriod(t: Db, company: any, user: string, s: any, from: string, date: string, overageOnly = false) {
  const C = company.id;
  const A = await subAccounts(t, C);
  const to = periodEnd(from, s.period);
  const deferred = deferredPeriod(s.period);
  const lines: any[] = [];
  const disc = n(s.discountPct);
  const label = `${s.planName} — ${PERIODS[s.period].ar} من ${from} إلى ${to}`;
  if (!overageOnly && n(s.price) > 0) lines.push({ accountId: deferred ? A.deferred : A.revenue, description: `اشتراك ${label}${n(s.qty) !== 1 ? ` × ${n(s.qty)}` : ""}`, qty: n(s.qty), unitPrice: n(s.price), discountPct: disc, taxCode: s.taxCode });
  if (!overageOnly && !s.setupBilled && n(s.setupFee) > 0) lines.push({ accountId: A.revenue, description: `رسوم التأسيس والاشتراك — ${s.planName}`, qty: 1, unitPrice: n(s.setupFee), taxCode: s.taxCode });
  const over = await t.rows(`SELECT id, qty, price FROM sub_usage WHERE subscription_id=$1 AND overage AND NOT billed AND price > 0`, [s.id]);
  const byPrice = new Map<number, number>(); for (const u of over) byPrice.set(n(u.price), (byPrice.get(n(u.price)) || 0) + n(u.qty));
  const overQty = over.reduce((x: number, u: any) => x + n(u.qty), 0);
  for (const [price, q] of byPrice) lines.push({ accountId: A.revenue, description: `استخدام فوق الحد — ${q} ${s.quotaUnit || "مرة"} × ${price}`, qty: q, unitPrice: price, taxCode: s.taxCode });
  let inv: any = null, amort: any = null, periodNet = 0;
  if (lines.length) {
    const d = await saveDraft(t, company, user, { direction: "SALE", kind: "INVOICE", date, dueDate: date, partnerId: s.partnerId, costCenterId: s.costCenterId || null, notes: `اشتراك ${s.number}`, isDemo: !!s.isDemo, lines } as any);
    await postInvoice(t, company, d.id, user);
    inv = await t.one(`SELECT i.id, i.number, i.total, (SELECT COALESCE(SUM(l.net_amount),0) FROM invoice_lines l WHERE l.invoice_id=i.id) net, (SELECT COALESCE(SUM(l.net_amount),0) FROM invoice_lines l WHERE l.invoice_id=i.id AND l.account_id=$2) period_net FROM invoices i WHERE i.id=$1`, [d.id, deferred ? A.deferred : A.revenue]);
    // the period's own share (not the setup fee and the uses above the quota, which are earned now)
    periodNet = deferred ? n(inv.periodNet) : r2(n(s.price) * n(s.qty) * (1 - disc / 100));
    if (deferred && periodNet > 0) {
      amort = await createAmortization(t, C, user, { kind: "DEFERRED", name: `اشتراك ${s.number} — ${s.planName} (${from} إلى ${to})`, total: periodNet, months: PERIODS[s.period].months, startDate: from, sourceAccountId: A.deferred, targetAccountId: A.revenue, partnerId: s.partnerId, costCenterId: s.costCenterId || null, auto: true, notes: `فاتورة ${inv.number}`, isDemo: !!s.isDemo });
      await runAmortization(t, C, user, today(), amort.id);
    }
    if (over.length) await t.exec(`UPDATE sub_usage SET billed=true WHERE id = ANY($1)`, [over.map((u: any) => u.id)]);
  }
  if (overageOnly && !inv) return { to, inv };
  await move(t, C, s, "INVOICE", date, user, { amount: n(inv?.net), periodFrom: overageOnly ? null : from, periodTo: overageOnly ? null : to, invoiceId: inv?.id || null, amortizationId: amort?.id || null, detail: { periodNet: overageOnly ? 0 : periodNet, deferred, overage: overQty, setup: !overageOnly && !s.setupBilled && n(s.setupFee) > 0 ? n(s.setupFee) : 0 }, notes: inv ? `${overageOnly ? "استخدام فوق الحد — " : ""}فاتورة ${inv.number}` : "فترة بلا مبلغ" });
  if (!overageOnly) s.setupBilled = true;
  return { to, inv };
}

/** Everything due up to the day: trials ending, renewals, the period end of cancellations and fixed terms, pauses ending. */
export async function billDue(t: Db, company: any, user: string, upTo = today(), onlyId?: string) {
  const C = company.id;
  const ids = await t.rows(`SELECT id FROM subscriptions WHERE company_id=$1 AND ((status IN ('TRIAL','ACTIVE') AND next_bill_date <= $2) OR (status='PAUSED' AND paused_until IS NOT NULL AND paused_until < $2)) ${onlyId ? "AND id=$3" : ""} ORDER BY next_bill_date`, onlyId ? [C, upTo, onlyId] : [C, upTo]);
  let invoices = 0, ended = 0, resumed = 0;
  for (const r of ids) {
    const s = await lockSub(t, C, r.id);
    if (s.status === "PAUSED") { await doResume(t, C, user, s, addDays(s.pausedUntil!, 1)); resumed++; if (!(s.nextBillDate && s.nextBillDate <= upTo)) continue; }
    for (let i = 0; i < 60 && s.nextBillDate && s.nextBillDate <= upTo; i++) {
      const from = s.nextBillDate;
      const stop = s.cancelAtPeriodEnd ? "CANCELLED" : (s.endDate && from > s.endDate) || (!s.autoRenew && s.status === "ACTIVE" && s.currentTo) ? "EXPIRED" : null;
      if (stop) {
        // the uses above the quota of the last period are still billed
        const over = await t.maybe(`SELECT 1 FROM sub_usage WHERE subscription_id=$1 AND overage AND NOT billed AND price > 0`, [s.id]);
        if (over) { await billPeriod(t, company, user, s, from, from, true); invoices++; }
        await t.update("subscriptions", { id: s.id }, { status: stop, nextBillDate: null, cancelledDate: stop === "CANCELLED" ? s.currentTo || from : null, updatedAt: new Date() });
        await move(t, C, s, stop === "CANCELLED" ? "CANCEL" : "EXPIRE", from, user, { notes: stop === "CANCELLED" ? `انتهى في نهاية الفترة${s.cancelReason ? ` — ${s.cancelReason}` : ""}` : "انتهت مدة الاشتراك" });
        s.nextBillDate = null; s.status = stop; ended++; break;
      }
      await assertOpenDate(t, C, from);
      if (s.pendingPlanId) await applyPending(t, C, user, s, from);
      const { to } = await billPeriod(t, company, user, s, from, from);
      s.currentFrom = from; s.currentTo = to; s.nextBillDate = addDays(to, 1); s.status = "ACTIVE"; invoices++;
      await t.update("subscriptions", { id: s.id }, { status: "ACTIVE", currentFrom: from, currentTo: to, nextBillDate: s.nextBillDate, setupBilled: true, updatedAt: new Date() });
    }
  }
  return { invoices, ended, resumed };
}
export async function companiesWithDueSubscriptions(t: Db) {
  return (await t.rows(`SELECT DISTINCT s.company_id FROM subscriptions s JOIN companies c ON c.id=s.company_id WHERE c.status='ACTIVE' AND ((s.status IN ('TRIAL','ACTIVE') AND s.next_bill_date <= $1) OR (s.status='PAUSED' AND s.paused_until < $1))`, [today()])).map((r: any) => r.companyId);
}

async function applyPending(t: Db, C: string, user: string, s: any, date: string) {
  const plan = await t.one(`SELECT * FROM sub_plans WHERE id=$1 AND company_id=$2`, [s.pendingPlanId, C]);
  const from = { plan: s.planName, price: n(s.price), qty: n(s.qty) };
  Object.assign(s, { planId: plan.id, planName: plan.name, period: plan.period, price: n(plan.price), qty: s.pendingQty ? n(s.pendingQty) : n(s.qty), taxCode: plan.taxCode, quota: plan.quota, quotaUnit: plan.quotaUnit, overagePrice: plan.overagePrice, graceDays: plan.graceDays, pausable: plan.pausable, pendingPlanId: null, pendingQty: null });
  await t.update("subscriptions", { id: s.id }, { planId: plan.id, price: s.price, qty: s.qty, pendingPlanId: null, pendingQty: null });
  await move(t, C, s, "CHANGE", date, user, { detail: { from, to: { plan: plan.name, price: s.price, qty: s.qty } }, notes: `بدأت خطة ${plan.name}` });
}

/** A higher plan of the same period: now, with a charge for the days left. Otherwise from the next period. */
export async function changePlan(t: Db, company: any, user: string, id: string, b: any) {
  const C = company.id;
  const s = await lockSub(t, C, id);
  if (!["TRIAL", "ACTIVE"].includes(s.status)) throw conflict("يُغيَّر فقط اشتراك ساري");
  const plan = await t.one(`SELECT * FROM sub_plans WHERE id=$1 AND company_id=$2`, [uid(b.planId) || s.planId, C], "اختر الخطة");
  if (!plan.isActive) throw bad(`الخطة «${plan.name}» موقوفة`);
  const qty = b.qty === undefined || b.qty === "" ? n(s.qty) : num(b.qty); if (!(qty > 0)) throw bad("العدد يكون أكبر من صفر");
  if (plan.id === s.planId && qty === n(s.qty)) throw bad("اختر خطة أو عدداً مختلفاً");
  const date = isDate(b.date) ? String(b.date) : today();
  const oldValue = n(s.price) * n(s.qty), newValue = n(plan.price) * qty;
  const now = s.status === "ACTIVE" && plan.period === s.period && newValue > oldValue && s.currentTo && date <= s.currentTo && date >= s.currentFrom!;
  if (!now) {
    if (s.status === "TRIAL") { // nothing billed yet: the trial simply continues on the new plan
      await t.update("subscriptions", { id: s.id }, { planId: plan.id, price: n(plan.price), qty, updatedAt: new Date() });
      await move(t, C, s, "CHANGE", date, user, { detail: { from: { plan: s.planName, price: n(s.price), qty: n(s.qty) }, to: { plan: plan.name, price: n(plan.price), qty } }, notes: `خلال التجربة إلى ${plan.name}` });
      return getSubscription(t, C, s.id);
    }
    await t.update("subscriptions", { id: s.id }, { pendingPlanId: plan.id, pendingQty: qty, updatedAt: new Date() });
    await move(t, C, s, "CHANGE", date, user, { detail: { pending: true, to: { plan: plan.name, price: n(plan.price), qty } }, notes: `تبدأ ${plan.name} من ${s.nextBillDate}` });
    return getSubscription(t, C, s.id);
  }
  await assertOpenDate(t, C, date);
  const left = days(date, s.currentTo!), span = days(s.currentFrom!, s.currentTo!);
  const charge = r2(((newValue - oldValue) * (1 - n(s.discountPct) / 100) * left) / span);
  const A = await subAccounts(t, C);
  const deferred = deferredPeriod(s.period);
  let inv: any = null, amort: any = null;
  if (charge > 0) {
    const d = await saveDraft(t, company, user, { direction: "SALE", kind: "INVOICE", date, dueDate: date, partnerId: s.partnerId, costCenterId: s.costCenterId || null, notes: `ترقية اشتراك ${s.number}`, isDemo: !!s.isDemo,
      lines: [{ accountId: deferred ? A.deferred : A.revenue, description: `ترقية من ${s.planName}${n(s.qty) !== 1 ? ` × ${n(s.qty)}` : ""} إلى ${plan.name}${qty !== 1 ? ` × ${qty}` : ""} — ${left} يوماً من ${span} (${date} إلى ${s.currentTo})`, qty: 1, unitPrice: charge, taxCode: plan.taxCode }] } as any);
    await postInvoice(t, company, d.id, user);
    inv = await t.one(`SELECT i.id, i.number, (SELECT COALESCE(SUM(l.net_amount),0) FROM invoice_lines l WHERE l.invoice_id=i.id) net FROM invoices i WHERE i.id=$1`, [d.id]);
    const months = Math.max(1, Math.round(left / 30.4));
    if (deferred && months > 1) {
      amort = await createAmortization(t, C, user, { kind: "DEFERRED", name: `ترقية اشتراك ${s.number} — ${plan.name} (${date} إلى ${s.currentTo})`, total: n(inv.net), months, startDate: date, sourceAccountId: A.deferred, targetAccountId: A.revenue, partnerId: s.partnerId, costCenterId: s.costCenterId || null, auto: true, notes: `فاتورة ${inv.number}`, isDemo: !!s.isDemo });
      await runAmortization(t, C, user, today(), amort.id);
    } else if (deferred) { // a month or less left: earned now
      await post(t, C, { date, type: "AMORTIZATION", sourceType: "SUBSCRIPTION", sourceId: s.id, reference: s.number, memo: `ترقية اشتراك ${s.number} — يُستحق في الشهر`, isDemo: !!s.isDemo, createdBy: user, lines: [{ account: A.deferred, debit: n(inv.net) }, { account: A.revenue, credit: n(inv.net) }] });
    }
  }
  await t.update("subscriptions", { id: s.id }, { planId: plan.id, price: n(plan.price), qty, pendingPlanId: null, pendingQty: null, updatedAt: new Date() });
  await move(t, C, s, "CHANGE", date, user, { amount: n(inv?.net), invoiceId: inv?.id || null, amortizationId: amort?.id || null, periodFrom: date, periodTo: s.currentTo, detail: { from: { plan: s.planName, price: n(s.price), qty: n(s.qty) }, to: { plan: plan.name, price: n(plan.price), qty }, left, span, charge }, notes: inv ? `فاتورة الفرق ${inv.number}` : null });
  return getSubscription(t, C, s.id);
}

export async function pause(t: Db, C: string, user: string, id: string, b: any = {}) {
  const s = await lockSub(t, C, id);
  if (s.status !== "ACTIVE") throw conflict("يُوقف مؤقتاً فقط اشتراك ساري");
  if (!s.pausable) throw bad(`خطة «${s.planName}» لا تسمح بالإيقاف المؤقت`);
  if (deferredPeriod(s.period)) throw bad("الإيقاف المؤقت للخطط الأسبوعية والشهرية؛ الخطط الأطول إيرادها موزّع على أشهرها — ألغِ أو انقل المشترك لخطة شهرية");
  const from = isDate(b.from) ? String(b.from) : today();
  if (s.currentTo && from > addDays(s.currentTo, 1)) throw bad(`ابدأ الإيقاف قبل نهاية الفترة الحالية (${s.currentTo})`);
  const until = isDate(b.until) ? String(b.until) : null; if (until && until < from) throw bad("نهاية الإيقاف قبل بدايته");
  await t.update("subscriptions", { id: s.id }, { status: "PAUSED", pausedFrom: from, pausedUntil: until, updatedAt: new Date() });
  await move(t, C, s, "PAUSE", from, user, { notes: [until ? `حتى ${until}` : "حتى الاستئناف", txt(b.reason, 200)].filter(Boolean).join(" — ") });
  return { ok: true };
}
async function doResume(t: Db, C: string, user: string, s: any, date: string) {
  // the paid days left when it was paused are kept: the period moves on by the days it was paused
  const pf = s.pausedFrom || date;
  let to = s.currentTo, next = s.nextBillDate;
  if (s.currentTo && pf <= s.currentTo) { const left = days(pf, s.currentTo); to = addDays(date, left - 1); next = addDays(to, 1); }
  else next = date;
  await t.update("subscriptions", { id: s.id }, { status: "ACTIVE", pausedFrom: null, pausedUntil: null, currentTo: to, nextBillDate: next, updatedAt: new Date() });
  await move(t, C, s, "RESUME", date, user, { notes: `بعد إيقاف ${Math.max(0, days(pf, addDays(date, -1)))} يوماً — الفترة حتى ${to || "—"}` });
  Object.assign(s, { status: "ACTIVE", currentTo: to, nextBillDate: next, pausedFrom: null, pausedUntil: null });
}
export async function resume(t: Db, company: any, user: string, id: string, b: any = {}) {
  const s = await lockSub(t, company.id, id);
  if (s.status !== "PAUSED") throw conflict("الاشتراك غير موقوف");
  const date = isDate(b.date) ? String(b.date) : today();
  if (s.pausedFrom && date < s.pausedFrom) throw bad("تاريخ الاستئناف قبل بداية الإيقاف");
  await doResume(t, company.id, user, s, date);
  await billDue(t, company, user, today(), s.id);
  return getSubscription(t, company.id, s.id);
}

/** At the period end (nothing more is billed), or now — the unused days may go back on a credit note. */
export async function cancel(t: Db, company: any, user: string, id: string, b: any = {}) {
  const C = company.id;
  const s = await lockSub(t, C, id);
  if (!LIVE.includes(s.status)) throw conflict("الاشتراك منتهٍ من قبل");
  const reason = txt(b.reason, 200);
  if (b.when !== "NOW" && s.status !== "TRIAL" && s.status !== "PAUSED") {
    await t.update("subscriptions", { id: s.id }, { cancelAtPeriodEnd: true, cancelReason: reason, updatedAt: new Date() });
    await move(t, C, s, "CANCEL", today(), user, { notes: `يُلغى في نهاية الفترة (${s.currentTo})${reason ? ` — ${reason}` : ""}`, detail: { atPeriodEnd: true } });
    return getSubscription(t, C, s.id);
  }
  const date = isDate(b.date) ? String(b.date) : today(); await assertOpenDate(t, C, date);
  const credits: any[] = [];
  const A = await subAccounts(t, C);
  const parts: { mv: any; base: number; from: string; to: string }[] = [];
  if (s.status === "ACTIVE" && s.currentFrom && s.currentTo) {
    const last = await t.maybe(`SELECT m.*, i.status inv_status FROM sub_moves m LEFT JOIN invoices i ON i.id=m.invoice_id WHERE m.subscription_id=$1 AND m.kind='INVOICE' AND m.period_from=$2 ORDER BY m.created_at DESC LIMIT 1`, [s.id, s.currentFrom]);
    if (last) parts.push({ mv: last, base: n(last.detail?.periodNet), from: s.currentFrom, to: s.currentTo });
    // upgrades in this period: their charge covered the days from the upgrade to the period end
    for (const m of await t.rows(`SELECT m.*, i.status inv_status FROM sub_moves m LEFT JOIN invoices i ON i.id=m.invoice_id WHERE m.subscription_id=$1 AND m.kind='CHANGE' AND m.invoice_id IS NOT NULL AND m.period_from >= $2 ORDER BY m.created_at`, [s.id, s.currentFrom])) parts.push({ mv: m, base: n(m.amount), from: iso(m.periodFrom)!, to: iso(m.periodTo)! });
  }
  for (const p of parts) {
    const unused = date < p.to ? days(addDays(date, 1), p.to) : 0, span = days(p.from, p.to);
    const why = `إلغاء اشتراك ${s.number}: ${unused} يوماً غير مستخدمة من ${span}`;
    if (p.mv.amortizationId) {
      // spread over months: those ended are earned; of the rest, what is credited goes back and the remainder is earned now
      await runAmortization(t, C, user, addDays(date, -1), p.mv.amortizationId);
      const am = await t.one(`SELECT * FROM amortizations WHERE id=$1`, [p.mv.amortizationId]);
      const rest = r2(n(am.total) - n(am.postedAmount));
      const back = b.credit && am.status === "ACTIVE" ? r2(Math.min(rest, (p.base * unused) / span)) : 0;
      if (back > 0) { const cn = await creditNote(t, company, user, s, p.mv, back, A.deferred, why, date); if (cn) credits.push(cn); }
      if (am.status === "ACTIVE") {
        await t.exec(`UPDATE amortizations SET total=total-$2 WHERE id=$1`, [am.id, back]);
        if (rest - back > 0.004) await finishAmortization(t, C, user, am.id, date);
        else await t.exec(`UPDATE amortizations SET status='DONE' WHERE id=$1`, [am.id]);
      }
    } else if (b.credit && unused > 0 && p.mv.invoiceId) {
      const back = r2((p.base * unused) / span);
      if (back > 0) { const cn = await creditNote(t, company, user, s, p.mv, back, A.revenue, why, date); if (cn) credits.push(cn); }
    }
  }
  const credit = credits[0] || null, creditTotal = r2(credits.reduce((x, c) => x + n(c.net), 0));
  // uses above the quota not billed yet
  if (await t.maybe(`SELECT 1 FROM sub_usage WHERE subscription_id=$1 AND overage AND NOT billed AND price > 0`, [s.id])) await billPeriod(t, company, user, s, date, date, true);
  await t.update("subscriptions", { id: s.id }, { status: "CANCELLED", cancelledDate: date, cancelReason: reason, nextBillDate: null, currentTo: s.currentTo && date < s.currentTo ? date : s.currentTo, pausedFrom: null, pausedUntil: null, updatedAt: new Date() });
  await move(t, C, s, "CANCEL", date, user, { amount: creditTotal, invoiceId: credit?.id || null, detail: { credits: credits.map((c) => ({ id: c.id, number: c.number, net: n(c.net) })) }, notes: [credits.length ? `إشعار دائن ${credits.map((c) => c.number).join("، ")}` : null, reason].filter(Boolean).join(" — ") || "أُلغي الآن" });
  return getSubscription(t, C, s.id);
}
async function creditNote(t: Db, company: any, user: string, s: any, last: any, amount: number, accountId: string, reason: string, date: string) {
  if (last.invStatus !== "POSTED") return null;
  const d = await saveDraft(t, company, user, { direction: "SALE", kind: "CREDIT_NOTE", originId: last.invoiceId, reason, date, partnerId: s.partnerId, isDemo: !!s.isDemo, lines: [{ accountId, description: reason, qty: 1, unitPrice: amount, taxCode: s.taxCode }] } as any);
  await postInvoice(t, company, d.id, user);
  const inv = await t.one(`SELECT i.id, i.number, (SELECT COALESCE(SUM(l.net_amount),0) FROM invoice_lines l WHERE l.invoice_id=i.id) net FROM invoices i WHERE i.id=$1`, [d.id]);
  await move(t, company.id, s, "CREDIT", date, user, { amount: n(inv.net), invoiceId: inv.id, notes: `إشعار دائن ${inv.number}` });
  return inv;
}

// ───────────────────────── usage and check-ins ─────────────────────────
async function usedIn(t: Db, s: any) {
  if (!s.currentFrom || !s.currentTo) return 0;
  return n((await t.one(`SELECT COALESCE(SUM(qty),0) q FROM sub_usage WHERE subscription_id=$1 AND date BETWEEN $2 AND $3`, [s.id, s.currentFrom, s.currentTo])).q);
}
async function pastDue(t: Db, s: any) {
  const r = await t.one(`SELECT COALESCE(SUM(i.total-i.amount_paid),0) due, MIN(i.date) since FROM sub_moves m JOIN invoices i ON i.id=m.invoice_id WHERE m.subscription_id=$1 AND m.kind IN ('INVOICE','CHANGE') AND i.status='POSTED' AND i.total-i.amount_paid > 0.004 AND i.date < $2`, [s.id, addDays(today(), -n(s.graceDays))]);
  return n(r.due) > 0 ? { due: r2(n(r.due)), since: iso(r.since) } : null;
}
export async function checkin(t: Db, C: string, user: string, b: any) {
  let id = uid(b.subscriptionId);
  if (!id) {
    const q = txt(b.q, 60); if (!q) throw bad("اكتب رقم الاشتراك أو جوال المشترك أو اسمه");
    const found = await t.rows(`SELECT s.id FROM subscriptions s JOIN partners p ON p.id=s.partner_id WHERE s.company_id=$1 AND s.status IN ('TRIAL','ACTIVE','PAUSED') AND (s.number=$2 OR p.phone=$2 OR p.name ILIKE '%'||$2||'%') ORDER BY s.status='ACTIVE' DESC LIMIT 5`, [C, q]);
    if (!found.length) throw new AppError(404, `لا اشتراك ساري لـ«${q}»`);
    if (found.length > 1 && !(await t.maybe(`SELECT 1 FROM subscriptions WHERE company_id=$1 AND number=$2`, [C, q]))) return { choose: await Promise.all(found.map(async (f: any) => brief(t, C, f.id))) };
    id = found[0].id;
  }
  const s = await lockSub(t, C, id!);
  const date = today();
  if (s.status === "PAUSED") throw conflict(`الاشتراك ${s.number} موقوف مؤقتاً${s.pausedUntil ? ` حتى ${s.pausedUntil}` : ""}`);
  if (!["TRIAL", "ACTIVE"].includes(s.status) || !s.currentTo || date > s.currentTo || (s.currentFrom && date < s.currentFrom)) throw conflict(`الاشتراك ${s.number} غير ساري اليوم${s.currentTo ? ` (الفترة حتى ${s.currentTo})` : ""}`);
  const due = await pastDue(t, s);
  if (due && !b.force) throw conflict(`على المشترك ${due.due} متأخرة منذ ${due.since} — سدّدها أو اسمح بالدخول`);
  const qty = b.qty === undefined || b.qty === "" ? 1 : num(b.qty); if (!(qty > 0) || qty > 1000) throw bad("العدد يكون أكبر من صفر");
  const used = await usedIn(t, s);
  const quota = s.quota === null ? null : n(s.quota);
  let overage = false;
  if (quota !== null && used + qty > quota) {
    if (!(n(s.overagePrice) > 0)) throw conflict(`استُنفد رصيد الفترة: ${used} من ${quota} ${s.quotaUnit || ""}`.trim());
    overage = true;
  }
  const u = await t.insert("sub_usage", { companyId: C, subscriptionId: s.id, date, qty, overage, price: overage ? n(s.overagePrice) : 0, note: txt(b.note, 200), createdBy: user, isDemo: !!s.isDemo });
  return { ok: true, id: u.id, overage, ...(await brief(t, C, s.id)) };
}
export async function undoUsage(t: Db, C: string, id: string) {
  const r = await t.maybe(`DELETE FROM sub_usage WHERE id=$1 AND company_id=$2 AND NOT billed RETURNING id`, [uid(id), C]);
  if (!r) throw conflict("الاستخدام غير موجود أو فُوتر");
  return { ok: true };
}

// ───────────────────────── views ─────────────────────────
function shapeSub(s: any, td: string) {
  for (const k of ["startDate", "trialEnd", "currentFrom", "currentTo", "nextBillDate", "endDate", "cancelledDate", "pausedFrom", "pausedUntil"]) s[k] = iso(s[k]);
  const value = r2(n(s.price) * n(s.qty) * (1 - n(s.discountPct) / 100));
  const renewSoon = ["ACTIVE"].includes(s.status) && !!s.currentTo && s.currentTo >= td && s.currentTo <= addDays(td, 7);
  return { id: s.id, number: s.number, partnerId: s.partnerId, partnerName: s.partnerName, partnerPhone: s.partnerPhone, planId: s.planId, planName: s.planName, period: s.period, periodAr: PERIODS[s.period]?.ar, status: s.status,
    price: n(s.price), qty: n(s.qty), discountPct: n(s.discountPct), value, mrr: s.status === "ACTIVE" ? r2(monthlyOf(value, s.period)) : 0, startDate: s.startDate, trialEnd: s.trialEnd, currentFrom: s.currentFrom, currentTo: s.currentTo, nextBillDate: s.nextBillDate, endDate: s.endDate,
    autoRenew: s.autoRenew, cancelAtPeriodEnd: s.cancelAtPeriodEnd, cancelledDate: s.cancelledDate, cancelReason: s.cancelReason, pausedFrom: s.pausedFrom, pausedUntil: s.pausedUntil, pendingPlanId: s.pendingPlanId, pendingPlanName: s.pendingPlanName || null, pendingQty: s.pendingQty === null ? null : n(s.pendingQty),
    quota: s.quota === null || s.quota === undefined ? null : n(s.quota), quotaUnit: s.quotaUnit, used: n(s.used), due: r2(n(s.due)), dueSince: iso(s.dueSince), pastDue: n(s.due) > 0.004 && !!s.dueSince && iso(s.dueSince)! < addDays(td, -n(s.graceDays)),
    renewSoon, ending: renewSoon && (s.cancelAtPeriodEnd || !s.autoRenew || (s.endDate && s.endDate <= s.currentTo)), isDemo: s.isDemo };
}
const SUB_SQL = `SELECT s.*, pa.name partner_name, pa.phone partner_phone, p.name plan_name, p.period, p.quota, p.quota_unit, p.grace_days, pp.name pending_plan_name,
    (SELECT COALESCE(SUM(u.qty),0) FROM sub_usage u WHERE u.subscription_id=s.id AND u.date BETWEEN s.current_from AND s.current_to) used,
    (SELECT COALESCE(SUM(i.total-i.amount_paid),0) FROM sub_moves m JOIN invoices i ON i.id=m.invoice_id WHERE m.subscription_id=s.id AND m.kind IN ('INVOICE','CHANGE') AND i.status='POSTED') due,
    (SELECT MIN(i.date) FROM sub_moves m JOIN invoices i ON i.id=m.invoice_id WHERE m.subscription_id=s.id AND m.kind IN ('INVOICE','CHANGE') AND i.status='POSTED' AND i.total-i.amount_paid > 0.004) due_since
  FROM subscriptions s JOIN partners pa ON pa.id=s.partner_id JOIN sub_plans p ON p.id=s.plan_id LEFT JOIN sub_plans pp ON pp.id=s.pending_plan_id`;
export async function listSubscriptions(t: Db, C: string, q: any = {}) {
  const where = ["s.company_id=$1"]; const p: any[] = [C];
  if (q.status === "LIVE") where.push(`s.status IN ('TRIAL','ACTIVE','PAUSED')`);
  else if (["TRIAL", "ACTIVE", "PAUSED", "CANCELLED", "EXPIRED"].includes(q.status)) { p.push(q.status); where.push(`s.status=$${p.length}`); }
  if (uid(q.planId)) { p.push(q.planId); where.push(`s.plan_id=$${p.length}`); }
  if (uid(q.partnerId)) { p.push(q.partnerId); where.push(`s.partner_id=$${p.length}`); }
  if (txt(q.q)) { p.push(String(q.q).trim()); where.push(`(s.number ILIKE '%'||$${p.length}||'%' OR pa.name ILIKE '%'||$${p.length}||'%' OR pa.phone ILIKE '%'||$${p.length}||'%')`); }
  const rows = await t.rows(`${SUB_SQL} WHERE ${where.join(" AND ")} ORDER BY CASE s.status WHEN 'ACTIVE' THEN 0 WHEN 'TRIAL' THEN 1 WHEN 'PAUSED' THEN 2 ELSE 3 END, s.current_to NULLS LAST, s.number DESC LIMIT 1000`, p);
  const td = today();
  let list = rows.map((s: any) => shapeSub(s, td));
  if (q.flag === "PAST_DUE") list = list.filter((s) => s.pastDue);
  if (q.flag === "RENEW") list = list.filter((s) => s.renewSoon);
  return list;
}
async function brief(t: Db, C: string, id: string) {
  const s = shapeSub(await t.one(`${SUB_SQL} WHERE s.id=$1 AND s.company_id=$2`, [id, C]), today());
  return { subscription: { id: s.id, number: s.number, partnerName: s.partnerName, planName: s.planName, status: s.status, currentTo: s.currentTo, quota: s.quota, quotaUnit: s.quotaUnit, used: s.used, left: s.quota === null ? null : r2(Math.max(0, s.quota - s.used)), pastDue: s.pastDue, due: s.due } };
}
export async function getSubscription(t: Db, C: string, id: string) {
  const s = await t.one(`${SUB_SQL} WHERE s.id=$1 AND s.company_id=$2`, [uid(id), C], "الاشتراك غير موجود");
  const td = today();
  const moves = await t.rows(`SELECT m.*, i.number invoice_number, i.kind invoice_kind, i.total invoice_total, i.amount_paid, a.number amort_number, a.posted_amount, a.total amort_total FROM sub_moves m LEFT JOIN invoices i ON i.id=m.invoice_id LEFT JOIN amortizations a ON a.id=m.amortization_id WHERE m.subscription_id=$1 ORDER BY m.created_at`, [s.id]);
  const usage = await t.rows(`SELECT id, at, date, qty, overage, billed, note, created_by FROM sub_usage WHERE subscription_id=$1 ORDER BY at DESC LIMIT 200`, [s.id]);
  const seen = new Set<string>();
  const invoices = moves.filter((m: any) => m.invoiceId && !seen.has(m.invoiceId) && seen.add(m.invoiceId)).map((m: any) => ({ id: m.invoiceId, number: m.invoiceNumber, kind: m.invoiceKind, date: iso(m.date), from: iso(m.periodFrom), to: iso(m.periodTo), net: n(m.amount), total: n(m.invoiceTotal), paid: n(m.amountPaid), due: m.invoiceKind === "CREDIT_NOTE" ? 0 : r2(n(m.invoiceTotal) - n(m.amountPaid)) }));
  const deferred = moves.filter((m: any) => m.amortizationId).map((m: any) => ({ id: m.amortizationId, number: m.amortNumber, total: n(m.amortTotal), earned: n(m.postedAmount), left: r2(n(m.amortTotal) - n(m.postedAmount)) }));
  return { ...shapeSub(s, td), taxCode: s.taxCode, notes: s.notes, createdBy: s.createdBy, setupBilled: s.setupBilled, costCenterId: s.costCenterId,
    invoices, deferred, deferredLeft: r2(deferred.reduce((x, d) => x + d.left, 0)), billed: r2(invoices.filter((i) => i.kind !== "CREDIT_NOTE").reduce((x, i) => x + i.total, 0)),
    usage: usage.map((u: any) => ({ ...u, date: iso(u.date), qty: n(u.qty) })),
    moves: moves.map((m: any) => ({ id: m.id, kind: m.kind, date: iso(m.date), amount: n(m.amount), from: iso(m.periodFrom), to: iso(m.periodTo), detail: m.detail, notes: m.notes, invoiceId: m.invoiceId, invoiceNumber: m.invoiceNumber, amortizationId: m.amortizationId, createdBy: m.createdBy })) };
}

/** MRR at a day: subscriptions running that day (started, not ended, not in trial), at their current price. */
const mrrAt = (subs: any[], d: string) => r2(subs.filter((s) => s.status !== "TRIAL" && (s.trialEnd ? s.trialEnd < d : true) && s.startDate <= d && !(s.cancelledDate && s.cancelledDate < d) && !(["EXPIRED"].includes(s.status) && s.currentTo && s.currentTo < d)).reduce((x, s) => x + monthlyOf(s.value, s.period), 0));

export async function dashboard(t: Db, C: string) {
  const td = today(), m0 = td.slice(0, 8) + "01", d30 = addDays(td, -30);
  const all = await listSubscriptions(t, C);
  const live = all.filter((s) => LIVE.includes(s.status));
  const mrr = r2(all.reduce((x, s) => x + s.mrr, 0));
  const [rev, def, plans] = await Promise.all([
    t.maybe(`SELECT COALESCE(SUM(l.credit-l.debit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND a.system_key='SUBSCRIPTION_REVENUE' AND e.status='POSTED' AND e.date >= $2`, [C, m0]),
    t.one(`SELECT COALESCE(SUM(a.total-a.posted_amount),0) b FROM sub_moves m JOIN amortizations a ON a.id=m.amortization_id WHERE m.company_id=$1 AND a.status='ACTIVE'`, [C]),
    listPlans(t, C),
  ]);
  // churn: subscribers lost in the last 30 days over those running 30 days ago
  const at30 = all.filter((s) => s.startDate <= d30 && s.status !== "TRIAL" && !(s.cancelledDate && s.cancelledDate < d30) && !(s.status === "EXPIRED" && s.currentTo && s.currentTo < d30));
  const lost = all.filter((s) => (s.status === "CANCELLED" && s.cancelledDate && s.cancelledDate >= d30) || (s.status === "EXPIRED" && s.currentTo && s.currentTo >= d30 && s.currentTo <= td));
  const fresh = all.filter((s) => s.startDate >= d30 && s.startDate <= td);
  const trend: { month: string; mrr: number }[] = [];
  for (let i = 5; i >= 0; i--) { const me = addDays(addMonths(m0, -i + 1), -1); const d = me > td ? td : me; trend.push({ month: d.slice(0, 7), mrr: mrrAt(all, d) }); }
  const byPlan = plans.filter((p: any) => p.subscribers > 0).map((p: any) => ({ id: p.id, name: p.name, period: p.period, subscribers: p.subscribers, mrr: p.mrr })).sort((a: any, b: any) => b.mrr - a.mrr);
  const due = await t.one(`SELECT COUNT(*)::int c FROM subscriptions WHERE company_id=$1 AND status IN ('TRIAL','ACTIVE') AND next_bill_date <= $2`, [C, td]);
  return {
    mrr, arr: r2(mrr * 12), counts: { active: all.filter((s) => s.status === "ACTIVE").length, trial: all.filter((s) => s.status === "TRIAL").length, paused: all.filter((s) => s.status === "PAUSED").length, ended: all.filter((s) => ["CANCELLED", "EXPIRED"].includes(s.status)).length, live: live.length },
    arpu: all.some((s) => s.mrr > 0) ? r2(mrr / all.filter((s) => s.mrr > 0).length) : 0,
    churn: { lost: lost.length, base: at30.length, ratePct: at30.length ? r2((lost.length / at30.length) * 100) : 0, lostMrr: r2(lost.reduce((x, s) => x + monthlyOf(s.value, s.period), 0)) },
    fresh: fresh.length, month: { from: m0, revenue: r2(n(rev?.b)) }, deferredLeft: r2(n(def.b)), billingDue: due.c, trend, byPlan,
    renewSoon: live.filter((s) => s.renewSoon), pastDue: live.filter((s) => s.pastDue), trialsEnding: live.filter((s) => s.status === "TRIAL" && s.trialEnd && s.trialEnd <= addDays(td, 7)),
    paused: live.filter((s) => s.status === "PAUSED"),
  };
}

/** Uses per subscriber in the current period, against the quota (who is near it, who never comes). */
export async function usageReport(t: Db, C: string, q: any = {}) {
  const to = isDate(q.to) ? String(q.to) : today(), from = isDate(q.from) ? String(q.from) : addDays(to, -29);
  const [subs, daily] = await Promise.all([
    t.rows(`SELECT s.id, s.number, pa.name partner, p.name plan, p.quota, p.quota_unit, s.status, COALESCE(SUM(u.qty),0) used, MAX(u.date) last FROM subscriptions s JOIN partners pa ON pa.id=s.partner_id JOIN sub_plans p ON p.id=s.plan_id LEFT JOIN sub_usage u ON u.subscription_id=s.id AND u.date BETWEEN $2 AND $3 WHERE s.company_id=$1 AND s.status IN ('TRIAL','ACTIVE','PAUSED') GROUP BY s.id, pa.name, p.name, p.quota, p.quota_unit ORDER BY used DESC`, [C, from, to]),
    t.rows(`SELECT date, SUM(qty) q, COUNT(DISTINCT subscription_id)::int people FROM sub_usage WHERE company_id=$1 AND date BETWEEN $2 AND $3 GROUP BY date ORDER BY date`, [C, from, to]),
  ]);
  return { from, to, subscribers: subs.map((s: any) => ({ ...s, used: n(s.used), quota: s.quota === null ? null : n(s.quota), last: iso(s.last) })), daily: daily.map((d: any) => ({ date: iso(d.date), qty: n(d.q), people: d.people })), idle: subs.filter((s: any) => n(s.used) === 0).length };
}

export async function subGuardOnReverse(t: Db, C: string, entryId: string) {
  const e = await t.maybe(`SELECT reference FROM journal_entries WHERE id=$1 AND company_id=$2 AND source_type='SUBSCRIPTION'`, [uid(entryId), C]);
  if (e) throw conflict(`هذا قيد اشتراك ${e.reference}: يُصحَّح من شاشة الاشتراك`);
}
