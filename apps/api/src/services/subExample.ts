/**
 * 3.51.0 worked example for subscriptions, flagged as sample data: a gym (monthly membership with 12 visits and a
 * per-visit charge above them, an annual membership on deferred revenue), a cloud software plan per user with a
 * 14-day trial, and a quarterly coffee box — with subscribers active, paid and unpaid, on trial, paused, cancelled
 * and cancelling at the period end, and a month of check-ins.
 */
import { Db } from "../db/pool";
import { conflict, today, addDays, addMonths } from "../lib/core";
import { createPayment } from "./payments";
import { savePlan, createSubscription, billDue, pause, cancel } from "./subscriptions";

export async function seedSubscriptionExample(t: Db, company: any, user: string) {
  const C = company.id;
  if (await t.maybe(`SELECT 1 FROM sub_plans WHERE company_id=$1 AND code='PX-GYM-M'`, [C])) throw conflict("مثال الاشتراكات محمَّل من قبل — تجده في خطط الاشتراك والمشتركين");
  const D = { isDemo: true };
  const cash = (await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND system_key IN ('CASH','BANK') AND NOT is_group ORDER BY system_key='CASH' DESC LIMIT 1`, [C])).id;
  const gymM = await savePlan(t, C, { code: "PX-GYM-M", name: "عضوية النادي الشهرية (مثال)", category: "نادي رياضي", period: "MONTH", price: 300, setupFee: 100, quota: 12, quotaUnit: "زيارة", overagePrice: 30, description: "12 زيارة في الشهر، وكل زيارة بعدها 30" }, undefined, D);
  const gymY = await savePlan(t, C, { code: "PX-GYM-Y", name: "عضوية النادي السنوية (مثال)", category: "نادي رياضي", period: "YEAR", price: 3000, quotaUnit: "زيارة", description: "زيارات غير محدودة، تُدفع مقدماً وتُستحق شهراً بشهر" }, undefined, D);
  const saas = await savePlan(t, C, { code: "PX-SAAS", name: "باقة البرنامج السحابي — لكل مستخدم (مثال)", category: "برمجيات", period: "MONTH", price: 99, trialDays: 14, description: "سعر المستخدم في الشهر، وتجربة مجانية 14 يوماً" }, undefined, D);
  const box = await savePlan(t, C, { code: "PX-BOX", name: "صندوق القهوة المختصة ربع السنوي (مثال)", category: "صناديق", period: "QUARTER", price: 450, pausable: false, description: "صندوق كل ثلاثة أشهر" }, undefined, D);
  // a company customer carries what a standard tax invoice needs (VAT number, CR and national address)
  const mk = (code: string, name: string, phone: string, kind = "INDIVIDUAL") => t.insert("partners", { companyId: C, code, name, isCustomer: true, isSupplier: false, kind, phone, city: "الرياض", isDemo: true,
    ...(kind === "COMPANY" ? { vatNumber: `310998877${code.slice(-1)}00003`, crNumber: `101099900${code.slice(-1)}`, district: "العليا", street: "طريق الملك فهد", buildingNo: "7421", postalCode: "12211", additionalNo: "3344", email: `info-${code.toLowerCase()}@example.sa`, contactPerson: "المدير المالي" } : {}) });
  const P = {
    sara: await mk("SX-C1", "سارة القحطاني (مثال)", "0561110001"), fahad: await mk("SX-C2", "فهد الدوسري (مثال)", "0561110002"),
    co: await mk("SX-C3", "شركة الرواد للتقنية (مثال)", "0561110003", "COMPANY"), reem: await mk("SX-C4", "ريم الشهري (مثال)", "0561110004"),
    noura: await mk("SX-C5", "نورة المطيري (مثال)", "0561110005"), abd: await mk("SX-C6", "عبدالله الزهراني (مثال)", "0561110006"), cafe: await mk("SX-C7", "مقهى الركن (مثال)", "0561110007", "COMPANY"),
  };
  const td = today();
  const payAll = async (subId: string, except: string[] = []) => {
    const inv = await t.rows(`SELECT i.id, i.partner_id, i.date, i.total - i.amount_paid due FROM sub_moves m JOIN invoices i ON i.id=m.invoice_id WHERE m.subscription_id=$1 AND i.kind='INVOICE' AND i.status='POSTED' AND i.total - i.amount_paid > 0.004 ORDER BY i.date`, [subId]);
    for (const i of inv) if (!except.includes(i.id)) await createPayment(t, C, user, { direction: "IN", partnerId: i.partnerId, amount: Number(i.due), accountId: cash, method: "CASH", date: String(i.date instanceof Date ? i.date.toISOString() : i.date).slice(0, 10), allocations: [{ invoiceId: i.id, amount: Number(i.due) }], isDemo: true });
  };
  const visits = async (subId: string, from: string, count: number, step = 2) => { for (let i = 0; i < count; i++) { const d = addDays(from, i * step); if (d > td) break; await t.insert("sub_usage", { companyId: C, subscriptionId: subId, date: d, at: new Date(d + "T17:30:00+03:00"), qty: 1, overage: false, createdBy: user, isDemo: true }); } };
  // 1) a monthly member for three months, paid, with visits this month
  const s1 = await createSubscription(t, company, user, { partnerId: P.sara.id, planId: gymM.id, startDate: addDays(addMonths(td, -3), 3), notes: "مثال: عضوية شهرية مدفوعة" }, D);
  await payAll(s1.id);
  const s1c = await t.one(`SELECT current_from FROM subscriptions WHERE id=$1`, [s1.id]);
  await visits(s1.id, String(s1c.currentFrom instanceof Date ? s1c.currentFrom.toISOString() : s1c.currentFrom).slice(0, 10), 9);
  // 2) a year paid up front, earned a twelfth a month
  const s2 = await createSubscription(t, company, user, { partnerId: P.fahad.id, planId: gymY.id, startDate: addMonths(td.slice(0, 8) + "01", -4), notes: "مثال: سنوية مقدماً — إيراد مؤجل" }, D);
  await payAll(s2.id);
  await visits(s2.id, addDays(td, -20), 10);
  // 3) a company with 5 users; this month's invoice unpaid past the grace days
  const s3 = await createSubscription(t, company, user, { partnerId: P.co.id, planId: saas.id, qty: 5, trial: false, startDate: addDays(addMonths(td, -2), -10), notes: "مثال: 5 مستخدمين — فاتورة الشهر متأخرة" }, D);
  const last3 = await t.one(`SELECT i.id FROM sub_moves m JOIN invoices i ON i.id=m.invoice_id WHERE m.subscription_id=$1 AND m.kind='INVOICE' ORDER BY m.period_from DESC LIMIT 1`, [s3.id]);
  await payAll(s3.id, [last3.id]);
  // 4) on the free trial
  await createSubscription(t, company, user, { partnerId: P.reem.id, planId: saas.id, qty: 2, startDate: addDays(td, -5), notes: "مثال: تجربة مجانية" }, D);
  // 5) a member who paused for a trip
  const s5 = await createSubscription(t, company, user, { partnerId: P.noura.id, planId: gymM.id, startDate: addDays(td, -12), waiveSetup: true, notes: "مثال: إيقاف مؤقت" }, D);
  await payAll(s5.id); await visits(s5.id, addDays(td, -12), 4);
  await pause(t, C, user, s5.id, { from: addDays(td, -3), until: addDays(td, 11), reason: "سفر" });
  // 6) a member who left 20 days ago (churn), the unused days credited
  const s6 = await createSubscription(t, company, user, { partnerId: P.abd.id, planId: gymM.id, startDate: addMonths(td, -3), bill: false, notes: "مثال: ألغى الاشتراك" }, D);
  await billDue(t, company, user, addDays(td, -21), s6.id); await payAll(s6.id);
  await cancel(t, company, user, s6.id, { when: "NOW", date: addDays(td, -20), credit: true, reason: "انتقل إلى حي آخر" });
  // 7) a quarterly box cancelling at the period end
  const s7 = await createSubscription(t, company, user, { partnerId: P.cafe.id, planId: box.id, startDate: addDays(addMonths(td, -1), 4), notes: "مثال: يُلغى في نهاية الفترة" }, D);
  await payAll(s7.id);
  await cancel(t, company, user, s7.id, { when: "END", reason: "يجرب مورداً آخر" });
  return { ok: true };
}
