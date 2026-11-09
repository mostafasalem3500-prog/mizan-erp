/** Round 28 routes: promotions, customer loyalty points, document attachments. */
import { Router, Request } from "express";
import { db, tx } from "../db/pool";
import { h, bad, notFound, AppError, num } from "../lib/core";
import { authenticate, perm, cid, actor, p, can, subscriptionState } from "../lib/auth";
import { audit } from "./master";
import * as pr from "../services/promotions";
import * as ly from "../services/loyalty";

export const r28 = Router();
r28.use(authenticate);

// ─── promotions ──────────────────────────────────────────────────────────
r28.get("/promotions", perm("sales.read"), h(async (req) => pr.listPromotions(db, cid(req))));
r28.get("/promotions/live", perm("pos.use"), h(async (req) => pr.livePromotions(db, cid(req))));
r28.post("/promotions", perm("settings.write"), h(async (req) => { const r = await tx((t) => pr.savePromotion(t, cid(req), req.body || {})); await audit(req, "CREATE", "promotion", r.id, { name: r.name }); return r; }));
r28.put("/promotions/:id", perm("settings.write"), h(async (req) => { const r = await tx((t) => pr.savePromotion(t, cid(req), req.body || {}, p(req).id)); await audit(req, "UPDATE", "promotion", r.id, { name: r.name, active: r.isActive }); return r; }));
r28.delete("/promotions/:id", perm("settings.write"), h(async (req) => {
  const used = await db.maybe(`SELECT 1 FROM invoice_lines WHERE promotion_id=$1 LIMIT 1`, [p(req).id]);
  if (used) { await db.exec(`UPDATE promotions SET is_active=false, updated_at=now() WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]); return { ok: true, deactivated: true, message: "العرض مستخدم في فواتير — تم إيقافه بدلاً من حذفه" }; }
  await db.exec(`DELETE FROM promotions WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]);
  await audit(req, "DELETE", "promotion", p(req).id);
  return { ok: true };
}));
/** Offers for sales-invoice lines (the editor applies them on request). */
r28.post("/promotions/apply", perm("sales.read"), h(async (req) => {
  const b = req.body || {};
  if (!Array.isArray(b.lines)) throw bad("lines مطلوبة");
  const at = b.date && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? new Date(`${b.date}T09:00:00Z`) : new Date();
  return { hits: await pr.promotionHits(db, cid(req), b.lines.map((l: any) => ({ productId: l.productId || null, qty: num(l.qty), unitPrice: num(l.unitPrice) })), at, "SALES") };
}));

// ─── loyalty ─────────────────────────────────────────────────────────────
r28.get("/loyalty", perm("sales.read"), h(async (req) => tx((t) => ly.loyaltyOverview(t, req.company))));
r28.put("/loyalty/settings", perm("settings.write"), h(async (req) => { const s = await tx((t) => ly.saveLoyaltySettings(t, cid(req), req.body || {})); await audit(req, "UPDATE", "loyalty_settings", cid(req), s); return s; }));
r28.get("/loyalty/settings", perm("pos.use"), h(async (req) => ly.loyaltySettings(req.company)));
r28.get("/partners/:id/loyalty", perm("partners.read"), h(async (req) => tx((t) => ly.customerLoyalty(t, req.company, p(req).id))));
r28.post("/partners/:id/loyalty/adjust", perm("settings.write"), h(async (req) => { const r = await tx((t) => ly.adjustPoints(t, req.company, p(req).id, req.body?.points, req.body?.note, actor(req))); await audit(req, "LOYALTY_ADJUST", "partner", p(req).id, { points: r.points, note: r.note }); return r; }));

// ─── attachments ─────────────────────────────────────────────────────────
const ENTITY_DOMAINS: Record<string, string[]> = { invoice: ["sales", "purchases"], payment: ["payments"], expense: ["expenses"], journal: ["accounting"], partner: ["partners"], asset: ["assets"], product: ["products"] };
const TABLES: Record<string, string> = { invoice: "invoices", payment: "payments", expense: "expenses", journal: "journal_entries", partner: "partners", asset: "fixed_assets", product: "products" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME_OK = /^(image\/(png|jpe?g|webp|gif)|application\/pdf|text\/plain|text\/csv|application\/(msword|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.ms-excel|zip))$/;
const MAX = 8 * 1024 * 1024;
function allowed(req: Request, entity: string, write: boolean) {
  const doms = ENTITY_DOMAINS[entity];
  if (!doms) throw bad("نوع المستند غير مدعوم");
  for (const v of Object.values(req.params)) if (v !== entity && !UUID.test(String(v))) throw notFound("المستند غير موجود");
  if (!req.company) throw new AppError(400, "اختر المنشأة أولاً", "NO_COMPANY");
  const ok = req.auth.superAdmin || doms.some((d) => can(req.auth.role, `${d}.${write ? "write" : "read"}`));
  if (!ok) throw new AppError(403, "لا تملك صلاحية على هذا المستند", "FORBIDDEN");
  if (write && subscriptionState(req.company).readOnly) throw new AppError(402, "النظام في وضع القراءة فقط", "SUBSCRIPTION");
}
async function owned(req: Request, entity: string, id: string) {
  const ok = await db.maybe(`SELECT 1 FROM ${TABLES[entity]} WHERE id=$1 AND company_id=$2`, [id, cid(req)]);
  if (!ok) throw notFound("المستند غير موجود");
}
r28.get("/attachments/file/:fid", h(async (req, res) => {
  if (!UUID.test(p(req).fid)) throw notFound("المرفق غير موجود");
  const a = await db.one(`SELECT * FROM attachments WHERE id=$1 AND company_id=$2`, [p(req).fid, cid(req)], "المرفق غير موجود");
  allowed(req, a.entity, false);
  res.setHeader("Content-Type", a.mime);
  res.setHeader("Content-Disposition", `${req.query.download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(a.name)}`);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(a.data);
}));
r28.delete("/attachments/file/:fid", h(async (req) => {
  if (!UUID.test(p(req).fid)) throw notFound("المرفق غير موجود");
  const a = await db.one(`SELECT id, entity, entity_id, name FROM attachments WHERE id=$1 AND company_id=$2`, [p(req).fid, cid(req)], "المرفق غير موجود");
  allowed(req, a.entity, true);
  await db.exec(`DELETE FROM attachments WHERE id=$1`, [a.id]);
  await audit(req, "DETACH", a.entity, a.entityId, { name: a.name });
  return { ok: true };
}));
r28.get("/attachments/:entity/:id", h(async (req) => {
  const { entity, id } = p(req); allowed(req, entity, false);
  return db.rows(`SELECT id, name, mime, size, created_by, created_at FROM attachments WHERE company_id=$1 AND entity=$2 AND entity_id=$3 ORDER BY created_at`, [cid(req), entity, id]);
}));
r28.post("/attachments/:entity/:id", h(async (req) => {
  const { entity, id } = p(req); allowed(req, entity, true); await owned(req, entity, id);
  const b = req.body || {};
  const name = String(b.name || "").trim().slice(0, 160);
  const mime = String(b.mime || "").toLowerCase();
  if (!name) throw bad("اسم الملف مطلوب");
  if (!MIME_OK.test(mime)) throw bad("نوع الملف غير مسموح — صور، PDF، Word، Excel، نص، ZIP");
  const m = String(b.data || "").match(/^(?:data:[^;]+;base64,)?([A-Za-z0-9+/=\s]+)$/);
  if (!m) throw bad("محتوى الملف غير صالح");
  const buf = Buffer.from(m[1], "base64");
  if (!buf.length) throw bad("الملف فارغ");
  if (buf.length > MAX) throw bad("حجم الملف أكبر من 8 ميجابايت");
  const c = await db.one(`SELECT COUNT(*)::int c FROM attachments WHERE company_id=$1 AND entity=$2 AND entity_id=$3`, [cid(req), entity, id]);
  if (c.c >= 20) throw bad("الحد الأقصى 20 مرفقاً للمستند");
  const r = await db.one(`INSERT INTO attachments (company_id, entity, entity_id, name, mime, size, data, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name, mime, size, created_by, created_at`, [cid(req), entity, id, name, mime, buf.length, buf, actor(req)]);
  await audit(req, "ATTACH", entity, id, { name, size: buf.length });
  return r;
}));
