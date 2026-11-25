/** 3.51.0 routes: subscriptions — plans, subscribers (bill, change plan, pause, resume, cancel), check-ins, dashboard, usage. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import * as s from "../services/subscriptions";
import { seedSubscriptionExample } from "../services/subExample";

export const subscriptions = Router();
subscriptions.use(authenticate);
const R = perm("sales.read"), W = perm("sales.write");

subscriptions.get("/subs/dashboard", R, h(async (req) => s.dashboard(db, cid(req))));
subscriptions.get("/subs/plans", R, h(async (req) => s.listPlans(db, cid(req))));
subscriptions.post("/subs/plans", W, h(async (req) => { const r = await tx((t) => s.savePlan(t, cid(req), req.body || {})); await audit(req, "CREATE", "sub_plan", r.id, { name: r.name }); return r; }));
subscriptions.put("/subs/plans/:id", W, h(async (req) => tx((t) => s.savePlan(t, cid(req), req.body || {}, p(req).id))));
subscriptions.get("/subs", R, h(async (req) => s.listSubscriptions(db, cid(req), req.query)));
subscriptions.get("/subs/usage", R, h(async (req) => s.usageReport(db, cid(req), req.query)));
subscriptions.get("/subs/:id", R, h(async (req) => s.getSubscription(db, cid(req), p(req).id)));
subscriptions.post("/subs", W, h(async (req) => { const r = await tx(async (t) => { const x = await s.createSubscription(t, req.company, actor(req), req.body || {}); return s.getSubscription(t, cid(req), x.id); }); await audit(req, "CREATE", "subscription", r.id, { number: r.number }); return r; }));
subscriptions.post("/subs/:id/bill", W, h(async (req) => tx(async (t) => { await s.billDue(t, req.company, actor(req), undefined, p(req).id); return s.getSubscription(t, cid(req), p(req).id); })));
subscriptions.post("/subs/:id/change", W, h(async (req) => { const r = await tx((t) => s.changePlan(t, req.company, actor(req), p(req).id, req.body || {})); await audit(req, "CHANGE", "subscription", r.id, { number: r.number, plan: r.planName }); return r; }));
subscriptions.post("/subs/:id/pause", W, h(async (req) => tx(async (t) => { await s.pause(t, cid(req), actor(req), p(req).id, req.body || {}); return s.getSubscription(t, cid(req), p(req).id); })));
subscriptions.post("/subs/:id/resume", W, h(async (req) => tx((t) => s.resume(t, req.company, actor(req), p(req).id, req.body || {}))));
subscriptions.post("/subs/:id/cancel", W, h(async (req) => { const r = await tx((t) => s.cancel(t, req.company, actor(req), p(req).id, req.body || {})); await audit(req, "CANCEL", "subscription", r.id, { number: r.number }); return r; }));
subscriptions.post("/subs-checkin", perm("sales.read"), h(async (req) => tx((t) => s.checkin(t, cid(req), actor(req), req.body || {}))));
subscriptions.delete("/subs-usage/:id", W, h(async (req) => tx((t) => s.undoUsage(t, cid(req), p(req).id))));
subscriptions.post("/subs-bill-due", W, h(async (req) => tx((t) => s.billDue(t, req.company, actor(req)))));
subscriptions.post("/subs-example", W, h(async (req) => tx((t) => seedSubscriptionExample(t, req.company, actor(req)))));
