/** 3.49.0 routes: manufacturing — work centres, BOMs, orders, disassembly, planning, scheduling, shop floor, reports. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import * as s from "../services/manufacturing";
import { seedManufacturingExample } from "../services/mfgExample";

export const mfg = Router();
mfg.use(authenticate);
const R = perm("mfg.read"), W = perm("mfg.write");

mfg.get("/mfg/dashboard", R, h(async (req) => s.dashboard(db, cid(req))));
mfg.get("/mfg/work-centers", R, h(async (req) => s.listWorkCenters(db, cid(req))));
mfg.post("/mfg/work-centers", W, h(async (req) => { const r = await tx((t) => s.saveWorkCenter(t, cid(req), req.body || {})); await audit(req, "CREATE", "work_center", r.id, { name: r.name }); return r; }));
mfg.put("/mfg/work-centers/:id", W, h(async (req) => tx((t) => s.saveWorkCenter(t, cid(req), req.body || {}, p(req).id))));
mfg.delete("/mfg/work-centers/:id", W, h(async (req) => tx((t) => s.deleteWorkCenter(t, cid(req), p(req).id))));

mfg.get("/mfg/boms", R, h(async (req) => s.listBoms(db, cid(req), req.query)));
mfg.get("/mfg/boms/:id", R, h(async (req) => s.getBom(db, cid(req), p(req).id)));
mfg.post("/mfg/boms", W, h(async (req) => { const r = await tx((t) => s.saveBom(t, cid(req), req.body || {})); await audit(req, "CREATE", "bom", r.id, { code: r.code }); return r; }));
mfg.put("/mfg/boms/:id", W, h(async (req) => { const r = await tx((t) => s.saveBom(t, cid(req), req.body || {}, p(req).id)); await audit(req, "UPDATE", "bom", r.id, { code: r.code }); return r; }));
mfg.delete("/mfg/boms/:id", W, h(async (req) => tx((t) => s.deleteBom(t, cid(req), p(req).id))));
mfg.get("/mfg/cost", R, h(async (req) => s.costFor(db, cid(req), req.query)));

mfg.get("/mfg/orders", R, h(async (req) => s.listOrders(db, cid(req), req.query)));
mfg.get("/mfg/orders/:id", R, h(async (req) => s.getOrder(db, cid(req), p(req).id)));
mfg.post("/mfg/orders", W, h(async (req) => { const r = await tx(async (t) => { const o = await s.createOrder(t, req.company, actor(req), req.body || {}); return s.getOrder(t, cid(req), o.id); }); await audit(req, "CREATE", "mfg_order", r.id, { number: r.number, qty: r.qty }); return r; }));
mfg.put("/mfg/orders/:id", W, h(async (req) => tx(async (t) => { await s.updateDraft(t, cid(req), p(req).id, req.body || {}); return s.getOrder(t, cid(req), p(req).id); })));
mfg.post("/mfg/orders/:id/confirm", W, h(async (req) => tx(async (t) => { await s.confirmOrder(t, cid(req), p(req).id); return s.getOrder(t, cid(req), p(req).id); })));
mfg.post("/mfg/orders/:id/issue", W, h(async (req) => tx((t) => s.issue(t, cid(req), actor(req), p(req).id, req.body || {}))));
mfg.post("/mfg/orders/:id/return", W, h(async (req) => tx((t) => s.returnMaterials(t, cid(req), actor(req), p(req).id, req.body || {}))));
mfg.post("/mfg/orders/:id/ops/:seq", W, h(async (req) => tx((t) => s.opAction(t, cid(req), actor(req), p(req).id, Number(p(req).seq), req.body || {}))));
mfg.post("/mfg/orders/:id/produce", W, h(async (req) => { const r = await tx((t) => s.produce(t, cid(req), actor(req), p(req).id, req.body || {})); await audit(req, "PRODUCE", "mfg_order", r.id, { number: r.number, qty: req.body?.qty, scrap: req.body?.scrapQty }); return r; }));
mfg.post("/mfg/orders/:id/close", W, h(async (req) => { const r = await tx((t) => s.closeOrder(t, cid(req), actor(req), p(req).id, req.body || {})); await audit(req, "CLOSE", "mfg_order", r.id, { number: r.number, variance: r.sheet.variance }); return r; }));
mfg.post("/mfg/orders/:id/cancel", W, h(async (req) => { const r = await tx((t) => s.cancelOrder(t, cid(req), actor(req), p(req).id, req.body || {})); await audit(req, "CANCEL", "mfg_order", r.id, { number: r.number }); return r; }));

mfg.get("/mfg/unbuilds", R, h(async (req) => s.listUnbuilds(db, cid(req))));
mfg.post("/mfg/unbuilds", W, h(async (req) => { const r = await tx((t) => s.unbuild(t, cid(req), actor(req), req.body || {})); await audit(req, "CREATE", "unbuild", r.id, { number: r.number, qty: r.qty }); return r; }));

mfg.get("/mfg/plan", R, h(async (req) => s.mrp(db, cid(req), req.query)));
mfg.post("/mfg/plan/orders", W, h(async (req) => tx((t) => s.ordersFromPlan(t, req.company, actor(req), req.body || {}))));
mfg.get("/mfg/schedule", R, h(async (req) => s.schedule(db, cid(req), req.query)));
mfg.get("/mfg/floor", R, h(async (req) => s.floor(db, cid(req), req.query)));
mfg.post("/mfg/example", W, h(async (req) => { const r = await tx((t) => seedManufacturingExample(t, req.company, actor(req))); await audit(req, "CREATE", "mfg_example", null, {}); return r; }));
mfg.get("/mfg/reports", R, h(async (req) => s.reports(db, cid(req), req.query)));
