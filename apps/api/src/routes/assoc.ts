/** Associations edition routes: members, subscriptions, shares, surplus distribution, unified voucher register, entry previews. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import { previewEntry } from "./ops";
import * as ch from "../services/charity";
import * as as from "../services/assoc";

export const assocRoutes = Router();
assocRoutes.use(authenticate);
const R = "payments.read", W = "payments.write";

// entry preview before posting (the same rolled-back transaction the core vouchers use)
assocRoutes.post("/charity/receipts/preview-entry", perm(W), h(async (req) => previewEntry((t) => ch.createReceipt(t, cid(req), actor(req), req.body || {}))));
assocRoutes.post("/charity/disbursements/preview-entry", perm(W), h(async (req) => previewEntry((t) => ch.createDisbursement(t, cid(req), actor(req), req.body || {}))));

assocRoutes.get("/charity/vouchers", perm(R), h(async (req) => as.voucherRegister(db, cid(req), req.query)));

assocRoutes.get("/charity/members", perm("partners.read"), h(async (req) => tx((t) => as.listMembers(t, cid(req), req.query))));
assocRoutes.post("/charity/members", perm("partners.write"), h(async (req) => { const r = await tx((t) => as.saveMember(t, cid(req), req.body || {})); await audit(req, "CREATE", "member", r.id, { name: r.name }); return r; }));
assocRoutes.put("/charity/members/:id", perm("partners.write"), h(async (req) => { const r = await tx((t) => as.saveMember(t, cid(req), req.body || {}, p(req).id)); await audit(req, "UPDATE", "member", r.id, { name: r.name }); return r; }));
assocRoutes.post("/charity/members/from/:id", perm("partners.write"), h(async (req) => tx((t) => as.makeMember(t, cid(req), p(req).id))));
assocRoutes.get("/charity/members/:id/statement", perm(R), h(async (req) => as.memberStatement(db, cid(req), p(req).id)));
assocRoutes.post("/charity/members/fee", perm(W), h(async (req) => { const r = await tx(async (t) => ch.createReceipt(t, cid(req), actor(req), await as.feeReceiptBody(t, cid(req), req.body || {}))); await audit(req, "CREATE", "charity_receipt", r.id, { number: r.number, amount: r.amount, fee: true }); return r; }));
assocRoutes.post("/charity/members/fee/preview-entry", perm(W), h(async (req) => previewEntry(async (t) => ch.createReceipt(t, cid(req), actor(req), await as.feeReceiptBody(t, cid(req), req.body || {})))));

assocRoutes.get("/charity/shares", perm(R), h(async (req) => as.listShareTxns(db, cid(req), req.query)));
assocRoutes.post("/charity/shares", perm(W), h(async (req) => { const r = await tx((t) => as.createShareTxn(t, cid(req), actor(req), req.body || {})); await audit(req, "CREATE", "assoc_share", r.id, { number: r.number, amount: r.amount, kind: r.kind }); return r; }));
assocRoutes.post("/charity/shares/preview-entry", perm(W), h(async (req) => previewEntry((t) => as.createShareTxn(t, cid(req), actor(req), req.body || {}))));
assocRoutes.post("/charity/shares/:id/cancel", perm("accounting.write"), h(async (req) => { const r = await tx((t) => as.cancelShareTxn(t, cid(req), actor(req), p(req).id, req.body?.reason)); await audit(req, "CANCEL", "assoc_share", p(req).id); return r; }));

assocRoutes.get("/charity/distributions", perm(R), h(async (req) => as.listDistributions(db, cid(req))));
assocRoutes.post("/charity/distributions/plan", perm("reports.read"), h(async (req) => tx((t) => as.distributionPlan(t, cid(req), req.body || {}))));
assocRoutes.post("/charity/distributions/preview-entry", perm("accounting.write"), h(async (req) => previewEntry((t) => as.postDistribution(t, cid(req), actor(req), req.body || {}))));
assocRoutes.post("/charity/distributions", perm("accounting.write"), h(async (req) => { const r = await tx((t) => as.postDistribution(t, cid(req), actor(req), req.body || {})); await audit(req, "POST", "assoc_distribution", r.id, { number: r.number, year: r.year, surplus: r.surplus }); return r; }));
assocRoutes.post("/charity/distributions/:id/pay", perm(W), h(async (req) => { const r = await tx((t) => as.payDistribution(t, cid(req), actor(req), p(req).id, req.body || {})); await audit(req, "PAY", "assoc_distribution", p(req).id, { total: r.total }); return r; }));
assocRoutes.post("/charity/distributions/:id/cancel", perm("accounting.write"), h(async (req) => { const r = await tx((t) => as.cancelDistribution(t, cid(req), actor(req), p(req).id, req.body?.reason)); await audit(req, "CANCEL", "assoc_distribution", p(req).id); return r; }));
assocRoutes.get("/charity/assoc-checks", perm("reports.read"), h(async (req) => as.assocChecks(db, cid(req))));
