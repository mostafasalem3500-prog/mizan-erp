/**
 * Egypt edition self-check: a throw-away Egyptian company inside ONE transaction, scripted business through the real
 * services (14% VAT, withholding & Form 41, payroll with social insurance / salary tax / martyrs fund, corporate income
 * tax with withholding credits, ETA e-invoice and e-receipt documents), compared with figures computed by hand, then ROLLED BACK.
 */
import { tx, Db } from "../db/pool";
import { r2 } from "../lib/core";
import { bootstrapCompany } from "../routes/auth";
import { saveDraft, postInvoice } from "./invoices";
import { createPayment } from "./payments";
import { createExpense } from "./expenses";
import { manualJournal } from "./misc";
import { createRun, postRun } from "./payroll";
import * as rep from "./reports";
import { finalAccounts } from "./round27";
import { annualSalaryTax, form41, fileForm41, incomeTaxCompute, incomeTaxPost, incomeTaxSettle } from "./egypt";
import { previewDocument, buildReceipt, validateReceipt, serialize, sha256hex } from "../eta/eta";
import { amountToArabicWords } from "../lib/tafqeet";
import type { Check, SelfCheckResult } from "./selfcheck";

class Rollback extends Error {}

export async function runEgyptSelfCheck(): Promise<SelfCheckResult> {
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
      const user = await t.insert("users", { email: `selfcheck-eg-${Date.now()}@mizan.invalid`, passwordHash: "-", fullName: "فحص النسخة المصرية" });
      const co0 = await bootstrapCompany(t, { nameAr: "شركة فحص النسخة المصرية", vatNumber: "123456789", city: "القاهرة" }, user.id, "PRO");
      const co = await t.one(`SELECT * FROM companies WHERE id=$1`, [co0.id]);
      const C = co.id;
      eq("إعداد المنشأة", "العملة الأساسية جنيه مصري", "EGP", co.currency);
      eq("إعداد المنشأة", "دورية إقرار القيمة المضافة شهرية", "MONTHLY", co.vatPeriod);
      const acc = async (key: string) => (await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND system_key=$2`, [C, key])).id;
      const bal = async (key: string, to = "2026-12-31") => r2((await t.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND a.system_key=$2 AND e.status='POSTED' AND e.date <= $3`, [C, key, to])).b);
      const bank = await acc("BANK"), capital = await acc("CAPITAL"), util = await acc("UTILITIES");
      eq("دليل الحسابات المصري", "حساب «ضريبة كسب العمل المستحقة» موجود", true, !!(await acc("SALARY_TAX_PAYABLE")));
      eq("دليل الحسابات المصري", "حساب «ضرائب مخصومة منا تحت حساب الضريبة» موجود", true, !!(await acc("EG_WHT_CREDIT")));
      await t.insert("eta_configs", { companyId: C, environment: "MOCK", rin: "123456789", activityCode: "4620", governate: "القاهرة", regionCity: "مدينة نصر", street: "شارع عباس العقاد", buildingNumber: "10", posSerial: "POS-0001" });
      const wh = (await t.one(`SELECT id FROM warehouses WHERE company_id=$1`, [C])).id;
      const P1 = await t.insert("products", { companyId: C, sku: "P1", name: "منتج اختبار", type: "STOCK", salePrice: 100, purchasePrice: 60, taxCode: "S", etaItemType: "EGS", etaItemCode: "EG-123456789-P1", etaUnitType: "EA" });
      const S1 = await t.insert("products", { companyId: C, sku: "S1", name: "خدمة استشارية", type: "SERVICE", salePrice: 30000, purchasePrice: 0, taxCode: "S", etaItemType: "EGS", etaItemCode: "EG-123456789-S1", etaUnitType: "HUR" });
      const NOC = await t.insert("products", { companyId: C, sku: "NC", name: "صنف GS1 بلا باركود", type: "SERVICE", salePrice: 50, purchasePrice: 0, taxCode: "S", etaItemType: "GS1" });
      const sup = await t.insert("partners", { companyId: C, code: "S1", name: "مورد مصري", isSupplier: true, vatNumber: "200000001", kind: "COMPANY", whtType: "SUPPLIES", country: "EG" });
      const cusB = await t.insert("partners", { companyId: C, code: "C1", name: "عميل شركة", isCustomer: true, vatNumber: "300000002", kind: "COMPANY", country: "EG", governate: "الجيزة", city: "الدقي", street: "شارع التحرير", buildingNo: "5" });
      const cusBad = await t.insert("partners", { companyId: C, code: "C2", name: "عميل شركة بلا رقم", isCustomer: true, kind: "COMPANY", country: "EG", etaType: "B" });
      const doc = async (direction: "SALE" | "PURCHASE", kind: string, date: string, partnerId: string, lines: any[], extra: any = {}) => {
        const d = await saveDraft(t, co, U, { direction, kind, date, partnerId, warehouseId: wh, lines, pricesIncludeVat: false, ...extra } as any);
        return postInvoice(t, co, d.id, U, { overrideCreditLimit: true });
      };

      await manualJournal(t, C, U, { date: "2026-01-02", memo: "رأس المال", lines: [{ accountId: bank, debit: 200000 }, { accountId: capital, credit: 200000 }] });
      const pur = await doc("PURCHASE", "INVOICE", "2026-01-10", sup.id, [{ productId: P1.id, qty: 100, unitPrice: 60, taxCode: "S" }]);
      eq("ضريبة القيمة المضافة 14%", "فاتورة شراء 6,000 → ضريبة 840", 840, pur.vatTotal);
      const pay = await createPayment(t, C, U, { direction: "OUT", partnerId: sup.id, date: "2026-01-20", amount: 6840, accountId: bank });
      eq("الخصم تحت حساب الضريبة", "سداد المورد: خصم 1% توريدات على 6,000 قبل الضريبة = 60", 60, pay.whtAmount);
      eq("الخصم تحت حساب الضريبة", "المحوَّل للمورد 6,840 − 60", 6780, pay.netPaid);
      scenario.push("1) رأس مال 200,000؛ شراء 100 × 60 + ضريبة 14% وسداده مع خصم 1% تحت حساب الضريبة");

      const sale = await doc("SALE", "INVOICE", "2026-02-01", cusB.id, [{ productId: P1.id, qty: 50, unitPrice: 100, taxCode: "S" }]);
      eq("ضريبة القيمة المضافة 14%", "فاتورة بيع 5,000 → ضريبة 700 وإجمالي 5,700", 5700, sale.total);
      eq("منظومة الفاتورة الإلكترونية", "فاتورة البيع لعميل شركة تنتظر الإرسال كفاتورة إلكترونية", "INVOICE/PENDING", `${sale.etaKind}/${sale.etaStatus}`);
      const rec = await createPayment(t, C, U, { direction: "IN", partnerId: cusB.id, date: "2026-02-05", amount: 5700, accountId: bank, wht: { type: "SUPPLIES" } });
      eq("الخصم تحت حساب الضريبة", "تحصيل: العميل خصم 1% من 5,000 = 50 (رصيد مدين لنا)", 50, rec.whtAmount);
      eq("الخصم تحت حساب الضريبة", "رصيد «ضرائب مخصومة منا» = 50", 50, await bal("EG_WHT_CREDIT"));
      const cn = await doc("SALE", "CREDIT_NOTE", "2026-02-10", cusB.id, [{ productId: P1.id, qty: 5, unitPrice: 100, taxCode: "S" }], { originId: sale.id, reason: "مرتجع" });
      await createExpense(t, C, U, { date: "2026-02-15", accountId: util, description: "كهرباء", amount: 2000, taxCode: "S", payAccountId: bank });
      scenario.push("2) بيع 50 × 100 لعميل شركة وتحصيله مع خصم العميل 1%؛ إشعار دائن 5 وحدات؛ مصروف كهرباء 2,000 + 14%");

      // ── VAT return (January–February) ───────────────────────────────────
      const vr = await rep.vatReturn(t, C, { from: "2026-01-01", to: "2026-02-28" });
      eq("إقرار القيمة المضافة", "ضريبة المخرجات (700 − 70)", 630, vr.outputVat);
      eq("إقرار القيمة المضافة", "ضريبة المدخلات (840 + 280)", 1120, vr.inputVat);
      eq("إقرار القيمة المضافة", "الصافي رصيد دائن مرحّل −490", -490, vr.net);
      eq("إقرار القيمة المضافة", "الإقرار يطابق حسابات الأستاذ", true, vr.reconciled);
      eq("إقرار القيمة المضافة", "البند الأول بالسعر العام 14%", true, String(vr.boxes[0].label).includes("14%"));

      // ── ETA e-invoice documents ─────────────────────────────────────────
      const pv = await previewDocument(t, co, sale.id);
      const d: any = pv.document;
      eq("منظومة الفاتورة الإلكترونية", "نوع المستند I والمصدر برقم تسجيله", "I/123456789", `${d.documentType}/${d.issuer.id}`);
      eq("منظومة الفاتورة الإلكترونية", "المشتري شركة (B) برقم تسجيله", "B/300000002", `${d.receiver.type}/${d.receiver.id}`);
      eq("منظومة الفاتورة الإلكترونية", "كود الصنف EGS", "EGS/EG-123456789-P1", `${d.invoiceLines[0].itemType}/${d.invoiceLines[0].itemCode}`);
      eq("منظومة الفاتورة الإلكترونية", "ضريبة T1/V009 بنسبة 14% = 700", "T1/V009/14/700", `${d.invoiceLines[0].taxableItems[0].taxType}/${d.invoiceLines[0].taxableItems[0].subType}/${d.invoiceLines[0].taxableItems[0].rate}/${d.invoiceLines[0].taxableItems[0].amount}`);
      eq("منظومة الفاتورة الإلكترونية", "إجمالي المستند 5,700", 5700, d.totalAmount);
      eq("منظومة الفاتورة الإلكترونية", "التسلسل القياسي للتوقيع يبدأ بـ \"ISSUER\"\"ADDRESS\"", true, pv.serialized.startsWith('"ISSUER""ADDRESS""BRANCHID""0"'));
      eq("منظومة الفاتورة الإلكترونية", "المستند مطابق لقواعد المنظومة (بلا أخطاء)", "—", pv.errors.join(" | ") || "—");
      const pvCn = await previewDocument(t, co, cn.id);
      eq("منظومة الفاتورة الإلكترونية", "الإشعار الدائن قبل قبول الفاتورة الأصلية يُرفض (references)", true, pvCn.errors.some((e: string) => e.startsWith("references")));
      await t.exec(`UPDATE invoices SET eta_uuid='ABCDEFGHIJKLMNOPQRSTUVWXYZ', eta_status='VALID' WHERE id=$1`, [sale.id]);
      const pvCn2 = await previewDocument(t, co, cn.id);
      eq("منظومة الفاتورة الإلكترونية", "الإشعار الدائن (C) يشير إلى uuid الفاتورة الأصلية", "C/ABCDEFGHIJKLMNOPQRSTUVWXYZ/—", `${(pvCn2.document as any).documentType}/${(pvCn2.document as any).references?.[0]}/${pvCn2.errors.join("|") || "—"}`);
      const bad1 = await doc("SALE", "INVOICE", "2026-02-20", cusBad.id, [{ productId: NOC.id, qty: 10, unitPrice: 50, taxCode: "S" }]);
      const pvBad = await previewDocument(t, co, bad1.id);
      eq("منظومة الفاتورة الإلكترونية", "اكتشاف: صنف GS1 بلا كود، ومشتري شركة بلا رقم تسجيل", true, pvBad.errors.some((e: string) => e.includes("itemCode")) && pvBad.errors.some((e: string) => e.startsWith("receiver.id")));

      // ── ETA e-receipt (POS) chain ───────────────────────────────────────
      const cfg = await t.one(`SELECT * FROM eta_configs WHERE company_id=$1`, [C]);
      const lines = await t.rows(`SELECT l.*, p.sku, p.eta_item_type, p.eta_item_code, p.eta_unit_type FROM invoice_lines l LEFT JOIN products p ON p.id=l.product_id WHERE l.invoice_id=$1`, [sale.id]);
      const r1 = buildReceipt(co, cfg, { ...sale, kind: "INVOICE" }, lines, null, "");
      const r2_ = buildReceipt(co, cfg, { ...sale, number: sale.number + "-2", kind: "INVOICE" }, lines, null, r1.header.uuid);
      const copy = JSON.parse(JSON.stringify(r1)); copy.header.uuid = "";
      eq("الإيصال الإلكتروني", "uuid = SHA-256 للإيصال بعد التسلسل القياسي", sha256hex(serialize(copy)), r1.header.uuid);
      eq("الإيصال الإلكتروني", "الإيصال الثاني مرتبط بالسابق (previousUUID)", r1.header.uuid, r2_.header.previousUUID);
      eq("الإيصال الإلكتروني", "الإيصال مطابق للقواعد", "—", validateReceipt(r1).join(" | ") || "—");
      const tampered = JSON.parse(JSON.stringify(r1)); tampered.totalAmount = 1;
      eq("الإيصال الإلكتروني", "تعديل الإيصال بعد حساب uuid يُكتشف", true, validateReceipt(tampered).some((e) => e.includes("uuid")));
      scenario.push("3) مستندات المنظومة: فاتورة I وإشعار C ومحاكاة أخطاء، وسلسلة إيصالات إلكترونية");

      // ── payroll ─────────────────────────────────────────────────────────
      await t.insert("employees", { companyId: C, code: "E1", name: "موظف اختبار", nationality: "EGYPTIAN", hireDate: "2025-01-01", basic: 10000, housing: 0, transport: 2000, otherAllow: 0, gosi: true });
      const run = await createRun(t, C, U, { period: "2026-02" });
      const L = (run.lines as any[])[0];
      eq("الرواتب (مصر)", "حصة العامل في التأمينات 11% من 12,000", 1320, L.gosiEmp);
      eq("الرواتب (مصر)", "حصة صاحب العمل 18.75%", 2250, L.gosiEr);
      eq("الرواتب (مصر)", "ضريبة كسب العمل الشهرية (وعاء سنوي 108,160)", 948.5, L.salaryTax);
      eq("الرواتب (مصر)", "صندوق تكريم الشهداء 0.05%", 6, L.martyrs);
      eq("الرواتب (مصر)", "صافي الراتب 12,000 − 1,320 − 948.50 − 6", 9725.5, L.net);
      await postRun(t, C, U, run.id);
      eq("الرواتب (مصر)", "ضريبة كسب العمل المستحقة في الأستاذ", -948.5, await bal("SALARY_TAX_PAYABLE"));
      eq("الرواتب (مصر)", "التأمينات المستحقة (1,320 + 2,250)", -3570, await bal("GOSI_PAYABLE"));
      eq("ضريبة المرتبات", "دخل 80,000 بعد الإعفاء → 5,750", 5750, annualSalaryTax(80000));
      eq("ضريبة المرتبات", "دخل 650,000: تسقط الشريحة المعفاة → 141,250", 141250, annualSalaryTax(650000));
      eq("ضريبة المرتبات", "دخل 1,500,000: أول 1.2 مليون بـ 25% والباقي 27.5% → 382,500", 382500, annualSalaryTax(1500000));
      scenario.push("4) مسير رواتب بالتأمينات (قانون 148) وضريبة كسب العمل وصندوق الشهداء");

      // ── Form 41 ─────────────────────────────────────────────────────────
      const f = await form41(t, C, { period: "2026-Q1" });
      eq("نموذج 41", "إجمالي المخصوم من الموردين في الربع الأول", 60, f.taxTotal);
      eq("نموذج 41", "إجمالي ما خصمه العملاء منا", 50, f.creditsTotal);
      await fileForm41(t, C, U, { period: "2026-Q1", accountId: bank, date: "2026-04-25" });
      eq("نموذج 41", "بعد التوريد: رصيد الخصم المستحق للمصلحة صفر", 0, await bal("WHT_PAYABLE"));
      await rejects(t, "نموذج 41", "سند صرف بخصم بتاريخ ربع مقدَّم نموذجه", () => createPayment(t, C, U, { direction: "OUT", partnerId: sup.id, date: "2026-03-30", amount: 1000, accountId: bank, wht: { type: "SUPPLIES" } }));
      await rejects(t, "نموذج 41", "خصم على تعامل لا يتجاوز 300 جنيه", () => createPayment(t, C, U, { direction: "OUT", partnerId: sup.id, date: "2026-05-01", amount: 200, accountId: bank, wht: { type: "SUPPLIES" } }));
      scenario.push("5) نموذج 41 للربع الأول: 60 مخصومة وتوريدها، ومنع الخصم بعد التقديم أو تحت 300 جنيه");

      // ── corporate income tax ───────────────────────────────────────────
      await doc("SALE", "INVOICE", "2026-03-01", cusB.id, [{ productId: S1.id, qty: 1, unitPrice: 30000, taxCode: "S" }]);
      const it = await incomeTaxCompute(t, C, { year: "2026" });
      // profit = sales (5,000 − 500 + 30,000 + 500 bad-doc) − COGS 45×60 − electricity 2,000 − payroll 14,250
      eq("ضريبة الدخل", "الربح المحاسبي قبل الضريبة", 16050, it.profitBeforeTax);
      const ip = await incomeTaxPost(t, C, U, { year: "2026", items: [{ group: "ADD", label: "مصروفات غير واجبة الخصم", amount: 1000 }] });
      eq("ضريبة الدخل", "الوعاء 17,050 × 22.5%", 3836.25, ip.tax);
      const st = await incomeTaxSettle(t, C, U, ip.id, { accountId: bank, date: "2026-12-31" });
      eq("ضريبة الدخل", "خصم الضرائب المخصومة منا (50) والباقي من البنك", 3786.25, st.cash);
      eq("ضريبة الدخل", "رصيد الضرائب المخصومة منا بعد التسوية صفر", 0, await bal("EG_WHT_CREDIT"));
      eq("ضريبة الدخل", "رصيد ضريبة الدخل المستحقة صفر", 0, await bal("INCOME_TAX_PAYABLE"));
      const is = await rep.incomeStatement(t, C, { from: "2026-01-01", to: "2026-12-31" });
      eq("ضريبة الدخل", "صافي الربح بعد الضريبة في قائمة الدخل", r2(16050 - 3836.25), is.net);
      scenario.push("6) ضريبة الدخل 22.5% على الربح المعدّل، وتسويتها بالخصم من المنبع والباقي من البنك");

      // ── ledger integrity and final accounts ──────────────────────────────
      const integ = await rep.integrity(t, C);
      for (const c of integ.checks) checks.push({ group: "فحوص التطابق الآلية", name: c.name, expected: c.b, actual: c.a, ok: c.ok });
      const fy = await t.one(`SELECT id FROM fiscal_years WHERE company_id=$1 AND name='2026'`, [C]);
      const fa = await finalAccounts(t, C, { fiscalYearId: fy.id });
      eq("الحسابات الختامية", "كل فحوص ترابط القوائم ناجحة", "—", fa.checks.filter((x: any) => !x.ok).map((x: any) => x.name).join(" | ") || "—");
      eq("التفقيط", "المبلغ كتابةً بالجنيه والقرش", "فقط ألف ومائتان وخمسون جنيهاً وخمسة وسبعون قرشاً لا غير", amountToArabicWords(1250.75));

      throw new Rollback();
    });
  } catch (e: any) {
    if (!(e instanceof Rollback)) fatal = e?.message || String(e);
  }
  const failed = checks.filter((c) => !c.ok).length + (fatal ? 1 : 0);
  return { ok: !fatal && failed === 0, passed: checks.filter((c) => c.ok).length, failed, durationMs: Date.now() - started, scenario, checks, error: fatal };
}
