/**
 * Accounting self-check ("فحص الدورة المحاسبية"):
 * builds a throw-away company inside ONE transaction, runs a scripted year of business through the real
 * services (opening capital → purchases → supplier payments → sales → receipts → sales return →
 * purchase return → expense → stock count → VAT return → year-end closing → next-year activity),
 * compares every ledger, sub-ledger and final account with figures computed by hand, then ROLLS BACK.
 * Nothing is written to the database; real companies are never touched.
 */
import { tx, Db } from "../db/pool";
import { r2 } from "../lib/core";
import { bootstrapCompany } from "../routes/auth";
import { saveDraft, postInvoice } from "./invoices";
import { createPayment } from "./payments";
import { createExpense } from "./expenses";
import { stockAdjustment, manualJournal, fileVatReturn } from "./misc";
import { closeFiscalYear } from "./closing";
import { reverse } from "../accounting/engine";
import { openSession, posSale, closeSession } from "./pos";
import { createAsset, runDepreciation } from "./assets";
import * as rep from "./reports";

export interface Check { group: string; name: string; expected: any; actual: any; ok: boolean }
export interface SelfCheckResult { ok: boolean; passed: number; failed: number; durationMs: number; scenario: string[]; checks: Check[]; error?: string }

class Rollback extends Error {}

export async function runAccountingSelfCheck(): Promise<SelfCheckResult> {
  const started = Date.now();
  const checks: Check[] = [];
  const scenario: string[] = [];
  let fatal: string | undefined;
  const eq = (group: string, name: string, expected: any, actual: any) => {
    const ok = typeof expected === "number" ? Math.abs(Number(actual) - expected) < 0.005 : expected === actual;
    checks.push({ group, name, expected, actual: typeof expected === "number" ? r2(Number(actual)) : actual, ok });
  };
  const rejects = async (t: Db, group: string, name: string, fn: () => Promise<any>) => {
    let msg = "";
    try { await t.savepoint(fn); } catch (e: any) { msg = e.message || "rejected"; }
    checks.push({ group, name, expected: "مرفوض", actual: msg ? `مرفوض: ${msg.slice(0, 90)}` : "قُبل!", ok: !!msg });
  };

  try {
    await tx(async (t) => {
      const U = "فحص آلي";
      // ── company, master data ──────────────────────────────────────────────
      const user = await t.insert("users", { email: `selfcheck-${Date.now()}@mizan.invalid`, passwordHash: "-", fullName: "فحص الدورة المحاسبية" });
      const co0 = await bootstrapCompany(t, { nameAr: "شركة فحص الدورة المحاسبية", vatNumber: "399999999900003", crNumber: "1010010000", city: "مكة المكرمة" }, user.id, "PRO");
      await t.exec(`UPDATE companies SET building_no='1234', postal_code='24243', street='شارع الاختبار', district='العزيزية' WHERE id=$1`, [co0.id]);
      const co = await t.one(`SELECT * FROM companies WHERE id=$1`, [co0.id]);
      const C = co.id;
      const acc = async (key: string) => (await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND system_key=$2`, [C, key])).id;
      const bank = await acc("BANK"), capital = await acc("CAPITAL"), rent = await acc("RENT");
      const wh = (await t.one(`SELECT id FROM warehouses WHERE company_id=$1`, [C])).id;
      const P1 = await t.insert("products", { companyId: C, sku: "T-P1", name: "صنف اختبار 1", type: "STOCK", salePrice: 80, purchasePrice: 50, taxCode: "S" });
      const P2 = await t.insert("products", { companyId: C, sku: "T-P2", name: "صنف اختبار 2", type: "STOCK", salePrice: 300, purchasePrice: 200, taxCode: "S" });
      const S1 = await t.insert("products", { companyId: C, sku: "T-S1", name: "خدمة تركيب", type: "SERVICE", salePrice: 1000, purchasePrice: 0, taxCode: "S" });
      const supA = await t.insert("partners", { companyId: C, code: "S-A", name: "المورد أ", isSupplier: true, vatNumber: "300000000000003", kind: "COMPANY" });
      const supB = await t.insert("partners", { companyId: C, code: "S-B", name: "المورد ب", isSupplier: true, vatNumber: "311111111111113", kind: "COMPANY" });
      const cusX = await t.insert("partners", { companyId: C, code: "C-X", name: "العميل س (منشأة)", isCustomer: true, vatNumber: "322222222222223", kind: "COMPANY", street: "طريق الملك", buildingNo: "2222", city: "جدة", postalCode: "23435", district: "الروضة" });
      const cusY = await t.insert("partners", { companyId: C, code: "C-Y", name: "العميل ص (فرد)", isCustomer: true, kind: "INDIVIDUAL" });
      const doc = async (direction: "SALE" | "PURCHASE", kind: string, date: string, partnerId: string, lines: any[], extra: any = {}) => {
        const d = await saveDraft(t, co, U, { direction, kind, date, partnerId, warehouseId: wh, lines, pricesIncludeVat: false, ...extra } as any);
        return postInvoice(t, co, d.id, U, { overrideCreditLimit: true });
      };

      // ── 2025 scenario ─────────────────────────────────────────────────────
      await manualJournal(t, C, U, { date: "2025-01-01", memo: "رأس المال", lines: [{ accountId: bank, debit: 100000 }, { accountId: capital, credit: 100000 }] });
      scenario.push("1) قيد رأس المال 100,000 في البنك");
      const pA = await doc("PURCHASE", "INVOICE", "2025-01-10", supA.id, [{ productId: P1.id, qty: 100, unitPrice: 50, taxCode: "S" }], { supplierRef: "A-1" });
      const pB = await doc("PURCHASE", "INVOICE", "2025-01-12", supB.id, [{ productId: P2.id, qty: 40, unitPrice: 200, taxCode: "S" }], { supplierRef: "B-1" });
      scenario.push("2) شراء آجل: 100 × 50 من المورد أ (5,750 شامل) و 40 × 200 من المورد ب (9,200 شامل)");
      await createPayment(t, C, U, { direction: "OUT", partnerId: supA.id, date: "2025-02-01", amount: 5750, accountId: bank });
      await createPayment(t, C, U, { direction: "OUT", partnerId: supB.id, date: "2025-02-01", amount: 4000, accountId: bank });
      scenario.push("3) سداد المورد أ بالكامل 5,750 وسداد جزئي للمورد ب 4,000");
      const sX = await doc("SALE", "INVOICE", "2025-03-01", cusX.id, [{ productId: P1.id, qty: 60, unitPrice: 80, taxCode: "S" }]);
      const sY = await doc("SALE", "INVOICE", "2025-03-05", cusY.id, [{ productId: P2.id, qty: 10, unitPrice: 300, taxCode: "S" }, { productId: S1.id, qty: 1, unitPrice: 1000, taxCode: "S" }]);
      scenario.push("4) بيع آجل: 60 × 80 للعميل س (5,520) و 10 × 300 + خدمة 1,000 للعميل ص (4,600)");
      await createPayment(t, C, U, { direction: "IN", partnerId: cusX.id, date: "2025-03-20", amount: 5520, accountId: bank });
      await createPayment(t, C, U, { direction: "IN", partnerId: cusY.id, date: "2025-03-20", amount: 2000, accountId: bank });
      scenario.push("5) تحصيل كامل من س 5,520 وجزئي من ص 2,000");
      await doc("SALE", "CREDIT_NOTE", "2025-04-01", cusX.id, [{ productId: P1.id, qty: 5, unitPrice: 80, taxCode: "S" }], { originId: sX.id, reason: "إرجاع بضاعة" });
      scenario.push("6) مرتجع مبيعات من س: 5 × 80 (460 شامل)");
      await doc("PURCHASE", "CREDIT_NOTE", "2025-04-05", supB.id, [{ productId: P2.id, qty: 5, unitPrice: 200, taxCode: "S" }], { originId: pB.id, reason: "مرتجع" });
      scenario.push("7) مرتجع مشتريات للمورد ب: 5 × 200 (1,150 شامل)");
      await createExpense(t, C, U, { date: "2025-04-30", accountId: rent, description: "إيجار المعرض", amount: 3000, taxCode: "S", payAccountId: bank });
      scenario.push("8) مصروف إيجار 3,000 + ضريبة 450 من البنك");
      await stockAdjustment(t, C, U, { date: "2025-06-30", warehouseId: wh, kind: "COUNT", lines: [{ productId: P1.id, qty: 44 }] } as any);
      scenario.push("9) جرد: الصنف 1 الفعلي 44 بدل 45 (عجز 50)");

      // ── controls that must be refused ────────────────────────────────────
      await rejects(t, "ضوابط الترحيل", "قيد غير متوازن", () => manualJournal(t, C, U, { date: "2025-07-01", lines: [{ accountId: bank, debit: 100 }, { accountId: capital, credit: 90 }] }));
      await rejects(t, "ضوابط الترحيل", "بيع كمية أكبر من المخزون", () => doc("SALE", "INVOICE", "2025-07-01", cusY.id, [{ productId: P2.id, qty: 999, unitPrice: 300, taxCode: "S" }]));
      await rejects(t, "ضوابط الترحيل", "مرتجع يتجاوز الكمية المباعة", () => doc("SALE", "CREDIT_NOTE", "2025-07-01", cusX.id, [{ productId: P1.id, qty: 100, unitPrice: 80, taxCode: "S" }], { originId: sX.id, reason: "تجاوز" }));
      await rejects(t, "ضوابط الترحيل", "تخصيص سند بأكثر من المتبقي على الفاتورة", () => createPayment(t, C, U, { direction: "IN", partnerId: cusY.id, date: "2025-07-01", amount: 9000, accountId: bank, allocations: [{ invoiceId: sY.id, amount: 9000 }] }));
      await rejects(t, "ضوابط الترحيل", "إشعار دائن بدون سبب (متطلب الهيئة)", () => doc("SALE", "CREDIT_NOTE", "2025-07-01", cusX.id, [{ productId: P1.id, qty: 1, unitPrice: 80, taxCode: "S" }], { originId: sX.id, reason: "" }));

      // ── 2025 expected figures (computed by hand) ─────────────────────────
      const Y25 = { from: "2025-01-01", to: "2025-12-31" };
      const tb = await rep.trialBalance(t, C, Y25);
      const bal = (code: string) => { const r = tb.rows.find((x: any) => x.code === code); return r ? Number(r.closing) : 0; };
      const code = async (key: string) => (await t.one(`SELECT code FROM accounts WHERE company_id=$1 AND system_key=$2`, [C, key])).code;
      eq("ميزان المراجعة 2025", "الميزان متوازن", true, tb.balanced);
      eq("ميزان المراجعة 2025", "البنك = 100,000 − 5,750 − 4,000 + 5,520 + 2,000 − 3,450", 94320, bal(await code("BANK")));
      eq("ميزان المراجعة 2025", "العملاء (س −460 + ص 2,600)", 2140, bal(await code("AR")));
      eq("ميزان المراجعة 2025", "الموردون (ب 9,200 − 4,000 − 1,150)", -4050, bal(await code("AP")));
      eq("ميزان المراجعة 2025", "المخزون (44 × 50 + 25 × 200)", 7200, bal(await code("INVENTORY")));
      eq("ميزان المراجعة 2025", "ضريبة المخرجات (720 + 450 + 150 − 60)", -1260, bal(await code("VAT_OUT")));
      eq("ميزان المراجعة 2025", "ضريبة المدخلات (750 + 1,200 − 150 + 450)", 2250, bal(await code("VAT_IN")));

      const is = await rep.incomeStatement(t, C, Y25);
      eq("قائمة الدخل 2025", "المبيعات (4,800 + 3,000 + 1,000)", 8800, is.sales.total);
      eq("قائمة الدخل 2025", "مردودات المبيعات", -400, is.returns.total);
      eq("قائمة الدخل 2025", "صافي المبيعات", 8400, is.netSales);
      eq("قائمة الدخل 2025", "تكلفة المبيعات (3,000 + 2,000 − 250 + عجز 50)", 4800, is.cogs.total);
      eq("قائمة الدخل 2025", "مجمل الربح", 3600, is.grossProfit);
      eq("قائمة الدخل 2025", "المصروفات التشغيلية (الإيجار)", 3000, is.opex.total);
      eq("قائمة الدخل 2025", "صافي الربح", 600, is.net);

      const st = async (p: any, role: string) => (await rep.partnerStatement(t, C, p.id, { ...Y25, role })).closing;
      eq("كشوف الحسابات", "كشف العميل س (دائن بالمرتجع)", -460, await st(cusX, "CUSTOMER"));
      eq("كشوف الحسابات", "كشف العميل ص", 2600, await st(cusY, "CUSTOMER"));
      eq("كشوف الحسابات", "كشف المورد أ", 0, await st(supA, "SUPPLIER"));
      eq("كشوف الحسابات", "كشف المورد ب", 4050, await st(supB, "SUPPLIER"));
      const agC = await rep.aging(t, C, { to: "2025-12-31" });
      const agS = await rep.aging(t, C, { to: "2025-12-31", role: "SUPPLIER" });
      eq("كشوف الحسابات", "أعمار ديون العملاء (فواتير مفتوحة)", 2600, agC.totals.total);
      eq("كشوف الحسابات", "أعمار ديون الموردين (فاتورة ب المتبقية)", 4050, agS.totals.total);

      const inv = await rep.inventoryValuation(t, C, {});
      eq("المخزون", "قيمة المخزون من الأرصدة = الأستاذ", true, inv.matches);
      eq("المخزون", "كمية الصنف 1", 44, Number(inv.rows.find((r: any) => r.sku === "T-P1")?.qty || 0));
      eq("المخزون", "كمية الصنف 2", 25, Number(inv.rows.find((r: any) => r.sku === "T-P2")?.qty || 0));

      const vat = await rep.vatReturn(t, C, Y25);
      const box = (n: number): any => vat.boxes.find((b: any) => b.no === n) || {};
      eq("الإقرار الضريبي 2025", "البند 1 مبيعات خاضعة (صافي)", 8400, box(1).net);
      eq("الإقرار الضريبي 2025", "البند 1 ضريبة المبيعات", 1260, box(1).vat);
      eq("الإقرار الضريبي 2025", "البند 7 مشتريات خاضعة (5,000 + 8,000 − 1,000 + 3,000)", 15000, box(7).net);
      eq("الإقرار الضريبي 2025", "البند 7 ضريبة المشتريات", 2250, box(7).vat);
      eq("الإقرار الضريبي 2025", "صافي الضريبة (مستردة)", -990, vat.net);
      eq("الإقرار الضريبي 2025", "الإقرار مطابق للأستاذ", true, vat.reconciled);

      const cf = await rep.cashFlow(t, C, Y25);
      eq("التدفقات النقدية 2025", "صافي التغير في النقدية = رصيد البنك", 94320, cf.net);

      const docs = await t.rows(
        `SELECT i.number, i.direction, i.kind, i.total, COALESCE((SELECT SUM(CASE WHEN a.system_key='AR' THEN l.debit-l.credit ELSE l.credit-l.debit END) FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE l.entry_id=i.journal_id AND a.system_key IN ('AR','AP')),0) party
         FROM invoices i WHERE i.company_id=$1 AND i.status='POSTED'`, [C]);
      const mism = docs.filter((d) => Math.abs(Math.abs(Number(d.party)) - Number(d.total)) > 0.005);
      eq("ترحيل المستندات", `كل مستند مرحّل له قيد بطرف العميل/المورد = إجماليه (${docs.length} مستند)`, 0, mism.length);
      const noJe = await t.one(`SELECT COUNT(*)::int c FROM invoices WHERE company_id=$1 AND status='POSTED' AND journal_id IS NULL`, [C]);
      eq("ترحيل المستندات", "لا يوجد مستند مرحّل بلا قيد", 0, noJe.c);

      // ── VAT settlement & year-end closing ────────────────────────────────
      await fileVatReturn(t, C, U, "2025-01-01", "2025-12-31");
      scenario.push("10) تقديم الإقرار الضريبي لسنة 2025 (قيد تسوية الضريبة)");
      const tb2 = await rep.trialBalance(t, C, Y25);
      const bal2 = (c: string) => Number(tb2.rows.find((x: any) => x.code === c)?.closing || 0);
      eq("الإقرار الضريبي 2025", "بعد التسوية: حساب الضريبة المستحقة (مدين/مسترد)", 990, bal2(await code("VAT_PAYABLE")));
      eq("الإقرار الضريبي 2025", "بعد التسوية: ضريبة المخرجات صفر", 0, bal2(await code("VAT_OUT")));

      const fy = await t.one(`SELECT id FROM fiscal_years WHERE company_id=$1 AND start_date='2025-01-01'`, [C]);
      const cl = await closeFiscalYear(t, C, U, fy.id);
      scenario.push("11) إقفال السنة المالية 2025");
      eq("الإقفال السنوي", "صافي الربح المرحّل للأرباح المبقاة", 600, cl.netIncome);
      const bs = await rep.balanceSheet(t, C, { to: "2025-12-31" });
      eq("الميزانية العمومية 31/12/2025", "الميزانية متوازنة", true, bs.balanced);
      eq("الميزانية العمومية 31/12/2025", "إجمالي الأصول (بنك 94,320 + عملاء 2,140 + مخزون 7,200)", 103660, bs.totalAssets);
      eq("الميزانية العمومية 31/12/2025", "إجمالي الخصوم (موردون 4,050 − ضريبة مستردة 990)", 3060, bs.totalLiab);
      eq("الميزانية العمومية 31/12/2025", "حقوق الملكية (100,000 + 600)", 100600, bs.totalEquity);
      eq("الميزانية العمومية 31/12/2025", "نتيجة غير مقفلة بعد الإقفال", 0, bs.currentResult);
      const is2 = await rep.incomeStatement(t, C, Y25);
      eq("الإقفال السنوي", "قائمة دخل 2025 بعد الإقفال ما زالت تُظهر الربح", 600, is2.net);
      const tbRe = await rep.trialBalance(t, C, Y25);
      eq("الإقفال السنوي", "الأرباح المبقاة بعد الإقفال", -600, Number(tbRe.rows.find((x: any) => x.code === "3104")?.closing || 0));
      await rejects(t, "الإقفال السنوي", "منع الترحيل بتاريخ داخل سنة مقفلة", () => manualJournal(t, C, U, { date: "2025-12-15", lines: [{ accountId: bank, debit: 10 }, { accountId: capital, credit: 10 }] }));

      // ── 2026: opening balances carried, new activity, reversal ───────────
      const sZ = await doc("SALE", "INVOICE", "2026-01-15", cusY.id, [{ productId: P1.id, qty: 4, unitPrice: 80, taxCode: "S" }]);
      await createPayment(t, C, U, { direction: "IN", partnerId: cusY.id, date: "2026-01-16", amount: 1000, accountId: bank });
      const wrong = await manualJournal(t, C, U, { date: "2026-01-20", memo: "قيد خاطئ", lines: [{ accountId: rent, debit: 500 }, { accountId: bank, credit: 500 }] });
      await reverse(t, C, wrong!.id, "2026-01-21", "عكس قيد خاطئ", U);
      scenario.push("12) 2026: بيع 4 × 80 للعميل ص (368)، تحصيل 1,000، قيد خاطئ 500 ثم عكسه");
      const tb26 = await rep.trialBalance(t, C, { from: "2026-01-01", to: "2026-12-31" });
      const o26 = (c: string) => Number(tb26.rows.find((x: any) => x.code === c)?.opening || 0);
      const c26 = (c: string) => Number(tb26.rows.find((x: any) => x.code === c)?.closing || 0);
      eq("أرصدة 2026", "الرصيد الافتتاحي للبنك = ختامي 2025", 94320, o26(await code("BANK")));
      eq("أرصدة 2026", "الرصيد الافتتاحي للأرباح المبقاة", -600, o26("3104"));
      eq("أرصدة 2026", "الإيرادات تبدأ 2026 من صفر", 0, o26(await code("SALES")));
      eq("أرصدة 2026", "العملاء آخر المدة (2,140 + 368 − 1,000)", 1508, c26(await code("AR")));
      eq("أرصدة 2026", "البنك آخر المدة (94,320 + 1,000؛ القيد المعكوس لا أثر له)", 95320, c26(await code("BANK")));
      eq("أرصدة 2026", "الإيجار في 2026 بعد العكس", 0, c26(await code("RENT")));
      eq("أرصدة 2026", "ميزان 2026 متوازن", true, tb26.balanced);
      const is26 = await rep.incomeStatement(t, C, { from: "2026-01-01", to: "2026-12-31" });
      eq("أرصدة 2026", "ربح 2026 (320 − تكلفة 4 × 50)", 120, is26.net);
      const bs26 = await rep.balanceSheet(t, C, { to: "2026-12-31" });
      eq("أرصدة 2026", "ميزانية 2026 متوازنة", true, bs26.balanced);
      eq("أرصدة 2026", "حقوق الملكية (100,600 + 120)", 100720, bs26.totalEquity);
      void sZ;

      // ── POS shift + fixed asset (2026) ────────────────────────────────────
      const cash = await acc("CASH"), posCash = await acc("POS_CASH");
      const glBal = async (id: string) => Number((await t.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id=$1 AND e.status='POSTED'`, [id])).b);
      const cash0 = await glBal(cash);
      const sess = await openSession(t, C, { id: user.id, name: U }, 500, wh);
      const ps = await posSale(t, co, { id: user.id, name: U }, { sessionId: sess.id, lines: [{ productId: P2.id, qty: 2 }], tenders: [{ method: "CASH", amount: null }] } as any);
      eq("نقطة البيع", "فاتورة نقطة البيع: 2 × 300 + 15%", 690, Number(ps.total));
      const closed = await closeSession(t, C, U, sess.id, 1190, true);
      eq("نقطة البيع", "إغلاق الوردية: النقدية المتوقعة (500 عهدة + 690)", 1190, Number(closed.expectedCash));
      eq("نقطة البيع", "فرق العد عند الإغلاق", 0, Number(closed.difference));
      eq("نقطة البيع", "توريد نقدية المبيعات للصندوق الرئيسي", 690, (await glBal(cash)) - cash0);
      eq("نقطة البيع", "صندوق نقاط البيع بعد التوريد", 0, await glBal(posCash));
      scenario.push("13) وردية نقطة بيع: بيع نقدي 2 × 300 (690)، عدّ 1,190 وتوريد المبيعات للصندوق");
      const fa = await createAsset(t, C, U, { name: "جهاز اختبار", acquisitionDate: "2026-01-01", cost: 12000, vatAmount: 1800, salvageValue: 0, usefulLifeMonths: 12, payAccountId: bank } as any);
      await runDepreciation(t, C, U, "2026-06-30");
      const far = await t.one(`SELECT accumulated, (SELECT COUNT(*)::int FROM asset_depreciations d WHERE d.asset_id=f.id) n FROM fixed_assets f WHERE id=$1`, [fa.id]);
      eq("الأصول الثابتة", "عدد أشهر الإهلاك يناير–يونيو", 6, Number(far.n));
      eq("الأصول الثابتة", "مجمع الإهلاك 6 × 1,000", 6000, Number(far.accumulated));
      eq("الأصول الثابتة", "مجمع الإهلاك في الأستاذ = السجل", -Number(far.accumulated), await glBal(await acc("ACC_DEP")));
      scenario.push("14) شراء أصل 12,000 + ضريبة 1,800 وإهلاك شهري حتى 30/06/2026");
      const isF = await rep.incomeStatement(t, C, { from: "2026-01-01", to: "2026-12-31" });
      eq("أرصدة 2026", "صافي 2026 (120 + ربح نقطة البيع 200 − إهلاك 6,000)", -5680, isF.net);
      const bsF = await rep.balanceSheet(t, C, { to: "2026-12-31" });
      eq("أرصدة 2026", "الميزانية متوازنة بعد نقطة البيع والأصل", true, bsF.balanced);

      const integ = await rep.integrity(t, C);
      for (const c of integ.checks) checks.push({ group: "فحوص التطابق الآلية", name: c.name, expected: c.b, actual: c.a, ok: c.ok });

      throw new Rollback(); // discard everything
    });
  } catch (e: any) {
    if (!(e instanceof Rollback)) fatal = e?.message || String(e);
  }
  const failed = checks.filter((c) => !c.ok).length + (fatal ? 1 : 0);
  return { ok: !fatal && failed === 0, passed: checks.filter((c) => c.ok).length, failed, durationMs: Date.now() - started, scenario, checks, error: fatal };
}
