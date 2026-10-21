/** Round 23 routes: zakat base assessment and withholding tax. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import * as s from "../services/round23";

export const r23 = Router();
r23.use(authenticate);

r23.get("/tax/wht/types", perm("vat.read"), h(async () => s.WHT_TYPES));
r23.get("/tax/wht", perm("vat.read"), h(async (req) => s.whtReport(db, cid(req), req.query)));
r23.post("/tax/wht/file", perm("vat.write"), h(async (req) => { const r = await tx((t) => s.fileWht(t, cid(req), actor(req), req.body || {})); await audit(req, "FILE", "wht_return", r.id, { period: r.period, tax: r.taxTotal }); return r; }));
r23.post("/tax/wht/:id/cancel", perm("vat.write"), h(async (req) => tx((t) => s.cancelWht(t, cid(req), actor(req), p(req).id))));

r23.get("/zakat/compute", perm("accounting.read"), h(async (req) => s.zakatCompute(db, cid(req), req.query)));
r23.post("/zakat", perm("accounting.write"), h(async (req) => { const r = await tx((t) => s.zakatPost(t, cid(req), actor(req), req.body || {})); await audit(req, "POST", "zakat", r.id, { base: r.base, zakat: r.zakat }); return r; }));
r23.get("/zakat/:id", perm("accounting.read"), h(async (req) => s.zakatGet(db, cid(req), p(req).id)));
r23.post("/zakat/:id/cancel", perm("accounting.write"), h(async (req) => tx((t) => s.zakatCancel(t, cid(req), actor(req), p(req).id))));
r23.post("/zakat/:id/pay", perm("payments.write"), h(async (req) => { const r = await tx((t) => s.zakatPay(t, cid(req), actor(req), p(req).id, req.body || {})); await audit(req, "PAY", "zakat", p(req).id, { amount: req.body?.amount }); return r; }));

// ─── charity: zakat fund & case studies ────────────────────────────────────
import * as c4 from "../services/charity4";
r23.get("/charity/zakat/meta", perm("payments.read"), h(async (req) => ({ categories: c4.ZAKAT_CATEGORIES, flags: c4.CASE_FLAGS, policy: await c4.policy(db, cid(req)), fund: await c4.zakatFund(db, cid(req)) })));
r23.get("/charity/zakat/fund", perm("reports.read"), h(async (req) => c4.zakatFundReport(db, cid(req), req.query)));
r23.put("/charity/policy", perm("settings.write"), h(async (req) => { const r = await tx((t) => c4.savePolicy(t, cid(req), req.body || {})); await audit(req, "UPDATE", "charity_policy", null, r); return r; }));
r23.get("/charity/beneficiaries/:id/aid-history", perm("payments.read"), h(async (req) => c4.aidHistory(db, cid(req), p(req).id, req.query)));
r23.get("/charity/beneficiaries/:id/cases", perm("partners.read"), h(async (req) => c4.listCases(db, cid(req), p(req).id)));
r23.post("/charity/beneficiaries/:id/cases", perm("partners.write"), h(async (req) => { const r = await tx((t) => c4.saveCase(t, cid(req), actor(req), p(req).id, req.body || {})); await audit(req, "CREATE", "case_study", r.id, { verdict: r.verdict, score: r.score }); return r; }));
r23.post("/charity/case-assess", perm("partners.read"), h(async (req) => c4.assess(req.body || {}, await c4.policy(db, cid(req)))));
