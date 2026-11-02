/**
 * Egyptian Tax Authority (ETA) — e-invoice (منظومة الفاتورة الإلكترونية, document v1.0) and e-receipt (الإيصال الإلكتروني, v1.2).
 *
 *  • B2B / B2G sales invoices, credit and debit notes → e-invoice documents (I / C / D), signed with the taxpayer's e-seal
 *    (CAdES-BES over the canonical serialization). The e-seal lives on a USB token, so signing is delegated to a local
 *    signer service (cfg.signer_url) that holds the token; version 0.9 (unsigned) is accepted on pre-production only.
 *  • POS (B2C) sales and returns → e-receipts (S / R) chained by previousUUID, uuid = SHA-256 of the canonical serialization.
 *  • Environments: MOCK (built-in simulator that applies the same validation rules), PREPROD and PROD.
 *  • Item codes: EGS (EG-<RIN>-<internal code>, registered on the portal) or GS1 barcodes.
 */
import crypto from "crypto";
import { Db, tx, db } from "../db/pool";
import { r2, D, bad } from "../lib/core";

export const ETA_HOSTS: Record<string, { id: string; api: string }> = {
  PREPROD: { id: "https://id.preprod.eta.gov.eg", api: "https://api.preprod.invoicing.eta.gov.eg" },
  PROD: { id: "https://id.eta.gov.eg", api: "https://api.invoicing.eta.gov.eg" },
};
const r5 = (v: any) => D(v).toDecimalPlaces(5).toNumber();

/** Tax code → ETA tax type / subtype. */
export const ETA_TAX: Record<string, { type: string; sub: string; ar: string }> = {
  S: { type: "T1", sub: "V009", ar: "ضريبة القيمة المضافة — بيع سلع/خدمات عامة" },
  Z: { type: "T1", sub: "V001", ar: "تصدير (سعر صفر)" },
  X: { type: "T1", sub: "V001", ar: "تصدير (سعر صفر)" },
  E: { type: "T1", sub: "V003", ar: "سلع/خدمات معفاة" },
  O: { type: "T1", sub: "V004", ar: "غير خاضع للضريبة" },
};
export const ETA_UNITS: Record<string, string> = { EA: "قطعة/وحدة", KGM: "كيلوجرام", GRM: "جرام", LTR: "لتر", MTR: "متر", MTK: "متر مربع", BOX: "علبة/كرتونة", PK: "عبوة", H87: "قطعة", HUR: "ساعة", DAY: "يوم", MON: "شهر", SET: "طقم" };
export const GOVERNATES = ["القاهرة", "الجيزة", "الإسكندرية", "القليوبية", "الشرقية", "الدقهلية", "الغربية", "المنوفية", "البحيرة", "كفر الشيخ", "دمياط", "بورسعيد", "الإسماعيلية", "السويس", "الفيوم", "بني سويف", "المنيا", "أسيوط", "سوهاج", "قنا", "الأقصر", "أسوان", "البحر الأحمر", "الوادي الجديد", "مطروح", "شمال سيناء", "جنوب سيناء"];

// ─── canonical serialization (ETA SDK algorithm) ─────────────────────────
/** Property names upper-cased and quoted, values quoted; array items are each prefixed with the array's name. */
export function serialize(v: any): string {
  if (v === null || v === undefined) return '""';
  if (typeof v !== "object") return `"${String(v)}"`;
  let out = "";
  for (const k of Object.keys(v)) {
    const val = v[k];
    const K = `"${k.toUpperCase()}"`;
    if (Array.isArray(val)) { out += K; for (const el of val) out += K + serialize(el); }
    else out += K + serialize(val);
  }
  return out;
}
export const sha256hex = (s: string) => crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

// ─── configuration ───────────────────────────────────────────────────────
export async function getConfig(t: Db, companyId: string) {
  let c = await t.maybe(`SELECT * FROM eta_configs WHERE company_id=$1`, [companyId]);
  if (!c) c = await t.insert("eta_configs", { companyId });
  return c;
}
export const publicConfig = (c: any) => ({ ...c, clientSecret: c.clientSecret ? "••••••••" : null, signerSecret: c.signerSecret ? "••••••••" : null, posClientSecret: c.posClientSecret ? "••••••••" : null, posPresharedKey: c.posPresharedKey ? "••••••••" : null });

export function configIssues(c: any, company: any): string[] {
  const e: string[] = [];
  if (!/^\d{9}$/.test(String(c.rin || company.vatNumber || ""))) e.push("رقم التسجيل الضريبي للمنشأة (9 أرقام)");
  if (!/^\d{4}$/.test(String(c.activityCode || ""))) e.push("كود النشاط الضريبي (4 أرقام)");
  if (!c.governate || !c.regionCity || !c.street || !c.buildingNumber) e.push("عنوان الفرع (المحافظة، المدينة/الحي، الشارع، رقم المبنى)");
  if (c.environment !== "MOCK" && (!c.clientId || !c.clientSecret)) e.push("Client ID / Client Secret من بوابة المصلحة");
  return e;
}

// ─── document builders ───────────────────────────────────────────────────
const isoUtc = (inv: any) => {
  const ts = inv.issuedAt ? new Date(inv.issuedAt) : new Date(`${inv.date}T10:00:00+02:00`);
  return ts.toISOString().replace(/\.\d{3}Z$/, "Z");
};

function receiverOf(partner: any, inv: any) {
  const name = partner?.name || inv.partnerName || "عميل نقدي";
  const country = partner?.country && /^[A-Za-z]{2}$/.test(partner.country) ? partner.country.toUpperCase() : "EG";
  const vat = String(partner?.vatNumber || inv.partnerVat || "");
  const type = partner?.etaType || (country !== "EG" ? "F" : /^\d{9}$/.test(vat) ? "B" : "P");
  const id = type === "B" ? vat : type === "P" ? String(partner?.idNumber || (/^\d{14}$/.test(vat) ? vat : "")) : String(partner?.idNumber || vat || "");
  return { address: { country, governate: partner?.governate || "", regionCity: partner?.city || "", street: partner?.street || "", buildingNumber: partner?.buildingNo || "" }, type, id, name };
}

function itemOf(l: any, rin: string) {
  const t = l.etaItemType === "GS1" ? "GS1" : "EGS";
  const code = l.etaItemCode || (t === "EGS" && l.sku ? `EG-${rin}-${l.sku}` : "");
  return { itemType: t, itemCode: code, unitType: l.etaUnitType || "EA", internalCode: l.sku || "" };
}

/** Builds the ETA e-invoice document (without signatures) from a posted sales document. */
export function buildInvoiceDocument(company: any, cfg: any, inv: any, lines: any[], partner: any, origin: any) {
  const rin = String(cfg.rin || company.vatNumber || "");
  const docType = inv.kind === "CREDIT_NOTE" ? "C" : inv.kind === "DEBIT_NOTE" ? "D" : "I";
  const invoiceLines = lines.map((l) => {
    const qty = Number(l.qty), net = Number(l.netAmount), vat = Number(l.vatAmount);
    const discountPct = Number(l.discountPct || 0);
    const gross = discountPct > 0 && discountPct < 100 ? r5(net / (1 - discountPct / 100)) : net;
    const unit = qty ? r5(gross / qty) : 0;
    const salesTotal = r5(qty * unit);
    const discount = r5(salesTotal - net);
    const tx = ETA_TAX[l.taxCode] || ETA_TAX.S;
    const it = itemOf(l, rin);
    return {
      description: String(l.description || l.productName || "صنف").slice(0, 500), itemType: it.itemType, itemCode: it.itemCode, unitType: it.unitType, quantity: r5(qty), internalCode: it.internalCode,
      salesTotal, total: r5(net + vat), valueDifference: 0, totalTaxableFees: 0, netTotal: r5(net), itemsDiscount: 0,
      unitValue: { currencySold: "EGP", amountEGP: unit },
      discount: { rate: r5(discountPct), amount: discount },
      taxableItems: [{ taxType: tx.type, amount: r5(vat), subType: tx.sub, rate: Number(l.taxRate || 0) }],
    };
  });
  const sum = (k: string) => r5(invoiceLines.reduce((a, l: any) => a + l[k], 0));
  const vatTotal = r5(invoiceLines.reduce((a, l) => a + l.taxableItems[0].amount, 0));
  const doc: any = {
    issuer: { address: { branchID: String(cfg.branchCode || "0"), country: "EG", governate: cfg.governate || "", regionCity: cfg.regionCity || "", street: cfg.street || "", buildingNumber: cfg.buildingNumber || "", postalCode: cfg.postalCode || "" }, type: "B", id: rin, name: company.nameAr },
    receiver: receiverOf(partner, inv),
    documentType: docType, documentTypeVersion: cfg.documentVersion || "1.0",
    dateTimeIssued: isoUtc(inv), taxpayerActivityCode: String(cfg.activityCode || ""), internalID: inv.number,
    purchaseOrderReference: "", purchaseOrderDescription: "", salesOrderReference: "", salesOrderDescription: "", proformaInvoiceNumber: "",
    ...(docType !== "I" ? { references: origin?.etaUuid ? [origin.etaUuid] : [] } : {}),
    invoiceLines,
    totalDiscountAmount: sum("salesTotal") ? r5(invoiceLines.reduce((a, l) => a + l.discount.amount, 0)) : 0,
    totalSalesAmount: sum("salesTotal"), netAmount: sum("netTotal"),
    taxTotals: [{ taxType: "T1", amount: vatTotal }],
    totalAmount: r5(sum("netTotal") + vatTotal), extraDiscountAmount: 0, totalItemsDiscountAmount: 0,
  };
  return doc;
}

/** Builds the ETA e-receipt (v1.2) and its chained uuid. */
export function buildReceipt(company: any, cfg: any, inv: any, lines: any[], origin: any, previousUUID: string) {
  const rin = String(cfg.rin || company.vatNumber || "");
  const itemData = lines.map((l) => {
    const qty = Number(l.qty), net = Number(l.netAmount), vat = Number(l.vatAmount);
    const discountPct = Number(l.discountPct || 0);
    const gross = discountPct > 0 && discountPct < 100 ? r5(net / (1 - discountPct / 100)) : net;
    const unit = qty ? r5(gross / qty) : 0;
    const totalSale = r5(qty * unit);
    const disc = r5(totalSale - net);
    const tx = ETA_TAX[l.taxCode] || ETA_TAX.S;
    const it = itemOf(l, rin);
    return {
      internalCode: it.internalCode, description: String(l.description || "صنف").slice(0, 500), itemType: it.itemType, itemCode: it.itemCode, unitType: it.unitType,
      quantity: r5(qty), unitPrice: unit, netSale: r5(net), totalSale, total: r5(net + vat),
      commercialDiscountData: disc > 0 ? [{ amount: disc, description: "خصم" }] : [], itemDiscountData: [], valueDifference: 0,
      taxableItems: [{ taxType: tx.type, amount: r5(vat), subType: tx.sub, rate: Number(l.taxRate || 0) }],
    };
  });
  const s = (k: string) => r5(itemData.reduce((a, l: any) => a + l[k], 0));
  const vat = r5(itemData.reduce((a, l) => a + l.taxableItems[0].amount, 0));
  const pm = (inv.tenders || []).some((x: any) => x.method === "CARD") ? "V" : "C";
  const r: any = {
    header: { dateTimeIssued: isoUtc(inv), receiptNumber: inv.number, uuid: "", previousUUID: previousUUID || "", referenceOldUUID: inv.kind === "CREDIT_NOTE" ? origin?.etaUuid || "" : "", currency: "EGP", exchangeRate: 0, sOrderNameCode: "", orderdeliveryMode: "", grossWeight: 0, netWeight: 0 },
    documentType: { receiptType: inv.kind === "CREDIT_NOTE" ? "R" : "S", typeVersion: "1.2" },
    seller: { rin, companyTradeName: company.nameAr, branchCode: String(cfg.branchCode || "0"), branchAddress: { country: "EG", governate: cfg.governate || "", regionCity: cfg.regionCity || "", street: cfg.street || "", buildingNumber: cfg.buildingNumber || "" }, deviceSerialNumber: cfg.posSerial || "", syndicateLicenseNumber: "", activityCode: String(cfg.activityCode || "") },
    buyer: { type: "P", id: "", name: inv.partnerName && inv.partnerName !== "عميل نقدي" ? inv.partnerName : "", mobileNumber: "", paymentNumber: "" },
    itemData, totalSales: s("totalSale"), totalCommercialDiscount: r5(s("totalSale") - s("netSale")), totalItemsDiscount: 0, extraReceiptDiscountData: [],
    netAmount: s("netSale"), feesAmount: 0, totalAmount: r5(s("netSale") + vat), taxTotals: [{ taxType: "T1", amount: vat }], paymentMethod: pm, adjustment: 0,
  };
  r.header.uuid = sha256hex(serialize(r));
  return r;
}

// ─── validation (also what the MOCK environment enforces) ────────────────
const near = (a: number, b: number) => Math.abs(a - b) <= 0.01001;
export function validateInvoiceDocument(doc: any): string[] {
  const e: string[] = [];
  if (!/^\d{9}$/.test(doc.issuer?.id || "")) e.push("issuer.id: رقم التسجيل الضريبي للمصدر يجب أن يكون 9 أرقام");
  if (!/^\d{4}$/.test(doc.taxpayerActivityCode || "")) e.push("taxpayerActivityCode: كود النشاط 4 أرقام");
  for (const k of ["governate", "regionCity", "street", "buildingNumber"]) if (!doc.issuer?.address?.[k]) e.push(`issuer.address.${k}: مطلوب`);
  const rc = doc.receiver || {};
  if (rc.type === "B" && !/^\d{9}$/.test(rc.id || "")) e.push("receiver.id: المشتري (شركة) يتطلب رقم تسجيل ضريبي من 9 أرقام");
  if (rc.type === "P" && Number(doc.totalAmount) >= 50000 && !/^\d{14}$/.test(rc.id || "")) e.push("receiver.id: فاتورة لشخص طبيعي بقيمة 50,000 جنيه فأكثر تتطلب الرقم القومي (14 رقماً)");
  if (rc.type === "F" && !rc.id) e.push("receiver.id: المشتري الأجنبي يتطلب رقم هوية/جواز");
  if (rc.type === "B") for (const k of ["governate", "regionCity", "street", "buildingNumber"]) if (!rc.address?.[k]) e.push(`receiver.address.${k}: مطلوب للمشتري الشركة`);
  if (!["I", "C", "D"].includes(doc.documentType)) e.push("documentType غير صحيح");
  if (doc.documentType !== "I" && !(doc.references || []).length) e.push("references: الإشعار يجب أن يشير إلى uuid الفاتورة الأصلية بعد قبولها في المنظومة");
  if (!(doc.invoiceLines || []).length) e.push("invoiceLines: لا توجد بنود");
  (doc.invoiceLines || []).forEach((l: any, i: number) => {
    const n = `invoiceLines[${i + 1}]`;
    if (!l.itemCode) e.push(`${n}.itemCode: كود الصنف (EGS/GS1) غير مسجل للصنف «${l.description}»`);
    if (l.itemType === "EGS" && l.itemCode && !/^EG-\d{9}-.+/.test(l.itemCode)) e.push(`${n}.itemCode: كود EGS يجب أن يكون بالصيغة EG-<رقم التسجيل>-<الكود>`);
    if (l.itemType === "GS1" && l.itemCode && !/^\d{8,14}$/.test(l.itemCode)) e.push(`${n}.itemCode: كود GS1 أرقام فقط (8–14)`);
    if (!near(l.salesTotal, l.quantity * l.unitValue.amountEGP)) e.push(`${n}.salesTotal ≠ الكمية × سعر الوحدة`);
    if (!near(l.netTotal, l.salesTotal - l.discount.amount)) e.push(`${n}.netTotal ≠ salesTotal − الخصم`);
    const t1 = l.taxableItems.find((x: any) => x.taxType === "T1");
    if (t1 && !near(t1.amount, l.netTotal * t1.rate / 100)) e.push(`${n}.T1 ≠ صافي القيمة × ${t1.rate}%`);
    if (!near(l.total, l.netTotal + l.taxableItems.reduce((a: number, x: any) => a + x.amount, 0))) e.push(`${n}.total ≠ الصافي + الضرائب`);
  });
  const L = doc.invoiceLines || [];
  const s = (f: (l: any) => number) => L.reduce((a: number, l: any) => a + f(l), 0);
  if (!near(doc.totalSalesAmount, s((l) => l.salesTotal))) e.push("totalSalesAmount ≠ مجموع البنود");
  if (!near(doc.netAmount, s((l) => l.netTotal))) e.push("netAmount ≠ مجموع صافي البنود");
  if (!near(doc.totalAmount, doc.netAmount + doc.taxTotals.reduce((a: number, x: any) => a + x.amount, 0) - doc.extraDiscountAmount)) e.push("totalAmount ≠ الصافي + الضرائب − الخصم الإضافي");
  if (doc.documentTypeVersion === "1.0" && !(doc.signatures || []).length) e.push("signatures: النسخة 1.0 تتطلب توقيع الختم الإلكتروني (USB Token)");
  return e;
}

export function validateReceipt(r: any): string[] {
  const e: string[] = [];
  if (!/^\d{9}$/.test(r.seller?.rin || "")) e.push("seller.rin: رقم التسجيل الضريبي 9 أرقام");
  if (!r.seller?.deviceSerialNumber) e.push("seller.deviceSerialNumber: رقم تسلسل جهاز نقطة البيع المسجل في المنظومة");
  if (!/^\d{4}$/.test(r.seller?.activityCode || "")) e.push("seller.activityCode: كود النشاط 4 أرقام");
  (r.itemData || []).forEach((l: any, i: number) => { if (!l.itemCode) e.push(`itemData[${i + 1}].itemCode: كود الصنف غير مسجل («${l.description}»)`); if (!near(l.totalSale, l.quantity * l.unitPrice)) e.push(`itemData[${i + 1}].totalSale ≠ الكمية × السعر`); });
  if (r.documentType?.receiptType === "R" && !r.header?.referenceOldUUID) e.push("referenceOldUUID: إيصال المرتجع يجب أن يشير إلى إيصال البيع المقبول");
  const copy = JSON.parse(JSON.stringify(r)); copy.header.uuid = "";
  if (sha256hex(serialize(copy)) !== r.header.uuid) e.push("header.uuid لا يطابق SHA-256 للإيصال");
  return e;
}

// ─── transport ───────────────────────────────────────────────────────────
const tokens = new Map<string, { token: string; exp: number }>();
async function token(cfg: any, pos = false) {
  const key = `${cfg.companyId}:${pos ? "pos" : "erp"}:${cfg.environment}`;
  const c = tokens.get(key);
  if (c && c.exp > Date.now() + 60000) return c.token;
  const host = ETA_HOSTS[cfg.environment];
  if (!host) throw bad("بيئة الربط غير صحيحة");
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: pos ? cfg.posClientId : cfg.clientId, client_secret: pos ? cfg.posClientSecret : cfg.clientSecret, scope: "InvoicingAPI" });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (pos) Object.assign(headers, { posserial: cfg.posSerial || "", pososversion: cfg.posOsVersion || "", posmodelframework: cfg.posModel || "", presharedkey: cfg.posPresharedKey || "" });
  const r = await fetch(`${host.id}/connect/token`, { method: "POST", headers, body, signal: AbortSignal.timeout(20000) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw bad(`تعذر الحصول على رمز الدخول من المنظومة (${r.status}) ${j.error_description || j.error || ""}`.trim());
  tokens.set(key, { token: j.access_token, exp: Date.now() + Number(j.expires_in || 3600) * 1000 });
  return j.access_token as string;
}
async function api(cfg: any, method: string, path: string, body?: any, pos = false) {
  const tk = await token(cfg, pos);
  const r = await fetch(`${ETA_HOSTS[cfg.environment].api}${path}`, { method, headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json", "Accept-Language": "ar" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  let j: any = null; try { j = text ? JSON.parse(text) : null; } catch { j = { raw: text.slice(0, 500) }; }
  return { status: r.status, ok: r.ok, body: j };
}

/** Delegated signing: the local signer (holding the USB token) returns a CAdES-BES signature over the serialized document. */
async function sign(cfg: any, serialized: string) {
  if (!cfg.signerUrl) return null;
  const r = await fetch(cfg.signerUrl, { method: "POST", headers: { "Content-Type": "application/json", ...(cfg.signerSecret ? { Authorization: `Bearer ${cfg.signerSecret}` } : {}) }, body: JSON.stringify({ serialized: Buffer.from(serialized, "utf8").toString("base64"), sha256: sha256hex(serialized) }), signal: AbortSignal.timeout(30000) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.signature) throw bad(`خدمة التوقيع لم تُرجع توقيعاً (${r.status}) ${j.message || ""}`.trim());
  return String(j.signature);
}

const mockUuid = (seed: string) => crypto.createHash("sha256").update(seed).digest("base64").replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 26).padEnd(26, "X");

// ─── workflow ────────────────────────────────────────────────────────────
async function log(t: Db, companyId: string, invoiceId: string | null, action: string, ok: boolean, detail: any) {
  await t.insert("eta_log", { companyId, invoiceId, action, ok, detail: JSON.stringify(detail ?? null) });
}

/** Called when a sales document is posted: marks it for the ETA (receipt for POS, e-invoice otherwise). */
export async function queueDocument(t: Db, company: any, invoiceId: string) {
  const inv = await t.one(`SELECT id, kind, channel, direction FROM invoices WHERE id=$1`, [invoiceId]);
  if (inv.direction !== "SALE" || !["INVOICE", "CREDIT_NOTE", "DEBIT_NOTE"].includes(inv.kind)) return;
  const cfg = await getConfig(t, company.id);
  const issues = configIssues(cfg, company);
  const kind = inv.channel === "POS" ? "RECEIPT" : "INVOICE";
  await t.exec(`UPDATE invoices SET eta_kind=$2, eta_status=$3 WHERE id=$1`, [invoiceId, kind, issues.length ? "NOT_CONFIGURED" : "PENDING"]);
}

async function loadDoc(t: Db, companyId: string, invoiceId: string) {
  const inv = await t.one(`SELECT * FROM invoices WHERE id=$1 AND company_id=$2 FOR UPDATE`, [invoiceId, companyId], "المستند غير موجود");
  const lines = await t.rows(`SELECT l.*, p.sku, p.eta_item_type, p.eta_item_code, p.eta_unit_type, p.name product_name FROM invoice_lines l LEFT JOIN products p ON p.id=l.product_id WHERE l.invoice_id=$1 ORDER BY l.sort`, [invoiceId]);
  const partner = inv.partnerId ? await t.maybe(`SELECT * FROM partners WHERE id=$1`, [inv.partnerId]) : null;
  const origin = inv.originId ? await t.maybe(`SELECT id, number, eta_uuid FROM invoices WHERE id=$1`, [inv.originId]) : null;
  return { inv, lines, partner, origin };
}

/** Builds the document as it would be sent now, with its serialization and validation errors (no side effects). */
export async function previewDocument(t: Db, company: any, invoiceId: string) {
  const cfg = await getConfig(t, company.id);
  const { inv, lines, partner, origin } = await loadDoc(t, company.id, invoiceId);
  if (inv.etaKind === "RECEIPT" || inv.channel === "POS") {
    const doc = buildReceipt(company, cfg, inv, lines, origin, cfg.receiptLastUuid || "");
    return { kind: "RECEIPT", document: doc, serialized: serialize(doc), errors: [...configIssues(cfg, company).map((x) => "الإعدادات: " + x), ...validateReceipt(doc)] };
  }
  const doc = buildInvoiceDocument(company, cfg, inv, lines, partner, origin);
  const serialized = serialize(doc);
  const errors = validateInvoiceDocument({ ...doc, signatures: doc.documentTypeVersion === "1.0" && (cfg.signerUrl || cfg.environment === "MOCK") ? [{ signatureType: "I", value: "…" }] : [] });
  return { kind: "INVOICE", document: doc, serialized, sha256: sha256hex(serialized), errors: [...configIssues(cfg, company).map((x) => "الإعدادات: " + x), ...errors] };
}

/** Submits one document. MOCK applies the same validation locally and answers like the ETA. */
export async function submitDocument(company: any, invoiceId: string) {
  return tx(async (t) => {
    const cfg = await t.one(`SELECT * FROM eta_configs WHERE company_id=$1 FOR UPDATE`, [company.id]).catch(() => getConfig(t, company.id));
    const { inv, lines, partner, origin } = await loadDoc(t, company.id, invoiceId);
    if (["VALID", "SUBMITTED", "CANCELLED"].includes(inv.etaStatus)) return { status: inv.etaStatus, uuid: inv.etaUuid };
    const ci = configIssues(cfg, company);
    if (ci.length) { await t.exec(`UPDATE invoices SET eta_status='NOT_CONFIGURED', eta_errors=$2 WHERE id=$1`, [invoiceId, JSON.stringify(ci)]); return { status: "NOT_CONFIGURED", errors: ci }; }
    const isReceipt = inv.etaKind === "RECEIPT" || inv.channel === "POS";
    if (isReceipt) {
      const doc = buildReceipt(company, cfg, inv, lines, origin, cfg.receiptLastUuid || "");
      const errors = validateReceipt(doc);
      if (errors.length) { await t.exec(`UPDATE invoices SET eta_status='INVALID', eta_document=$2, eta_errors=$3 WHERE id=$1`, [invoiceId, JSON.stringify(doc), JSON.stringify(errors)]); await log(t, company.id, invoiceId, "RECEIPT_SUBMIT", false, errors); return { status: "INVALID", errors }; }
      let res: any;
      if (cfg.environment === "MOCK") res = { status: 202, ok: true, body: { submissionId: mockUuid("s" + doc.header.uuid), acceptedDocuments: [{ uuid: doc.header.uuid, receiptNumber: doc.header.receiptNumber }], rejectedDocuments: [] } };
      else res = await api(cfg, "POST", "/api/v1/receiptsubmissions", { receipts: [doc] }, true);
      const acc = res.body?.acceptedDocuments?.[0];
      const status = res.ok && acc ? (cfg.environment === "MOCK" ? "VALID" : "SUBMITTED") : "REJECTED";
      const errs = status === "REJECTED" ? [JSON.stringify(res.body?.rejectedDocuments?.[0]?.error || res.body).slice(0, 800)] : null;
      await t.exec(`UPDATE invoices SET eta_status=$2, eta_uuid=$3, eta_submission_id=$4, eta_document=$5, eta_response=$6, eta_errors=$7, eta_submitted_at=now() WHERE id=$1`, [invoiceId, status, doc.header.uuid, res.body?.submissionId || null, JSON.stringify(doc), JSON.stringify(res.body), errs && JSON.stringify(errs)]);
      if (status !== "REJECTED") await t.exec(`UPDATE eta_configs SET receipt_last_uuid=$2, updated_at=now() WHERE company_id=$1`, [company.id, doc.header.uuid]);
      await log(t, company.id, invoiceId, "RECEIPT_SUBMIT", status !== "REJECTED", res.body);
      return { status, uuid: doc.header.uuid, errors: errs };
    }
    const doc: any = buildInvoiceDocument(company, cfg, inv, lines, partner, origin);
    const serialized = serialize(doc);
    if (doc.documentTypeVersion === "1.0") {
      if (cfg.environment === "MOCK" && !cfg.signerUrl) doc.signatures = [{ signatureType: "I", value: Buffer.from("MOCK-SIGNATURE:" + sha256hex(serialized)).toString("base64") }];
      else {
        const sig = await sign(cfg, serialized).catch((e) => { throw bad(e.message); });
        if (!sig) { await t.exec(`UPDATE invoices SET eta_status='NEEDS_SIGNATURE', eta_document=$2 WHERE id=$1`, [invoiceId, JSON.stringify(doc)]); return { status: "NEEDS_SIGNATURE", errors: ["اضبط خدمة التوقيع (USB Token) أو استخدم النسخة 0.9 في بيئة ما قبل الإنتاج"] }; }
        doc.signatures = [{ signatureType: "I", value: sig }];
      }
    }
    const errors = validateInvoiceDocument(doc);
    if (errors.length) { await t.exec(`UPDATE invoices SET eta_status='INVALID', eta_document=$2, eta_errors=$3 WHERE id=$1`, [invoiceId, JSON.stringify(doc), JSON.stringify(errors)]); await log(t, company.id, invoiceId, "SUBMIT", false, errors); return { status: "INVALID", errors }; }
    let res: any;
    if (cfg.environment === "MOCK") { const u = mockUuid(serialized); res = { status: 202, ok: true, body: { submissionId: mockUuid("sub" + u), acceptedDocuments: [{ uuid: u, longId: (u + mockUuid(u)).slice(0, 42), internalId: inv.number }], rejectedDocuments: [] } }; }
    else res = await api(cfg, "POST", "/api/v1.0/documentsubmissions", { documents: [doc] });
    const acc = res.body?.acceptedDocuments?.[0];
    const status = res.ok && acc ? (cfg.environment === "MOCK" ? "VALID" : "SUBMITTED") : "REJECTED";
    const errs = status === "REJECTED" ? [JSON.stringify(res.body?.rejectedDocuments?.[0]?.error || res.body).slice(0, 800)] : null;
    await t.exec(`UPDATE invoices SET eta_status=$2, eta_uuid=$3, eta_long_id=$4, eta_submission_id=$5, eta_document=$6, eta_response=$7, eta_errors=$8, eta_submitted_at=now() WHERE id=$1`, [invoiceId, status, acc?.uuid || null, acc?.longId || null, res.body?.submissionId || null, JSON.stringify(doc), JSON.stringify(res.body), errs && JSON.stringify(errs)]);
    await log(t, company.id, invoiceId, "SUBMIT", status !== "REJECTED", res.body);
    return { status, uuid: acc?.uuid || null, errors: errs };
  });
}

/** Refreshes a submitted document's status (Valid / Invalid / Cancelled / Rejected) from the ETA. */
export async function refreshDocument(company: any, invoiceId: string) {
  return tx(async (t) => {
    const cfg = await getConfig(t, company.id);
    const inv = await t.one(`SELECT * FROM invoices WHERE id=$1 AND company_id=$2 FOR UPDATE`, [invoiceId, company.id]);
    if (!inv.etaUuid) throw bad("المستند لم يُرسل بعد");
    if (cfg.environment === "MOCK") return { status: inv.etaStatus };
    const path = inv.etaKind === "RECEIPT" ? `/api/v1/receipts/${inv.etaUuid}/details` : `/api/v1.0/documents/${inv.etaUuid}/details`;
    const r = await api(cfg, "GET", path, undefined, inv.etaKind === "RECEIPT");
    const st = String(r.body?.status || r.body?.receipt?.status || "").toLowerCase();
    const map: Record<string, string> = { valid: "VALID", invalid: "INVALID", cancelled: "CANCELLED", rejected: "REJECTED", submitted: "SUBMITTED" };
    const status = map[st] || inv.etaStatus;
    const errs = status === "INVALID" ? [JSON.stringify(r.body?.validationResults || r.body).slice(0, 1500)] : null;
    await t.exec(`UPDATE invoices SET eta_status=$2, eta_response=$3, eta_errors=COALESCE($4, eta_errors) WHERE id=$1`, [invoiceId, status, JSON.stringify(r.body), errs && JSON.stringify(errs)]);
    await log(t, company.id, invoiceId, "REFRESH", r.ok, { status: r.status, docStatus: st });
    return { status };
  });
}

/** Issuer cancellation (allowed within the ETA's cancellation window). */
export async function cancelDocument(company: any, invoiceId: string, reason: string) {
  return tx(async (t) => {
    const cfg = await getConfig(t, company.id);
    const inv = await t.one(`SELECT * FROM invoices WHERE id=$1 AND company_id=$2 FOR UPDATE`, [invoiceId, company.id]);
    if (!inv.etaUuid || !["VALID", "SUBMITTED"].includes(inv.etaStatus)) throw bad("يمكن إلغاء المستندات المقبولة في المنظومة فقط");
    if (!reason || reason.length < 3) throw bad("اكتب سبب الإلغاء");
    if (cfg.environment !== "MOCK") {
      const r = await api(cfg, "PUT", `/api/v1.0/documents/state/${inv.etaUuid}/state`, { status: "cancelled", reason });
      if (!r.ok) throw bad(`رفضت المنظومة الإلغاء (${r.status}) ${JSON.stringify(r.body).slice(0, 300)}`);
    }
    await t.exec(`UPDATE invoices SET eta_status='CANCELLED' WHERE id=$1`, [invoiceId]);
    await log(t, company.id, invoiceId, "CANCEL", true, { reason });
    return { status: "CANCELLED" };
  });
}

export async function testConnection(t: Db, company: any) {
  const cfg = await getConfig(t, company.id);
  const issues = configIssues(cfg, company);
  if (cfg.environment === "MOCK") return { ok: issues.length === 0, environment: "MOCK", message: issues.length ? "أكمل الإعدادات: " + issues.join("، ") : "المحاكي جاهز — المستندات تُتحقق بنفس قواعد المنظومة دون إرسال فعلي", issues };
  try { await token(cfg); return { ok: true, environment: cfg.environment, message: "تم الاتصال بالمنظومة والحصول على رمز الدخول بنجاح", issues }; }
  catch (e: any) { return { ok: false, environment: cfg.environment, message: e.message, issues }; }
}

export const r2x = r2;

/** After posting: send at once when auto-submit is on (awaited in the simulator, background against the real ETA). */
export async function autoSubmit(company: any, invoiceId: string) {
  const row = await db.maybe(`SELECT i.eta_status, c.auto_submit, c.environment FROM invoices i LEFT JOIN eta_configs c ON c.company_id=i.company_id WHERE i.id=$1`, [invoiceId]);
  if (!row || row.etaStatus !== "PENDING" || row.autoSubmit === false) return;
  const run = submitDocument(company, invoiceId).catch((e) => tx((t) => log(t, company.id, invoiceId, "SUBMIT", false, { error: e.message })).catch(() => undefined));
  if (row.environment === "MOCK") await run;
}
