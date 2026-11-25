/** 3.47.0 routes: category tree, business pulse, smart observations, peak hours, sales breakdown. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h } from "../lib/core";
import { authenticate, perm, cid, p } from "../lib/auth";
import { audit } from "./master";
import * as s from "../services/round347";

export const r347 = Router();
r347.use(authenticate);
const branch = (req: any) => req.auth.lockedBranchId || (req.query.branchId ? String(req.query.branchId) : null);

r347.get("/categories", perm("products.read"), h(async (req) => s.listCategories(db, cid(req))));
r347.get("/categories/stats", perm("reports.read"), h(async (req) => s.categoryStats(db, cid(req), { from: String(req.query.from || ""), to: String(req.query.to || "") })));
r347.post("/categories", perm("products.write"), h(async (req) => { const r = await tx((t) => s.saveCategory(t, cid(req), req.body || {})); await audit(req, "CREATE", "category", r.id, { name: r.name }); return r; }));
r347.put("/categories/reorder", perm("products.write"), h(async (req) => tx((t) => s.reorderCategories(t, cid(req), req.body?.ids))));
r347.post("/categories/move-products", perm("products.write"), h(async (req) => { const r = await tx((t) => s.moveProducts(t, cid(req), req.body?.productIds, req.body?.categoryId)); await audit(req, "UPDATE", "category", req.body?.categoryId || null, { moved: r.moved }); return r; }));
r347.put("/categories/:id", perm("products.write"), h(async (req) => { const r = await tx((t) => s.saveCategory(t, cid(req), req.body || {}, p(req).id)); await audit(req, "UPDATE", "category", r.id, { name: r.name }); return r; }));
r347.post("/categories/:id/merge", perm("products.write"), h(async (req) => { const r = await tx((t) => s.mergeCategory(t, cid(req), p(req).id, req.body?.into)); await audit(req, "UPDATE", "category", p(req).id, r); return r; }));
r347.delete("/categories/:id", perm("products.write"), h(async (req) => { const r = await tx((t) => s.deleteCategory(t, cid(req), p(req).id)); await audit(req, "DELETE", "category", p(req).id, {}); return r; }));

r347.get("/dashboard/pulse", perm("reports.read"), h(async (req) => s.pulse(db, cid(req), { period: String(req.query.period || "month"), branchId: branch(req) })));
r347.get("/dashboard/insights", perm("reports.read"), h(async (req) => s.insights(db, cid(req))));
r347.get("/analytics/heatmap", perm("reports.read"), h(async (req) => s.heatmap(db, cid(req), { days: Number(req.query.days || 28), branchId: branch(req) })));
r347.get("/analytics/breakdown", perm("reports.read"), h(async (req) => s.salesBreakdown(db, cid(req), req.query as any)));
