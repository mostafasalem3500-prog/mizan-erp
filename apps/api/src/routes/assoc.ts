/** Associations edition routes: members, subscriptions, shares, surplus distribution, unified voucher register, entry previews. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import { previewEntry } from "./ops";
import * as ch from "../services/charity";
import * as as from "../services/assoc";
import * as a2 from "../services/assoc2";
import { AppError } from "../lib/core";

export const assocRoutes = Router();
assocRoutes.use(authenticate);
const R = "payments.read", W = "payments.write";

// entry preview before posting (the same rolled-back transaction the core vouchers use)
assocRoutes.post("/charity/receipts/preview-entry", perm(W), h(async (req) => previewEntry((t) => ch.createReceipt(t, cid(req), actor(req), req.body || {}))));
// a disbursement on a project must fit the project's budget (or carry a recorded override); closed projects take none
const withBudget = (b: any, check: any) => (check?.override ? { ...b, notes: `${b.notes ? b.notes + " " : ""}[تجاوز ميزانية المشروع: ${b.overBudgetReason}]` } : b);
assocRoutes.post("/charity/disbursements/preview-entry", perm(W), h(async (req) => previewEntry(async (t) => { const b = req.body || {}; return ch.createDisbursement(t, cid(req), actor(req), withBudget(b, await a2.checkProjectBudget(t, cid(req), b))); })));
assocRoutes.post("/charity/disbursements", perm(W), h(async (req) => {
  const r = await tx(async (t) => { const b = req.body || {}; const chk = await a2.checkProjectBudget(t, cid(req), b); return { ...(await ch.createDisbursement(t, cid(req), actor(req), withBudget(b, chk))), budget: chk }; });
  await audit(req, "CREATE", "charity_disbursement", r.id, { number: r.number, amount: r.amount, ...(r.budget?.override ? { overBudget: r.budget.override } : {}) });
  return r;
}));

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

// ─── reviewer notes: closing, project budget & final disbursement, daily backup & archive ───
const owner = (req: any) => !!req.auth.superAdmin || ["OWNER", "ADMIN"].includes(req.auth.role || "");
assocRoutes.get("/charity/closing", perm(R), h(async (req) => tx((t) => a2.closingStatus(t, cid(req)))));
assocRoutes.put("/charity/closing/settings", perm("settings.write"), h(async (req) => { const r = await tx((t) => a2.saveClosingConfig(t, cid(req), req.body || {})); await audit(req, "UPDATE", "closing_settings", cid(req), r); return r; }));
assocRoutes.get("/charity/closing/summary", perm(R), h(async (req) => tx((t) => a2.periodSummary(t, cid(req), String(req.query.from), String(req.query.to)))));
assocRoutes.get("/charity/closing/alerts", perm(R), h(async (req) => tx((t) => a2.closingAlerts(t, cid(req)))));
assocRoutes.post("/charity/closing/week", perm(W), h(async (req) => { const r = await tx((t) => a2.closeWeek(t, cid(req), actor(req), req.body || {})); await audit(req, "CLOSE_WEEK", "assoc_closing", r.id, { week: r.periodKey, force: !!req.body?.force }); return r; }));
assocRoutes.delete("/charity/closing/week/:key", perm("accounting.write"), h(async (req) => { if (!owner(req)) throw new AppError(403, "إعادة فتح الأسبوع للمالك أو المدير فقط", "FORBIDDEN"); const r = await tx((t) => a2.reopenWeek(t, cid(req), p(req).key)); await audit(req, "REOPEN_WEEK", "assoc_closing", null, { week: p(req).key }); return r; }));
assocRoutes.get("/charity/closing/month/:periodId", perm(R), h(async (req) => tx((t) => a2.monthCheck(t, cid(req), p(req).periodId))));
assocRoutes.post("/charity/closing/month", perm("accounting.write"), h(async (req) => { const r = await tx((t) => a2.closeMonth(t, cid(req), actor(req), req.body || {}, owner(req))); await audit(req, "LOCK_PERIOD", "period", req.body?.periodId, { from: "charity", force: !!req.body?.force }); return r; }));

assocRoutes.get("/charity/projects/:id/budget", perm(R), h(async (req) => tx((t) => a2.projectBudget(t, cid(req), p(req).id, req.query))));
assocRoutes.get("/charity/projects/:id/final", perm(R), h(async (req) => tx((t) => a2.projectFinal(t, cid(req), p(req).id))));
assocRoutes.post("/charity/projects/:id/close", perm("accounting.write"), h(async (req) => { if (req.body?.force && !owner(req)) throw new AppError(403, "إقفال مشروع فيه بنود مفتوحة للمالك أو المدير فقط", "FORBIDDEN"); const r = await tx((t) => a2.closeProject(t, cid(req), actor(req), p(req).id, req.body || {})); await audit(req, "CLOSE", "charity_project", p(req).id, { remainder: r.remainder, finalVoucher: r.finalVoucher?.number }); return r; }));
assocRoutes.post("/charity/projects/:id/reopen", perm("accounting.write"), h(async (req) => { if (!owner(req)) throw new AppError(403, "إعادة فتح المشروع للمالك أو المدير فقط", "FORBIDDEN"); const r = await tx((t) => a2.reopenProject(t, cid(req), p(req).id)); await audit(req, "REOPEN", "charity_project", p(req).id); return r; }));

assocRoutes.get("/charity/daily-archive", perm(R), h(async (req) => tx((t) => a2.dailyArchive(t, cid(req), String(req.query.date || "")))));

// automatic daily backups (every edition): list, take one now, download (.json.gz)
const backupOwner = (req: any) => { if (!owner(req)) throw new AppError(403, "النسخ الاحتياطية للمالك أو المدير فقط", "FORBIDDEN"); };
assocRoutes.get("/backups", perm("settings.read"), h(async (req) => { backupOwner(req); return a2.listBackups(cid(req)); }));
assocRoutes.post("/backups", perm("settings.read"), h(async (req) => { backupOwner(req); const r = await a2.makeBackup(cid(req), "MANUAL", actor(req)); await audit(req, "BACKUP", "company", cid(req), { size: r.size, rows: r.rows }); return r; }));
assocRoutes.get("/backups/:id/download", perm("settings.read"), h(async (req, res) => {
  backupOwner(req);
  const f = await a2.backupFile(cid(req), p(req).id);
  await audit(req, "BACKUP_EXPORT", "company", cid(req), { file: f.name });
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", `attachment; filename="${f.name}"`);
  res.send(f.data);
}));
