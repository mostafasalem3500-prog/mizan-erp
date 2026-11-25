/**
 * 3.49.0 worked example for manufacturing, flagged as sample data so «حذف البيانات التجريبية» removes it:
 *  • a furniture workshop — a dining table built from a table top (itself made from MDF, with sawdust as a by-product)
 *    and a kit of legs and screws, assembled and painted with a quality check;
 *  • a detergent plant — a 1,000-litre blend (water, SLES, salt, fragrance) mixed and tested, then filled into bottles.
 * Orders in every state: done with a cost variance, in progress, confirmed and short of material, and a draft.
 */
import { Db } from "../db/pool";
import { conflict, today, addDays } from "../lib/core";
import { saveDraft, postInvoice } from "./invoices";
import { BASE } from "./currency";
import { saveWorkCenter, saveBom, createOrder, issue, opAction, produce } from "./manufacturing";

export async function seedManufacturingExample(t: Db, company: any, user: string) {
  const C = company.id;
  if (await t.maybe(`SELECT 1 FROM products WHERE company_id=$1 AND sku='MF-TBL'`, [C])) throw conflict("مثال التصنيع محمَّل من قبل — تجده في أوامر التصنيع وقوائم المواد");
  const eg = BASE === "EGP";
  const D = { isDemo: true };
  const sup = await t.insert("partners", { companyId: C, code: "MF-SUP", name: "مورد الخامات الصناعية (مثال)", isSupplier: true, isCustomer: false, kind: "COMPANY", vatNumber: eg ? "200000002" : "300000000000003", street: "المدينة الصناعية الثانية", buildingNo: "4521", district: "الصناعية", city: eg ? "العاشر من رمضان" : "الرياض", postalCode: "14331", phone: "0551234567", isDemo: true });
  const cust = await t.insert("partners", { companyId: C, code: "MF-CUS", name: "معرض الأثاث الحديث (مثال)", isSupplier: false, isCustomer: true, kind: "COMPANY", vatNumber: eg ? "200000003" : "310000000000003", street: "طريق الملك عبدالعزيز", buildingNo: "7788", district: "الملقا", city: eg ? "القاهرة" : "الرياض", postalCode: "13521", phone: "0561234567", isDemo: true });
  const mk = (sku: string, name: string, unit: string, price: number, sale = 0) => t.insert("products", { companyId: C, sku, name, type: "STOCK", unit, salePrice: sale, purchasePrice: price, taxCode: "S", isActive: true, isDemo: true });
  // furniture
  const mdf = await mk("MF-MDF", "لوح MDF 18 مم (مثال)", "لوح", 85), leg = await mk("MF-LEG", "رجل خشب زان (مثال)", "حبة", 18), screw = await mk("MF-SCR", "برغي خشب (مثال)", "حبة", 0.25), paint = await mk("MF-PNT", "دهان لاكيه (مثال)", "لتر", 35);
  const top = await mk("MF-TOP", "سطح طاولة — نصف مصنّع (مثال)", "حبة", 0), dust = await mk("MF-DST", "نشارة خشب — منتج ثانوي (مثال)", "كجم", 0), kit = await mk("MF-KIT", "طقم تثبيت أرجل (مثال)", "طقم", 0), table = await mk("MF-TBL", "طاولة طعام خشب (مثال)", "حبة", 0, 650);
  // detergent
  const water = await mk("MF-WTR", "ماء مقطّر (مثال)", "لتر", 0.2), sles = await mk("MF-SLS", "مادة منظفة SLES (مثال)", "كجم", 9), salt = await mk("MF-SLT", "ملح صناعي (مثال)", "كجم", 1.2), frag = await mk("MF-FRG", "عطر ليمون (مثال)", "كجم", 60), bottle = await mk("MF-BTL", "عبوة 1 لتر بغطاء (مثال)", "حبة", 0.9);
  const liquid = await mk("MF-LQD", "سائل جلي — خلطة سائبة (مثال)", "لتر", 0), dish = await mk("MF-DSH", "سائل جلي ليمون 1 لتر (مثال)", "حبة", 0, 9);
  const d = await saveDraft(t, company, user, { direction: "PURCHASE", kind: "INVOICE", date: today(), partnerId: sup.id, supplierRef: "MF-5001", isDemo: true,
    lines: [[mdf, 14, 85], [leg, 60, 18], [screw, 300, 0.25], [paint, 12, 35], [water, 2000, 0.2], [sles, 300, 9], [salt, 60, 1.2], [frag, 12, 60], [bottle, 700, 0.9]].map(([p, q, pr]: any) => ({ productId: p.id, qty: q, unitPrice: pr, taxCode: "S" })) } as any);
  await postInvoice(t, company, d.id, user);
  // work centres
  const cnc = await saveWorkCenter(t, C, { code: "MF-CNC", name: "ماكينة CNC للنجارة (مثال)", kind: "MACHINE", rateHour: 45, overheadHour: 55 }, undefined, D);
  const asm = await saveWorkCenter(t, C, { code: "MF-ASM", name: "طاولة التجميع (مثال)", kind: "ASSEMBLY", rateHour: 35, overheadHour: 15, units: 2 }, undefined, D);
  const pnt = await saveWorkCenter(t, C, { code: "MF-PNT", name: "كابينة الدهان (مثال)", kind: "LINE", rateHour: 30, overheadHour: 40 }, undefined, D);
  const mix = await saveWorkCenter(t, C, { code: "MF-MIX", name: "خلاط 2000 لتر (مثال)", kind: "MACHINE", rateHour: 40, overheadHour: 60 }, undefined, D);
  const fill = await saveWorkCenter(t, C, { code: "MF-FIL", name: "خط التعبئة (مثال)", kind: "LINE", rateHour: 30, overheadHour: 30, capacityHours: 16 }, undefined, D);
  // bills of materials
  await saveBom(t, C, { productId: top.id, outputQty: 1, lotQty: 10, lines: [{ componentId: mdf.id, qty: 1, wastePct: 8, opSeq: 10 }], ops: [{ seq: 10, name: "قص وتشطيب الحواف", workCenterId: cnc.id, setupMin: 20, runMin: 12, instructions: "قص 160×90 سم وتدوير الحواف 5 مم" }], byproducts: [{ productId: dust.id, qty: 1.5, sharePct: 3 }], notes: "مثال: نصف مصنّع له منتج ثانوي" }, undefined, D);
  await saveBom(t, C, { productId: kit.id, kind: "KIT", outputQty: 1, lines: [{ componentId: leg.id, qty: 4 }, { componentId: screw.id, qty: 16 }] }, undefined, D);
  await saveBom(t, C, { productId: table.id, outputQty: 1, lotQty: 6, lines: [{ componentId: top.id, qty: 1, opSeq: 10 }, { componentId: kit.id, qty: 1, opSeq: 10 }, { componentId: paint.id, qty: 0.6, wastePct: 5, opSeq: 20 }],
    ops: [{ seq: 10, name: "تجميع وتثبيت الأرجل", workCenterId: asm.id, runMin: 35 }, { seq: 20, name: "دهان وفحص جودة", workCenterId: pnt.id, setupMin: 15, runMin: 25, qc: true, instructions: "طبقتان لاكيه، فحص اللمعان والفقاعات" }] }, undefined, D);
  await saveBom(t, C, { productId: liquid.id, outputQty: 1000, name: "خلطة الليمون القياسية", lines: [{ componentId: water.id, qty: 820, opSeq: 10 }, { componentId: sles.id, qty: 120, wastePct: 2, opSeq: 10 }, { componentId: salt.id, qty: 25, opSeq: 10 }, { componentId: frag.id, qty: 5, wastePct: 1, opSeq: 10 }],
    ops: [{ seq: 10, name: "خلط", workCenterId: mix.id, setupMin: 30, runMin: 0.06 }, { seq: 20, name: "فحص الحموضة واللزوجة", workCenterId: mix.id, runMin: 0.01, qc: true, instructions: "pH بين 6.5 و7.5، اللزوجة 2500–3500 cP" }] }, undefined, D);
  await saveBom(t, C, { productId: dish.id, outputQty: 1, lotQty: 500, lines: [{ componentId: liquid.id, qty: 1, wastePct: 2 }, { componentId: bottle.id, qty: 1 }], ops: [{ seq: 10, name: "تعبئة وتغطية ولصق", workCenterId: fill.id, setupMin: 20, runMin: 0.08 }] }, undefined, D);
  const td = today();
  // 1) tops: done
  const o1 = await createOrder(t, company, user, { productId: top.id, qty: 10, confirm: true, dueDate: td, notes: "مثال: أمر منتهٍ بمنتج ثانوي" }, D);
  await issue(t, C, user, o1.id, { all: true });
  await opAction(t, C, user, o1.id, 10, { action: "finish", minutes: 150, operator: "فهد" });
  await produce(t, C, user, o1.id, { qty: 10 });
  // 2) the blend: done with a normal loss
  const o3 = await createOrder(t, company, user, { productId: liquid.id, qty: 1000, confirm: true, dueDate: td, notes: "مثال: خلطة 1000 لتر خرج منها 985 والفاقد عادي" }, D);
  await issue(t, C, user, o3.id, { all: true });
  await opAction(t, C, user, o3.id, 10, { action: "finish", minutes: 95, operator: "ماجد" });
  await opAction(t, C, user, o3.id, 20, { action: "finish", minutes: 12, qcResult: "PASS", qcNote: "pH 7.1 · لزوجة 3000", operator: "مختبر الجودة" });
  await produce(t, C, user, o3.id, { qty: 985, scrapQty: 15, scrapKind: "NORMAL" });
  // 3) bottles filled: done
  const o4 = await createOrder(t, company, user, { productId: dish.id, qty: 600, confirm: true, dueDate: td, notes: "مثال: تعبئة" }, D);
  await produce(t, C, user, o4.id, { qty: 600 });
  // 4) tables for a customer: in progress, painting still to do
  const o2 = await createOrder(t, company, user, { productId: table.id, qty: 6, confirm: true, priority: 1, plannedStart: td, dueDate: addDays(td, 3), partnerId: cust.id, salesRef: "طلب المعرض 118", notes: "مثال: أمر قيد التنفيذ" }, D);
  await issue(t, C, user, o2.id, { all: true });
  await opAction(t, C, user, o2.id, 10, { action: "finish", minutes: 230, operator: "سالم" });
  // 5) more tables: confirmed but short of tops and legs (shows on the dashboard and in planning)
  await createOrder(t, company, user, { productId: table.id, qty: 8, confirm: true, plannedStart: addDays(td, 2), dueDate: addDays(td, 7), notes: "مثال: مواد ناقصة" }, D);
  // 6) a draft
  await createOrder(t, company, user, { productId: dish.id, qty: 300, plannedStart: addDays(td, 4), dueDate: addDays(td, 6), notes: "مثال: مسودة" }, D);
  // a customer order for tables, for requirements planning
  await saveDraft(t, company, user, { direction: "SALE", kind: "ORDER", date: td, partnerId: cust.id, isDemo: true, lines: [{ productId: table.id, qty: 10, unitPrice: 650, taxCode: "S" }] } as any);
  return { ok: true };
}
