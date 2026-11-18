/** 3.38.0 routes: modifiers & service charge, supplier payment runs, cash flow forecast, smart auditor, account suggestion. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import * as md from "../services/modifiers";
import * as pr from "../services/paymentruns";
import { cashForecast } from "../services/cashforecast";
import * as au from "../services/auditor";

export const r338 = Router();
r338.use(authenticate);
const who = (req: any) => ({ id: req.auth.userId, name: actor(req), role: req.auth.role });

// modifiers (the POS reads the active ones and keeps them for offline use)
r338.get("/modifiers", perm("products.read"), h(async (req) => md.listGroups(db, cid(req))));
r338.get("/modifiers/live", perm("pos.use"), h(async (req) => md.listGroups(db, cid(req), true)));
r338.post("/modifiers", perm("products.write"), h(async (req) => { const g = await tx((t) => md.saveGroup(t, cid(req), req.body || {})); await audit(req, "CREATE", "modifier_group", g.id, { name: g.name }); return g; }));
r338.put("/modifiers/:id", perm("products.write"), h(async (req) => { const g = await tx((t) => md.saveGroup(t, cid(req), req.body || {}, p(req).id)); await audit(req, "UPDATE", "modifier_group", g.id, { name: g.name }); return g; }));
r338.delete("/modifiers/:id", perm("products.write"), h(async (req) => { const r = await tx((t) => md.deleteGroup(t, cid(req), p(req).id)); await audit(req, "DELETE", "modifier_group", p(req).id); return r; }));

// supplier payment runs
r338.get("/payment-runs/propose", perm("accounting.write"), h(async (req) => pr.propose(db, cid(req), { dueUntil: String(req.query.dueUntil || ""), partnerId: String(req.query.partnerId || ""), minAmount: Number(req.query.minAmount || 0) })));
r338.get("/payment-runs", perm("accounting.write"), h(async (req) => pr.listRuns(db, cid(req))));
r338.get("/payment-runs/:id", perm("accounting.write"), h(async (req) => pr.getRun(db, cid(req), p(req).id)));
r338.post("/payment-runs", perm("accounting.write"), h(async (req) => { const r = await tx((t) => pr.createRun(t, cid(req), who(req), req.body || {})); await audit(req, "CREATE", "payment_run", r.id, { number: r.number, total: r.total }); return r; }));
r338.put("/payment-runs/:id", perm("accounting.write"), h(async (req) => tx((t) => pr.updateRun(t, cid(req), p(req).id, req.body || {}))));
r338.post("/payment-runs/:id/approve", perm("accounting.write"), h(async (req) => { const r = await tx((t) => pr.approveRun(t, cid(req), who(req), p(req).id)); await audit(req, "APPROVE", "payment_run", r.id, { number: r.number, total: r.total }); return r; }));
r338.post("/payment-runs/:id/reopen", perm("accounting.write"), h(async (req) => tx((t) => pr.reopenRun(t, cid(req), p(req).id))));
r338.post("/payment-runs/:id/post", perm("accounting.write"), h(async (req) => { const r = await tx((t) => pr.postRun(t, cid(req), actor(req), p(req).id)); await audit(req, "POST", "payment_run", r.id, { number: r.number, total: r.total, vouchers: r.vouchers.length }); return r; }));
r338.post("/payment-runs/:id/cancel", perm("accounting.write"), h(async (req) => { const r = await tx((t) => pr.cancelRun(t, cid(req), actor(req), p(req).id)); await audit(req, "CANCEL", "payment_run", r.id, { number: r.number }); return r; }));

// cash flow forecast
r338.get("/reports/cash-forecast", perm("accounting.read"), h(async (req) => cashForecast(db, req.company, { weeks: Number(req.query.weeks || 13), overdueRate: req.query.overdueRate === undefined ? undefined : Number(req.query.overdueRate), cashSales: req.query.cashSales === "1", from: String(req.query.from || "") })));

// smart auditor
r338.get("/auditor", perm("accounting.read"), h(async (req) => au.auditScan(db, req.company, { from: String(req.query.from || ""), to: String(req.query.to || ""), showDismissed: req.query.all === "1" })));
r338.post("/auditor/dismiss", perm("accounting.write"), h(async (req) => { const r = await tx((t) => au.dismiss(t, cid(req), actor(req), req.body || {})); await audit(req, "DISMISS", "audit_finding", null, req.body); return r; }));
r338.post("/auditor/undismiss", perm("accounting.write"), h(async (req) => tx((t) => au.undismiss(t, cid(req), req.body || {}))));
r338.get("/expenses/suggest-account", perm("expenses.write"), h(async (req) => au.suggestAccount(db, cid(req), { payee: String(req.query.payee || ""), partnerId: String(req.query.partnerId || ""), description: String(req.query.description || "") })));
