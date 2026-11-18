/** Written financial report and the periodic (monthly / quarterly / annual) reports archive. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h, bad } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import { financialReport } from "../services/finreport";
import * as pr from "../services/periodic";

export const fr = Router();
fr.use(authenticate);
const lockBranch = (req: any) => ({ ...req.query, branchId: req.auth.lockedBranchId || req.query.branchId });
fr.get("/reports/financial-report", perm("reports.read"), h(async (req) => financialReport(db, cid(req), lockBranch(req))));
fr.get("/periodic-reports", perm("reports.read"), h(async (req) => {
  // a branch-locked user sees only reports of their branch — the periodic reports are for the whole establishment
  if ((req as any).auth.lockedBranchId) return { rows: [], settings: null, lockedBranch: true };
  const made = await tx((t) => pr.ensureLatest(t, cid(req), actor(req))).catch(() => null);
  return { rows: await pr.listReports(db, cid(req)), settings: await pr.periodicSettings(db, cid(req)), issued: made };
}));
fr.get("/periodic-reports/:id", perm("reports.read"), h(async (req) => { if ((req as any).auth.lockedBranchId) throw bad("التقارير الدورية للمنشأة كاملة — غير متاحة لمستخدم مقيّد بفرع"); return pr.getReport(db, cid(req), p(req).id, String(req.query.lang || "")); }));
fr.post("/periodic-reports", perm("reports.read"), h(async (req) => {
  if ((req as any).auth.lockedBranchId) throw bad("التقارير الدورية للمنشأة كاملة — غير متاحة لمستخدم مقيّد بفرع");
  const r = await tx((t) => pr.issueReport(t, cid(req), actor(req), req.body || {}));
  await audit(req, "CREATE", "periodic_report", r.id, { kind: r.kind, from: r.periodFrom, to: r.periodTo });
  return r;
}));
fr.delete("/periodic-reports/:id", perm("settings.write"), h(async (req) => { const r = await pr.deleteReport(db, cid(req), p(req).id); await audit(req, "DELETE", "periodic_report", p(req).id); return r; }));
fr.put("/periodic-reports/settings", perm("settings.write"), h(async (req) => pr.savePeriodicSettings(db, cid(req), req.body || {})));
