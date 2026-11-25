/** 3.39.0 routes: payroll remittances (both editions); Egypt — solidarity contribution, legal reserve, salary-tax report, simplified regime. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import { IS_EG } from "../lib/country";
import * as rm from "../services/payremit";
import * as ec from "../services/egcompliance";
import { EG_INSURANCE_LIMITS, insuranceLimits, EG_PAYROLL } from "../services/egypt";
import { OVERTIME_RATES } from "../services/payroll";

export const r339 = Router();
r339.use(authenticate);

r339.get("/payroll/remittances", perm("accounting.read"), h(async (req) => rm.remitSummary(db, cid(req), req.query)));
r339.post("/payroll/remittances", perm("accounting.write"), h(async (req) => { const r = await tx((t) => rm.remit(t, cid(req), actor(req), req.body || {})); await audit(req, "PAYROLL_REMIT", "payroll_remittance", r.id, { kind: r.kind, period: r.period, amount: r.amount }); return r; }));
r339.post("/payroll/remittances/:id/cancel", perm("accounting.write"), h(async (req) => { const r = await tx((t) => rm.cancelRemit(t, cid(req), actor(req), p(req).id)); await audit(req, "CANCEL_PAYROLL_REMIT", "payroll_remittance", p(req).id); return r; }));
r339.get("/payroll/overtime-rates", perm("hr.read"), h(async () => ({ rates: OVERTIME_RATES })));

// ─── Egypt only ──────────────────────────────────────────────────────────
const eg = Router();
eg.use((_req, _res, next) => (IS_EG ? next() : next("router")));
eg.get("/tax/eg/rules", perm("accounting.read"), h(async (req) => ({
  simplified: { ...ec.EG_SIMPLIFIED, enabled: !!req.company.egSimplified }, solidarityRate: ec.EG_SOLIDARITY_RATE, legalReserve: ec.EG_LEGAL_RESERVE,
  insurance: { ...EG_PAYROLL.insurance, ...insuranceLimits(), byYear: EG_INSURANCE_LIMITS }, exemption: EG_PAYROLL.personalExemption,
})));
eg.get("/tax/solidarity", perm("accounting.read"), h(async (req) => ec.solidarityCompute(db, cid(req), req.query)));
eg.post("/tax/solidarity", perm("accounting.write"), h(async (req) => { const r = await tx((t) => ec.solidarityPost(t, cid(req), actor(req), req.body || {})); await audit(req, "POST_SOLIDARITY", "journal", r.journalId, { year: r.year, amount: r.amount }); return r; }));
eg.post("/tax/solidarity/cancel", perm("accounting.write"), h(async (req) => tx((t) => ec.solidarityCancel(t, cid(req), actor(req), req.body || {}))));
eg.post("/tax/solidarity/pay", perm("accounting.write"), h(async (req) => { const r = await tx((t) => ec.solidarityPay(t, cid(req), actor(req), req.body || {})); await audit(req, "PAY_SOLIDARITY", "journal", r.journalId, { paid: r.paid }); return r; }));
eg.get("/tax/legal-reserve", perm("accounting.read"), h(async (req) => ec.legalReserveCompute(db, cid(req), req.query)));
eg.post("/tax/legal-reserve", perm("accounting.write"), h(async (req) => { const r = await tx((t) => ec.legalReservePost(t, cid(req), actor(req), req.body || {})); await audit(req, "POST_LEGAL_RESERVE", "journal", r.journalId, { year: r.year, amount: r.amount }); return r; }));
eg.post("/tax/legal-reserve/cancel", perm("accounting.write"), h(async (req) => tx((t) => ec.legalReserveCancel(t, cid(req), actor(req), req.body || {}))));
eg.get("/tax/salary-tax-report", perm("accounting.read"), h(async (req) => ec.salaryTaxReport(db, cid(req), req.query)));
eg.get("/tax/simplified", perm("accounting.read"), h(async (req) => ec.simplifiedTax(Number(req.query.turnover || 0))));
r339.use(eg);
