/** Round 6 routes: currencies, landed costs, price lists, bank statement import. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h, bad, req as need, isDate, today } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import { listCurrencies, upsertCurrency, rateFor } from "../services/currency";
import { computeAllocation, createLandedCost, postLandedCost, deleteLandedCost } from "../services/landed";
import { listPriceLists, getPriceList, savePriceList, deletePriceList, resolvePrices } from "../services/pricelists";
import { payCustomsVat } from "../services/invoices";
import { importStatement, suggestMatches, confirmMatch, unmatch, setIgnored, statementSummary } from "../services/bankimport";

export const r6 = Router();
r6.use(authenticate);

// ── currencies ────────────────────────────────────────────────────────────
r6.get("/currencies", perm("dashboard.read"), h(async (req) => listCurrencies(db, cid(req))));
r6.get("/currencies/:code/rate", perm("dashboard.read"), h(async (req) => ({ code: p(req).code.toUpperCase(), date: isDate(req.query.date) ? req.query.date : today(), rate: await rateFor(db, cid(req), p(req).code, String(req.query.date || "")) })));
r6.put("/currencies/:code", perm("settings.write"), h(async (req) => { const r = await tx((t) => upsertCurrency(t, cid(req), { ...req.body, code: p(req).code })); await audit(req, "UPDATE", "currency", r.id, { code: r.code, rate: r.rate }); return r; }));
r6.post("/currencies", perm("settings.write"), h(async (req) => { const r = await tx((t) => upsertCurrency(t, cid(req), req.body || {})); await audit(req, "CREATE", "currency", r.id, { code: r.code, rate: r.rate }); return r; }));
r6.get("/currencies/:code/history", perm("dashboard.read"), h(async (req) => db.rows(`SELECT date, rate FROM exchange_rates WHERE company_id=$1 AND code=$2 ORDER BY date DESC LIMIT 60`, [cid(req), p(req).code.toUpperCase()])));

// ── landed costs ──────────────────────────────────────────────────────────
r6.get("/landed-costs", perm("purchases.read"), h(async (req) => db.rows(`SELECT lc.*, i.number AS invoice_number, i.partner_name, j.number AS journal_number FROM landed_costs lc JOIN invoices i ON i.id=lc.invoice_id LEFT JOIN journal_entries j ON j.id=lc.journal_id WHERE lc.company_id=$1 ${req.query.invoiceId ? "AND lc.invoice_id=$2" : ""} ORDER BY lc.date DESC, lc.created_at DESC`, req.query.invoiceId ? [cid(req), req.query.invoiceId] : [cid(req)])));
r6.post("/landed-costs/preview", perm("purchases.read"), h(async (req) => computeAllocation(db, cid(req), req.body || {})));
r6.post("/landed-costs", perm("purchases.write"), h(async (req) => { const r = await tx((t) => createLandedCost(t, cid(req), actor(req), req.body || {})); await audit(req, "CREATE", "landed_cost", r.id, { number: r.number, total: r.total }); return r; }));
r6.post("/landed-costs/:id/post", perm("purchases.write"), h(async (req) => { const r = await tx((t) => postLandedCost(t, cid(req), actor(req), p(req).id)); await audit(req, "POST", "landed_cost", p(req).id); return r; }));
r6.delete("/landed-costs/:id", perm("purchases.write"), h(async (req) => { await tx((t) => deleteLandedCost(t, cid(req), p(req).id)); return { ok: true }; }));

// ── price lists ───────────────────────────────────────────────────────────
r6.get("/price-lists", perm("products.read"), h(async (req) => listPriceLists(db, cid(req))));
r6.get("/price-lists/:id", perm("products.read"), h(async (req) => getPriceList(db, cid(req), p(req).id)));
r6.post("/price-lists", perm("products.write"), h(async (req) => { const r = await tx((t) => savePriceList(t, cid(req), req.body || {})); await audit(req, "CREATE", "price_list", r.id, { name: r.name }); return r; }));
r6.put("/price-lists/:id", perm("products.write"), h(async (req) => { const r = await tx((t) => savePriceList(t, cid(req), req.body || {}, p(req).id)); await audit(req, "UPDATE", "price_list", r.id, { name: r.name }); return r; }));
r6.delete("/price-lists/:id", perm("products.write"), h(async (req) => { await tx((t) => deletePriceList(t, cid(req), p(req).id)); return { ok: true }; }));
r6.get("/price-lists/:id/resolve", perm("products.read"), h(async (req) => resolvePrices(db, cid(req), p(req).id, String(req.query.ids || "").split(",").filter(Boolean), Number(req.query.qty) || 1)));

// ── bank statements ───────────────────────────────────────────────────────
r6.post("/bank/:accountId/statement/import", perm("accounting.write"), h(async (req) => {
  const rows = req.body?.rows;
  if (!Array.isArray(rows) || rows.length > 5000) throw bad("أرسل حتى 5000 سطر في المرة الواحدة");
  const r = await tx((t) => importStatement(t, cid(req), p(req).accountId, rows, String(req.body?.batch || today())));
  await audit(req, "IMPORT", "bank_statement", p(req).accountId, r);
  return r;
}));
r6.get("/bank/:accountId/statement", perm("accounting.read"), h(async (req) => ({ ...(await suggestMatches(db, cid(req), p(req).accountId, Number(req.query.window) || 5)), summary: await statementSummary(db, cid(req), p(req).accountId) })));
r6.post("/bank/statement/:id/match", perm("accounting.write"), h(async (req) => tx((t) => confirmMatch(t, cid(req), p(req).id, String(need(req.body, "journalLineId", "حركة الحساب"))))));
r6.post("/bank/statement/:id/unmatch", perm("accounting.write"), h(async (req) => tx((t) => unmatch(t, cid(req), p(req).id))));
r6.post("/bank/statement/:id/ignore", perm("accounting.write"), h(async (req) => tx((t) => setIgnored(t, cid(req), p(req).id, req.body?.ignored !== false))));
r6.post("/bank/:accountId/statement/match-all", perm("accounting.write"), h(async (req) => {
  const s = await suggestMatches(db, cid(req), p(req).accountId, Number(req.body?.window) || 5);
  let n = 0;
  for (const r of s.rows) if (r.suggestion && (req.body?.maxDays === undefined || r.suggestion.daysApart <= Number(req.body.maxDays))) { await tx((t) => confirmMatch(t, cid(req), r.id, r.suggestion.id)); n++; }
  await audit(req, "MATCH", "bank_statement", p(req).accountId, { matched: n });
  return { matched: n };
}));
r6.delete("/bank/:accountId/statement", perm("accounting.write"), h(async (req) => { await db.exec(`DELETE FROM bank_statement_lines WHERE company_id=$1 AND account_id=$2 AND status<>'MATCHED'`, [cid(req), p(req).accountId]); return { ok: true }; }));

// ── customs VAT payment for import bills ──────────────────────────────────
r6.post("/invoices/:id/pay-customs", perm("payments.write"), h(async (req) => { const r = await tx((t) => payCustomsVat(t, cid(req), actor(req), p(req).id, String(need(req.body, "accountId", "حساب السداد")), req.body.date)); await audit(req, "PAY_CUSTOMS", "invoice", p(req).id); return r; }));

// ── reorder suggestions → purchase orders ────────────────────────────────
r6.get("/inventory/reorder", perm("inventory.read"), h(async (req) => {
  const rows = await db.rows(
    `WITH bal AS (SELECT product_id, SUM(qty) qty FROM stock_balances WHERE company_id=$1 GROUP BY product_id),
     sales AS (SELECT l.product_id, SUM(l.qty*l.factor) q FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.company_id=$1 AND i.direction='SALE' AND i.kind='INVOICE' AND i.status='POSTED' AND i.date >= CURRENT_DATE - 90 GROUP BY l.product_id),
     lastbuy AS (SELECT DISTINCT ON (l.product_id) l.product_id, i.partner_id, i.partner_name, l.unit_price/NULLIF(l.factor,0) unit_price, i.date FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.company_id=$1 AND i.direction='PURCHASE' AND i.kind='INVOICE' AND i.status='POSTED' ORDER BY l.product_id, i.date DESC),
     onorder AS (SELECT l.product_id, SUM(l.qty*l.factor) q FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.company_id=$1 AND i.direction='PURCHASE' AND i.kind='ORDER' AND i.status='DRAFT' GROUP BY l.product_id)
     SELECT p.id, p.sku, p.name, p.unit, p.reorder_level, p.purchase_price, COALESCE(b.qty,0) qty, COALESCE(s.q,0) sold90, COALESCE(o.q,0) on_order, lb.partner_id AS supplier_id, lb.partner_name AS supplier_name, lb.unit_price AS last_price, lb.date AS last_date
     FROM products p LEFT JOIN bal b ON b.product_id=p.id LEFT JOIN sales s ON s.product_id=p.id LEFT JOIN lastbuy lb ON lb.product_id=p.id LEFT JOIN onorder o ON o.product_id=p.id
     WHERE p.company_id=$1 AND p.type='STOCK' AND p.is_active AND (COALESCE(b.qty,0) <= p.reorder_level OR ($2::boolean AND COALESCE(s.q,0) > 0))
     ORDER BY (COALESCE(b.qty,0) - p.reorder_level), p.name`, [cid(req), req.query.all === "1"]);
  return rows.map((r) => {
    const monthly = Number(r.sold90) / 3;
    const target = Math.max(Number(r.reorderLevel) * 2, monthly * 1.5); // cover ~6 weeks or twice the reorder level
    const suggested = Math.max(0, Math.ceil(target - Number(r.qty) - Number(r.onOrder)));
    return { ...r, monthlySales: Math.round(monthly * 10) / 10, suggested, price: Number(r.lastPrice ?? r.purchasePrice ?? 0) };
  }).filter((r) => r.suggested > 0 || Number(r.qty) <= Number(r.reorderLevel));
}));
r6.post("/inventory/reorder/orders", perm("purchases.write"), h(async (req) => {
  const items: { productId: string; qty: number; supplierId?: string | null; price?: number }[] = req.body?.items || [];
  const groups = new Map<string, typeof items>();
  for (const it of items) { if (!it.productId || !(Number(it.qty) > 0)) continue; const k = it.supplierId || ""; (groups.get(k) || groups.set(k, []).get(k)!).push(it); }
  if (!groups.size) throw bad("لا توجد أصناف بكميات");
  const { saveDraft } = require("../services/invoices") as typeof import("../services/invoices");
  const created: any[] = [];
  await tx(async (t) => {
    for (const [supplierId, list] of groups) {
      let sid = supplierId;
      if (!sid) { const s = await t.maybe(`SELECT id FROM partners WHERE company_id=$1 AND is_supplier AND is_active ORDER BY created_at LIMIT 1`, [cid(req)]); if (!s) throw bad("حدد المورد للأصناف التي ليس لها مورد سابق"); sid = s.id; }
      const sup = await t.one(`SELECT currency FROM partners WHERE id=$1 AND company_id=$2`, [sid, cid(req)], "المورد غير موجود");
      const rate = sup.currency && sup.currency !== "SAR" ? await rateFor(t, cid(req), sup.currency) : 1; // last prices are in SAR → convert to the supplier's currency
      const d = await saveDraft(t, req.company, actor(req), { direction: "PURCHASE", kind: "ORDER", partnerId: sid, notes: "أمر شراء من اقتراحات إعادة الطلب", currency: sup.currency || "SAR", exchangeRate: rate, lines: list.map((it) => ({ productId: it.productId, qty: Number(it.qty), unitPrice: rate !== 1 ? Math.round(((Number(it.price) || 0) / rate) * 10000) / 10000 : Number(it.price) || 0, taxCode: "S" })) });
      created.push({ id: d.id, number: d.number, partnerName: d.partnerName, lines: list.length });
    }
  });
  await audit(req, "CREATE", "reorder_po", cid(req), { orders: created.length });
  return created;
}));
