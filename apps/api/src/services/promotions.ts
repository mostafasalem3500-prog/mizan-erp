/** Promotions (العروض): offers by product/category, date, weekday and hour; applied in the POS and on demand in sales invoices. */
import { Db } from "../db/pool";
import { bad, notFound, r2, num, isDate } from "../lib/core";
import { applyPromotions, Promo, PromoLine } from "./promoEngine";

const KINDS = ["PERCENT", "FIXED_PRICE", "BUY_X_GET_Y"];
const SCOPES = ["ALL", "PRODUCTS", "CATEGORIES"];
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Postgres array literal (the Db helper sends JS arrays as JSON). Items are uuids, digits or fixed codes. */
const pgArr = (xs: any[]) => `{${xs.map(String).join(",")}}`;

export async function listPromotions(t: Db, companyId: string) {
  return t.rows(
    `SELECT p.*, COALESCE(u.uses,0)::int uses, COALESCE(u.discount,0) discount_given, COALESCE(u.sales,0) sales
       FROM promotions p
       LEFT JOIN LATERAL (SELECT COUNT(DISTINCT l.invoice_id) uses, SUM(CASE WHEN i.kind='CREDIT_NOTE' THEN -l.promo_discount ELSE l.promo_discount END) discount,
                                 SUM(CASE WHEN i.kind='CREDIT_NOTE' THEN -l.total ELSE l.total END) sales
                            FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id
                           WHERE l.promotion_id=p.id AND i.status='POSTED') u ON true
      WHERE p.company_id=$1 ORDER BY p.is_active DESC, p.priority DESC, p.created_at DESC`, [companyId]);
}

/** Offers that can apply now or later (inactive and expired ones excluded) — cached by the POS for offline use. */
export async function livePromotions(t: Db, companyId: string) {
  return t.rows(`SELECT * FROM promotions WHERE company_id=$1 AND is_active AND (date_to IS NULL OR date_to >= CURRENT_DATE - 1)`, [companyId]);
}

export async function savePromotion(t: Db, companyId: string, b: any, id?: string) {
  const name = String(b.name || "").trim();
  if (!name) throw bad("اسم العرض مطلوب");
  const kind = KINDS.includes(b.kind) ? b.kind : "PERCENT";
  const scope = SCOPES.includes(b.scope) ? b.scope : "ALL";
  const productIds: string[] = Array.isArray(b.productIds) ? b.productIds.filter(Boolean) : [];
  const categoryIds: string[] = Array.isArray(b.categoryIds) ? b.categoryIds.filter(Boolean) : [];
  if (scope === "PRODUCTS" && !productIds.length) throw bad("اختر صنفاً واحداً على الأقل");
  if (scope === "CATEGORIES" && !categoryIds.length) throw bad("اختر تصنيفاً واحداً على الأقل");
  if (productIds.length) { const c = await t.one(`SELECT COUNT(*)::int c FROM products WHERE company_id=$1 AND id = ANY($2::uuid[])`, [companyId, productIds]); if (c.c !== productIds.length) throw bad("صنف غير موجود في العرض"); }
  if (categoryIds.length) { const c = await t.one(`SELECT COUNT(*)::int c FROM product_categories WHERE company_id=$1 AND id = ANY($2::uuid[])`, [companyId, categoryIds]); if (c.c !== categoryIds.length) throw bad("تصنيف غير موجود في العرض"); }
  const value = num(b.value), buyQty = num(b.buyQty), getQty = num(b.getQty);
  if (kind === "PERCENT" && !(value > 0 && value <= 100)) throw bad("نسبة الخصم بين 0 و100");
  if (kind === "FIXED_PRICE" && !(value >= 0)) throw bad("السعر الخاص غير صحيح");
  if (kind === "FIXED_PRICE" && scope === "ALL") throw bad("السعر الخاص يكون لأصناف أو تصنيفات محددة");
  if (kind === "BUY_X_GET_Y" && !(buyQty >= 1 && getQty >= 1)) throw bad("حدد كمية الشراء والكمية المجانية (1 على الأقل)");
  const dateFrom = b.dateFrom || null, dateTo = b.dateTo || null;
  if ((dateFrom && !isDate(dateFrom)) || (dateTo && !isDate(dateTo))) throw bad("تاريخ غير صحيح");
  if (dateFrom && dateTo && dateTo < dateFrom) throw bad("تاريخ نهاية العرض قبل بدايته");
  const timeFrom = b.timeFrom || null, timeTo = b.timeTo || null;
  if ((timeFrom && !HM.test(timeFrom)) || (timeTo && !HM.test(timeTo)) || (!!timeFrom !== !!timeTo)) throw bad("حدد ساعة البداية والنهاية بصيغة HH:MM");
  const days = (Array.isArray(b.days) ? b.days : []).map(Number).filter((d: number) => d >= 0 && d <= 6);
  const channels = (Array.isArray(b.channels) ? b.channels : ["POS", "SALES"]).filter((c: string) => ["POS", "SALES"].includes(c));
  if (!channels.length) throw bad("اختر نقطة البيع أو فواتير المبيعات");
  const data = {
    name, kind, scope, productIds: pgArr(scope === "PRODUCTS" ? productIds : []), categoryIds: pgArr(scope === "CATEGORIES" ? categoryIds : []),
    value: kind === "BUY_X_GET_Y" ? 0 : value, buyQty: kind === "BUY_X_GET_Y" ? buyQty : 0, getQty: kind === "BUY_X_GET_Y" ? getQty : 0,
    minQty: Math.max(0, num(b.minQty)), minTotal: Math.max(0, r2(num(b.minTotal))), dateFrom, dateTo, days: pgArr(days), timeFrom, timeTo, channels: pgArr(channels),
    priority: Math.round(num(b.priority)), isActive: b.isActive !== false, notes: b.notes || null, updatedAt: new Date(),
  };
  if (id) { const r = await t.update("promotions", { id, companyId }, data); if (!r) throw notFound(); return r; }
  return t.insert("promotions", { companyId, ...data });
}

/** Offer hits for document lines (unit prices as entered). */
export async function promotionHits(t: Db, companyId: string, lines: { productId?: string | null; qty: number; unitPrice: number }[], at: Date, channel: "POS" | "SALES") {
  const promos = (await livePromotions(t, companyId)) as Promo[];
  if (!promos.length) return lines.map(() => null);
  const ids = lines.map((l) => l.productId).filter(Boolean) as string[];
  const cats = ids.length ? await t.rows(`SELECT id, category_id FROM products WHERE company_id=$1 AND id = ANY($2::uuid[])`, [companyId, ids]) : [];
  const cm = new Map(cats.map((c: any) => [c.id, c.categoryId]));
  const pl: PromoLine[] = lines.map((l) => ({ productId: l.productId || "", categoryId: l.productId ? cm.get(l.productId) : null, qty: num(l.qty), unitPrice: num(l.unitPrice) }));
  return applyPromotions(promos, pl, at, channel).map((h, i) => (lines[i].productId ? h : null));
}
