/** Round 7 routes: collections (reminders), email (invoice / statement / reminder). */
import { Router } from "express";
import { db } from "../db/pool";
import { h, bad, req as need, r2, isDate, today, addDays } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import { mailStatus, sendMail, emailLayout } from "../services/mail";
import { partnerStatement } from "../services/reports";
import { getInvoice } from "../services/invoices";

export const r7 = Router();
r7.use(authenticate);

const fmt = (v: any) => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const origin = (req: any) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

/** Customers with open balances, aged, with contact details and last reminder. */
r7.get("/collections", perm("sales.read"), h(async (req) => {
  const td = today();
  const rows = await db.rows(
    `SELECT p.id, p.name, p.phone, p.email, p.payment_terms, p.credit_limit,
       COUNT(i.id)::int invoices, COALESCE(SUM(i.total - i.amount_paid),0) due,
       COALESCE(SUM(CASE WHEN i.due_date < $2 THEN i.total - i.amount_paid END),0) overdue,
       MIN(CASE WHEN i.due_date < $2 THEN i.due_date END) oldest_due,
       (SELECT json_build_object('channel', r.channel, 'at', r.created_at, 'by', r.sent_by) FROM reminders r WHERE r.partner_id=p.id ORDER BY r.created_at DESC LIMIT 1) last_reminder,
       (SELECT COUNT(*)::int FROM reminders r WHERE r.partner_id=p.id AND r.created_at > now() - interval '30 days') reminders30
     FROM partners p JOIN invoices i ON i.partner_id=p.id AND i.direction='SALE' AND i.kind='INVOICE' AND i.status='POSTED' AND i.total - i.amount_paid > 0.001${/^[0-9a-f-]{36}$/i.test(String(req.query.branchId || "")) ? ` AND i.branch_id='${req.query.branchId}'::uuid` : ""}
     WHERE p.company_id=$1 GROUP BY p.id ORDER BY overdue DESC, due DESC`, [cid(req), td]);
  return rows.map((r) => ({ ...r, due: r2(r.due), overdue: r2(r.overdue), daysOverdue: r.oldestDue ? Math.round((Date.parse(td) - Date.parse(String(r.oldestDue).slice(0, 10))) / 86400000) : 0 }));
}));

r7.get("/collections/:partnerId/invoices", perm("sales.read"), h(async (req) => db.rows(`SELECT id, number, date, due_date, total, amount_paid, total-amount_paid due, share_token, currency, fc_total, fc_paid FROM invoices WHERE company_id=$1 AND partner_id=$2 AND direction='SALE' AND kind='INVOICE' AND status='POSTED' AND total-amount_paid>0.001 ORDER BY due_date`, [cid(req), p(req).partnerId])));

/** Default reminder text (WhatsApp / email) for a customer. */
r7.get("/collections/:partnerId/message", perm("sales.read"), h(async (req) => {
  const partner = await db.one(`SELECT * FROM partners WHERE id=$1 AND company_id=$2`, [p(req).partnerId, cid(req)], "العميل غير موجود");
  const inv = await db.rows(`SELECT id, number, date, due_date, total, amount_paid, total-amount_paid due, share_token FROM invoices WHERE company_id=$1 AND partner_id=$2 AND direction='SALE' AND kind='INVOICE' AND status='POSTED' AND total-amount_paid>0.001 ORDER BY due_date`, [cid(req), partner.id]);
  const due = r2(inv.reduce((a, i) => a + Number(i.due), 0));
  const overdue = inv.filter((i) => String(i.dueDate).slice(0, 10) < today());
  const base = origin(req);
  const lines = inv.map((i) => `• ${i.number} بتاريخ ${String(i.date).slice(0, 10)} — المتبقي ${fmt(i.due)} ر.س${String(i.dueDate).slice(0, 10) < today() ? " (متأخرة)" : ""}\n  ${base}/p/${i.shareToken}`);
  const text = `السلام عليكم ${partner.name}،\nنود تذكيركم بأن إجمالي المستحق لصالح ${req.company.nameAr} هو ${fmt(due)} ر.س${overdue.length ? `، منها ${fmt(overdue.reduce((a, i) => a + Number(i.due), 0))} ر.س متأخرة عن موعد السداد` : ""}.\n\nالفواتير المفتوحة:\n${lines.join("\n")}\n\nنرجو التكرم بالسداد وموافاتنا بإشعار التحويل. شاكرين تعاونكم.\n${req.company.nameAr}${req.company.phone ? " — " + req.company.phone : ""}`;
  return { partner: { id: partner.id, name: partner.name, phone: partner.phone, email: partner.email }, due, overdue: r2(overdue.reduce((a, i) => a + Number(i.due), 0)), invoices: inv, text, subject: `تذكير بالمستحقات — ${req.company.nameAr}` };
}));

/** Logs a reminder; channel EMAIL also sends it. */
r7.post("/collections/:partnerId/reminders", perm("sales.write"), h(async (req) => {
  const partner = await db.one(`SELECT * FROM partners WHERE id=$1 AND company_id=$2`, [p(req).partnerId, cid(req)], "العميل غير موجود");
  const channel = ["WHATSAPP", "EMAIL", "CALL", "NOTE"].includes(req.body?.channel) ? req.body.channel : "NOTE";
  const body = String(req.body?.body || "");
  let sent: any = null;
  if (channel === "EMAIL") {
    const to = req.body?.to || partner.email;
    if (!to) throw bad("العميل ليس له بريد إلكتروني");
    sent = await sendMail({ to, subject: req.body?.subject || `تذكير بالمستحقات — ${req.company.nameAr}`, html: emailLayout(req.company, "تذكير بالمستحقات", `<div style="white-space:pre-wrap;line-height:1.7">${body.replace(/</g, "&lt;")}</div>`), text: body, fromName: req.company.nameAr, replyTo: req.company.email || undefined });
  }
  const r = await db.insert("reminders", { companyId: cid(req), partnerId: partner.id, channel, subject: req.body?.subject || null, body, amountDue: req.body?.amountDue ?? null, sentBy: actor(req) });
  await audit(req, "REMINDER", "partner", partner.id, { channel });
  return { ...r, sent };
}));
r7.get("/collections/:partnerId/history", perm("sales.read"), h(async (req) => db.rows(`SELECT * FROM reminders WHERE company_id=$1 AND partner_id=$2 ORDER BY created_at DESC LIMIT 50`, [cid(req), p(req).partnerId])));

// ── email: status, invoice, statement ─────────────────────────────────────
r7.get("/mail/status", perm("dashboard.read"), h(async () => mailStatus()));
r7.post("/invoices/:id/email", perm("sales.write"), h(async (req) => {
  const inv = await getInvoice(db, cid(req), p(req).id);
  const partner = inv.partnerId ? await db.maybe(`SELECT email, name FROM partners WHERE id=$1`, [inv.partnerId]) : null;
  const to = req.body?.to || partner?.email;
  if (!to) throw bad("لا يوجد بريد إلكتروني للعميل — أدخله في بطاقة العميل أو في الحقل");
  const link = `${origin(req)}/p/${inv.shareToken}`;
  const kind = inv.kind === "INVOICE" ? (inv.invoiceType === "SIMPLIFIED" ? "فاتورة ضريبية مبسطة" : "فاتورة ضريبية") : inv.kind === "QUOTATION" ? "عرض سعر" : inv.kind === "ORDER" ? "أمر بيع" : "إشعار";
  const rows = inv.lines.map((l: any) => `<tr><td style="padding:6px;border-bottom:1px solid #eee">${l.description}</td><td style="padding:6px;border-bottom:1px solid #eee;text-align:center">${Number(l.qty)} ${l.uom || l.unit || ""}</td><td style="padding:6px;border-bottom:1px solid #eee;text-align:left">${fmt(l.total)}</td></tr>`).join("");
  const html = emailLayout(req.company, `${kind} رقم ${inv.number}`, `<p>عزيزنا ${inv.partnerName}،</p><p>مرفق ${kind} رقم <b>${inv.number}</b> بتاريخ ${String(inv.date).slice(0, 10)} بإجمالي <b>${fmt(inv.total)} ر.س</b>${inv.dueDate && inv.kind === "INVOICE" ? ` وتاريخ استحقاق ${String(inv.dueDate).slice(0, 10)}` : ""}.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="background:#eef4f3"><th style="padding:6px;text-align:right">البيان</th><th style="padding:6px">الكمية</th><th style="padding:6px;text-align:left">الإجمالي</th></tr>${rows}</table>
    <p style="margin-top:16px"><a href="${link}" style="background:#0f4c47;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">عرض المستند وطباعته</a></p>${req.body?.note ? `<p>${String(req.body.note).replace(/</g, "&lt;")}</p>` : ""}`);
  const r = await sendMail({ to, subject: `${kind} ${inv.number} — ${req.company.nameAr}`, html, fromName: req.company.nameAr, replyTo: req.company.email || undefined });
  await audit(req, "EMAIL", "invoice", inv.id, { to });
  return { ok: true, to, ...r };
}));
r7.post("/partners/:id/statement/email", perm("sales.write"), h(async (req) => {
  const partner = await db.one(`SELECT * FROM partners WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)], "الطرف غير موجود");
  const to = req.body?.to || partner.email;
  if (!to) throw bad("لا يوجد بريد إلكتروني للطرف");
  const from = isDate(req.body?.from) ? req.body.from : addDays(today(), -365), toD = isDate(req.body?.to) ? req.body.to : today();
  const st = await partnerStatement(db, cid(req), partner.id, { from, to: toD, role: req.body?.role === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER" });
  const rows = st.rows.map((r: any) => `<tr><td style="padding:5px;border-bottom:1px solid #eee">${String(r.date).slice(0, 10)}</td><td style="padding:5px;border-bottom:1px solid #eee">${r.number}</td><td style="padding:5px;border-bottom:1px solid #eee">${r.memo || ""}</td><td style="padding:5px;border-bottom:1px solid #eee;text-align:left">${r.debit ? fmt(r.debit) : ""}</td><td style="padding:5px;border-bottom:1px solid #eee;text-align:left">${r.credit ? fmt(r.credit) : ""}</td><td style="padding:5px;border-bottom:1px solid #eee;text-align:left">${fmt(r.balance)}</td></tr>`).join("");
  const html = emailLayout(req.company, `كشف حساب — ${partner.name}`, `<p>الفترة من ${from} إلى ${toD}. الرصيد الافتتاحي <b>${fmt(st.opening)}</b> والرصيد الختامي <b>${fmt(st.closing)} ر.س</b>.</p>
    <table style="width:100%;border-collapse:collapse;font-size:12px"><tr style="background:#eef4f3"><th style="padding:5px">التاريخ</th><th style="padding:5px">المستند</th><th style="padding:5px">البيان</th><th style="padding:5px">مدين</th><th style="padding:5px">دائن</th><th style="padding:5px">الرصيد</th></tr>${rows}</table>`);
  const r = await sendMail({ to, subject: `كشف حساب ${partner.name} — ${req.company.nameAr}`, html, fromName: req.company.nameAr, replyTo: req.company.email || undefined });
  await db.insert("reminders", { companyId: cid(req), partnerId: partner.id, channel: "EMAIL", subject: "كشف حساب", body: `كشف حساب ${from} — ${toD} أُرسل إلى ${to}`, amountDue: st.closing, sentBy: actor(req) });
  return { ok: true, to, ...r };
}));
