/** Round 5 routes: HR (leaves, loans, provisions, settlements), budgets, comparative & cost-center reports. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h, req as need, isDate, today, monthEnd } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import * as hr from "../services/hr";
import * as bud from "../services/budgets";
import { incomeStatementCompare, costCenterPnl, accountantAlerts } from "../services/reports";

export const r5 = Router();
r5.use(authenticate);

// ── HR: positions, leaves, loans ──────────────────────────────────────────
r5.get("/hr/positions", perm("accounting.read"), h(async (req) => {
  const asOf = isDate(req.query.asOf) ? String(req.query.asOf) : today();
  const emps = await db.rows(`SELECT * FROM employees WHERE company_id=$1 AND is_active ORDER BY code`, [cid(req)]);
  const rows: any[] = [];
  for (const e of emps) rows.push(await hr.employeePosition(db, cid(req), e, asOf));
  return { asOf, rows, reasons: hr.SETTLEMENT_REASONS };
}));
r5.get("/hr/leaves", perm("accounting.read"), h(async (req) => db.rows(`SELECT l.*, e.name AS employee_name, e.code AS employee_code FROM employee_leaves l JOIN employees e ON e.id=l.employee_id WHERE l.company_id=$1 ${req.query.employeeId ? "AND l.employee_id=$2" : ""} ORDER BY l.from_date DESC LIMIT 500`, req.query.employeeId ? [cid(req), req.query.employeeId] : [cid(req)])));
r5.post("/hr/leaves", perm("accounting.write"), h(async (req) => { const r = await tx((t) => hr.addLeave(t, cid(req), actor(req), req.body || {})); await audit(req, "CREATE", "leave", r.id, { employeeId: r.employeeId, days: r.days }); return r; }));
r5.delete("/hr/leaves/:id", perm("accounting.write"), h(async (req) => { await db.exec(`DELETE FROM employee_leaves WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]); return { ok: true }; }));

r5.get("/hr/loans", perm("accounting.read"), h(async (req) => db.rows(`SELECT l.*, e.name AS employee_name, e.code AS employee_code, j.number AS journal_number FROM employee_loans l JOIN employees e ON e.id=l.employee_id LEFT JOIN journal_entries j ON j.id=l.journal_id WHERE l.company_id=$1 ORDER BY l.status='ACTIVE' DESC, l.date DESC`, [cid(req)])));
r5.post("/hr/loans", perm("payments.write"), h(async (req) => { const r = await tx((t) => hr.createLoan(t, cid(req), actor(req), req.body || {})); await audit(req, "CREATE", "loan", r.id, { number: r.number, amount: r.amount }); return r; }));
r5.post("/hr/loans/:id/cancel", perm("payments.write"), h(async (req) => { const r = await tx((t) => hr.cancelLoan(t, cid(req), actor(req), p(req).id)); await audit(req, "CANCEL", "loan", p(req).id); return r; }));

// ── HR: monthly provisions ────────────────────────────────────────────────
r5.get("/hr/provisions", perm("accounting.read"), h(async (req) => db.rows(`SELECT r.*, j.number AS journal_number FROM hr_provisions r LEFT JOIN journal_entries j ON j.id=r.journal_id WHERE r.company_id=$1 ORDER BY r.period DESC`, [cid(req)])));
r5.get("/hr/provisions/preview", perm("accounting.read"), h(async (req) => hr.previewProvision(db, cid(req), String(req.query.period || today().slice(0, 7)))));
r5.post("/hr/provisions", perm("accounting.write"), h(async (req) => { const r = await tx((t) => hr.createProvision(t, cid(req), actor(req), req.body || {})); await audit(req, "CREATE", "hr_provision", r.id, { period: r.period }); return r; }));
r5.post("/hr/provisions/:id/post", perm("accounting.write"), h(async (req) => { const r = await tx((t) => hr.postProvision(t, cid(req), actor(req), p(req).id)); await audit(req, "POST", "hr_provision", p(req).id); return r; }));
r5.delete("/hr/provisions/:id", perm("accounting.write"), h(async (req) => { await tx((t) => hr.deleteProvision(t, cid(req), p(req).id)); return { ok: true }; }));

// ── HR: final settlements ─────────────────────────────────────────────────
r5.get("/hr/settlements", perm("accounting.read"), h(async (req) => db.rows(`SELECT s.*, e.name AS employee_name, e.code AS employee_code, j.number AS journal_number FROM employee_settlements s JOIN employees e ON e.id=s.employee_id LEFT JOIN journal_entries j ON j.id=s.journal_id WHERE s.company_id=$1 ORDER BY s.date DESC`, [cid(req)])));
r5.post("/hr/settlements/compute", perm("accounting.read"), h(async (req) => hr.computeSettlement(db, cid(req), req.body || {})));
r5.post("/hr/settlements", perm("accounting.write"), h(async (req) => { const r = await tx((t) => hr.createSettlement(t, cid(req), actor(req), req.body || {})); await audit(req, "CREATE", "settlement", r.id, { number: r.number, net: r.net }); return r; }));
r5.post("/hr/settlements/:id/post", perm("accounting.write"), h(async (req) => { const r = await tx((t) => hr.postSettlement(t, cid(req), actor(req), p(req).id)); await audit(req, "POST", "settlement", p(req).id); return r; }));
r5.post("/hr/settlements/:id/pay", perm("payments.write"), h(async (req) => { const r = await tx((t) => hr.paySettlement(t, cid(req), actor(req), p(req).id, String(need(req.body, "accountId", "حساب الصرف")), req.body.date)); await audit(req, "PAY", "settlement", p(req).id); return r; }));
r5.delete("/hr/settlements/:id", perm("accounting.write"), h(async (req) => { await tx((t) => hr.deleteSettlement(t, cid(req), p(req).id)); return { ok: true }; }));

// ── budgets ───────────────────────────────────────────────────────────────
r5.get("/budgets", perm("reports.read"), h(async (req) => bud.listBudgets(db, cid(req))));
r5.get("/budgets/:id", perm("reports.read"), h(async (req) => bud.getBudget(db, cid(req), p(req).id)));
r5.post("/budgets", perm("accounting.write"), h(async (req) => { const r = await tx((t) => bud.createBudget(t, cid(req), actor(req), req.body || {})); await audit(req, "CREATE", "budget", r.id, { name: r.name, year: r.year }); return r; }));
r5.put("/budgets/:id/lines", perm("accounting.write"), h(async (req) => tx((t) => bud.saveLines(t, cid(req), p(req).id, req.body?.lines))));
r5.post("/budgets/:id/fill", perm("accounting.write"), h(async (req) => tx(async (t) => { const b = await t.one(`SELECT * FROM budgets WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)], "الموازنة غير موجودة"); if (b.status !== "DRAFT") throw new Error("الموازنة معتمدة"); await bud.fillFromActuals(t, cid(req), b.id, Number(req.body?.sourceYear) || b.year - 1, Number(req.body?.growthPct) || 0); return bud.getBudget(t, cid(req), b.id); })));
r5.post("/budgets/:id/status", perm("accounting.write"), h(async (req) => bud.setStatus(db, cid(req), p(req).id, String(req.body?.status))));
r5.delete("/budgets/:id", perm("accounting.write"), h(async (req) => { await bud.deleteBudget(db, cid(req), p(req).id); return { ok: true }; }));
r5.get("/reports/budget/:id", perm("reports.read"), h(async (req) => bud.budgetVsActual(db, cid(req), p(req).id, req.query)));

// ── reports ───────────────────────────────────────────────────────────────
r5.get("/reports/income-compare", perm("reports.read"), h(async (req) => incomeStatementCompare(db, cid(req), req.query)));
r5.get("/reports/cost-centers", perm("reports.read"), h(async (req) => costCenterPnl(db, cid(req), req.query)));
r5.get("/alerts", perm("dashboard.read"), h(async (req) => accountantAlerts(db, cid(req), today())));
r5.get("/hr/employees/:id/statement", perm("accounting.read"), h(async (req) => {
  const e = await db.one(`SELECT * FROM employees WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)], "الموظف غير موجود");
  const asOf = isDate(req.query.asOf) ? String(req.query.asOf) : monthEnd(today());
  return {
    employee: e, position: await hr.employeePosition(db, cid(req), e, asOf),
    ledger: await db.rows(`SELECT * FROM employee_provision_ledger WHERE company_id=$1 AND employee_id=$2 ORDER BY date, created_at`, [cid(req), e.id]),
    leaves: await db.rows(`SELECT * FROM employee_leaves WHERE company_id=$1 AND employee_id=$2 ORDER BY from_date DESC`, [cid(req), e.id]),
    loans: await db.rows(`SELECT * FROM employee_loans WHERE company_id=$1 AND employee_id=$2 ORDER BY date DESC`, [cid(req), e.id]),
    payslips: await db.rows(`SELECT r.period, r.date, r.status, l.* FROM payroll_runs r, jsonb_to_recordset(r.lines) AS l("employeeId" text, gross numeric, "gosiEmp" numeric, deduction numeric, absence numeric, loan numeric, net numeric) WHERE r.company_id=$1 AND l."employeeId"=$2 AND r.status<>'DRAFT' ORDER BY r.period DESC`, [cid(req), e.id]),
  };
}));
