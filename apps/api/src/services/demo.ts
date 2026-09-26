/**
 * Demo dataset: six months of realistic trading activity, every document posted through
 * the real engine (so all reports reconcile), every row tagged is_demo=true → purgeable.
 */
import { Db, db, tx, pool } from "../db/pool";
import { r2, addDays, addMonths, monthEnd, today } from "../lib/core";
import { post, nextNumber } from "../accounting/engine";
import { saveDraft, postInvoice } from "./invoices";
import { createPayment } from "./payments";
import { createExpense } from "./expenses";
import { createAsset, runDepreciation } from "./assets";
import { openSession, posSale, posReturn, closeSession } from "./pos";
import { stockAdjustment, fileVatReturn } from "./misc";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const CUSTOMERS = [
  ["شركة النخبة للمقاولات", "310123456700003", true], ["مؤسسة الريان التجارية", "300987654300003", true], ["مطاعم الذواقة", "311222333400003", true],
  ["شركة أفق الخليج للتوريدات", "302555666700003", true], ["فندق واحة مكة", "300111222300003", true], ["محمد عبدالله العتيبي", null, false],
  ["سارة أحمد الزهراني", null, false], ["مدارس المستقبل الأهلية", "301444555600003", true], ["بقالة الحي", null, false], ["صيدلية الشفاء", "309876543200003", true],
];
const SUPPLIERS = [
  ["شركة المراعي", "300000000000003", "الرياض"], ["مصنع مياه نوفا", "300101010100003", "جدة"], ["شركة الكابلات السعودية", "301212121200003", "جدة"],
  ["مؤسسة الأدوات المكتبية الحديثة", "302323232300003", "مكة"], ["شركة التوريدات الغذائية", "303434343400003", "الدمام"], ["مورد استيراد الأجهزة (خارجي)", null, "دبي"],
];
const CATS = [["مواد غذائية", "#0ea5e9"], ["مشروبات", "#22c55e"], ["منظفات", "#f59e0b"], ["قرطاسية", "#8b5cf6"], ["إلكترونيات", "#ef4444"], ["خدمات", "#64748b"]];
const PRODUCTS: [string, string, number, number, number, string, string?][] = [
  // sku, name, cat idx, cost, price, unit, taxCode
  ["FD-001", "أرز بسمتي 5 كجم", 0, 42, 58, "كيس"], ["FD-002", "زيت زيتون 1 لتر", 0, 28, 39.5, "عبوة"], ["FD-003", "سكر ناعم 2 كجم", 0, 8.5, 12, "كيس"],
  ["FD-004", "شاي أسود 400 جم", 0, 14, 21, "علبة"], ["FD-005", "تمر سكري فاخر 1 كجم", 0, 35, 55, "علبة"], ["FD-006", "حليب طويل الأجل 1 لتر", 0, 4.2, 6, "عبوة"],
  ["BV-001", "مياه معدنية 600 مل (كرتون 40)", 1, 14, 22, "كرتون"], ["BV-002", "عصير برتقال 1 لتر", 1, 6.5, 9.5, "عبوة"], ["BV-003", "قهوة عربية 250 جم", 1, 22, 34, "كيس"],
  ["BV-004", "مشروب غازي (كرتون 24)", 1, 26, 38, "كرتون"], ["CL-001", "منظف أرضيات 3 لتر", 2, 11, 17.5, "عبوة"], ["CL-002", "صابون سائل 1 لتر", 2, 7, 11, "عبوة"],
  ["CL-003", "مناديل ورقية (كرتون 10)", 2, 32, 45, "كرتون"], ["ST-001", "ورق تصوير A4 (رزمة)", 3, 15, 22, "رزمة"], ["ST-002", "أقلام حبر جاف (علبة 50)", 3, 18, 29, "علبة"],
  ["ST-003", "دفاتر مسطرة 100 ورقة", 3, 4, 7, "دفتر"], ["EL-001", "شاحن هاتف سريع 25 واط", 4, 38, 69, "حبة"], ["EL-002", "سماعات لاسلكية", 4, 95, 165, "حبة"],
  ["EL-003", "كيبل شبكة Cat6 305 م", 4, 210, 320, "بكرة"], ["EL-004", "طابعة ليزر مكتبية", 4, 620, 899, "حبة"],
  ["SV-001", "خدمة توصيل داخل المدينة", 5, 0, 25, "طلب"], ["SV-002", "خدمة تركيب وتشغيل", 5, 0, 150, "زيارة"], ["MD-001", "أدوية ومستلزمات معفاة", 0, 30, 30, "عبوة", "E"],
];

async function log(companyId: string, step: string, pct: number) {
  await pool.query(`UPDATE companies SET demo_job=$2 WHERE id=$1`, [companyId, JSON.stringify({ step, pct, at: new Date() })]);
}

export async function loadDemo(companyId: string, userId: string, userName: string) {
  const company = await db.one(`SELECT * FROM companies WHERE id=$1`, [companyId]);
  if (!company) throw new Error("company");
  // a previous attempt may have been interrupted (server restart) — start clean
  await purgeDemo(companyId);
  const c = { ...company, id: companyId, allowNegativeStock: false, pricesIncludeVat: false };
  const rand = rng(20260926);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  const end = today();
  const start = addMonths(end.slice(0, 7) + "-01", -5); // first day, 5 months back → 6 months window
  const user = { id: userId, name: userName };

  await log(companyId, "إنشاء البيانات الأساسية", 5);
  const ids = await tx(async (t) => {
    const wh = await t.one(`SELECT id FROM warehouses WHERE company_id=$1 ORDER BY is_default DESC LIMIT 1`, [companyId]);
    const customers: any[] = [];
    for (const [i, [name, vat, isCo]] of CUSTOMERS.entries())
      customers.push(await t.insert("partners", { companyId, code: `C-D${String(i + 1).padStart(3, "0")}`, name, isCustomer: true, kind: isCo ? "COMPANY" : "INDIVIDUAL", vatNumber: vat, crNumber: isCo ? `10100${between(10000, 99999)}` : null, phone: `05${between(10000000, 99999999)}`, city: pick(["مكة المكرمة", "جدة", "الرياض", "الطائف"]), district: "الحي التجاري", street: "شارع الملك فهد", buildingNo: String(between(1000, 9999)), postalCode: String(between(21000, 24999)), creditLimit: isCo ? 150000 : 0, paymentTerms: isCo ? 30 : 0, isDemo: true }));
    const suppliers: any[] = [];
    for (const [i, [name, vat, city]] of SUPPLIERS.entries())
      suppliers.push(await t.insert("partners", { companyId, code: `S-D${String(i + 1).padStart(3, "0")}`, name, isSupplier: true, vatNumber: vat, city, country: vat ? "SA" : "AE", paymentTerms: 30, isDemo: true }));
    const cats: any[] = [];
    for (const [name, color] of CATS) cats.push(await t.insert("product_categories", { companyId, name, color, isDemo: true }));
    const products: any[] = [];
    for (const [sku, name, ci, cost, price, unit, tax] of PRODUCTS)
      products.push(await t.insert("products", { companyId, sku, barcode: `629${String(between(100000000, 999999999))}`, name, type: sku.startsWith("SV") ? "SERVICE" : "STOCK", categoryId: cats[ci].id, unit, salePrice: price, purchasePrice: cost, taxCode: tax || "S", reorderLevel: sku.startsWith("SV") ? 0 : 20, isDemo: true }));
    // opening balances: capital, cash, bank
    const cash = await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND system_key='CASH'`, [companyId]);
    const bank = await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND system_key='BANK'`, [companyId]);
    const cap = await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND system_key='CAPITAL'`, [companyId]);
    const posCash = await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND system_key='POS_CASH'`, [companyId]);
    const openDate = addDays(start, -1);
    await post(t, companyId, { date: openDate, type: "OPENING", memo: "قيد افتتاحي — رأس المال (بيانات تجريبية)", isDemo: true, createdBy: userName, lines: [
      { account: cash.id, debit: 60000, description: "رصيد افتتاحي الصندوق" }, { account: posCash.id, debit: 2000, description: "عهدة صندوق نقاط البيع" }, { account: bank.id, debit: 340000, description: "رصيد افتتاحي البنك" }, { account: cap.id, credit: 402000, description: "رأس المال" },
    ] });
    // opening stock
    await stockAdjustment(t, companyId, userName, { date: openDate, warehouseId: wh.id, kind: "OPENING", isDemo: true, lines: products.filter((p) => p.type === "STOCK").map((p) => ({ productId: p.id, qty: between(80, 250), unitCost: Number(p.purchasePrice) })) });
    // fixed assets
    await createAsset(t, companyId, userName, { name: "سيارة توصيل - تويوتا هايس", category: "سيارات", acquisitionDate: start, cost: 95000, vatAmount: 14250, salvageValue: 15000, usefulLifeMonths: 60, payAccountId: bank.id, isDemo: true, assetAccountId: (await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND code='120103'`, [companyId])).id, accDepAccountId: (await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND code='120202'`, [companyId])).id });
    await createAsset(t, companyId, userName, { name: "أجهزة نقاط البيع والحاسب", category: "حاسب آلي", acquisitionDate: start, cost: 18000, vatAmount: 2700, salvageValue: 0, usefulLifeMonths: 36, payAccountId: bank.id, isDemo: true, assetAccountId: (await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND code='120106'`, [companyId])).id, accDepAccountId: (await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND code='120205'`, [companyId])).id });
    await createAsset(t, companyId, userName, { name: "أثاث ورفوف المعرض", category: "أثاث", acquisitionDate: start, cost: 24000, vatAmount: 3600, salvageValue: 2000, usefulLifeMonths: 84, payAccountId: bank.id, isDemo: true, assetAccountId: (await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND code='120104'`, [companyId])).id, accDepAccountId: (await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND code='120203'`, [companyId])).id });
    return { wh: wh.id, customers, suppliers, products, cash: cash.id, bank: bank.id, posCash: posCash.id };
  });

  const stock = ids.products.filter((p) => p.type === "STOCK");
  const services = ids.products.filter((p) => p.type === "SERVICE");
  const expAcc = async (t: Db, code: string) => (await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND code=$2`, [companyId, code])).id;
  const salesInvoices: any[] = [];
  const purchaseBills: any[] = [];
  const months: string[] = [];
  for (let m = 0; m < 6; m++) months.push(addMonths(start, m));

  for (const [mi, mStart] of months.entries()) {
    const mEnd = monthEnd(mStart) > end ? end : monthEnd(mStart);
    await log(companyId, `توليد حركة شهر ${mStart.slice(0, 7)}`, 10 + mi * 14);
    await tx(async (t) => {
      // ── purchases: 4-6 bills/month ──
      for (let i = 0; i < between(5, 7); i++) {
        const date = addDays(mStart, between(0, Math.max(0, daysBetween(mStart, mEnd))));
        const sup = pick(ids.suppliers.slice(0, 5));
        const lines = Array.from({ length: between(2, 5) }, () => {
          const p = pick(stock);
          return { productId: p.id, qty: between(30, 100), unitPrice: r2(Number(p.purchasePrice) * (0.95 + rand() * 0.1)), taxCode: "S" };
        });
        const d = await saveDraft(t, c, userName, { direction: "PURCHASE", kind: "INVOICE", date, partnerId: sup.id, warehouseId: ids.wh, supplierRef: `SUP-${between(1000, 9999)}`, lines, isDemo: true });
        purchaseBills.push(await postInvoice(t, c, d.id, userName));
      }
      // one import bill (reverse charge) in months 2 and 5
      if (mi === 1 || mi === 4) {
        const p = ids.products.find((x) => x.sku === "EL-002")!;
        const d = await saveDraft(t, c, userName, { direction: "PURCHASE", kind: "INVOICE", date: addDays(mStart, 10), partnerId: ids.suppliers[5].id, warehouseId: ids.wh, supplierRef: `IMP-${between(100, 999)}`, lines: [{ productId: p.id, qty: 40, unitPrice: 90, taxCode: "RC" }], isDemo: true });
        purchaseBills.push(await postInvoice(t, c, d.id, userName));
      }
      // ── B2B sales invoices: 8-12/month ──
      for (let i = 0; i < between(12, 18); i++) {
        const date = addDays(mStart, between(0, Math.max(0, daysBetween(mStart, mEnd))));
        const cust = pick(ids.customers.filter((x) => x.kind === "COMPANY"));
        const lines = Array.from({ length: between(1, 4) }, () => {
          const p = rand() < 0.15 ? pick(services) : pick(stock);
          return { productId: p.id, qty: p.type === "SERVICE" ? between(1, 3) : between(10, 60), unitPrice: Number(p.salePrice), discountPct: rand() < 0.3 ? pick([2, 5, 10]) : 0, taxCode: p.taxCode };
        });
        try {
          await t.savepoint(async () => {
            const d = await saveDraft(t, c, userName, { direction: "SALE", kind: "INVOICE", date, partnerId: cust.id, warehouseId: ids.wh, invoiceType: "STANDARD", lines, isDemo: true });
            salesInvoices.push(await postInvoice(t, c, d.id, userName));
          });
        } catch (e: any) {
          if (e.code !== "INSUFFICIENT_STOCK" && e.code !== "CREDIT_LIMIT") throw e;
        }
      }
      // ── POS: ~5 sessions/month, 6-14 tickets each ──
      for (let s = 0; s < 6; s++) {
        const date = addDays(mStart, Math.min(s * 5 + between(0, 2), Math.max(0, daysBetween(mStart, mEnd))));
        const session = await openSession(t, companyId, user, 500, ids.wh);
        await t.exec(`UPDATE pos_sessions SET opened_at=$2::date + interval '9 hours', is_demo=true WHERE id=$1`, [session.id, date]);
        const tickets: any[] = [];
        for (let k = 0; k < between(10, 20); k++) {
          const lines = Array.from({ length: between(1, 4) }, () => ({ productId: pick(stock).id, qty: between(1, 6) }));
          const method = rand() < 0.55 ? "CARD" : "CASH";
          try {
            const inv = await t.savepoint(() => posSale(t, c, user, { sessionId: session.id, lines, tenders: [{ method: method as any, amount: null }], isDemo: true, date, partnerId: rand() < 0.2 ? pick(ids.customers.filter((x) => x.kind === "INDIVIDUAL")).id : null, discountPct: rand() < 0.1 ? 5 : 0 }));
            tickets.push(inv);
          } catch (e: any) {
            if (e.code !== "INSUFFICIENT_STOCK") throw e;
          }
        }
        if (tickets.length && rand() < 0.5) {
          const orig = pick(tickets);
          const l = orig.lines[0];
          await posReturn(t, c, user, session.id, orig.id, [{ productId: l.productId, qty: 1 }], "بضاعة تالفة", true);
        }
        const st = await t.one(`SELECT * FROM pos_sessions WHERE id=$1`, [session.id]);
        const expected = r2(Number(st.openingCash) + Number(st.cashSales));
        await closeSession(t, companyId, userName, session.id, rand() < 0.2 ? r2(expected - pick([5, 10, 20])) : expected, true);
        await t.exec(`UPDATE pos_sessions SET closed_at=$2::date + interval '21 hours' WHERE id=$1`, [session.id, date]);
        await t.exec(`UPDATE journal_entries SET date=$2 WHERE source_type='POS_SESSION' AND source_id=$1`, [session.id, date]);
      }
      // ── expenses ──
      await createExpense(t, companyId, userName, { date: addDays(mStart, 1), accountId: await expAcc(t, "5204"), payee: "مالك العقار", description: `إيجار المعرض والمستودع - ${mStart.slice(0, 7)}`, amount: 7000, taxCode: "S", payAccountId: ids.bank, isDemo: true });
      await createExpense(t, companyId, userName, { date: mEnd, accountId: await expAcc(t, "5201"), payee: "الموظفون", description: `رواتب شهر ${mStart.slice(0, 7)}`, amount: 16500, taxCode: "O", payAccountId: ids.bank, isDemo: true });
      await createExpense(t, companyId, userName, { date: addDays(mStart, between(5, 20)), accountId: await expAcc(t, "5205"), payee: "الشركة السعودية للكهرباء", description: "فاتورة كهرباء", amount: r2(1800 + rand() * 900), taxCode: "S", payAccountId: ids.bank, isDemo: true });
      await createExpense(t, companyId, userName, { date: addDays(mStart, between(5, 20)), accountId: await expAcc(t, "5206"), payee: "STC", description: "اتصالات وإنترنت", amount: 650, taxCode: "S", payAccountId: ids.bank, isDemo: true });
      await createExpense(t, companyId, userName, { date: addDays(mStart, between(2, 25)), accountId: await expAcc(t, "5213"), payee: "متفرقات", description: "مصروفات نثرية", amount: r2(200 + rand() * 400), taxCode: "S", payAccountId: ids.cash, isDemo: true });
      if (mi % 2 === 0) await createExpense(t, companyId, userName, { date: addDays(mStart, 12), accountId: await expAcc(t, "5301"), payee: "وكالة إعلانات", partnerId: ids.suppliers[3].id, description: "حملة إعلانية على وسائل التواصل", amount: 3500, taxCode: "S", payAccountId: null, isDemo: true });
      await createExpense(t, companyId, userName, { date: addDays(mStart, 3), accountId: await expAcc(t, "5211"), payee: "البنك", description: "رسوم بنكية", amount: 120, taxCode: "E", payAccountId: ids.bank, isDemo: true });
      // ── collections & supplier payments (previous months' invoices) ──
      for (const inv of salesInvoices.filter((x) => x.date < mStart && x.paymentStatus !== "PAID" && x._paidFlag !== true)) {
        if (rand() < 0.75) {
          const open = await t.one(`SELECT total, amount_paid, partner_id FROM invoices WHERE id=$1`, [inv.id]);
          const due = r2(Number(open.total) - Number(open.amountPaid));
          if (due <= 0) { inv._paidFlag = true; continue; }
          const partial = rand() < 0.2;
          await createPayment(t, companyId, userName, { direction: "IN", partnerId: open.partnerId, date: addDays(mStart, between(1, 20)), amount: partial ? r2(due / 2) : due, method: "BANK", accountId: ids.bank, reference: `حوالة ${between(100000, 999999)}`, allocations: [{ invoiceId: inv.id, amount: partial ? r2(due / 2) : due }], isDemo: true });
          if (!partial) inv._paidFlag = true;
        }
      }
      for (const bill of purchaseBills.filter((x) => x.date < mStart && x._paidFlag !== true)) {
        if (rand() < 0.8) {
          const open = await t.one(`SELECT total, amount_paid, partner_id FROM invoices WHERE id=$1`, [bill.id]);
          const due = r2(Number(open.total) - Number(open.amountPaid));
          if (due <= 0) { bill._paidFlag = true; continue; }
          await createPayment(t, companyId, userName, { direction: "OUT", partnerId: open.partnerId, date: addDays(mStart, between(1, 25)), amount: due, method: "BANK", accountId: ids.bank, reference: `حوالة ${between(100000, 999999)}`, allocations: [{ invoiceId: bill.id, amount: due }], isDemo: true });
          bill._paidFlag = true;
        }
      }
      // ── a credit note now and then ──
      if (mi >= 1 && salesInvoices.length) {
        const orig = salesInvoices[between(0, salesInvoices.length - 1)];
        const full = await t.one(`SELECT * FROM invoices WHERE id=$1`, [orig.id]);
        const l0 = (await t.rows(`SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY sort`, [orig.id]))[0];
        if (l0 && Number(l0.qty) > 1 && !orig._cn) {
          const d = await saveDraft(t, c, userName, { direction: "SALE", kind: "CREDIT_NOTE", date: addDays(mStart, between(3, 20)), partnerId: full.partnerId, warehouseId: ids.wh, originId: full.id, reason: "بضاعة مرتجعة - غير مطابقة", lines: [{ productId: l0.productId, qty: 1, unitPrice: Number(l0.unitPrice), discountPct: Number(l0.discountPct), taxCode: l0.taxCode }], isDemo: true });
          await postInvoice(t, c, d.id, userName);
          orig._cn = true;
        }
      }
      // ── depreciation for the month ──
      await runDepreciation(t, companyId, userName, mEnd, true);
      // quotations / orders pipeline (open documents for the UI)
      if (mi === 5) {
        for (let i = 0; i < 3; i++) {
          const cust = pick(ids.customers.filter((x) => x.kind === "COMPANY"));
          await saveDraft(t, c, userName, { direction: "SALE", kind: i === 0 ? "ORDER" : "QUOTATION", date: addDays(end, -between(0, 6)), partnerId: cust.id, warehouseId: ids.wh, lines: Array.from({ length: between(2, 4) }, () => { const p = pick(stock); return { productId: p.id, qty: between(10, 50), unitPrice: Number(p.salePrice), taxCode: p.taxCode }; }), isDemo: true });
        }
        const sup = pick(ids.suppliers.slice(0, 4));
        await saveDraft(t, c, userName, { direction: "PURCHASE", kind: "ORDER", date: addDays(end, -2), partnerId: sup.id, warehouseId: ids.wh, lines: Array.from({ length: 3 }, () => { const p = pick(stock); return { productId: p.id, qty: between(50, 100), unitPrice: Number(p.purchasePrice), taxCode: "S" }; }), isDemo: true });
      }
    });
  }

  // quarterly VAT return for the first completed quarter inside the window (if 3 full months elapsed)
  await log(companyId, "إقرار الضريبة وفحص التطابق", 92);
  await tx(async (t) => {
    const q1From = months[0], q1To = monthEnd(months[2]);
    if (q1To < end) await fileVatReturn(t, companyId, userName, q1From, q1To, true);
    await t.exec(`UPDATE companies SET demo_loaded=true, demo_job=$2 WHERE id=$1`, [companyId, JSON.stringify({ step: "اكتمل التحميل", pct: 100, done: true, at: new Date() })]);
  });
}

function daysBetween(a: string, b: string) {
  return Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000);
}

/** Deletes everything tagged is_demo for the company, in dependency order, in one transaction. */
export async function purgeDemo(companyId: string) {
  await tx(async (t) => {
    const demoProducts = (await t.rows(`SELECT id FROM products WHERE company_id=$1 AND is_demo`, [companyId])).map((p) => p.id);
    await t.exec(`DELETE FROM invoices WHERE company_id=$1 AND is_demo`, [companyId]);
    await t.exec(`DELETE FROM payments WHERE company_id=$1 AND is_demo`, [companyId]);
    await t.exec(`DELETE FROM expenses WHERE company_id=$1 AND is_demo`, [companyId]);
    await t.exec(`DELETE FROM pos_sessions WHERE company_id=$1 AND is_demo`, [companyId]);
    await t.exec(`DELETE FROM asset_depreciations WHERE company_id=$1 AND is_demo`, [companyId]);
    await t.exec(`DELETE FROM fixed_assets WHERE company_id=$1 AND is_demo`, [companyId]);
    await t.exec(`DELETE FROM vat_returns WHERE company_id=$1 AND is_demo`, [companyId]);
    await t.exec(`DELETE FROM stock_adjustments WHERE company_id=$1 AND is_demo`, [companyId]);
    await t.exec(`DELETE FROM stock_moves WHERE company_id=$1 AND (is_demo OR product_id = ANY($2))`, [companyId, demoProducts]);
    await t.exec(`DELETE FROM stock_balances WHERE company_id=$1 AND product_id = ANY($2)`, [companyId, demoProducts]);
    await t.exec(`DELETE FROM journal_entries WHERE company_id=$1 AND is_demo`, [companyId]);
    await t.exec(`DELETE FROM products WHERE company_id=$1 AND is_demo`, [companyId]);
    await t.exec(`DELETE FROM product_categories WHERE company_id=$1 AND is_demo`, [companyId]);
    await t.exec(`DELETE FROM partners WHERE company_id=$1 AND is_demo AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.partner_id=partners.id) AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.partner_id=partners.id)`, [companyId]);
    await t.exec(`DELETE FROM audit_logs WHERE company_id=$1 AND (details->>'isDemo')='true'`, [companyId]);
    const realSales = await t.one(`SELECT COUNT(*)::int c FROM invoices WHERE company_id=$1 AND direction='SALE' AND status='POSTED'`, [companyId]);
    if (realSales.c === 0) await t.exec(`UPDATE zatca_configs SET icv_counter=0, last_hash='NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==' WHERE company_id=$1`, [companyId]);
    // reopen any fiscal year whose closing entry was demo (deleted above)
    await t.exec(`UPDATE fiscal_years SET status='OPEN', closing_entry_id=NULL, closed_at=NULL WHERE company_id=$1 AND closing_entry_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM journal_entries e WHERE e.id=fiscal_years.closing_entry_id)`, [companyId]);
    await t.exec(`UPDATE companies SET demo_loaded=false, demo_job=NULL WHERE id=$1`, [companyId]);
  });
}
