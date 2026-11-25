/**
 * 3.50.0 worked example for rentals, flagged as sample data: equipment, a car, a furnished unit and an events tent,
 * with contracts in every state — a monthly lease billed each month, equipment out now, a car returned late with a
 * cleaning charge and its deposit settled, a forklift reserved for next week, a tent overdue, and a maintenance window.
 */
import { Db } from "../db/pool";
import { conflict, today, addDays, addMonths } from "../lib/core";
import { saveAsset, addMaintenance, createContract, deliver, receiveDeposit, billDue, returnContract, settleDeposit } from "./rentals";

export async function seedRentalExample(t: Db, company: any, user: string) {
  const C = company.id;
  if (await t.maybe(`SELECT 1 FROM rental_assets WHERE company_id=$1 AND code='RX-GEN'`, [C])) throw conflict("مثال التأجير محمَّل من قبل — تجده في أصول التأجير والعقود");
  const D = { isDemo: true };
  const cash = (await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND system_key IN ('CASH','BANK') AND NOT is_group ORDER BY system_key='CASH' DESC LIMIT 1`, [C])).id;
  const gen = await saveAsset(t, C, { code: "RX-GEN", name: "مولد كهرباء 100 ك.ف (مثال)", kind: "EQUIPMENT", category: "مولدات", identifier: "GEN-100-07", rateDay: 450, rateWeek: 2500, rateMonth: 8000, deposit: 3000, costValue: 85000, meter: 1240, meterUnit: "ساعة تشغيل" }, undefined, D);
  const fork = await saveAsset(t, C, { code: "RX-FRK", name: "رافعة شوكية 3 طن (مثال)", kind: "EQUIPMENT", category: "رافعات", identifier: "FL-3T-02", rateHour: 120, rateDay: 600, rateWeek: 3500, rateMonth: 11000, deposit: 5000, costValue: 120000, meter: 3310, meterUnit: "ساعة تشغيل" }, undefined, D);
  const car = await saveAsset(t, C, { code: "RX-CAR", name: "سيارة سيدان 2025 (مثال)", kind: "VEHICLE", category: "سيارات", identifier: "أ ب ج 1234", rateDay: 180, rateWeek: 1100, rateMonth: 3800, deposit: 1500, costValue: 110000, meter: 18450, meterUnit: "كم" }, undefined, D);
  const flat = await saveAsset(t, C, { code: "RX-APT", name: "شقة مفروشة غرفتين — برج الواحة 304 (مثال)", kind: "UNIT", category: "وحدات سكنية", identifier: "304", rateMonth: 4500, deposit: 4500, costValue: 650000 }, undefined, D);
  const tent = await saveAsset(t, C, { code: "RX-TNT", name: "خيمة مناسبات 10×20 م (مثال)", kind: "EQUIPMENT", category: "مناسبات", rateDay: 900, rateWeek: 5000, deposit: 2000, costValue: 40000 }, undefined, D);
  const mk = (code: string, name: string, phone: string) => t.insert("partners", { companyId: C, code, name, isCustomer: true, isSupplier: false, kind: "INDIVIDUAL", phone, city: "الرياض", isDemo: true });
  const p1 = await mk("RX-C1", "مؤسسة البناء الحديث (مثال)", "0551112233"), p2 = await mk("RX-C2", "خالد العتيبي (مثال)", "0552223344"), p3 = await mk("RX-C3", "شركة الفعاليات الذهبية (مثال)", "0553334455");
  const td = today();
  // 1) a furnished unit, month by month
  const c1 = await createContract(t, C, user, { partnerId: p2.id, startDate: addMonths(td, -2), endDate: addDays(addMonths(td, 10), -1), billing: "MONTHLY", lines: [{ assetId: flat.id, unit: "MONTH" }], notes: "مثال: إيجار شهري يُفوتر كل شهر" }, D);
  await receiveDeposit(t, C, user, c1.id, { amount: 4500, accountId: cash, date: addMonths(td, -2) });
  await deliver(t, company, user, c1.id, { date: addMonths(td, -2) });
  await billDue(t, company, user, td, c1.id);
  // 2) a generator out now, billed up front
  const c2 = await createContract(t, C, user, { partnerId: p1.id, startDate: addDays(td, -5), endDate: addDays(td, 2), lines: [{ assetId: gen.id }], notes: "مثال: معدة مؤجرة الآن" }, D);
  await receiveDeposit(t, C, user, c2.id, { amount: 3000, accountId: cash, date: addDays(td, -5) });
  await deliver(t, company, user, c2.id, { date: addDays(td, -5), lines: [{ assetId: gen.id, meterOut: 1240 }] });
  // 3) a car returned two days late with a cleaning charge; the deposit pays it and the rest goes back
  const c3 = await createContract(t, C, user, { partnerId: p2.id, startDate: addDays(td, -10), endDate: addDays(td, -4), lines: [{ assetId: car.id }], notes: "مثال: إرجاع متأخر وتسوية التأمين" }, D);
  await receiveDeposit(t, C, user, c3.id, { amount: 1500, accountId: cash, date: addDays(td, -10) });
  await deliver(t, company, user, c3.id, { date: addDays(td, -10), lines: [{ assetId: car.id, meterOut: 18450 }] });
  await returnContract(t, company, user, c3.id, { date: addDays(td, -2), lines: [{ assetId: car.id, meterIn: 19320, condition: "يحتاج تنظيفاً داخلياً" }], charges: [{ description: "تنظيف داخلي", amount: 150 }] });
  await settleDeposit(t, C, user, c3.id, { accountId: cash, date: addDays(td, -2) });
  // 4) a forklift reserved for next week, and its maintenance after it
  await createContract(t, C, user, { partnerId: p1.id, startDate: addDays(td, 3), endDate: addDays(td, 9), lines: [{ assetId: fork.id }], reserve: true, notes: "مثال: حجز قادم" }, D);
  await addMaintenance(t, C, fork.id, { fromDate: addDays(td, 12), toDate: addDays(td, 13), description: "صيانة دورية 500 ساعة", cost: 900 }, D);
  // 5) an events tent not back yet
  const c5 = await createContract(t, C, user, { partnerId: p3.id, startDate: addDays(td, -6), endDate: addDays(td, -2), lines: [{ assetId: tent.id }], notes: "مثال: متأخر عن الإرجاع" }, D);
  await deliver(t, company, user, c5.id, { date: addDays(td, -6) });
  return { ok: true };
}
