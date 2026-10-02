/**
 * Salla (سلة) store connector — receives Salla webhooks and turns them into accounting documents.
 *
 *   order.created            → sales invoice (posted immediately, or kept as a draft until the order completes)
 *   order.status.updated /
 *   order.updated            → completed/delivered: post the draft & settle COD; canceled/refunded: credit note
 *   order.refunded           → full credit note
 *   product.created/updated  → product upserted by SKU (optional)
 *
 * Prepaid orders (card, Mada, Apple Pay, Tabby, Tamara…) are settled into the e-store clearing account;
 * cash-on-delivery stays on the customer until Salla reports the order delivered/completed.
 * Every webhook is logged (salla_events) with its outcome and can be re-processed.
 */
import crypto from "crypto";
import { db, tx, Db } from "../db/pool";
import { bad, num, r2, D, today, isDate } from "../lib/core";
import { saveDraft, postInvoice, getInvoice, applySettlement } from "./invoices";
import { post } from "../accounting/engine";
import { createPayment } from "./payments";
import { emit, invoiceDto } from "./integrations";
import { nextCode } from "../routes/master";
import { submitInvoice } from "../zatca/stamp";
import { reqCtx } from "../lib/context";

const ACTOR = "متجر سلة (تكامل آلي)";
const DONE_STATUSES = ["completed", "delivered", "shipped", "delivering"];
const CANCEL_STATUSES = ["canceled", "cancelled", "refunded", "restored", "restoring"];
const VAT = 0.15;

export const newSallaToken = () => crypto.randomBytes(18).toString("base64url");

export async function getConnection(companyId: string) {
  return db.maybe(`SELECT * FROM salla_connections WHERE company_id=$1`, [companyId]);
}

/** Webhook authenticity: path token always; when a secret is set, also the Salla signature (or token strategy header). */
export function verifySignature(conn: any, raw: Buffer | undefined, headers: Record<string, any>) {
  if (!conn.secret) return true;
  const sig = String(headers["x-salla-signature"] || "");
  if (sig && raw) {
    const mac = crypto.createHmac("sha256", conn.secret).update(raw).digest("hex");
    const a = Buffer.from(mac), b = Buffer.from(sig.toLowerCase());
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  const auth = String(headers.authorization || "");
  if (auth && auth.replace(/^Bearer\s+/i, "") === conn.secret) return true;
  return false;
}

// ─── payload helpers (Salla payloads vary slightly between API versions → read defensively) ──
const amt = (v: any): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number" || typeof v === "string") return num(v);
  if (typeof v === "object") return amt(v.amount ?? v.value ?? 0);
  return 0;
};
const statusSlug = (o: any) => String(o?.status?.slug || o?.status?.customized?.slug || o?.status || "").toLowerCase();
const orderDate = (o: any) => {
  const d = String(o?.date?.date || o?.created_at || o?.date || "").slice(0, 10);
  return isDate(d) ? d : today();
};
const isCod = (o: any) => /cod|cash/i.test(String(o?.payment_method || o?.payment?.method || ""));
const orderRef = (o: any) => String(o?.reference_id || o?.id || "");

async function upsertSallaCustomer(t: Db, companyId: string, c: any) {
  if (!c) c = {};
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || c.name || "عميل متجر سلة";
  const phone = c.mobile ? `${c.mobile_code ? String(c.mobile_code).replace(/^\+?/, "+") : ""}${c.mobile}`.replace(/\s/g, "") : null;
  const sallaCode = c.id ? `SL-${c.id}` : null;
  let found = sallaCode ? await t.maybe(`SELECT * FROM partners WHERE company_id=$1 AND code=$2`, [companyId, sallaCode]) : null;
  if (!found && phone) found = await t.maybe(`SELECT * FROM partners WHERE company_id=$1 AND is_customer AND (phone=$2 OR phone=$3) LIMIT 1`, [companyId, phone, String(c.mobile || "")]);
  if (!found && c.email) found = await t.maybe(`SELECT * FROM partners WHERE company_id=$1 AND is_customer AND lower(email)=lower($2) LIMIT 1`, [companyId, c.email]);
  if (found) return found;
  if (!c.id && !phone && !c.email) {
    return (await t.maybe(`SELECT * FROM partners WHERE company_id=$1 AND code='WALKIN'`, [companyId])) || t.insert("partners", { companyId, code: "WALKIN", name: "عميل نقدي", isCustomer: true, kind: "INDIVIDUAL" });
  }
  return t.insert("partners", {
    companyId, code: sallaCode || (await nextCode(companyId, "C")), name, isCustomer: true, kind: "INDIVIDUAL",
    phone, email: c.email || null, city: c.city || null, country: c.country_code || c.country || "SA", notes: "عميل من متجر سلة",
  });
}

async function findOrCreateProduct(t: Db, companyId: string, item: any, create: boolean) {
  const sku = String(item?.sku || item?.product?.sku || "").trim();
  if (sku) {
    const p = await t.maybe(`SELECT * FROM products WHERE company_id=$1 AND (sku=$2 OR barcode=$2) LIMIT 1`, [companyId, sku]);
    if (p) return p;
  }
  if (!create || !sku) return null;
  const unit = amt(item?.amounts?.price_without_tax) || r2(amt(item?.price) / (1 + VAT));
  const isService = /digital|service|codes|booking|donating/i.test(String(item?.product_type || item?.product?.type || ""));
  return t.insert("products", {
    companyId, sku, name: String(item?.name || sku).slice(0, 200), type: isService ? "SERVICE" : "STOCK", unit: "حبة",
    salePrice: r2(unit), purchasePrice: 0, taxCode: "S",
  });
}

/** Builds Mizan invoice lines from a Salla order (prices excl. VAT; line discounts as %). */
async function orderLines(t: Db, companyId: string, conn: any, o: any) {
  const items: any[] = Array.isArray(o?.items) ? o.items : [];
  if (!items.length) throw bad("الطلب لا يحتوي أصنافاً");
  const lines: any[] = [];
  for (const it of items) {
    const qty = num(it.quantity) || 1;
    const prod = await findOrCreateProduct(t, companyId, it, conn.createProducts);
    let unit = amt(it?.amounts?.price_without_tax);
    if (!unit) unit = r2(amt(it?.price) / (1 + VAT)); // Saudi store prices are VAT-inclusive
    if (!unit && amt(it?.amounts?.total)) unit = r2(amt(it.amounts.total) / qty / (1 + VAT));
    const disc = amt(it?.amounts?.total_discount);
    const gross = unit * qty;
    const zeroRated = it?.amounts?.tax && amt(it.amounts.tax.amount ?? it.amounts.tax) === 0 && amt(it?.amounts?.tax?.percent) === 0 && it?.amounts?.tax?.percent !== undefined;
    lines.push({
      productId: prod?.id || null, description: String(it.name || prod?.name || "صنف من متجر سلة") + (it.sku && !prod ? ` (${it.sku})` : ""),
      qty, unitPrice: r2(unit), discountPct: gross > 0 && disc > 0 ? Math.min(100, r2((disc / gross) * 100)) : 0, taxCode: zeroRated ? "Z" : prod?.taxCode || "S",
    });
  }
  // order-level discount (coupons, offers) spread as an equal % on every line
  const orderDisc = Array.isArray(o?.amounts?.discounts) ? o.amounts.discounts.reduce((a: number, d: any) => a + amt(d.discount ?? d.amount ?? d.value ?? d), 0) : amt(o?.amounts?.discount);
  const linesNet = lines.reduce((a, l) => a + l.unitPrice * l.qty * (1 - l.discountPct / 100), 0);
  if (orderDisc > 0 && linesNet > 0) {
    const pct = Math.min(100, (orderDisc / (1 + VAT) / linesNet) * 100);
    for (const l of lines) l.discountPct = r2(100 - (100 - l.discountPct) * (1 - pct / 100));
  }
  const shipping = amt(o?.amounts?.shipping_cost);
  if (shipping > 0) lines.push({ productId: null, description: `رسوم الشحن — ${o?.shipping?.company || o?.shipping?.courier_name || "سلة"}`, qty: 1, unitPrice: r2(shipping / (1 + VAT)), discountPct: 0, taxCode: "S" });
  const codFee = amt(o?.amounts?.cash_on_delivery);
  if (codFee > 0) lines.push({ productId: null, description: "رسوم الدفع عند الاستلام", qty: 1, unitPrice: r2(codFee / (1 + VAT)), discountPct: 0, taxCode: "S" });
  return lines;
}

async function company(companyId: string) {
  return db.one(`SELECT * FROM companies WHERE id=$1`, [companyId]);
}

async function settle(t: Db, conn: any, inv: any, o: any) {
  const due = r2(D(inv.total).minus(inv.amountPaid || 0));
  if (due <= 0.001) return null;
  const acc = conn.depositAccountId
    ? await t.one(`SELECT id FROM accounts WHERE id=$1`, [conn.depositAccountId])
    : await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND system_key='ESTORE_CLEARING'`, [inv.companyId]);
  return createPayment(t, inv.companyId, ACTOR, {
    direction: "IN", partnerId: inv.partnerId, date: inv.date, amount: due, method: isCod(o) ? "CASH" : "BANK", accountId: acc.id,
    reference: `سلة ${orderRef(o)}`, notes: `تحصيل طلب سلة رقم ${orderRef(o)} — ${o?.payment_method || ""}`, allocations: [{ invoiceId: inv.id, amount: due }], branchId: inv.branchId, isDemo: !!inv.isDemo,
  });
}

async function afterPost(companyId: string, invoiceId: string) {
  const c = await company(companyId);
  const doc = await getInvoice(db, companyId, invoiceId);
  if (doc.zatcaStatus === "PENDING") submitInvoice(c, doc.id).catch(() => undefined);
  emit(companyId, "invoice.posted", invoiceDto(doc));
  return doc;
}

/** Create (and normally post) the invoice for a Salla order. Idempotent on salla:<order id>. */
async function handleOrderCreated(conn: any, o: any, opts: { forceDraft?: boolean; sample?: boolean } = {}) {
  const ext = `salla:${o?.id ?? orderRef(o)}`;
  const existing = await db.maybe(`SELECT id, status, number FROM invoices WHERE company_id=$1 AND external_ref=$2 AND kind='INVOICE'`, [conn.companyId, ext]);
  if (existing) return { status: "IGNORED", message: `الطلب مسجل مسبقاً في المستند ${existing.number}`, invoiceId: existing.id };
  if (CANCEL_STATUSES.includes(statusSlug(o))) return { status: "IGNORED", message: "طلب ملغى — لم يُسجل" };
  const c = await company(conn.companyId);
  const shouldPost = !opts.forceDraft && conn.autoPost && (conn.postOnStatus === "created" || DONE_STATUSES.includes(statusSlug(o)));
  // 1) the draft (always succeeds if lines are valid)
  const draft = await tx(async (t) => {
    const partner = await upsertSallaCustomer(t, conn.companyId, o.customer);
    const lines = await orderLines(t, conn.companyId, conn, o);
    const d = await saveDraft(t, c, ACTOR, {
      direction: "SALE", kind: "INVOICE", channel: "SALLA", date: orderDate(o), partnerId: partner.id, warehouseId: conn.warehouseId || null, branchId: conn.branchId || null,
      notes: `طلب متجر سلة رقم ${orderRef(o)}${o?.payment_method ? ` — الدفع: ${o.payment_method}` : ""}`, pricesIncludeVat: false, lines, isDemo: !!opts.sample, // sample orders are tagged demo → removed with «حذف البيانات التجريبية»
    } as any);
    await t.exec(`UPDATE invoices SET external_ref=$2 WHERE id=$1`, [d.id, ext]);
    return d;
  });
  if (!shouldPost) return { status: "DONE", message: opts.forceDraft ? "أُنشئت مسودة اختبار (لم تُرحّل)" : "أُنشئت مسودة فاتورة — تُرحَّل عند اكتمال الطلب", invoiceId: draft.id };
  // 2) post + settle prepaid orders; a posting failure (e.g. stock) leaves the draft for review
  try {
    await tx(async (t) => {
      const posted = await postInvoice(t, c, draft.id, ACTOR, { overrideCreditLimit: true });
      if (!isCod(o)) await settle(t, conn, posted, o);
    });
  } catch (e: any) {
    return { status: "FAILED", message: `حُفظت كمسودة ولم تُرحّل: ${e.message}`, invoiceId: draft.id };
  }
  const doc = await afterPost(conn.companyId, draft.id);
  return { status: "DONE", message: `فاتورة ${doc.number} بقيمة ${Number(doc.total).toFixed(2)} ر.س${isCod(o) ? " (دفع عند الاستلام — مستحقة على العميل)" : " (مسددة عبر سلة)"}`, invoiceId: doc.id };
}

async function handleOrderStatus(conn: any, o: any) {
  const ext = `salla:${o?.id ?? orderRef(o)}`;
  const inv = await db.maybe(`SELECT * FROM invoices WHERE company_id=$1 AND external_ref=$2 AND kind='INVOICE'`, [conn.companyId, ext]);
  const slug = statusSlug(o);
  if (!inv) {
    if (CANCEL_STATUSES.includes(slug)) return { status: "IGNORED", message: "طلب ملغى لم يُسجل سابقاً" };
    return handleOrderCreated(conn, o); // first time we hear of this order
  }
  const c = await company(conn.companyId);
  if (CANCEL_STATUSES.includes(slug)) {
    if (inv.status === "DRAFT") { await db.exec(`DELETE FROM invoices WHERE id=$1`, [inv.id]); return { status: "DONE", message: "أُلغي الطلب — حُذفت المسودة" }; }
    const already = await db.maybe(`SELECT id, number FROM invoices WHERE origin_id=$1 AND kind='CREDIT_NOTE' AND status='POSTED'`, [inv.id]);
    if (already) return { status: "IGNORED", message: `مرتجع مسجل مسبقاً ${already.number}`, invoiceId: inv.id, creditNoteId: already.id };
    const full = await getInvoice(db, conn.companyId, inv.id);
    const cn = await tx(async (t) => {
      const d = await saveDraft(t, c, ACTOR, {
        direction: "SALE", kind: "CREDIT_NOTE", channel: "SALLA", partnerId: full.partnerId, warehouseId: full.warehouseId, branchId: full.branchId, originId: full.id, invoiceType: full.invoiceType, isDemo: !!full.isDemo,
        reason: slug === "refunded" ? "استرجاع طلب متجر سلة" : "إلغاء طلب متجر سلة", pricesIncludeVat: false,
        lines: full.lines.map((l: any) => ({ productId: l.productId, accountId: l.accountId, description: l.description, qty: Number(l.qty), unitPrice: Number(l.unitPrice), discountPct: Number(l.discountPct), taxCode: l.taxCode, uomId: l.uomId || null })),
      } as any);
      const posted = await postInvoice(t, c, d.id, ACTOR, {});
      // money already collected for the order goes back through the same clearing account
      const cnOpen = r2(D(posted.total).minus(posted.amountPaid || 0));
      const refund = Math.min(Number(full.amountPaid), cnOpen);
      if (refund > 0.001) {
        const acc = conn.depositAccountId || (await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND system_key='ESTORE_CLEARING'`, [conn.companyId])).id;
        const memo = `رد مبلغ طلب سلة ${orderRef(o)} — ${posted.number}`;
        await post(t, conn.companyId, { date: posted.date, type: "PAYMENT", sourceType: "INVOICE", sourceId: posted.id, branchId: full.branchId, reference: posted.number, memo, createdBy: ACTOR, isDemo: !!full.isDemo, lines: [
          { key: "AR", debit: refund, partnerId: full.partnerId, description: memo }, { account: acc, credit: refund, description: memo },
        ] });
        await applySettlement(t, posted.id, refund);
      }
      return posted;
    });
    await afterPost(conn.companyId, cn.id);
    return { status: "DONE", message: `إشعار دائن ${cn.number} لإلغاء الطلب`, invoiceId: inv.id, creditNoteId: cn.id };
  }
  if (DONE_STATUSES.includes(slug)) {
    let msg = "";
    if (inv.status === "DRAFT" && conn.autoPost) {
      try { await tx((t) => postInvoice(t, c, inv.id, ACTOR, { overrideCreditLimit: true })); } catch (e: any) { return { status: "FAILED", message: `تعذر ترحيل المسودة: ${e.message}`, invoiceId: inv.id }; }
      await afterPost(conn.companyId, inv.id);
      msg = "رُحّلت الفاتورة عند اكتمال الطلب. ";
    }
    const cur = await db.one(`SELECT * FROM invoices WHERE id=$1`, [inv.id]);
    if (cur.status === "POSTED" && ["completed", "delivered"].includes(slug) && Number(cur.total) - Number(cur.amountPaid) > 0.001) {
      await tx((t) => settle(t, conn, cur, o));
      msg += "سُجل التحصيل في حساب تسوية المتجر.";
    }
    return { status: msg ? "DONE" : "IGNORED", message: msg || `حالة الطلب: ${slug}`, invoiceId: inv.id };
  }
  return { status: "IGNORED", message: `حالة الطلب «${o?.status?.name || slug}» لا تتطلب قيداً`, invoiceId: inv.id };
}

async function handleProduct(conn: any, p: any) {
  if (!conn.createProducts) return { status: "IGNORED", message: "مزامنة الأصناف غير مفعلة" };
  const sku = String(p?.sku || "").trim();
  if (!sku) return { status: "IGNORED", message: "صنف بدون رمز SKU" };
  const existing = await db.maybe(`SELECT id FROM products WHERE company_id=$1 AND sku=$2`, [conn.companyId, sku]);
  const price = amt(p?.price);
  if (existing) {
    await db.exec(`UPDATE products SET name=$2 WHERE id=$1`, [existing.id, String(p.name || sku).slice(0, 200)]);
    return { status: "DONE", message: `حُدّث اسم الصنف ${sku}` };
  }
  await tx((t) => findOrCreateProduct(t, conn.companyId, { sku, name: p.name, price: price, product_type: p.type }, true));
  return { status: "DONE", message: `أُنشئ الصنف ${sku}` };
}

/** Dispatches one webhook payload; logs the outcome. Never throws for business errors (Salla would retry forever). */
export async function processEvent(conn: any, body: any, opts: { eventId?: string; isTest?: boolean; sample?: boolean } = {}) {
  const event = String(body?.event || "unknown");
  const data = body?.data || {};
  let ev = opts.eventId ? await db.one(`SELECT * FROM salla_events WHERE id=$1`, [opts.eventId]) : null;
  if (!ev) ev = await db.insert("salla_events", { companyId: conn.companyId, event, sallaId: data?.id ? String(data.id) : null, reference: data?.reference_id ? String(data.reference_id) : data?.sku || null, payload: body, isTest: !!opts.isTest || !!opts.sample });
  else await db.exec(`UPDATE salla_events SET attempts=attempts+1 WHERE id=$1`, [ev.id]);
  let r: any;
  try {
    if (!conn.enabled) r = { status: "IGNORED", message: "الربط موقوف" };
    else r = await reqCtx.run({ bodyBranchId: conn.branchId || null }, async () => {
      if (event === "order.created") return handleOrderCreated(conn, data, { forceDraft: !!opts.isTest, sample: !!opts.sample || !!opts.isTest });
      if (event === "order.updated" || event === "order.status.updated" || event === "order.refunded" || event === "order.cancelled" || event === "order.deleted") {
        if (event === "order.refunded") data.status = { slug: "refunded", name: "مسترجع" };
        if (event === "order.cancelled" || event === "order.deleted") data.status = { slug: "canceled", name: "ملغي" };
        return handleOrderStatus(conn, data);
      }
      if (event === "product.created" || event === "product.updated") return handleProduct(conn, data);
      if (event === "app.store.authorize" || event === "app.installed") return { status: "IGNORED", message: "حدث تفويض التطبيق" };
      return { status: "IGNORED", message: `حدث غير مدعوم: ${event}` };
    });
  } catch (e: any) {
    r = { status: "FAILED", message: e?.message || String(e) };
  }
  await db.exec(`UPDATE salla_events SET status=$2, message=$3, invoice_id=$4, credit_note_id=$5, processed_at=now() WHERE id=$1`, [ev.id, r.status, r.message || null, r.invoiceId || null, r.creditNoteId || null]);
  // an earlier failure on the same order that this event has now resolved stops showing as pending work
  if (r.status === "DONE" && r.invoiceId) await db.exec(`UPDATE salla_events SET status='IGNORED', message=message || ' — عولج لاحقاً' WHERE company_id=$1 AND invoice_id=$2 AND status='FAILED' AND id<>$3`, [conn.companyId, r.invoiceId, ev.id]);
  await db.exec(`UPDATE salla_connections SET last_event_at=now() WHERE company_id=$1`, [conn.companyId]);
  return { id: ev.id, event, ...r };
}

/** A realistic sample order built from the company's own products — lets the merchant see the full flow before going live. */
export async function sampleOrder(companyId: string, opts: { cod?: boolean; warehouseId?: string | null } = {}) {
  // products that can actually ship from the store's warehouse (so the sample posts cleanly)
  let prods = await db.rows(
    `SELECT p.sku, p.name, p.sale_price FROM products p JOIN stock_balances b ON b.product_id=p.id AND b.warehouse_id=COALESCE($2::uuid, (SELECT id FROM warehouses WHERE company_id=$1 ORDER BY is_default DESC, code LIMIT 1))
     WHERE p.company_id=$1 AND p.type='STOCK' AND p.is_active AND NOT p.track_lots AND b.qty >= 3 AND p.sale_price > 0 ORDER BY random() LIMIT 2`, [companyId, opts.warehouseId || null]);
  if (!prods.length) prods = await db.rows(`SELECT sku, name, sale_price FROM products WHERE company_id=$1 AND type='STOCK' AND is_active ORDER BY random() LIMIT 2`, [companyId]);
  if (!prods.length) throw bad("أضف صنفاً واحداً على الأقل ليُستخدم في طلب الاختبار");
  const id = Math.floor(100000000 + Math.random() * 899999999);
  const items = prods.map((p, i) => {
    const q = i + 1, unit = Number(p.salePrice);
    return { id: id + i, name: p.name, sku: p.sku, quantity: q, product_type: "product", amounts: { price_without_tax: { amount: unit, currency: "SAR" }, total_discount: { amount: 0 }, tax: { percent: "15.00", amount: { amount: r2(unit * q * VAT) } }, total: { amount: r2(unit * q * (1 + VAT)) } } };
  });
  const sub = items.reduce((a, i) => a + i.amounts.price_without_tax.amount * i.quantity, 0);
  return {
    event: "order.created", merchant: 0, created_at: new Date().toISOString(),
    data: {
      id, reference_id: 20000 + Math.floor(Math.random() * 9999), date: { date: `${today()} 10:00:00.000000`, timezone: "Asia/Riyadh" },
      status: { slug: "under_review", name: "بإنتظار المراجعة" }, payment_method: opts.cod ? "cod" : "mada", currency: "SAR",
      amounts: { sub_total: { amount: r2(sub) }, shipping_cost: { amount: 25 }, tax: { percent: "15.00", amount: { amount: r2((sub + 25 / 1.15) * VAT) } }, discounts: [], total: { amount: r2(sub * 1.15 + 25) } },
      customer: { id: 900001, first_name: "عميل", last_name: "تجريبي (سلة)", mobile: "500000001", mobile_code: "+966", email: "salla.test@example.com", city: "مكة المكرمة", country: "SA" },
      shipping: { company: "سمسا" }, items,
    },
  };
}
