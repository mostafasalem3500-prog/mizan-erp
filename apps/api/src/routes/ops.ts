import { Router } from "express";
import { db, tx } from "../db/pool";
import { h, bad, conflict, req as need, num, paging, today, isDate } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import * as inv from "../services/invoices";
import { createPayment, cancelPayment } from "../services/payments";
import { createExpense, cancelExpense } from "../services/expenses";
import { createAsset, runDepreciation, disposeAsset } from "../services/assets";
import { closeFiscalYear, reopenFiscalYear } from "../services/closing";
import * as pos from "../services/pos";
import * as misc from "../services/misc";
import * as rep from "../services/reports";
import { reverse } from "../accounting/engine";
import { loadDemo, purgeDemo } from "../services/demo";
import { ensureZatcaConfig, submitInvoice } from "../zatca/stamp";
import { generateKeyPair, generateCsr } from "../zatca/crypto";
import { issueComplianceCsid, issueProductionCsid, complianceCheck } from "../zatca/api";

export const ops = Router();
ops.use(authenticate);

const dirPerm = (req: any, write = false) => (req.query.direction === "PURCHASE" || req.body?.direction === "PURCHASE" ? "purchases" : "sales") + (write ? ".write" : ".read");
const dyn = (write: boolean) => (req: any, res: any, next: any) => perm(dirPerm(req, write))(req, res, next);

// ─── invoices (sales & purchases, all kinds) ───────────────────────────────
ops.get(
  "/invoices",
  dyn(false),
  h(async (req) => {
    const { limit, offset } = paging(req.query);
    const params: any[] = [cid(req)];
    const where = ["i.company_id=$1"];
    const add = (sql: string, v: any) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
    if (req.query.direction) add("i.direction=?", req.query.direction);
    if (req.query.kind) add("i.kind = ANY(string_to_array(?, ','))", req.query.kind);
    if (req.query.status) add("i.status=?", req.query.status);
    if (req.query.paymentStatus) add("i.payment_status=?", req.query.paymentStatus);
    if (req.query.partnerId) add("i.partner_id=?", req.query.partnerId);
    if (req.query.channel) add("i.channel=?", req.query.channel);
    if (req.query.zatca) add("i.zatca_status=?", req.query.zatca);
    if (req.query.from) add("i.date>=?", req.query.from);
    if (req.query.to) add("i.date<=?", req.query.to);
    if (req.query.q) add("(i.number ILIKE ? OR i.partner_name ILIKE ? OR i.supplier_ref ILIKE ?)", `%${req.query.q}%`);
    const total = await db.one(`SELECT COUNT(*)::int c, COALESCE(SUM(CASE WHEN i.status='POSTED' THEN CASE WHEN i.kind='CREDIT_NOTE' THEN -i.total ELSE i.total END END),0) sum FROM invoices i WHERE ${where.join(" AND ")}`, params);
    params.push(limit, offset);
    const rows = await db.rows(`SELECT i.id, i.number, i.direction, i.kind, i.channel, i.date, i.due_date, i.partner_id, i.partner_name, i.partner_vat, i.invoice_type, i.status, i.payment_status, i.subtotal, i.discount_total, i.taxable, i.vat_total, i.total, i.amount_paid, i.zatca_status, i.origin_id, i.supplier_ref, i.notes, i.created_at, i.is_demo FROM invoices i WHERE ${where.join(" AND ")} ORDER BY i.date DESC, i.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { rows, total: total.c, sum: total.sum };
  }),
);

ops.get("/invoices/:id", perm("sales.read"), h(async (req) => {
  const doc = await inv.getInvoice(db, cid(req), p(req).id);
  doc.partner = doc.partnerId ? await db.maybe(`SELECT * FROM partners WHERE id=$1`, [doc.partnerId]) : null;
  doc.origin = doc.originId ? await db.maybe(`SELECT id, number, date, total FROM invoices WHERE id=$1`, [doc.originId]) : null;
  doc.related = await db.rows(`SELECT id, number, kind, status, date, total FROM invoices WHERE origin_id=$1 ORDER BY date`, [doc.id]);
  doc.payments = await db.rows(`SELECT p.id, p.number, p.date, p.amount, p.method, (a->>'amount')::numeric allocated FROM payments p, jsonb_array_elements(COALESCE(p.allocations,'[]'::jsonb)) a WHERE p.company_id=$1 AND p.status='POSTED' AND a->>'invoiceId'=$2`, [cid(req), doc.id]);
  doc.journal = doc.journalId ? await db.rows(`SELECT l.debit, l.credit, l.description, a.code, a.name_ar FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE l.entry_id=$1 ORDER BY l.sort`, [doc.journalId]) : [];
  doc.company = await db.one(`SELECT name_ar, name_en, vat_number, cr_number, phone, email, logo, street, building_no, additional_no, district, city, postal_code, invoice_footer, invoice_terms, invoice_template FROM companies WHERE id=$1`, [cid(req)]);
  return doc;
}));

ops.post("/invoices", dyn(true), h(async (req) => { const d = await tx((t) => inv.saveDraft(t, req.company, actor(req), req.body)); await audit(req, "CREATE", "invoice", d.id, { kind: d.kind, number: d.number }); return inv.getInvoice(db, cid(req), d.id); }));
ops.put("/invoices/:id", dyn(true), h(async (req) => { await tx((t) => inv.saveDraft(t, req.company, actor(req), req.body, p(req).id)); return inv.getInvoice(db, cid(req), p(req).id); }));
ops.post("/invoices/:id/post", dyn(true), h(async (req) => {
  const override = !!req.body?.overrideCreditLimit && (["OWNER", "ADMIN"].includes(req.auth.role || "") || req.auth.superAdmin);
  const doc = await tx((t) => inv.postInvoice(t, req.company, p(req).id, actor(req), { tenders: req.body?.tenders, overrideCreditLimit: override }));
  if (override) await audit(req, "CREDIT_LIMIT_OVERRIDE", "invoice", doc.id, { number: doc.number });
  await audit(req, "POST", "invoice", doc.id, { number: doc.number, total: doc.total, isDemo: doc.isDemo });
  if (doc.direction === "SALE" && doc.zatcaStatus === "PENDING") submitInvoice(req.company, doc.id).catch(() => undefined);
  return inv.getInvoice(db, cid(req), doc.id);
}));
ops.post("/invoices/:id/convert", dyn(true), h(async (req) => tx((t) => inv.convert(t, req.company, p(req).id, actor(req), req.body.kind || "INVOICE"))));
ops.post("/invoices/:id/credit-note", dyn(true), h(async (req) => {
  // draft credit note for the full remaining quantities (user can edit before posting)
  const o = await inv.getInvoice(db, cid(req), p(req).id);
  if (o.kind !== "INVOICE" || o.status !== "POSTED") throw bad("يمكن إصدار إشعار دائن لفاتورة مرحلة فقط");
  const returned = await db.rows(`SELECT l.product_id, l.description, SUM(l.qty) q FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.origin_id=$1 AND i.kind='CREDIT_NOTE' AND i.status='POSTED' GROUP BY l.product_id, l.description`, [o.id]);
  const lines = o.lines.map((l: any) => { const r = returned.find((x) => (x.productId || null) === (l.productId || null) && (x.productId || x.description === l.description)); const qty = Number(l.qty) - Number(r?.q || 0); return { productId: l.productId, accountId: l.accountId, description: l.description, qty, unitPrice: l.unitPrice, discountPct: l.discountPct, taxCode: l.taxCode }; }).filter((l: any) => l.qty > 0);
  if (!lines.length) throw conflict("تم إرجاع كامل الفاتورة مسبقاً");
  const d = await tx((t) => inv.saveDraft(t, req.company, actor(req), { direction: o.direction, kind: "CREDIT_NOTE", partnerId: o.partnerId, warehouseId: o.warehouseId, originId: o.id, invoiceType: o.invoiceType, reason: req.body?.reason || "إلغاء / إرجاع", lines, isDemo: o.isDemo, pricesIncludeVat: false, date: req.body?.date }));
  return inv.getInvoice(db, cid(req), d.id);
}));
ops.delete("/invoices/:id", dyn(true), h(async (req) => {
  const d = await db.one(`SELECT * FROM invoices WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]);
  if (d.status === "POSTED") throw conflict("لا يمكن حذف مستند مرحل — أصدر إشعاراً دائناً");
  await db.exec(`DELETE FROM invoices WHERE id=$1`, [d.id]);
  if (d.status === "CONVERTED") await db.exec(`UPDATE invoices SET status='CONVERTED' WHERE id=$1`, [d.id]);
  await audit(req, "DELETE", "invoice", d.id, { number: d.number });
  return { ok: true };
}));

// ─── payments ──────────────────────────────────────────────────────────────
ops.get("/payments", perm("payments.read"), h(async (req) => {
  const { limit, offset } = paging(req.query);
  const params: any[] = [cid(req)];
  const where = ["p.company_id=$1"];
  if (req.query.direction) { params.push(req.query.direction); where.push(`p.direction=$${params.length}`); }
  if (req.query.partnerId) { params.push(req.query.partnerId); where.push(`p.partner_id=$${params.length}`); }
  if (req.query.from) { params.push(req.query.from); where.push(`p.date>=$${params.length}`); }
  if (req.query.to) { params.push(req.query.to); where.push(`p.date<=$${params.length}`); }
  if (req.query.q) { params.push(`%${req.query.q}%`); where.push(`(p.number ILIKE $${params.length} OR pr.name ILIKE $${params.length} OR p.reference ILIKE $${params.length})`); }
  params.push(limit, offset);
  return db.rows(`SELECT p.*, pr.name AS partner_name, a.name_ar AS account_name FROM payments p JOIN partners pr ON pr.id=p.partner_id JOIN accounts a ON a.id=p.account_id WHERE ${where.join(" AND ")} ORDER BY p.date DESC, p.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
}));
ops.get("/payments/open-invoices/:partnerId", perm("payments.read"), h(async (req) => db.rows(`SELECT id, number, kind, date, due_date, total, amount_paid, total-amount_paid due FROM invoices WHERE company_id=$1 AND partner_id=$2 AND direction=$3 AND status='POSTED' AND kind IN ('INVOICE','DEBIT_NOTE') AND total-amount_paid>0.001 ORDER BY date`, [cid(req), p(req).partnerId, req.query.direction === "OUT" ? "PURCHASE" : "SALE"])));
ops.post("/payments", perm("payments.write"), h(async (req) => { const p = await tx((t) => createPayment(t, cid(req), actor(req), req.body)); await audit(req, "CREATE", "payment", p.id, { number: p.number, amount: p.amount }); return p; }));
ops.post("/payments/:id/cancel", perm("payments.write"), h(async (req) => { const r = await tx((t) => cancelPayment(t, cid(req), actor(req), p(req).id, req.body?.date)); await audit(req, "CANCEL", "payment", p(req).id); return r; }));

// ─── expenses ──────────────────────────────────────────────────────────────
ops.get("/expenses", perm("expenses.read"), h(async (req) => {
  const { limit, offset } = paging(req.query);
  const params: any[] = [cid(req)];
  const where = ["e.company_id=$1"];
  if (req.query.from) { params.push(req.query.from); where.push(`e.date>=$${params.length}`); }
  if (req.query.to) { params.push(req.query.to); where.push(`e.date<=$${params.length}`); }
  if (req.query.q) { params.push(`%${req.query.q}%`); where.push(`(e.number ILIKE $${params.length} OR e.description ILIKE $${params.length} OR e.payee ILIKE $${params.length})`); }
  params.push(limit, offset);
  return db.rows(`SELECT e.*, a.name_ar AS account_name, a.code AS account_code, pa.name_ar AS pay_account_name, p.name AS partner_name FROM expenses e JOIN accounts a ON a.id=e.account_id LEFT JOIN accounts pa ON pa.id=e.pay_account_id LEFT JOIN partners p ON p.id=e.partner_id WHERE ${where.join(" AND ")} ORDER BY e.date DESC, e.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
}));
ops.post("/expenses", perm("expenses.write"), h(async (req) => { const e = await tx((t) => createExpense(t, cid(req), actor(req), req.body)); await audit(req, "CREATE", "expense", e.id, { number: e.number, total: e.total }); return e; }));
ops.post("/expenses/:id/cancel", perm("expenses.write"), h(async (req) => tx((t) => cancelExpense(t, cid(req), actor(req), p(req).id))));

// ─── journals ──────────────────────────────────────────────────────────────
ops.get("/journals", perm("accounting.read"), h(async (req) => rep.journalBook(db, cid(req), req.query)));
ops.get("/journals/:id", perm("accounting.read"), h(async (req) => { const e = await db.one(`SELECT * FROM journal_entries WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]); e.lines = await db.rows(`SELECT l.*, a.code, a.name_ar, p.name AS partner_name FROM journal_lines l JOIN accounts a ON a.id=l.account_id LEFT JOIN partners p ON p.id=l.partner_id WHERE l.entry_id=$1 ORDER BY l.sort`, [e.id]); return e; }));
ops.post("/journals", perm("accounting.write"), h(async (req) => { const e = await tx((t) => misc.manualJournal(t, cid(req), actor(req), req.body)); await audit(req, "CREATE", "journal", e?.id || null, { number: e?.number }); return e; }));
ops.post("/journals/:id/reverse", perm("accounting.write"), h(async (req) => { const e = await tx((t) => reverse(t, cid(req), p(req).id, req.body?.date || today(), req.body?.memo, actor(req))); await audit(req, "REVERSE", "journal", p(req).id, { by: e?.number }); return e; }));
ops.post("/journals/opening", perm("accounting.write"), h(async (req) => tx((t) => misc.openingBalances(t, cid(req), actor(req), req.body.date, req.body.lines || []))));

// ─── inventory ─────────────────────────────────────────────────────────────
ops.get("/inventory/valuation", perm("inventory.read"), h(async (req) => rep.inventoryValuation(db, cid(req), req.query)));
ops.get("/inventory/card/:productId", perm("inventory.read"), h(async (req) => rep.stockCard(db, cid(req), p(req).productId, req.query)));
ops.get("/inventory/adjustments", perm("inventory.read"), h(async (req) => db.rows(`SELECT a.*, w.name AS warehouse FROM stock_adjustments a JOIN warehouses w ON w.id=a.warehouse_id WHERE a.company_id=$1 ORDER BY a.date DESC, a.created_at DESC LIMIT 200`, [cid(req)])));
ops.post("/inventory/adjustments", perm("inventory.write"), h(async (req) => { const a = await tx((t) => misc.stockAdjustment(t, cid(req), actor(req), req.body)); await audit(req, "CREATE", "stock_adjustment", a.id, { number: a.number }); return a; }));

// ─── assets ────────────────────────────────────────────────────────────────
ops.get("/assets", perm("assets.read"), h(async (req) => db.rows(`SELECT f.*, f.cost - f.accumulated nbv, a.name_ar AS asset_account, ROUND((f.cost - f.salvage_value) / f.useful_life_months, 2) monthly FROM fixed_assets f JOIN accounts a ON a.id=f.asset_account_id WHERE f.company_id=$1 ORDER BY f.code`, [cid(req)])));
ops.get("/assets/:id", perm("assets.read"), h(async (req) => ({ ...(await db.one(`SELECT * FROM fixed_assets WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)])), depreciations: await db.rows(`SELECT d.*, e.number FROM asset_depreciations d LEFT JOIN journal_entries e ON e.id=d.journal_id WHERE d.asset_id=$1 ORDER BY d.period_end`, [p(req).id]) })));
ops.post("/assets", perm("assets.write"), h(async (req) => { const a = await tx((t) => createAsset(t, cid(req), actor(req), req.body)); await audit(req, "CREATE", "asset", a.id, { code: a.code }); return a; }));
ops.post("/assets/depreciate", perm("assets.write"), h(async (req) => { const r = await tx((t) => runDepreciation(t, cid(req), actor(req), req.body?.through || today())); await audit(req, "DEPRECIATE", "asset", null, { count: r.length }); return r; }));
ops.post("/assets/:id/dispose", perm("assets.write"), h(async (req) => tx((t) => disposeAsset(t, cid(req), actor(req), p(req).id, req.body.date || today(), num(req.body.proceeds), req.body.accountId))));

// ─── POS ───────────────────────────────────────────────────────────────────
ops.get("/pos/session", perm("pos.use"), h(async (req) => {
  const s = await pos.currentSession(db, cid(req), req.auth.userId);
  if (!s) return { session: null };
  const stats = await db.one(`SELECT COUNT(*)::int orders, COALESCE(SUM(CASE WHEN kind='INVOICE' THEN total ELSE -total END),0) net FROM invoices WHERE pos_session_id=$1 AND status='POSTED'`, [s.id]);
  return { session: { ...s, ...stats, expectedCash: Number(s.openingCash) + Number(s.cashSales) } };
}));
ops.get("/pos/sessions", perm("pos.use"), h(async (req) => db.rows(`SELECT * FROM pos_sessions WHERE company_id=$1 ORDER BY opened_at DESC LIMIT 100`, [cid(req)])));
ops.post("/pos/session/open", perm("pos.use"), h(async (req) => tx((t) => pos.openSession(t, cid(req), { id: req.auth.userId, name: actor(req) }, num(req.body?.openingCash), req.body?.warehouseId))));
ops.post("/pos/session/close", perm("pos.use"), h(async (req) => { const s = await tx((t) => pos.closeSession(t, cid(req), actor(req), req.body.sessionId, num(req.body.countedCash), req.body.moveToMainCash !== false)); await audit(req, "CLOSE_SESSION", "pos_session", s.id, { difference: s.difference }); return s; }));
ops.get("/pos/session/:id/report", perm("pos.use"), h(async (req) => {
  const s = await db.one(`SELECT * FROM pos_sessions WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]);
  const invoices = await db.rows(`SELECT id, number, kind, date, issued_at, partner_name, total, vat_total, tenders, payment_status FROM invoices WHERE pos_session_id=$1 AND status='POSTED' ORDER BY issued_at`, [s.id]);
  const byMethod = await db.rows(`SELECT t->>'method' method, SUM((t->>'amount')::numeric * CASE WHEN i.kind='INVOICE' THEN 1 ELSE -1 END) amount FROM invoices i, jsonb_array_elements(COALESCE(i.tenders,'[]'::jsonb)) t WHERE i.pos_session_id=$1 AND i.status='POSTED' GROUP BY 1`, [s.id]);
  const products = await db.rows(`SELECT l.description, SUM(l.qty * CASE WHEN i.kind='INVOICE' THEN 1 ELSE -1 END) qty, SUM(l.total * CASE WHEN i.kind='INVOICE' THEN 1 ELSE -1 END) total FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.pos_session_id=$1 AND i.status='POSTED' GROUP BY l.description ORDER BY total DESC`, [s.id]);
  return { session: s, invoices, byMethod, products };
}));
ops.post("/pos/sale", perm("pos.use"), h(async (req) => {
  const r = await tx((t) => pos.posSale(t, req.company, { id: req.auth.userId, name: actor(req) }, req.body));
  if (r.zatcaStatus === "PENDING") submitInvoice(req.company, r.id).catch(() => undefined);
  return r;
}));
ops.post("/pos/return", perm("pos.use"), h(async (req) => {
  const r = await tx((t) => pos.posReturn(t, req.company, { id: req.auth.userId, name: actor(req) }, req.body.sessionId, req.body.originId, req.body.lines || [], req.body.reason));
  if (r.zatcaStatus === "PENDING") submitInvoice(req.company, r.id).catch(() => undefined);
  return r;
}));

// ─── reports ───────────────────────────────────────────────────────────────
ops.get("/dashboard", perm("dashboard.read"), h(async (req) => rep.dashboard(db, cid(req))));
ops.get("/reports/trial-balance", perm("reports.read"), h(async (req) => rep.trialBalance(db, cid(req), req.query)));
ops.get("/reports/ledger", perm("reports.read"), h(async (req) => rep.generalLedger(db, cid(req), req.query)));
ops.get("/reports/income", perm("reports.read"), h(async (req) => rep.incomeStatement(db, cid(req), req.query)));
ops.get("/reports/balance-sheet", perm("reports.read"), h(async (req) => rep.balanceSheet(db, cid(req), req.query)));
ops.get("/reports/cash-flow", perm("reports.read"), h(async (req) => rep.cashFlow(db, cid(req), req.query)));
ops.get("/reports/statement/:partnerId", perm("reports.read"), h(async (req) => rep.partnerStatement(db, cid(req), p(req).partnerId, req.query)));
ops.get("/reports/aging", perm("reports.read"), h(async (req) => rep.aging(db, cid(req), req.query)));
ops.get("/reports/vat", perm("vat.read"), h(async (req) => rep.vatReturn(db, cid(req), req.query)));
ops.get("/reports/integrity", perm("reports.read"), h(async (req) => rep.integrity(db, cid(req))));
ops.get("/reports/sales", perm("reports.read"), h(async (req) => {
  const from = isDate(req.query.from) ? req.query.from : "1900-01-01", to = isDate(req.query.to) ? req.query.to : today();
  const byProduct = await db.rows(`SELECT p.sku, p.name, c.name AS category, SUM(l.qty * CASE WHEN i.kind='CREDIT_NOTE' THEN -1 ELSE 1 END) qty, SUM(l.net_amount * CASE WHEN i.kind='CREDIT_NOTE' THEN -1 ELSE 1 END) net, SUM(l.qty * l.unit_cost * CASE WHEN i.kind='CREDIT_NOTE' THEN -1 ELSE 1 END) cost FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id JOIN products p ON p.id=l.product_id LEFT JOIN product_categories c ON c.id=p.category_id WHERE i.company_id=$1 AND i.direction='SALE' AND i.status='POSTED' AND i.kind IN ('INVOICE','CREDIT_NOTE') AND i.date BETWEEN $2 AND $3 GROUP BY p.id, c.name ORDER BY net DESC`, [cid(req), from, to]);
  const byCustomer = await db.rows(`SELECT pr.name, COUNT(*)::int invoices, SUM(i.total * CASE WHEN i.kind='CREDIT_NOTE' THEN -1 ELSE 1 END) total FROM invoices i JOIN partners pr ON pr.id=i.partner_id WHERE i.company_id=$1 AND i.direction='SALE' AND i.status='POSTED' AND i.kind IN ('INVOICE','CREDIT_NOTE') AND i.date BETWEEN $2 AND $3 GROUP BY pr.id ORDER BY total DESC`, [cid(req), from, to]);
  const byDay = await db.rows(`SELECT date, SUM(total * CASE WHEN kind='CREDIT_NOTE' THEN -1 ELSE 1 END) total, COUNT(*)::int count FROM invoices WHERE company_id=$1 AND direction='SALE' AND status='POSTED' AND kind IN ('INVOICE','CREDIT_NOTE') AND date BETWEEN $2 AND $3 GROUP BY date ORDER BY date`, [cid(req), from, to]);
  return { from, to, byProduct: byProduct.map((r) => ({ ...r, profit: Number(r.net) - Number(r.cost) })), byCustomer, byDay };
}));

// ─── VAT returns & closing ─────────────────────────────────────────────────
ops.get("/vat/returns", perm("vat.read"), h(async (req) => db.rows(`SELECT v.*, e.number AS journal_number FROM vat_returns v LEFT JOIN journal_entries e ON e.id=v.journal_id WHERE v.company_id=$1 ORDER BY v.period_from DESC`, [cid(req)])));
ops.post("/vat/returns", perm("vat.write"), h(async (req) => { const r = await tx((t) => misc.fileVatReturn(t, cid(req), actor(req), req.body.from, req.body.to)); await audit(req, "FILE_VAT", "vat_return", r.id, { net: r.netVat }); return r; }));
ops.post("/vat/returns/:id/pay", perm("vat.write"), h(async (req) => tx((t) => misc.payVat(t, cid(req), actor(req), p(req).id, req.body.accountId, req.body.date))));
ops.post("/fiscal-years/:id/close", perm("accounting.write"), h(async (req) => { if (!["OWNER", "ADMIN", "ACCOUNTANT"].includes(req.auth.role || "")) throw bad("الإقفال للمحاسب أو المالك فقط"); const r = await tx((t) => closeFiscalYear(t, cid(req), actor(req), p(req).id)); await audit(req, "CLOSE_YEAR", "fiscal_year", p(req).id, { net: r.netIncome }); return r; }));
ops.post("/fiscal-years/:id/reopen", perm("accounting.write"), h(async (req) => { const r = await tx((t) => reopenFiscalYear(t, cid(req), p(req).id)); await audit(req, "REOPEN_YEAR", "fiscal_year", p(req).id); return r; }));

// ─── ZATCA ─────────────────────────────────────────────────────────────────
ops.get("/zatca", perm("settings.read"), h(async (req) => {
  const cfg = await tx((t) => ensureZatcaConfig(t, cid(req)));
  const stats = await db.rows(`SELECT COALESCE(zatca_status,'—') status, COUNT(*)::int c FROM invoices WHERE company_id=$1 AND direction='SALE' AND status='POSTED' GROUP BY 1`, [cid(req)]);
  const { privateKey, complianceSecret, productionSecret, ...safe } = cfg;
  return { ...safe, hasKey: !!privateKey, hasCompliance: !!cfg.complianceCert, hasProduction: !!cfg.productionCert, stats };
}));
ops.put("/zatca", perm("settings.write"), h(async (req) => {
  const b = req.body || {};
  const phase = b.phase === 2 || b.phase === "2" ? 2 : 1;
  if (phase === 2 && !req.company.vatNumber) throw bad("أدخل الرقم الضريبي للمنشأة أولاً في الإعدادات");
  const env = ["SANDBOX", "SIMULATION", "PRODUCTION"].includes(b.environment) ? b.environment : undefined;
  await tx((t) => ensureZatcaConfig(t, cid(req)));
  await db.update("zatca_configs", { companyId: cid(req) }, { phase, environment: env, egsSerial: b.egsSerial, branchName: b.branchName, industry: b.industry, updatedAt: new Date() });
  await audit(req, "UPDATE", "zatca", cid(req), { phase, env });
  return { ok: true };
}));
ops.post("/zatca/csr", perm("settings.write"), h(async (req) => {
  const c = req.company;
  if (!c.vatNumber) throw bad("الرقم الضريبي مطلوب");
  const cfg = await tx((t) => ensureZatcaConfig(t, cid(req)));
  const key = await generateKeyPair();
  const serial = cfg.egsSerial || `1-Mizan|2-2.0|3-${cfg.egsUuid}`;
  const csr = await generateCsr(key, { commonName: `${(c.nameEn || "Mizan").replace(/[^A-Za-z0-9 ]/g, "").slice(0, 30) || "Mizan"}-${cfg.egsUuid.slice(0, 8)}`, serial, vat: c.vatNumber, orgName: c.nameAr, branchName: cfg.branchName || "Main", location: `${c.buildingNo || ""} ${c.street || ""} ${c.city || "Makkah"}`.trim() || "Makkah", industry: cfg.industry || "Trading", production: cfg.environment === "PRODUCTION" });
  await db.update("zatca_configs", { companyId: cid(req) }, { privateKey: key, csr, egsSerial: serial, complianceCert: null, complianceSecret: null, productionCert: null, productionSecret: null, onboardedAt: null, updatedAt: new Date() });
  await audit(req, "ZATCA_CSR", "zatca", cid(req));
  return { csr };
}));
ops.post("/zatca/import-keys", perm("settings.write"), h(async (req) => {
  // for teams that generated keys/CSR with the official ZATCA SDK
  if (!req.body.privateKey || !req.body.csr) throw bad("المفتاح الخاص وطلب الشهادة مطلوبان");
  await tx((t) => ensureZatcaConfig(t, cid(req)));
  await db.update("zatca_configs", { companyId: cid(req) }, { privateKey: req.body.privateKey, csr: req.body.csr, complianceCert: req.body.complianceCert || null, complianceSecret: req.body.complianceSecret || null, productionCert: req.body.productionCert || null, productionSecret: req.body.productionSecret || null, updatedAt: new Date() });
  return { ok: true };
}));
ops.post("/zatca/compliance-csid", perm("settings.write"), h(async (req) => {
  const cfg = await db.one(`SELECT * FROM zatca_configs WHERE company_id=$1`, [cid(req)]);
  if (!cfg.csr) throw bad("أنشئ طلب الشهادة (CSR) أولاً");
  const otp = String(need(req.body, "otp", "رمز OTP من بوابة فاتورة"));
  const r = await issueComplianceCsid(cfg.environment, cfg.csr, otp);
  await db.update("zatca_configs", { companyId: cid(req) }, { complianceCert: r.cert, complianceSecret: r.secret, complianceReqId: r.requestId, updatedAt: new Date() });
  await audit(req, "ZATCA_COMPLIANCE_CSID", "zatca", cid(req));
  return { requestId: r.requestId };
}));
ops.post("/zatca/compliance-check/:invoiceId", perm("settings.write"), h(async (req) => {
  const cfg = await db.one(`SELECT * FROM zatca_configs WHERE company_id=$1`, [cid(req)]);
  const i = await db.one(`SELECT * FROM invoices WHERE id=$1 AND company_id=$2`, [p(req).invoiceId, cid(req)]);
  if (!cfg.complianceCert) throw bad("لا توجد شهادة امتثال");
  if (!i.xml?.includes("<ds:SignatureValue>")) throw bad("الفاتورة غير موقعة — أعد الإرسال بعد الربط");
  const r = await complianceCheck(cfg.environment, cfg.complianceCert, cfg.complianceSecret, i.xml, i.invoiceHash, i.uuid);
  return r;
}));
ops.post("/zatca/production-csid", perm("settings.write"), h(async (req) => {
  const cfg = await db.one(`SELECT * FROM zatca_configs WHERE company_id=$1`, [cid(req)]);
  if (!cfg.complianceCert || !cfg.complianceReqId) throw bad("أصدر شهادة الامتثال أولاً");
  const r = await issueProductionCsid(cfg.environment, cfg.complianceCert, cfg.complianceSecret, cfg.complianceReqId);
  await db.update("zatca_configs", { companyId: cid(req) }, { productionCert: r.cert, productionSecret: r.secret, onboardedAt: new Date(), updatedAt: new Date() });
  await audit(req, "ZATCA_PRODUCTION_CSID", "zatca", cid(req));
  return { ok: true };
}));
ops.post("/zatca/submit/:invoiceId", perm("sales.write"), h(async (req) => submitInvoice(req.company, p(req).invoiceId)));
ops.post("/zatca/submit-pending", perm("sales.write"), h(async (req) => {
  const list = await db.rows(`SELECT id FROM invoices WHERE company_id=$1 AND direction='SALE' AND status='POSTED' AND zatca_status IN ('PENDING','FAILED','NOT_ONBOARDED') ORDER BY icv LIMIT 200`, [cid(req)]);
  const out: any[] = [];
  for (const i of list) out.push({ id: i.id, ...(await submitInvoice(req.company, i.id).catch((e) => ({ status: "FAILED", response: { error: e.message } }))) });
  return out;
}));
ops.get("/zatca/xml/:invoiceId", perm("sales.read"), h(async (req, res) => {
  const i = await db.one(`SELECT number, xml FROM invoices WHERE id=$1 AND company_id=$2`, [p(req).invoiceId, cid(req)]);
  if (!i.xml) throw bad("لا يوجد XML لهذه الفاتورة (المرحلة الأولى)");
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${i.number}.xml"`);
  res.send(i.xml);
}));

// ─── demo data ─────────────────────────────────────────────────────────────
ops.post("/demo/load", perm("settings.write"), h(async (req) => {
  const c = await db.one(`SELECT demo_loaded, demo_job FROM companies WHERE id=$1`, [cid(req)]);
  if (c.demoLoaded) throw conflict("البيانات التجريبية محملة بالفعل — احذفها أولاً");
  if (c.demoJob && !c.demoJob.done && !c.demoJob.error && Date.now() - new Date(c.demoJob.at).getTime() < 10 * 60000) throw conflict("جارٍ التحميل حالياً");
  await db.exec(`UPDATE companies SET demo_job=$2 WHERE id=$1`, [cid(req), JSON.stringify({ step: "بدء التحميل", pct: 1, at: new Date() })]);
  loadDemo(cid(req), req.auth.userId, actor(req)).catch(async (e) => {
    console.error("[demo]", e);
    await db.exec(`UPDATE companies SET demo_job=$2 WHERE id=$1`, [cid(req), JSON.stringify({ step: "فشل: " + e.message, pct: 0, error: true, at: new Date() })]);
  });
  await audit(req, "DEMO_LOAD", "company", cid(req));
  return { started: true };
}));
ops.get("/demo/status", perm("settings.read"), h(async (req) => db.one(`SELECT demo_loaded, demo_job FROM companies WHERE id=$1`, [cid(req)])));
ops.post("/demo/purge", perm("settings.write"), h(async (req) => { await purgeDemo(cid(req)); await audit(req, "DEMO_PURGE", "company", cid(req)); return { ok: true }; }));
