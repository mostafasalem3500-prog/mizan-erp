/** Round 28 routes: promotions, customer loyalty points, document attachments. */
import crypto from "crypto";
import { zip } from "../lib/zip";
import { Router, Request } from "express";
import { db, tx } from "../db/pool";
import { h, bad, notFound, AppError, num, today } from "../lib/core";
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
const ENTITY_DOMAINS: Record<string, string[]> = { invoice: ["sales", "purchases"], payment: ["payments"], expense: ["expenses"], journal: ["accounting"], partner: ["partners"], asset: ["assets"], product: ["products"], ai: ["dashboard"], archive: ["accounting"] };
const TABLES: Record<string, string> = { invoice: "invoices", payment: "payments", expense: "expenses", journal: "journal_entries", partner: "partners", asset: "fixed_assets", product: "products", ai: "ai_conversations" };
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
  const sha = sha256(buf); const duplicate = await sameFile(cid(req), sha);
  const r = await db.one(`INSERT INTO attachments (company_id, entity, entity_id, name, mime, size, data, created_by, sha256) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, name, mime, size, created_by, created_at`, [cid(req), entity, id, name, mime, buf.length, buf, actor(req), sha]);
  await audit(req, "ATTACH", entity, id, { name, size: buf.length });
  return { ...r, duplicate };
}));

// ─── AI accounting assistant (top plan) ──────────────────────────────────
import * as ai from "../services/ai";
const A = (req: Request) => ({ userId: req.auth.userId, userName: actor(req), role: req.auth.role, superAdmin: !!req.auth.superAdmin });
const needCo = (req: Request) => { if (!req.company) throw new AppError(400, "اختر المنشأة أولاً", "NO_COMPANY"); if (subscriptionState(req.company).readOnly) throw new AppError(402, "النظام في وضع القراءة فقط", "SUBSCRIPTION"); };
r28.get("/ai/status", perm("dashboard.read"), h(async (req) => ai.aiStatus(req.company, A(req))));
r28.put("/ai/key", perm("settings.write"), h(async (req) => { const r = await ai.saveAiKey(cid(req), req.body?.apiKey ? String(req.body.apiKey).trim() : null); await audit(req, "UPDATE", "ai_key", cid(req), { set: !!req.body?.apiKey, provider: r.provider }); return r; }));
r28.get("/ai/conversations", perm("dashboard.read"), h(async (req) => ai.listConversations(cid(req), req.auth.userId)));
r28.get("/ai/conversations/:id", perm("dashboard.read"), h(async (req) => ai.getConversation(cid(req), req.auth.userId, p(req).id)));
r28.delete("/ai/conversations/:id", perm("dashboard.read"), h(async (req) => { await ai.deleteConversation(cid(req), req.auth.userId, p(req).id); return { ok: true }; }));
r28.post("/ai/chat", h(async (req) => { needCo(req); return ai.chat(req.company, A(req), req.body || {}); }));
r28.post("/ai/conversations/:id/confirm", h(async (req) => { needCo(req); return ai.confirmPlan(req.company, A(req), p(req).id); }));
r28.post("/ai/conversations/:id/cancel", h(async (req) => { needCo(req); return ai.cancelPlan(req.company, A(req), p(req).id); }));

// ─── executive analytics, e-mailed management reports, document archive ───
import { executive } from "../services/insights";
import * as dg from "../services/digest";
import { mailStatus } from "../services/mail";
r28.get("/analytics/executive", perm("reports.read"), h(async (req) => executive(db, cid(req), { ...req.query, branchId: req.auth.lockedBranchId || req.query.branchId })));

r28.get("/digest", perm("settings.read"), h(async (req) => ({
  settings: dg.digestSettings(req.company), mail: mailStatus(), sections: dg.SECTIONS,
  recipients: await db.rows(`SELECT r.*, b.name branch_name FROM report_recipients r LEFT JOIN branches b ON b.id=r.branch_id WHERE r.company_id=$1 ORDER BY r.created_at`, [cid(req)]),
  log: await db.rows(`SELECT email, period, ok, error, created_at FROM report_send_log WHERE company_id=$1 ORDER BY created_at DESC LIMIT 40`, [cid(req)]),
})));
r28.put("/digest/settings", perm("settings.write"), h(async (req) => { const s = await dg.saveDigestSettings(cid(req), req.body || {}); await audit(req, "UPDATE", "digest_settings", cid(req), s); return s; }));
r28.post("/digest/recipients", perm("settings.write"), h(async (req) => { const r = await dg.saveRecipient(cid(req), req.body || {}); await audit(req, "CREATE", "report_recipient", r.id, { email: r.email, sections: r.sections }); return r; }));
r28.put("/digest/recipients/:id", perm("settings.write"), h(async (req) => { const r = await dg.saveRecipient(cid(req), req.body || {}, p(req).id); await audit(req, "UPDATE", "report_recipient", r.id, { email: r.email, sections: r.sections }); return r; }));
r28.delete("/digest/recipients/:id", perm("settings.write"), h(async (req) => { await db.exec(`DELETE FROM report_recipients WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]); await audit(req, "DELETE", "report_recipient", p(req).id); return { ok: true }; }));
const recipientOf = async (req: Request) => {
  const id = String(req.query.recipientId || req.body?.recipientId || "");
  if (UUID.test(id)) return db.one(`SELECT * FROM report_recipients WHERE id=$1 AND company_id=$2`, [id, cid(req)], "المستلم غير موجود");
  const sections = String(req.query.sections || "").split(",").filter((s) => dg.SECTIONS[s]);
  return { sections: sections.length ? sections : Object.keys(dg.SECTIONS), frequency: ["DAILY", "WEEKLY", "MONTHLY"].includes(String(req.query.frequency)) ? req.query.frequency : "DAILY", branchId: null };
};
r28.get("/digest/preview", perm("settings.read"), h(async (req, res) => { const m = await dg.buildFor(req.company, await recipientOf(req)); res.setHeader("Content-Type", "text/html; charset=utf-8"); res.send(m.html); }));
r28.post("/digest/send", perm("settings.write"), h(async (req) => {
  if (!mailStatus().configured) throw bad("خدمة البريد غير مفعّلة على الخادم — اضبط متغيرات SMTP أولاً");
  const rs = req.body?.recipientId ? [await recipientOf(req)] : await db.rows(`SELECT * FROM report_recipients WHERE company_id=$1 AND is_active`, [cid(req)]);
  const out: any[] = []; for (const r of rs) out.push(await dg.sendTo(req.company, r));
  await audit(req, "SEND", "digest", cid(req), { n: out.length, failed: out.filter((x) => !x.ok).length });
  return { sent: out.filter((x) => x.ok).length, failed: out.filter((x) => !x.ok) };
}));

const sha256 = (buf: Buffer) => crypto.createHash("sha256").update(buf).digest("hex");
const ENTITY_LABEL: Record<string, string> = { invoice: "فاتورة", expense: "مصروف", payment: "سند", journal: "قيد", partner: "ملف عميل/مورد", product: "صنف", asset: "أصل ثابت", archive: "مستندات المنشأة" };
/** The same bytes already filed in this company: where, so the user can tell a real duplicate from a deliberate second copy. */
async function sameFile(companyId: string, sha: string) {
  const d = await db.maybe(`${ARCH_SELECT} WHERE a.company_id=$1 AND a.sha256=$2 AND a.entity<>'ai' ORDER BY a.created_at LIMIT 1`, [companyId, sha]);
  return d ? { id: d.id, name: d.name, where: `${ENTITY_LABEL[d.entity] || d.entity}${d.ref ? ` ${d.ref}` : d.title ? ` «${d.title}»` : ""}`, at: d.createdAt } : null;
}
// archive: every attached file in one searchable place, plus stand-alone company documents with expiry dates
export const ARCHIVE_CATEGORIES = ["فاتورة مورد", "فاتورة مبيعات", "إيصال / سند", "عقد", "سجل تجاري", "رخصة / تصريح", "شهادة ضريبية أو زكوية", "كشف بنكي", "مستند حكومي", "مستند موظف", "مراسلات", "أخرى"];
const ARCH_SELECT = `SELECT a.id, a.entity, a.entity_id, a.name, a.mime, a.size, a.category, a.title, a.tags, a.notes, a.doc_date, a.expires_at, a.created_by, a.created_at,
    COALESCE(i.number, e.number, pm.number, j.number, pr.name, pd.name, fa.name) ref, i.direction, i.kind doc_kind, i.partner_name, COALESCE(i.total, e.total, pm.amount) amount, pm.direction pay_dir, pr.is_customer
  FROM attachments a
  LEFT JOIN invoices i ON a.entity='invoice' AND i.id=a.entity_id LEFT JOIN expenses e ON a.entity='expense' AND e.id=a.entity_id
  LEFT JOIN payments pm ON a.entity='payment' AND pm.id=a.entity_id LEFT JOIN journal_entries j ON a.entity='journal' AND j.id=a.entity_id
  LEFT JOIN partners pr ON a.entity='partner' AND pr.id=a.entity_id LEFT JOIN products pd ON a.entity='product' AND pd.id=a.entity_id LEFT JOIN fixed_assets fa ON a.entity='asset' AND fa.id=a.entity_id`;
r28.get("/archive", perm("reports.read"), h(async (req) => {
  const q: any = req.query; const params: any[] = [cid(req)]; const w = ["a.company_id=$1", "a.entity<>'ai'"];
  const add = (sql: string, v: any) => { params.push(v); w.push(sql.replace("?", `$${params.length}`)); };
  if (q.entity) add("a.entity=?", String(q.entity));
  if (q.category) add("a.category=?", String(q.category));
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || "")) add("COALESCE(a.doc_date, a.created_at::date) >= ?", q.from);
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || "")) add("COALESCE(a.doc_date, a.created_at::date) <= ?", q.to);
  if (q.tab === "expiring") w.push("a.expires_at IS NOT NULL AND a.expires_at <= CURRENT_DATE + 60");
  if (q.q) { params.push(`%${q.q}%`); const n = `$${params.length}`; w.push(`(${["a.name", "a.title", "a.tags", "a.notes", "i.number", "i.partner_name", "e.number", "e.description", "pr.name", "pm.number", "j.number"].map((c) => `${c} ILIKE ${n}`).join(" OR ")})`); }
  const sql = `${ARCH_SELECT} WHERE ${w.join(" AND ")} ORDER BY ${q.tab === "expiring" ? "a.expires_at" : "a.created_at DESC"} LIMIT 500`;
  const rows = await db.rows(sql, params);
  const stats = await db.one(`SELECT COUNT(*)::int files, COALESCE(SUM(size),0)::bigint bytes, COUNT(*) FILTER (WHERE entity='invoice')::int invoices, COUNT(*) FILTER (WHERE entity='expense')::int expenses, COUNT(*) FILTER (WHERE entity='archive')::int general,
      COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at <= CURRENT_DATE + 60)::int expiring, COUNT(*) FILTER (WHERE expires_at < CURRENT_DATE)::int expired FROM attachments WHERE company_id=$1 AND entity<>'ai'`, [cid(req)]);
  const byKind = await db.rows(`SELECT CASE WHEN entity='archive' THEN COALESCE(category,'أخرى') ELSE entity END k, entity='archive' general, COUNT(*)::int n, COALESCE(SUM(size),0)::bigint bytes FROM attachments WHERE company_id=$1 AND entity<>'ai' GROUP BY 1,2 ORDER BY 3 DESC`, [cid(req)]);
  return { rows, stats, categories: ARCHIVE_CATEGORIES, byKind: byKind.map((x) => ({ ...x, label: x.general ? x.k : ENTITY_LABEL[x.k] || x.k })) };
}));
/** Auditor pack: the period's documents in one ZIP, in a folder per kind, with an index sheet (CSV) listing what each file supports. */
r28.get("/archive/pack", perm("reports.read"), h(async (req, res) => {
  const q: any = req.query; const D = /^\d{4}-\d{2}-\d{2}$/;
  const from = D.test(q.from || "") ? q.from : `${today().slice(0, 4)}-01-01`, to = D.test(q.to || "") ? q.to : today();
  const params: any[] = [cid(req), from, to]; const w = ["a.company_id=$1", "a.entity<>'ai'", "COALESCE(a.doc_date, i.date, e.date, pm.date, j.date, a.created_at::date) BETWEEN $2 AND $3"];
  if (q.entity && ENTITY_LABEL[String(q.entity)]) { params.push(String(q.entity)); w.push(`a.entity=$${params.length}`); }
  if (q.category) { params.push(String(q.category)); w.push(`a.category=$${params.length}`); }
  const list = await db.rows(`${ARCH_SELECT.replace("a.created_at,", "a.created_at, COALESCE(a.doc_date, i.date, e.date, pm.date, j.date, a.created_at::date) on_date,")} WHERE ${w.join(" AND ")} ORDER BY a.entity, on_date, a.created_at LIMIT 2001`, params);
  if (!list.length) throw bad("لا توجد مستندات في هذه الفترة");
  const total = list.reduce((s2, x) => s2 + Number(x.size), 0);
  if (list.length > 2000 || total > 250 * 1024 * 1024) throw bad(`الحزمة كبيرة (${list.length > 2000 ? "أكثر من 2000 ملف" : Math.round(total / 1048576) + " ميجابايت"}) — قصّر الفترة أو اختر نوعاً واحداً`);
  const folder = (x: any) => x.entity === "invoice" ? (x.direction === "PURCHASE" ? "فواتير المشتريات" : "فواتير المبيعات") : x.entity === "expense" ? "المصروفات" : x.entity === "payment" ? (x.payDir === "IN" ? "سندات القبض" : "سندات الصرف") : x.entity === "journal" ? "القيود اليومية" : x.entity === "partner" ? "العملاء والموردون" : x.entity === "product" ? "الأصناف" : x.entity === "asset" ? "الأصول الثابتة" : `مستندات المنشأة/${x.category || "أخرى"}`;
  const csvCell = (v: any) => { const t = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const files: { name: string; data: Buffer; date?: Date }[] = []; const index = [["المجلد", "الملف", "المرجع", "الطرف", "التاريخ", "المبلغ", "العنوان", "الوسوم", "ينتهي في", "أرشفه", "تاريخ الأرشفة"]];
  for (let i = 0; i < list.length; i += 25) {
    const chunk = list.slice(i, i + 25);
    const data = await db.rows(`SELECT id, data FROM attachments WHERE company_id=$1 AND id = ANY($2::uuid[])`, [cid(req), `{${chunk.map((x) => x.id).join(",")}}`]);
    for (const x of chunk) {
      const body = data.find((d2) => d2.id === x.id)?.data; if (!body) continue;
      const day = String(x.onDate instanceof Date ? x.onDate.toISOString() : x.onDate).slice(0, 10);
      const fname = `${x.ref ? `${String(x.ref).replace(/[\/]/g, "-")} - ` : ""}${x.name}`;
      files.push({ name: `${folder(x)}/${fname}`, data: body, date: new Date(x.createdAt) });
      index.push([folder(x), fname, x.ref || "", x.partnerName || "", day, x.amount ?? "", x.title || "", x.tags || "", x.expiresAt ? String(x.expiresAt instanceof Date ? x.expiresAt.toISOString() : x.expiresAt).slice(0, 10) : "", x.createdBy || "", String(x.createdAt instanceof Date ? x.createdAt.toISOString() : x.createdAt).slice(0, 10)]);
    }
  }
  const missing = await db.rows(`SELECT 'فاتورة مشتريات' label, i.number, i.date, i.partner_name party, i.total FROM invoices i WHERE i.company_id=$1 AND i.direction='PURCHASE' AND i.kind='INVOICE' AND i.status='POSTED' AND i.date BETWEEN $2 AND $3 AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.entity='invoice' AND a.entity_id=i.id)
    UNION ALL SELECT 'مصروف', e.number, e.date, COALESCE(e.payee, e.description), e.total FROM expenses e WHERE e.company_id=$1 AND e.status='POSTED' AND e.date BETWEEN $2 AND $3 AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.entity='expense' AND a.entity_id=e.id) ORDER BY 3 LIMIT 5000`, [cid(req), from, to]);
  const BOM = "\ufeff";
  files.unshift({ name: "فهرس المستندات.csv", data: Buffer.from(BOM + index.map((r) => r.map(csvCell).join(",")).join("\r\n"), "utf8") });
  if (!q.entity && !q.category) files.push({ name: "مستندات ناقصة (بلا مرفق).csv", data: Buffer.from(BOM + [["النوع", "الرقم", "التاريخ", "الطرف / البيان", "الإجمالي"], ...missing.map((m) => [m.label, m.number, String(m.date instanceof Date ? m.date.toISOString() : m.date).slice(0, 10), m.party || "", m.total])].map((r) => r.map(csvCell).join(",")).join("\r\n"), "utf8") });
  const out = zip(files);
  await audit(req, "EXPORT", "archive", cid(req), { from, to, files: list.length });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`أرشيف ${req.company.nameAr} ${from} إلى ${to}.zip`)}`);
  res.setHeader("X-Files", String(list.length));
  res.send(out);
}));
/** Posted purchase invoices and expenses with no supporting document — what an auditor would ask for. */
r28.get("/archive/missing", perm("reports.read"), h(async (req) => {
  const q: any = req.query; const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || "") ? q.from : `${today().slice(0, 4)}-01-01`, to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || "") ? q.to : today();
  return db.rows(`SELECT 'invoice' entity, i.id, i.number, i.date, i.partner_name party, i.total, 'فاتورة مشتريات' label FROM invoices i WHERE i.company_id=$1 AND i.direction='PURCHASE' AND i.kind='INVOICE' AND i.status='POSTED' AND i.date BETWEEN $2 AND $3 AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.entity='invoice' AND a.entity_id=i.id)
    UNION ALL SELECT 'expense', e.id, e.number, e.date, COALESCE(e.payee, e.description), e.total, 'مصروف' FROM expenses e WHERE e.company_id=$1 AND e.status='POSTED' AND e.date BETWEEN $2 AND $3 AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.entity='expense' AND a.entity_id=e.id)
    ORDER BY 4 DESC LIMIT 500`, [cid(req), from, to]);
}));
const archMeta = (b: any) => ({
  category: ARCHIVE_CATEGORIES.includes(b.category) ? b.category : b.category === "" ? null : undefined, title: b.title === undefined ? undefined : String(b.title || "").trim().slice(0, 200) || null,
  tags: b.tags === undefined ? undefined : String(b.tags || "").trim().slice(0, 200) || null, notes: b.notes === undefined ? undefined : String(b.notes || "").trim().slice(0, 1000) || null,
  docDate: b.docDate === undefined ? undefined : /^\d{4}-\d{2}-\d{2}$/.test(b.docDate || "") ? b.docDate : null, expiresAt: b.expiresAt === undefined ? undefined : /^\d{4}-\d{2}-\d{2}$/.test(b.expiresAt || "") ? b.expiresAt : null,
});
r28.post("/archive/upload", perm("accounting.write"), h(async (req) => {
  const b = req.body || {};
  const name = String(b.name || "").trim().slice(0, 160), mime = String(b.mime || "").toLowerCase();
  if (!name) throw bad("اسم الملف مطلوب");
  if (!MIME_OK.test(mime)) throw bad("نوع الملف غير مسموح — صور، PDF، Word، Excel، نص، ZIP");
  const m = String(b.data || "").match(/^(?:data:[^;]+;base64,)?([A-Za-z0-9+/=\s]+)$/);
  const buf = m ? Buffer.from(m[1], "base64") : Buffer.alloc(0);
  if (!buf.length) throw bad("الملف فارغ");
  if (buf.length > MAX) throw bad("حجم الملف أكبر من 8 ميجابايت");
  const meta = archMeta(b);
  const sha = sha256(buf); const duplicate = await sameFile(cid(req), sha);
  if (duplicate && !b.allowDuplicate) throw new AppError(409, `هذا الملف مؤرشف من قبل في: ${duplicate.where} (باسم ${duplicate.name}). إن أردت نسخة ثانية فأكّد الحفظ.`, "DUPLICATE");
  const r = await db.one(`INSERT INTO attachments (company_id, entity, entity_id, name, mime, size, data, created_by, category, title, tags, notes, doc_date, expires_at, sha256) VALUES ($1,'archive',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, name`,
    [cid(req), name, mime, buf.length, buf, actor(req), meta.category ?? "أخرى", meta.title ?? null, meta.tags ?? null, meta.notes ?? null, meta.docDate ?? null, meta.expiresAt ?? null, sha]);
  await audit(req, "ARCHIVE", "attachment", r.id, { name });
  return { ...r, duplicate };
}));
r28.put("/archive/:id", perm("accounting.write"), h(async (req) => {
  const r = await db.update("attachments", { id: p(req).id, companyId: cid(req) }, archMeta(req.body || {}));
  if (!r) throw notFound("المستند غير موجود");
  return { ok: true };
}));

// ─── follow-up tasks & reminders, monthly sales target ───────────────────
r28.get("/tasks", perm("dashboard.read"), h(async (req) => {
  const q: any = req.query; const params: any[] = [cid(req)]; const w = ["t.company_id=$1"];
  if (q.status === "OPEN" || q.status === "DONE") { params.push(q.status); w.push(`t.status=$${params.length}`); }
  if (q.mine === "1") { params.push(req.auth.userId); w.push(`(t.assigned_to=$${params.length} OR (t.assigned_to IS NULL AND t.created_by=$${params.length}))`); }
  const rows = await db.rows(`SELECT t.* FROM tasks t WHERE ${w.join(" AND ")} ORDER BY (t.status='DONE'), t.due_date NULLS LAST, (t.priority='HIGH') DESC, t.created_at DESC LIMIT 500`, params);
  const mine = await db.one(`SELECT COUNT(*) FILTER (WHERE due_date <= CURRENT_DATE)::int due, COUNT(*)::int open FROM tasks WHERE company_id=$1 AND status='OPEN' AND (assigned_to=$2 OR (assigned_to IS NULL AND created_by=$2))`, [cid(req), req.auth.userId]);
  const members = await db.rows(`SELECT u.id, u.full_name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=$1 AND m.is_active ORDER BY u.full_name`, [cid(req)]);
  return { rows, mine, members };
}));
const taskBody = async (req: Request) => {
  const b = req.body || {};
  const title = b.title === undefined ? undefined : String(b.title).trim().slice(0, 200);
  if (title === "") throw bad("عنوان المهمة مطلوب");
  let assignedTo: any = undefined, assignedName: any = undefined;
  if (b.assignedTo !== undefined) {
    if (!b.assignedTo) { assignedTo = null; assignedName = null; }
    else { const u = await db.one(`SELECT u.id, u.full_name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=$1 AND u.id=$2`, [cid(req), UUID.test(b.assignedTo) ? b.assignedTo : "00000000-0000-0000-0000-000000000000"], "المستخدم غير موجود في المنشأة"); assignedTo = u.id; assignedName = u.fullName; }
  }
  return { title, notes: b.notes === undefined ? undefined : String(b.notes || "").slice(0, 2000) || null, dueDate: b.dueDate === undefined ? undefined : /^\d{4}-\d{2}-\d{2}$/.test(b.dueDate || "") ? b.dueDate : null,
    priority: b.priority === undefined ? undefined : ["LOW", "NORMAL", "HIGH"].includes(b.priority) ? b.priority : "NORMAL", assignedTo, assignedName,
    link: b.link === undefined ? undefined : /^\/[A-Za-z0-9\-\/?=&_]*$/.test(String(b.link || "")) ? String(b.link).slice(0, 200) : null };
};
r28.post("/tasks", perm("dashboard.read"), h(async (req) => { const d = await taskBody(req); if (!d.title) throw bad("عنوان المهمة مطلوب"); return db.insert("tasks", { companyId: cid(req), ...d, createdBy: req.auth.userId, createdName: actor(req) }); }));
r28.put("/tasks/:id", perm("dashboard.read"), h(async (req) => {
  const d: any = await taskBody(req);
  if (req.body?.status === "DONE") { d.status = "DONE"; d.doneAt = new Date(); } else if (req.body?.status === "OPEN") { d.status = "OPEN"; d.doneAt = null; }
  const r = await db.update("tasks", { id: UUID.test(p(req).id) ? p(req).id : "00000000-0000-0000-0000-000000000000", companyId: cid(req) }, d);
  if (!r) throw notFound("المهمة غير موجودة");
  return r;
}));
r28.delete("/tasks/:id", perm("dashboard.read"), h(async (req) => {
  const t = await db.maybe(`SELECT created_by FROM tasks WHERE id=$1 AND company_id=$2`, [UUID.test(p(req).id) ? p(req).id : "00000000-0000-0000-0000-000000000000", cid(req)]);
  if (!t) throw notFound("المهمة غير موجودة");
  if (t.createdBy !== req.auth.userId && !can(req.auth.role, "settings.write") && !req.auth.superAdmin) throw new AppError(403, "يحذف المهمة منشئها أو مدير النظام", "FORBIDDEN");
  await db.exec(`DELETE FROM tasks WHERE id=$1`, [p(req).id]);
  return { ok: true };
}));
r28.get("/targets", perm("reports.read"), h(async (req) => {
  const target = Number(req.company.targets?.monthlySales || 0);
  const m = await db.one(`SELECT COALESCE(SUM(CASE WHEN kind='CREDIT_NOTE' THEN -1 ELSE 1 END * taxable * COALESCE(exchange_rate,1)),0) v FROM invoices WHERE company_id=$1 AND direction='SALE' AND status='POSTED' AND kind IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE') AND date >= date_trunc('month', CURRENT_DATE)`, [cid(req)]);
  const now = new Date(Date.now() + 3 * 3600e3); const dim = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate(); const day = now.getUTCDate();
  const actual = Number(m.v);
  return { monthlySales: target, actual, pct: target ? Math.round((actual / target) * 1000) / 10 : null, day, daysInMonth: dim, expectedByNow: target ? Math.round((target * day) / dim) : null, projected: Math.round((actual / day) * dim), dailyNeeded: target && dim > day ? Math.max(0, Math.round((target - actual) / (dim - day))) : null };
}));
r28.put("/targets", perm("settings.write"), h(async (req) => { const v = Math.max(0, Math.round(num(req.body?.monthlySales))); await db.exec(`UPDATE companies SET targets = jsonb_set(targets, '{monthlySales}', to_jsonb($2::numeric)) WHERE id=$1`, [cid(req), v]); await audit(req, "UPDATE", "targets", cid(req), { monthlySales: v }); return { monthlySales: v }; }));
