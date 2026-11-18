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
import * as a3 from "../services/assoc3";
import { AppError } from "../lib/core";

export const assocRoutes = Router();
assocRoutes.use(authenticate);
const R = "payments.read", W = "payments.write";

// entry preview before posting (the same rolled-back transaction the core vouchers use)
assocRoutes.post("/charity/receipts/preview-entry", perm(W), h(async (req) => previewEntry((t) => ch.createReceipt(t, cid(req), actor(req), req.body || {}))));
// a disbursement on a project must fit the project's budget (or carry a recorded override); closed projects take none
const withBudget = (b: any, check: any) => (check?.override ? { ...b, notes: `${b.notes ? b.notes + " " : ""}[تجاوز ميزانية المشروع: ${b.overBudgetReason}]` } : b);
assocRoutes.post("/charity/disbursements/preview-entry", perm(W), h(async (req) => previewEntry(async (t) => { const b = req.body || {}; await a3.checkDirectLimit(t, cid(req), b); return ch.createDisbursement(t, cid(req), actor(req), withBudget(b, await a2.checkProjectBudget(t, cid(req), b))); })));
assocRoutes.post("/charity/disbursements", perm(W), h(async (req) => {
  const r = await tx(async (t) => { const b = req.body || {}; await a3.checkDirectLimit(t, cid(req), b); const chk = await a2.checkProjectBudget(t, cid(req), b); return { ...(await ch.createDisbursement(t, cid(req), actor(req), withBudget(b, chk))), budget: chk }; });
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

// ─── authority matrix, governance, grants, non-profit statements ───────────
assocRoutes.get("/charity/authority", perm(R), h(async (req) => tx((t) => a3.getAuthority(t, cid(req)))));
assocRoutes.put("/charity/authority", perm("settings.write"), h(async (req) => { if (!owner(req)) throw new AppError(403, "لائحة الصلاحيات يعدّلها المالك أو المدير فقط", "FORBIDDEN"); const r = await tx((t) => a3.saveAuthority(t, cid(req), req.body || {})); await audit(req, "UPDATE", "authority_matrix", cid(req), r); return r; }));
assocRoutes.post("/charity/requests/:id/approve", perm("accounting.write"), h(async (req) => { const r = await tx((t) => a3.approveRequest(t, cid(req), actor(req), p(req).id, req.body || {})); await audit(req, r.status === "APPROVED" ? "APPROVE" : "APPROVE_PARTIAL", "charity_request", p(req).id, { level: r.level?.title, approvals: (r.approvals || []).length }); return r; }));

assocRoutes.get("/charity/meetings", perm(R), h(async (req) => a3.listMeetings(db, cid(req))));
assocRoutes.post("/charity/meetings", perm(W), h(async (req) => { const r = await tx((t) => a3.saveMeeting(t, cid(req), actor(req), req.body || {})); await audit(req, "CREATE", "assoc_meeting", r.id, { number: r.number }); return r; }));
assocRoutes.put("/charity/meetings/:id", perm(W), h(async (req) => { if (req.body?.reopen && !owner(req)) throw new AppError(403, "إعادة فتح محضر معتمد للمالك أو المدير فقط", "FORBIDDEN"); const r = await tx((t) => a3.saveMeeting(t, cid(req), actor(req), req.body || {}, p(req).id)); await audit(req, req.body?.status === "APPROVED" ? "APPROVE" : "UPDATE", "assoc_meeting", p(req).id); return r; }));
assocRoutes.delete("/charity/meetings/:id", perm(W), h(async (req) => { const m = await db.one(`SELECT status FROM assoc_meetings WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)], "الاجتماع غير موجود"); if (m.status === "APPROVED") throw new AppError(409, "المحضر معتمد — لا يُحذف", "CONFLICT"); await db.exec(`DELETE FROM assoc_meetings WHERE id=$1`, [p(req).id]); await audit(req, "DELETE", "assoc_meeting", p(req).id); return { ok: true }; }));
assocRoutes.get("/charity/decisions", perm(R), h(async (req) => a3.listDecisions(db, cid(req), req.query)));
assocRoutes.post("/charity/decisions", perm(W), h(async (req) => { const r = await tx((t) => a3.saveDecision(t, cid(req), actor(req), req.body || {})); await audit(req, "CREATE", "assoc_decision", r.id, { number: r.number }); return r; }));
assocRoutes.put("/charity/decisions/:id", perm(W), h(async (req) => { const r = await tx((t) => a3.saveDecision(t, cid(req), actor(req), req.body || {}, p(req).id)); await audit(req, "UPDATE", "assoc_decision", p(req).id, { status: r.status }); return r; }));

assocRoutes.get("/charity/grants", perm(R), h(async (req) => a3.listGrants(db, cid(req))));
assocRoutes.get("/charity/grants/:id", perm(R), h(async (req) => a3.grantDetail(db, cid(req), p(req).id)));
assocRoutes.post("/charity/grants", perm(W), h(async (req) => { const r = await tx((t) => a3.saveGrant(t, cid(req), actor(req), req.body || {})); await audit(req, "CREATE", "assoc_grant", r.id, { number: r.number, amount: r.amount }); return r; }));
assocRoutes.put("/charity/grants/:id", perm(W), h(async (req) => { const r = await tx((t) => a3.saveGrant(t, cid(req), actor(req), req.body || {}, p(req).id)); await audit(req, "UPDATE", "assoc_grant", p(req).id); return r; }));

assocRoutes.get("/charity/npo-statements", perm("reports.read"), h(async (req) => tx((t) => a3.npoStatements(t, cid(req), req.query))));

// ─── Salla donation store ───────────────────────────────────────────────────
import * as st from "../services/assocStore";
import { newSallaToken, processEvent } from "../services/salla";
assocRoutes.get("/charity/store", perm(R), h(async (req) => st.storeOverview(cid(req))));
assocRoutes.put("/charity/store", perm("settings.write"), h(async (req) => {
  const b = req.body || {};
  const map = st.donationMap(b.map);
  for (const r of [...map.rules.map((x) => x.projectId), map.defaultProjectId].filter(Boolean)) await db.one(`SELECT 1 FROM charity_projects WHERE id=$1 AND company_id=$2`, [r, cid(req)], "مشروع غير موجود في قواعد المتجر");
  const mode = b.mode === "SALES" ? "SALES" : "DONATIONS";
  const vals: any = { mode, donationMap: JSON.stringify(map), enabled: b.enabled !== false };
  if (b.secret !== undefined) vals.secret = b.secret ? String(b.secret).trim().slice(0, 200) : null;
  const ex = await db.maybe(`SELECT 1 FROM salla_connections WHERE company_id=$1 AND platform='SALLA'`, [cid(req)]);
  if (ex) await db.update("salla_connections", { companyId: cid(req), platform: "SALLA" }, vals);
  else await db.insert("salla_connections", { companyId: cid(req), platform: "SALLA", token: newSallaToken(), autoPost: true, createProducts: false, ...vals });
  await audit(req, "UPDATE", "salla_donation_store", cid(req), { mode, rules: map.rules.length });
  return st.storeOverview(cid(req));
}));
assocRoutes.post("/charity/store/sample", perm("settings.write"), h(async (req) => {
  const conn = await db.maybe(`SELECT * FROM salla_connections WHERE company_id=$1 AND platform='SALLA'`, [cid(req)]);
  if (!conn) throw new AppError(400, "اربط المتجر أولاً", "BAD_REQUEST");
  if (conn.mode !== "DONATIONS") throw new AppError(400, "المتجر مضبوط على وضع المبيعات — اختر «متجر تبرعات»", "BAD_REQUEST");
  return processEvent(conn, st.sampleDonationOrder(st.donationMap(conn.donationMap)), { sample: true });
}));

// large expense runs need a board decision (authority matrix), the owner aside
assocRoutes.post("/charity/batches/:id/post", perm("accounting.write"), h(async (req) => {
  const r = await tx(async (t) => {
    const b = await t.one(`SELECT * FROM charity_batches WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)], "المسير غير موجود");
    const total = (b.lines || []).reduce((a: number, l: any) => a + Number(l.amount || 0), 0);
    const c = await a3.getAuthority(t, cid(req));
    if (c.enabled && c.directLimit && total > c.directLimit + 0.004) {
      const dec = req.body?.decisionId || b.decisionId;
      if (dec) { await t.one(`SELECT 1 FROM assoc_decisions WHERE id=$1 AND company_id=$2 AND status<>'CANCELLED'`, [dec, cid(req)], "القرار غير موجود"); await t.exec(`UPDATE charity_batches SET decision_id=$2 WHERE id=$1`, [b.id, dec]); }
      else if (!owner(req)) throw new AppError(409, `إجمالي المسير ${total.toFixed(2)} يتجاوز حد الصرف المباشر (${c.directLimit}) — اربط قرار اعتماد من «سجل القرارات»`, "AUTHORITY");
    }
    return ch.postBatch(t, cid(req), actor(req), p(req).id);
  });
  await audit(req, "POST", "charity_batch", p(req).id, { number: (r as any)?.number, total: (r as any)?.total, decision: req.body?.decisionId || null });
  return r;
}));

// ─── public verification of a donation receipt (QR on the printed receipt) ──
export const assocPublic = Router();
assocPublic.get("/donation/:token", h(async (req) => {
  const { CHARITY } = require("../lib/country") as typeof import("../lib/country");
  const tk = String(p(req).token || "");
  if (!CHARITY || !/^[A-Za-z0-9_-]{12,40}$/.test(tk)) throw new AppError(404, "السند غير موجود", "NOT_FOUND");
  const r = await db.maybe(`SELECT r.number, r.date, r.amount, r.source, r.status, r.payer_name, r.method, p.name project_name, s.association_name, s.license_no, s.logo IS NOT NULL has_logo
    FROM charity_receipts r JOIN charity_settings s ON s.company_id=r.company_id LEFT JOIN charity_projects p ON p.id=r.project_id WHERE r.verify_token=$1`, [tk]);
  if (!r) throw new AppError(404, "السند غير موجود", "NOT_FOUND");
  // the donor's name is shown partly: enough to recognise, not to disclose
  const parts = String(r.payerName || "").trim().split(/\s+/);
  const masked = parts.length > 1 ? `${parts[0]} ${parts.slice(1).map((w) => w[0] + "…").join(" ")}` : parts[0].length > 2 ? parts[0].slice(0, 2) + "…" : parts[0] || "";
  return { number: r.number, date: r.date, amount: Number(r.amount), source: ch.SOURCE_AR[r.source] || r.source, status: r.status, payer: masked, project: r.projectName, association: r.associationName, license: r.licenseNo };
}));
