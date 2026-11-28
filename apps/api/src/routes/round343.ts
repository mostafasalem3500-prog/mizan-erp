/** 3.43.0 routes: customer/supplier set-off, product recipes, supplier bank details and the payment-run bank file. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import * as s from "../services/round343";

export const r343 = Router();
r343.use(authenticate);

r343.get("/setoffs/candidates", perm("payments.read"), h(async (req) => s.setoffCandidates(db, cid(req))));
r343.get("/setoffs", perm("payments.read"), h(async (req) => s.listSetoffs(db, cid(req))));
r343.post("/setoffs/preview", perm("payments.read"), h(async (req) => s.setoffPreview(db, cid(req), req.body || {})));
r343.post("/setoffs", perm("accounting.write"), h(async (req) => { const r = await tx((t) => s.createSetoff(t, cid(req), actor(req), req.body || {})); await audit(req, "POST", "setoff", r.id, { number: r.number, amount: r.amount, partner: r.partnerName }); return r; }));
r343.post("/setoffs/:id/cancel", perm("accounting.write"), h(async (req) => { const r = await tx((t) => s.cancelSetoff(t, cid(req), actor(req), p(req).id)); await audit(req, "CANCEL", "setoff", r.id, { number: r.number }); return r; }));

r343.get("/recipes/engineering", perm("products.read"), h(async (req) => s.menuEngineering(db, cid(req), { days: Number(req.query.days || 30) })));
r343.post("/preps/example", perm("products.write"), h(async (req) => { const r = await tx((t) => s.seedShawarmaExample(t, req.company, actor(req), req.auth.userId)); await audit(req, "CREATE", "example", null, { example: "shawarma" }); return r; }));
// till appearance and the best sellers shown first
r343.get("/pos/ui", perm("pos.use"), h(async (req) => {
  const co = await db.one(`SELECT accounting->'pos'->'ui' ui FROM companies WHERE id=$1`, [cid(req)]);
  const top = await db.rows(`SELECT l.product_id id FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.company_id=$1 AND i.direction='SALE' AND i.kind='INVOICE' AND i.status='POSTED' AND i.channel='POS' AND i.date > CURRENT_DATE - 30 AND l.product_id IS NOT NULL GROUP BY l.product_id ORDER BY SUM(l.qty) DESC LIMIT 24`, [cid(req)]);
  return { ui: co.ui || {}, top: top.map((x: any) => x.id) };
}));
r343.put("/pos/ui", perm("settings.write"), h(async (req) => {
  const b = req.body || {};
  const ui = { tile: ["S", "M", "L"].includes(b.tile) ? b.tile : "M", cats: b.cats === "SIDE" ? "SIDE" : "TOP", images: b.images !== false, accent: /^#[0-9a-fA-F]{6}$/.test(String(b.accent || "")) ? String(b.accent) : null, topFirst: b.topFirst !== false };
  await db.exec(`UPDATE companies SET accounting = jsonb_set(jsonb_set(COALESCE(accounting,'{}'::jsonb), '{pos}', COALESCE(accounting->'pos','{}'::jsonb)), '{pos,ui}', $2::jsonb) WHERE id=$1`, [cid(req), JSON.stringify(ui)]);
  await audit(req, "UPDATE", "pos_settings", null, { ui });
  return { ui };
}));
r343.get("/restaurant/food-cost", perm("reports.read"), h(async (req) => s.foodCost(db, cid(req), { from: String(req.query.from || ""), to: String(req.query.to || "") })));
r343.put("/restaurant/food-cost-target", perm("settings.write"), h(async (req) => { const v = Math.min(90, Math.max(5, Math.round(Number(req.body?.target) || 30))); await db.exec(`UPDATE companies SET accounting = jsonb_set(jsonb_set(COALESCE(accounting,'{}'::jsonb), '{pos}', COALESCE(accounting->'pos','{}'::jsonb)), '{pos,foodCostTarget}', to_jsonb($2::int)) WHERE id=$1`, [cid(req), v]); return { target: v }; }));
r343.get("/products/:id/variant-costs", perm("products.read"), h(async (req) => s.variantCosts(db, cid(req), p(req).id)));
r343.get("/preps", perm("products.read"), h(async (req) => s.prepList(db, cid(req))));
r343.get("/prep-batches", perm("inventory.read"), h(async (req) => s.listBatches(db, cid(req))));
r343.post("/prep-batches/preview", perm("inventory.read"), h(async (req) => s.batchPreview(db, cid(req), req.body || {})));
r343.post("/prep-batches", perm("inventory.write"), h(async (req) => { const r = await tx((t) => s.createBatch(t, cid(req), actor(req), req.body || {})); await audit(req, "POST", "prep_batch", r.id, { number: r.number, item: r.name, output: r.outputQty, cost: r.cost }); return r; }));
r343.post("/prep-batches/:id/cancel", perm("inventory.write"), h(async (req) => { const r = await tx((t) => s.cancelBatch(t, cid(req), actor(req), p(req).id)); await audit(req, "CANCEL", "prep_batch", r.id, { number: r.number }); return r; }));
r343.get("/preps/leftovers", perm("inventory.read"), h(async (req) => s.dayLeftovers(db, cid(req), { date: String(req.query.date || ""), warehouseId: String(req.query.warehouseId || "") })));
r343.get("/preps/waste-log", perm("inventory.read"), h(async (req) => s.wasteLog(db, cid(req), { from: String(req.query.from || ""), to: String(req.query.to || "") })));
r343.post("/preps/leftovers/waste", perm("inventory.write"), h(async (req) => { const r = await tx((t) => s.wasteLeftovers(t, cid(req), actor(req), req.body || {})); await audit(req, "POST", "day_waste", null, { date: r.date, count: r.count, value: r.value }); return r; }));
r343.get("/recipes", perm("products.read"), h(async (req) => s.recipeList(db, cid(req))));
r343.get("/products/:id/recipe", perm("products.read"), h(async (req) => s.getRecipe(db, cid(req), p(req).id)));
r343.put("/products/:id/recipe", perm("products.write"), h(async (req) => { const r = await tx((t) => s.saveRecipe(t, cid(req), p(req).id, req.body || {})); await audit(req, "UPDATE", "recipe", p(req).id, { components: r.lines.length, cost: r.cost }); return r; }));

r343.put("/partners/:id/bank", perm("accounting.write"), h(async (req) => { const r = await tx((t) => s.saveBank(t, cid(req), p(req).id, req.body || {})); await audit(req, "UPDATE", "partner_bank", r.id, { iban: r.iban ? "…" + r.iban.slice(-4) : null }); return r; }));
r343.get("/payment-runs/:id/bank-file", perm("accounting.write"), h(async (req) => s.bankFile(db, cid(req), p(req).id)));
