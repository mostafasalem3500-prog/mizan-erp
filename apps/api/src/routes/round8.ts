/** Round 8: integrations — API keys & webhooks management, public REST API v1, customer portal. */
import { Router, Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { db, tx } from "../db/pool";
import { h, bad, AppError, notFound, num, isDate, today, addDays, r2 } from "../lib/core";
import { authenticate, perm, cid, actor, p, subscriptionState } from "../lib/auth";
import { audit, nextCode } from "./master";
import { EVENTS, createApiKey, resolveApiKey, newWebhookSecret, validateWebhookUrl, emit, testWebhook, redeliver, invoiceDto } from "../services/integrations";
import { saveDraft, postInvoice, getInvoice } from "../services/invoices";
import { createPayment } from "../services/payments";
import { partnerStatement } from "../services/reports";
import { submitInvoice } from "../zatca/stamp";

// ════════ management (session auth) ════════
export const r8 = Router();
r8.use(authenticate);

r8.get("/integrations", perm("settings.read"), h(async (req) => ({
  events: EVENTS,
  keys: await db.rows(`SELECT id, name, prefix, scopes, is_active, last_used_at, created_by, created_at FROM api_keys WHERE company_id=$1 ORDER BY created_at DESC`, [cid(req)]),
  webhooks: await db.rows(`SELECT w.id, w.url, w.events, w.is_active, w.created_at, w.secret, (SELECT json_build_object('ok', d.ok, 'status', d.status, 'at', d.created_at) FROM webhook_deliveries d WHERE d.webhook_id=w.id ORDER BY d.created_at DESC LIMIT 1) last FROM webhooks w WHERE w.company_id=$1 ORDER BY w.created_at DESC`, [cid(req)]),
})));
r8.post("/integrations/keys", perm("settings.write"), h(async (req) => { const k = await createApiKey(cid(req), String(req.body?.name || ""), req.body?.scopes || ["read"], actor(req)); await audit(req, "CREATE", "api_key", k.id, { name: k.name, scopes: k.scopes }); return k; }));
r8.post("/integrations/keys/:id/revoke", perm("settings.write"), h(async (req) => { await db.exec(`UPDATE api_keys SET is_active=false WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]); await audit(req, "REVOKE", "api_key", p(req).id); return { ok: true }; }));
r8.post("/integrations/webhooks", perm("settings.write"), h(async (req) => {
  const events = (req.body?.events || []).filter((e: string) => EVENTS[e]);
  if (!events.length) throw bad("اختر حدثاً واحداً على الأقل");
  const w = await db.insert("webhooks", { companyId: cid(req), url: validateWebhookUrl(String(req.body?.url || "")), events, secret: newWebhookSecret() });
  await audit(req, "CREATE", "webhook", w.id, { url: w.url });
  return w;
}));
r8.put("/integrations/webhooks/:id", perm("settings.write"), h(async (req) => db.update("webhooks", { id: p(req).id, companyId: cid(req) }, { isActive: req.body?.isActive, events: Array.isArray(req.body?.events) ? req.body.events.filter((e: string) => EVENTS[e]) : undefined, url: req.body?.url ? validateWebhookUrl(req.body.url) : undefined })));
r8.delete("/integrations/webhooks/:id", perm("settings.write"), h(async (req) => { await db.exec(`DELETE FROM webhooks WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]); return { ok: true }; }));
r8.post("/integrations/webhooks/:id/test", perm("settings.write"), h(async (req) => testWebhook(await db.one(`SELECT * FROM webhooks WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)], "غير موجود"))));
r8.get("/integrations/webhooks/:id/deliveries", perm("settings.read"), h(async (req) => db.rows(`SELECT d.id, d.event, d.status, d.ok, d.attempts, d.response, d.created_at, d.payload FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id WHERE w.id=$1 AND w.company_id=$2 ORDER BY d.created_at DESC LIMIT 50`, [p(req).id, cid(req)])));
r8.post("/integrations/deliveries/:id/redeliver", perm("settings.write"), h(async (req) => redeliver(p(req).id, cid(req))));

// customer portal links
r8.post("/partners/:id/portal", perm("partners.write"), h(async (req) => {
  const row = await db.one(`UPDATE partners SET portal_token=COALESCE(portal_token, gen_random_uuid()) WHERE id=$1 AND company_id=$2 RETURNING portal_token`, [p(req).id, cid(req)], "الطرف غير موجود");
  return { token: row.portalToken, path: `/c/${row.portalToken}` };
}));
r8.delete("/partners/:id/portal", perm("partners.write"), h(async (req) => { await db.exec(`UPDATE partners SET portal_token=NULL WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]); return { ok: true }; }));

// ════════ public portal (token, no login) ════════
export const portal = Router();
portal.get("/portal/:token", h(async (req) => {
  const token = p(req).token;
  if (!/^[0-9a-f-]{36}$/.test(token)) throw notFound();
  const partner = await db.maybe(`SELECT * FROM partners WHERE portal_token=$1 AND is_active`, [token]);
  if (!partner) throw notFound("الرابط غير صالح أو أُلغي");
  const company = await db.one(`SELECT name_ar, name_en, vat_number, cr_number, phone, email, logo, city, district, street FROM companies WHERE id=$1`, [partner.companyId]);
  const role = partner.isCustomer ? "CUSTOMER" : "SUPPLIER";
  const from = isDate(req.query.from) ? String(req.query.from) : addDays(today(), -365);
  const st = await partnerStatement(db, partner.companyId, partner.id, { from, to: today(), role });
  const dir = role === "CUSTOMER" ? "SALE" : "PURCHASE";
  const open = await db.rows(`SELECT number, date, due_date, total, amount_paid, total-amount_paid due, share_token, currency, fc_total FROM invoices WHERE company_id=$1 AND partner_id=$2 AND direction=$3 AND kind='INVOICE' AND status='POSTED' AND total-amount_paid>0.001 ORDER BY due_date`, [partner.companyId, partner.id, dir]);
  const recent = await db.rows(`SELECT number, kind, date, total, payment_status, share_token FROM invoices WHERE company_id=$1 AND partner_id=$2 AND direction=$3 AND status='POSTED' ORDER BY date DESC, created_at DESC LIMIT 30`, [partner.companyId, partner.id, dir]);
  return { company, partner: { name: partner.name, vatNumber: partner.vatNumber, phone: partner.phone, city: partner.city }, role, from, statement: { opening: st.opening, closing: st.closing, rows: st.rows.map((r: any) => ({ date: r.date, number: r.number, memo: r.memo, debit: r.debit, credit: r.credit, balance: r.balance })) }, open, recent, overdue: r2(open.filter((i) => String(i.dueDate).slice(0, 10) < today()).reduce((a, i) => a + Number(i.due), 0)) };
}));

// ════════ public REST API v1 (API key) ════════
export const v1 = Router();
const hits = new Map<string, { n: number; t: number }>();
async function apiAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const hdr = req.headers.authorization || "";
    const key = hdr.startsWith("Bearer ") ? hdr.slice(7) : String(req.headers["x-api-key"] || "");
    const k = await resolveApiKey(key);
    if (!k) throw new AppError(401, "مفتاح API غير صالح", "INVALID_API_KEY");
    const now = Date.now(), slot = hits.get(k.id);
    if (slot && now - slot.t < 60000) { if (++slot.n > 120) throw new AppError(429, "تجاوزت حد الطلبات (120/دقيقة)", "RATE_LIMIT"); } else hits.set(k.id, { n: 1, t: now });
    const company = await db.one(`SELECT * FROM companies WHERE id=$1`, [k.companyId]);
    (req as any).company = company;
    (req as any).auth = { userId: null, userName: `API: ${k.name}`, role: "API", companyId: company.id };
    (req as any).apiKey = k;
    if (req.method !== "GET") {
      if (!k.scopes.includes("write")) throw new AppError(403, "المفتاح للقراءة فقط", "FORBIDDEN");
      const s = subscriptionState(company);
      if (s.readOnly) throw new AppError(402, "الاشتراك منتهٍ — الحساب للقراءة فقط", "SUBSCRIPTION");
    }
    next();
  } catch (e) { next(e); }
}
v1.use(apiAuth);
const C = (req: any) => req.company.id as string;
const A = (req: any) => req.auth.userName as string;

v1.get("/me", h(async (req: any) => ({ company: { id: req.company.id, name: req.company.nameAr, vatNumber: req.company.vatNumber, currency: "SAR" }, key: { name: req.apiKey.name, scopes: req.apiKey.scopes }, events: Object.keys(EVENTS) })));

v1.get("/products", h(async (req) => {
  const params: any[] = [C(req)]; const w = ["p.company_id=$1", "p.is_active"];
  if (req.query.q) { params.push(`%${req.query.q}%`); w.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length} OR p.barcode=$${params.length})`); }
  if (req.query.sku) { params.push(String(req.query.sku)); w.push(`p.sku=$${params.length}`); }
  const limit = Math.min(Number(req.query.limit) || 200, 1000), offset = Number(req.query.offset) || 0;
  const rows = await db.rows(`SELECT p.id, p.sku, p.barcode, p.name, p.name_en, p.type, p.unit, p.sale_price, p.tax_code, c.name AS category, COALESCE((SELECT SUM(qty) FROM stock_balances b WHERE b.product_id=p.id),0) stock,
    COALESCE((SELECT json_agg(json_build_object('name', u.name, 'factor', u.factor, 'barcode', u.barcode, 'salePrice', u.sale_price)) FROM product_uoms u WHERE u.product_id=p.id), '[]'::json) packs
    FROM products p LEFT JOIN product_categories c ON c.id=p.category_id WHERE ${w.join(" AND ")} ORDER BY p.sku LIMIT ${limit} OFFSET ${offset}`, params);
  return { data: rows.map((r) => ({ ...r, salePrice: Number(r.salePrice), stock: Number(r.stock), priceIncludesVat: !!(req as any).company.pricesIncludeVat })), limit, offset };
}));
v1.get("/stock", h(async (req) => ({ data: await db.rows(`SELECT p.sku, p.name, w.code AS warehouse, b.qty FROM stock_balances b JOIN products p ON p.id=b.product_id JOIN warehouses w ON w.id=b.warehouse_id WHERE b.company_id=$1 AND p.type='STOCK' ORDER BY p.sku`, [C(req)]) })));

v1.get("/partners", h(async (req) => {
  const params: any[] = [C(req)]; const w = ["company_id=$1"];
  if (req.query.q) { params.push(`%${req.query.q}%`); w.push(`(name ILIKE $${params.length} OR phone ILIKE $${params.length} OR email ILIKE $${params.length} OR vat_number=$${params.length})`); }
  if (req.query.role === "SUPPLIER") w.push("is_supplier"); else if (req.query.role === "CUSTOMER") w.push("is_customer");
  return { data: await db.rows(`SELECT id, code, name, phone, email, vat_number, city, is_customer, is_supplier, credit_limit, payment_terms FROM partners WHERE ${w.join(" AND ")} ORDER BY name LIMIT 500`, params) };
}));

async function upsertCustomer(t: any, companyId: string, c: any) {
  if (c?.id) return t.one(`SELECT * FROM partners WHERE id=$1 AND company_id=$2`, [c.id, companyId], "العميل غير موجود");
  if (!c?.name && !c?.phone) return null;
  const phone = c.phone ? String(c.phone).replace(/\s/g, "") : null;
  const found = phone ? await t.maybe(`SELECT * FROM partners WHERE company_id=$1 AND phone=$2 AND is_customer LIMIT 1`, [companyId, phone]) : c.email ? await t.maybe(`SELECT * FROM partners WHERE company_id=$1 AND lower(email)=lower($2) LIMIT 1`, [companyId, c.email]) : null;
  if (found) return found;
  if (c.vatNumber && !/^3\d{13}3$/.test(c.vatNumber)) throw bad("الرقم الضريبي للعميل غير صحيح");
  const code = await nextCode(companyId, "C");
  return t.insert("partners", { companyId, code, name: String(c.name || phone), isCustomer: true, kind: c.vatNumber ? "COMPANY" : "INDIVIDUAL", phone, email: c.email || null, vatNumber: c.vatNumber || null, city: c.city || null, district: c.district || null, street: c.street || null, buildingNo: c.buildingNo || null, postalCode: c.postalCode || null, notes: "أُنشئ عبر الواجهة البرمجية" });
}
v1.post("/partners", h(async (req) => {
  const r = await tx((t) => upsertCustomer(t, C(req), req.body || {}));
  if (!r) throw bad("الاسم أو الجوال مطلوب");
  emit(C(req), "partner.created", { id: r.id, code: r.code, name: r.name, phone: r.phone });
  return r;
}));

/**
 * Create a sales order / invoice from an external channel (online store, website, marketplace).
 * Idempotent on externalRef. Lines reference products by productId, sku or barcode (pack barcodes too).
 */
v1.post("/orders", h(async (req: any) => {
  const b = req.body || {};
  const externalRef = b.externalRef ? String(b.externalRef).slice(0, 100) : null;
  if (externalRef) {
    const dup = await db.maybe(`SELECT id FROM invoices WHERE company_id=$1 AND external_ref=$2`, [C(req), externalRef]);
    if (dup) return { duplicate: true, ...invoiceDto(await getInvoice(db, C(req), dup.id)) };
  }
  const kind = b.kind === "ORDER" ? "ORDER" : b.kind === "QUOTATION" ? "QUOTATION" : "INVOICE";
  if (!Array.isArray(b.lines) || !b.lines.length) throw bad("lines مطلوبة");
  const result = await tx(async (t) => {
    let partner = await upsertCustomer(t, C(req), b.customer || (b.customerId ? { id: b.customerId } : null));
    if (!partner) partner = await t.maybe(`SELECT * FROM partners WHERE company_id=$1 AND code='WALKIN'`, [C(req)]) || await t.insert("partners", { companyId: C(req), code: "WALKIN", name: "عميل نقدي", isCustomer: true, kind: "INDIVIDUAL" });
    const lines: any[] = [];
    for (const [i, l] of b.lines.entries()) {
      let prod: any = null, uomId: string | null = null;
      if (l.productId) prod = await t.maybe(`SELECT * FROM products WHERE id=$1 AND company_id=$2`, [l.productId, C(req)]);
      else if (l.sku) prod = await t.maybe(`SELECT * FROM products WHERE sku=$1 AND company_id=$2`, [String(l.sku), C(req)]);
      else if (l.barcode) {
        prod = await t.maybe(`SELECT * FROM products WHERE barcode=$1 AND company_id=$2`, [String(l.barcode), C(req)]);
        if (!prod) { const u = await t.maybe(`SELECT * FROM product_uoms WHERE barcode=$1 AND company_id=$2`, [String(l.barcode), C(req)]); if (u) { uomId = u.id; prod = await t.one(`SELECT * FROM products WHERE id=$1`, [u.productId]); } }
      }
      if (!prod && !l.description) throw bad(`السطر ${i + 1}: الصنف غير موجود (${l.sku || l.barcode || l.productId || "—"})`);
      const unitPrice = l.unitPrice !== undefined ? num(l.unitPrice) : prod ? Number(prod.salePrice) : 0;
      lines.push({ productId: prod?.id || null, uomId, description: l.description || prod?.name, qty: num(l.qty) || 1, unitPrice, discountPct: num(l.discountPct), taxCode: l.taxCode || prod?.taxCode || "S" });
    }
    if (b.shipping && num(b.shipping) > 0) lines.push({ productId: null, uomId: null, description: b.shippingLabel || "رسوم الشحن والتوصيل", qty: 1, unitPrice: num(b.shipping), discountPct: 0, taxCode: "S" });
    const d = await saveDraft(t, req.company, A(req), { direction: "SALE", kind, channel: "API", date: isDate(b.date) ? b.date : today(), partnerId: partner.id, notes: b.notes || (externalRef ? `طلب خارجي ${externalRef}` : null), pricesIncludeVat: b.pricesIncludeVat ?? !!req.company.pricesIncludeVat, lines } as any);
    if (externalRef) await t.exec(`UPDATE invoices SET external_ref=$2 WHERE id=$1`, [d.id, externalRef]);
    if (kind !== "INVOICE" || b.post === false) return { id: d.id, posted: false };
    const posted = await postInvoice(t, req.company, d.id, A(req), { overrideCreditLimit: true });
    // optional payment received by the channel (e.g. card/online gateway) → receipt voucher on the bank/clearing account
    if (b.payment && num(b.payment.amount) > 0) {
      const acc = b.payment.accountCode ? await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND code=$2 AND is_cash_bank`, [C(req), String(b.payment.accountCode)], "رمز حساب السداد غير صحيح")
        : await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND system_key=$2`, [C(req), b.payment.method === "CASH" ? "CASH" : b.payment.method === "CARD" ? "CARD_CLEARING" : "BANK"]);
      await createPayment(t, C(req), A(req), { direction: "IN", partnerId: partner.id, date: posted.date, amount: Math.min(num(b.payment.amount), Number(posted.total)), method: b.payment.method || "BANK", accountId: acc.id, reference: b.payment.reference || externalRef, allocations: [{ invoiceId: posted.id, amount: Math.min(num(b.payment.amount), Number(posted.total)) }] });
    }
    return { id: d.id, posted: true };
  });
  const doc = await getInvoice(db, C(req), result.id);
  if (result.posted) { if (doc.zatcaStatus === "PENDING") submitInvoice(req.company, doc.id).catch(() => undefined); emit(C(req), "invoice.posted", invoiceDto(doc)); }
  emit(C(req), "order.received", { externalRef, invoiceId: doc.id, number: doc.number, total: Number(doc.total) });
  return invoiceDto(doc);
}));

v1.get("/invoices", h(async (req) => {
  const params: any[] = [C(req)]; const w = ["company_id=$1"];
  if (req.query.direction) { params.push(String(req.query.direction)); w.push(`direction=$${params.length}`); }
  if (isDate(req.query.from)) { params.push(req.query.from); w.push(`date >= $${params.length}`); }
  if (isDate(req.query.to)) { params.push(req.query.to); w.push(`date <= $${params.length}`); }
  if (req.query.externalRef) { params.push(String(req.query.externalRef)); w.push(`external_ref=$${params.length}`); }
  const rows = await db.rows(`SELECT id, number, direction, kind, channel, status, date, due_date, partner_id, partner_name, total, amount_paid, payment_status, zatca_status, external_ref, currency FROM invoices WHERE ${w.join(" AND ")} ORDER BY date DESC, created_at DESC LIMIT ${Math.min(Number(req.query.limit) || 100, 500)}`, params);
  return { data: rows };
}));
v1.get("/invoices/:id", h(async (req) => invoiceDto(await getInvoice(db, C(req), p(req).id))));

v1.post("/payments", h(async (req: any) => {
  const b = req.body || {};
  const partner = await db.one(`SELECT id FROM partners WHERE id=$1 AND company_id=$2`, [b.partnerId, C(req)], "الطرف غير موجود");
  const acc = b.accountCode ? await db.one(`SELECT id FROM accounts WHERE company_id=$1 AND code=$2 AND is_cash_bank`, [C(req), String(b.accountCode)], "رمز الحساب غير صحيح") : await db.one(`SELECT id FROM accounts WHERE company_id=$1 AND system_key='BANK'`, [C(req)]);
  const pay = await tx((t) => createPayment(t, C(req), A(req), { direction: b.direction === "OUT" ? "OUT" : "IN", partnerId: partner.id, date: isDate(b.date) ? b.date : today(), amount: num(b.amount), method: b.method || "BANK", accountId: acc.id, reference: b.reference || null, notes: b.notes || null, allocations: b.invoiceId ? [{ invoiceId: b.invoiceId, amount: num(b.amount) }] : undefined }));
  emit(C(req), "payment.created", { id: pay.id, number: pay.number, direction: pay.direction, partnerId: pay.partnerId, amount: Number(pay.amount), date: pay.date });
  return pay;
}));

v1.use((_req, res) => res.status(404).json({ message: "المسار غير موجود في الواجهة البرمجية", code: "NOT_FOUND" }));
export const _uuid = randomUUID;
