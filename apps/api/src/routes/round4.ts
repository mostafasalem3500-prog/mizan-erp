/** Round 4 routes: employees & payroll. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h, bad, req as need, num, isDate, r2 } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import { createRun, postRun, payRun, deleteRun, wpsCsv, computeLine, GOSI } from "../services/payroll";

export const r4 = Router();
r4.use(authenticate);

r4.get("/employees", perm("accounting.read"), h(async (req) => db.rows(`SELECT * FROM employees WHERE company_id=$1 ORDER BY is_active DESC, code`, [cid(req)])));
r4.post("/employees", perm("accounting.write"), h(async (req) => {
  const b = req.body || {};
  const name = String(need(b, "name", "اسم الموظف")).trim();
  const seq = await db.one(`INSERT INTO sequences(company_id, key, next) VALUES ($1,'CODE-E',2) ON CONFLICT (company_id, key) DO UPDATE SET next=sequences.next+1 RETURNING next-1 AS n`, [cid(req)]);
  const row = await db.insert("employees", { companyId: cid(req), code: b.code?.trim() || `E-${String(seq.n).padStart(4, "0")}`, name, jobTitle: b.jobTitle || null, department: b.department || null, nationality: b.nationality === "NON_SAUDI" ? "NON_SAUDI" : "SAUDI", hireDate: isDate(b.hireDate) ? b.hireDate : null, iban: b.iban || null, bankName: b.bankName || null, basic: num(b.basic), housing: num(b.housing), transport: num(b.transport), otherAllow: num(b.otherAllow), gosi: b.gosi !== false, costCenterId: b.costCenterId || null });
  await audit(req, "CREATE", "employee", row.id, { name });
  return row;
}));
r4.put("/employees/:id", perm("accounting.write"), h(async (req) => {
  const b = req.body || {};
  return db.update("employees", { id: p(req).id, companyId: cid(req) }, { code: b.code, name: b.name, jobTitle: b.jobTitle, department: b.department, nationality: b.nationality, hireDate: b.hireDate === "" ? null : b.hireDate, iban: b.iban, bankName: b.bankName, basic: b.basic === undefined ? undefined : num(b.basic), housing: b.housing === undefined ? undefined : num(b.housing), transport: b.transport === undefined ? undefined : num(b.transport), otherAllow: b.otherAllow === undefined ? undefined : num(b.otherAllow), gosi: b.gosi, isActive: b.isActive, costCenterId: b.costCenterId });
}));
r4.delete("/employees/:id", perm("accounting.write"), h(async (req) => { await db.exec(`UPDATE employees SET is_active=false WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]); return { ok: true }; }));

r4.get("/payroll", perm("accounting.read"), h(async (req) => ({ runs: await db.rows(`SELECT r.*, e.number AS journal_number FROM payroll_runs r LEFT JOIN journal_entries e ON e.id=r.journal_id WHERE r.company_id=$1 ORDER BY r.period DESC`, [cid(req)]), gosi: GOSI })));
r4.get("/payroll/preview", perm("accounting.read"), h(async (req) => {
  const emps = await db.rows(`SELECT * FROM employees WHERE company_id=$1 AND is_active ORDER BY code`, [cid(req)]);
  return emps.map((e) => computeLine(e));
}));
r4.post("/payroll", perm("accounting.write"), h(async (req) => { const r = await tx((t) => createRun(t, cid(req), actor(req), req.body)); await audit(req, "CREATE", "payroll", r.id, { period: r.period, net: r.totalNet }); return r; }));
r4.post("/payroll/:id/post", perm("accounting.write"), h(async (req) => { const r = await tx((t) => postRun(t, cid(req), actor(req), p(req).id)); await audit(req, "POST", "payroll", r.id); return r; }));
r4.post("/payroll/:id/pay", perm("payments.write"), h(async (req) => { const r = await tx((t) => payRun(t, cid(req), actor(req), p(req).id, String(need(req.body, "accountId", "حساب البنك")), req.body.date)); await audit(req, "PAY", "payroll", r.id); return r; }));
r4.delete("/payroll/:id", perm("accounting.write"), h(async (req) => { await tx((t) => deleteRun(t, cid(req), p(req).id)); return { ok: true }; }));
r4.get("/payroll/:id/wps.csv", perm("accounting.read"), h(async (req, res) => {
  const run = await db.one(`SELECT * FROM payroll_runs WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="WPS-${run.period}.csv"`);
  res.send(wpsCsv(req.company, run));
}));
