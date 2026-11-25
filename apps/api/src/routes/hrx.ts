/** 3.52.0 routes: HR — dashboard, GOSI rates, leave types and requests, documents, salary changes, payroll approval and WPS check. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h, bad } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import * as x from "../services/hrcore";
import { approveRun } from "../services/payroll";
import { employeePosition } from "../services/hr";
import * as ep from "../services/empPortal";

export const hrx = Router();
hrx.use(authenticate);
const R = perm("hr.read"), W = perm("hr.write");

hrx.get("/hr/dashboard", R, h(async (req) => x.hrDashboard(db, cid(req))));
hrx.get("/hr/gosi-rates", R, h(async (req) => x.listGosiRates(db, cid(req))));
hrx.post("/hr/gosi-rates", W, h(async (req) => { const r = await tx((t) => x.addGosiRate(t, cid(req), req.body || {})); await audit(req, "CREATE", "gosi_rate", r.id, req.body); return r; }));
hrx.post("/hr/gosi-limits", W, h(async (req) => { const r = await tx((t) => x.addGosiLimit(t, cid(req), req.body || {})); await audit(req, "CREATE", "gosi_limit", r.id, req.body); return r; }));
hrx.delete("/hr/gosi/:kind/:id", W, h(async (req) => tx((t) => x.deleteOwnGosiRow(t, cid(req), p(req).kind, p(req).id))));
hrx.get("/hr/leave-types", R, h(async (req) => tx((t) => x.ensureLeaveTypes(t, cid(req)))));
hrx.post("/hr/leave-types", W, h(async (req) => tx((t) => x.saveLeaveType(t, cid(req), req.body || {}))));
hrx.put("/hr/leave-types/:id", W, h(async (req) => tx((t) => x.saveLeaveType(t, cid(req), req.body || {}, p(req).id))));
hrx.post("/hr/leave-requests/quote", R, h(async (req) => tx((t) => x.quoteLeave(t, cid(req), req.body || {}))));
hrx.get("/hr/leave-requests", R, h(async (req) => x.listLeaves(db, cid(req), req.query)));
hrx.post("/hr/leave-requests", W, h(async (req) => { const r = await tx((t) => x.requestLeave(t, cid(req), actor(req), req.body || {})); await audit(req, "CREATE", "leave", r.id, { status: r.status, days: r.days }); return r; }));
for (const [path, st] of [["approve", "APPROVED"], ["reject", "REJECTED"], ["cancel", "CANCELLED"]] as const)
  hrx.post(`/hr/leave-requests/:id/${path}`, W, h(async (req) => { const r = await tx((t) => x.decideLeave(t, cid(req), actor(req), p(req).id, st, req.body?.note)); await audit(req, st, "leave", r.id); return r; }));
hrx.get("/hr/employees/:id/leave-balances", R, h(async (req) => x.leaveBalances(db, cid(req), p(req).id, req.query.asOf ? String(req.query.asOf) : undefined)));
hrx.get("/hr/documents", R, h(async (req) => x.listDocuments(db, cid(req), req.query)));
hrx.post("/hr/documents", W, h(async (req) => { const r = await tx((t) => x.saveDocument(t, cid(req), actor(req), req.body || {})); await audit(req, "CREATE", "hr_document", r.id, { kind: r.kind }); return r; }));
hrx.put("/hr/documents/:id", W, h(async (req) => tx((t) => x.saveDocument(t, cid(req), actor(req), req.body || {}, p(req).id))));
hrx.delete("/hr/documents/:id", W, h(async (req) => { await db.exec(`DELETE FROM hr_documents WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]); return { ok: true }; }));
hrx.post("/hr/employees/:id/salary-change", W, h(async (req) => { const r = await tx((t) => x.salaryChange(t, cid(req), actor(req), p(req).id, req.body || {})); await audit(req, "SALARY_CHANGE", "employee", p(req).id, { from: r.oldPay, to: r.newPay, effective: r.effectiveDate }); return r; }));
hrx.get("/hr/employees/:id/salary-history", R, h(async (req) => x.salaryHistory(db, cid(req), p(req).id)));
hrx.post("/hr/salary-changes/:id/cancel", W, h(async (req) => tx((t) => x.cancelSalaryChange(t, cid(req), p(req).id))));
/** Everything about one employee on one page. */
hrx.get("/hr/employees/:id/profile", R, h(async (req) => {
  const C = cid(req), e = await db.one(`SELECT e.*, m.name manager_name FROM employees e LEFT JOIN employees m ON m.id=e.manager_id WHERE e.id=$1 AND e.company_id=$2`, [p(req).id, C], "الموظف غير موجود");
  const asOf = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const [position, balances, documents, history, leaves, runs, loans] = await Promise.all([
    employeePosition(db, C, e, asOf), x.leaveBalances(db, C, e.id), x.listDocuments(db, C, { employeeId: e.id }), x.salaryHistory(db, C, e.id), x.listLeaves(db, C, { employeeId: e.id }),
    db.rows(`SELECT id, period, status, date, line FROM (SELECT r.id, r.period, r.status, r.date, jsonb_array_elements(r.lines) line FROM payroll_runs r WHERE r.company_id=$1) q WHERE line->>'employeeId'=$2 ORDER BY period DESC LIMIT 24`, [C, e.id]),
    db.rows(`SELECT * FROM employee_loans WHERE company_id=$1 AND employee_id=$2 ORDER BY date DESC`, [C, e.id]),
  ]);
  const ib = x.ibanCheck(e.iban);
  return { employee: { ...e, gosiSchemeResolved: x.gosiScheme(e) }, position, balances, documents, history, leaves, payslips: runs.map((r: any) => ({ runId: r.id, period: r.period, status: r.status, date: r.date, ...r.line })), loans, checks: { iban: ib.ok ? null : ib.error, idNumber: e.idNumber ? null : "رقم الهوية أو الإقامة غير مسجل" } };
}));
hrx.post("/payroll/:id/approve", W, h(async (req) => { const r = await tx((t) => approveRun(t, cid(req), actor(req), p(req).id)); await audit(req, "APPROVE", "payroll", r.id); return r; }));
hrx.post("/payroll/:id/unapprove", W, h(async (req) => { const r = await tx((t) => approveRun(t, cid(req), actor(req), p(req).id, true)); await audit(req, "UNAPPROVE", "payroll", r.id); return r; }));
hrx.get("/payroll/:id/wps-check", R, h(async (req) => { const r = await db.one(`SELECT lines FROM payroll_runs WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)], "المسير غير موجود"); return { problems: x.wpsProblems(r.lines) }; }));
hrx.get("/hr/settings", R, h(async (req) => ({ requireApproval: !!req.company.accounting?.hr?.requireApproval })));
hrx.put("/hr/settings", perm("settings.write"), h(async (req) => { const v = !!req.body?.requireApproval; await db.exec(`UPDATE companies SET accounting = jsonb_set(COALESCE(accounting,'{}'::jsonb), '{hr}', COALESCE(accounting->'hr','{}'::jsonb) || $2::jsonb) WHERE id=$1`, [cid(req), JSON.stringify({ requireApproval: v })]); await audit(req, "UPDATE", "hr_settings", cid(req), { requireApproval: v }); return { requireApproval: v }; }));

// 3.53.0 employee self-service link
hrx.post("/hr/employees/:id/portal", W, h(async (req) => { const r = await tx((t) => ep.portalLink(t, cid(req), p(req).id, !!req.body?.renew)); await audit(req, "UPDATE", "employee_portal", p(req).id, { renew: !!req.body?.renew }); return r; }));
hrx.delete("/hr/employees/:id/portal", W, h(async (req) => { const r = await tx((t) => ep.revokePortal(t, cid(req), p(req).id)); await audit(req, "DELETE", "employee_portal", p(req).id); return r; }));

/** Public (no login): the employee's own link. POST so the ID digits never sit in a URL. */
export const empPortal = Router();
empPortal.post("/emp/:token", h(async (req) => ep.portalView(db, p(req).token, req.body?.pin)));
empPortal.post("/emp/:token/quote", h(async (req) => tx((t) => ep.portalQuote(t, p(req).token, req.body || {}))));
empPortal.post("/emp/:token/leave", h(async (req) => tx((t) => ep.portalRequest(t, p(req).token, req.body || {}))));
empPortal.post("/emp/:token/cancel", h(async (req) => tx((t) => ep.portalCancel(t, p(req).token, req.body || {}))));
