/** Round 4 routes: employees & payroll. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h, bad, req as need, num, isDate, r2, today } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import { createRun, postRun, payRun, deleteRun, wpsCsv, computeLine, GOSI, buildLines } from "../services/payroll";
import { payrollEmployees, ibanCheck } from "../services/hrcore";
import { IS_EG } from "../lib/country";
import { computeLineEG } from "../services/egypt";
import { loanInstallments } from "../services/hr";

export const r4 = Router();
r4.use(authenticate);

r4.get("/employees", perm("hr.read"), h(async (req) => db.rows(`SELECT * FROM employees WHERE company_id=$1 ORDER BY is_active DESC, code`, [cid(req)])));
const NATS = IS_EG ? ["EGYPTIAN", "FOREIGN"] : ["SAUDI", "NON_SAUDI"];
const dOrNull = (v: any) => (v === "" || v === null ? null : isDate(v) ? v : undefined);
const tOrNull = (v: any, max = 120) => (v === undefined ? undefined : v === null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));
/** The employee file: identity, contract, GOSI registration and pay. An IBAN or ID typed in is checked before it is kept. */
function employeeFields(b: any, prev?: any) {
  const f: any = {
    code: tOrNull(b.code, 20) ?? undefined, name: b.name === undefined ? undefined : String(b.name).trim(), jobTitle: tOrNull(b.jobTitle), department: tOrNull(b.department),
    nationality: b.nationality === undefined ? undefined : NATS.includes(b.nationality) ? b.nationality : prev ? undefined : NATS[0],
    hireDate: dOrNull(b.hireDate), birthDate: dOrNull(b.birthDate), iban: b.iban === undefined ? undefined : String(b.iban || "").replace(/\s+/g, "").toUpperCase() || null, bankName: tOrNull(b.bankName),
    basic: b.basic === undefined ? undefined : num(b.basic), housing: b.housing === undefined ? undefined : num(b.housing), transport: b.transport === undefined ? undefined : num(b.transport), otherAllow: b.otherAllow === undefined ? undefined : num(b.otherAllow),
    gosi: b.gosi === undefined ? undefined : !!b.gosi, isActive: b.isActive === undefined ? undefined : !!b.isActive, costCenterId: b.costCenterId === undefined ? undefined : b.costCenterId || null,
    leaveDaysPerYear: b.leaveDaysPerYear === undefined ? undefined : Math.max(21, Math.round(num(b.leaveDaysPerYear) || 21)), leaveOpening: b.leaveOpening === undefined ? undefined : num(b.leaveOpening), leaveBalanceDate: dOrNull(b.leaveBalanceDate),
    idType: b.idType === undefined ? undefined : ["NATIONAL_ID", "IQAMA", "PASSPORT", "BORDER"].includes(b.idType) ? b.idType : null, idNumber: tOrNull(b.idNumber, 30),
    gender: b.gender === undefined ? undefined : ["M", "F"].includes(b.gender) ? b.gender : null, phone: tOrNull(b.phone, 30), email: tOrNull(b.email, 120), country: tOrNull(b.country, 60),
    contractType: b.contractType === undefined ? undefined : ["INDEFINITE", "FIXED", "PART_TIME"].includes(b.contractType) ? b.contractType : null, contractEnd: dOrNull(b.contractEnd), probationEnd: dOrNull(b.probationEnd),
    gosiRegDate: dOrNull(b.gosiRegDate), gosiScheme: b.gosiScheme === undefined ? undefined : ["OLD", "NEW"].includes(b.gosiScheme) ? b.gosiScheme : null, gosiNumber: tOrNull(b.gosiNumber, 30),
    managerId: b.managerId === undefined ? undefined : /^[0-9a-f-]{36}$/i.test(String(b.managerId || "")) ? b.managerId : null, workLocation: tOrNull(b.workLocation), notes: tOrNull(b.notes, 1000),
  };
  if (f.name !== undefined && !f.name) throw bad("اسم الموظف مطلوب");
  for (const k of ["basic", "housing", "transport", "otherAllow"]) if (f[k] !== undefined && f[k] < 0) throw bad("المبالغ لا تكون سالبة");
  if (f.iban && f.iban !== prev?.iban) { const c = ibanCheck(f.iban); if (!c.ok) throw bad(`IBAN: ${c.error}`); }
  if (f.idNumber && f.idNumber !== prev?.idNumber && !IS_EG && ["NATIONAL_ID", "IQAMA"].includes(f.idType ?? prev?.idType) && !/^[12]\d{9}$/.test(f.idNumber)) throw bad("رقم الهوية أو الإقامة 10 أرقام يبدأ بـ 1 (مواطن) أو 2 (مقيم)");
  if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) throw bad("البريد الإلكتروني غير صحيح");
  if (f.hireDate && f.contractEnd && f.contractEnd < f.hireDate) throw bad("نهاية العقد قبل تاريخ التعيين");
  for (const k of Object.keys(f)) if (f[k] === undefined) delete f[k];
  return f;
}
r4.post("/employees", perm("hr.write"), h(async (req) => {
  const b = req.body || {};
  need(b, "name", "اسم الموظف");
  const f = employeeFields(b);
  const seq = await db.one(`INSERT INTO sequences(company_id, key, next) VALUES ($1,'CODE-E',2) ON CONFLICT (company_id, key) DO UPDATE SET next=sequences.next+1 RETURNING next-1 AS n`, [cid(req)]);
  const row = await db.insert("employees", { companyId: cid(req), gosi: true, leaveDaysPerYear: 21, ...f, code: f.code || `E-${String(seq.n).padStart(4, "0")}`, basic: f.basic || 0, housing: f.housing || 0, transport: f.transport || 0, otherAllow: f.otherAllow || 0 });
  await audit(req, "CREATE", "employee", row.id, { name: row.name });
  return row;
}));
r4.put("/employees/:id", perm("hr.write"), h(async (req) => {
  const prev = await db.one(`SELECT * FROM employees WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)], "الموظف غير موجود");
  return db.update("employees", { id: p(req).id, companyId: cid(req) }, employeeFields(req.body || {}, prev));
}));
r4.delete("/employees/:id", perm("hr.write"), h(async (req) => { await db.one(`SELECT id FROM employees WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)], "الموظف غير موجود"); await db.exec(`UPDATE employees SET is_active=false WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]); return { ok: true }; }));

r4.get("/payroll", perm("hr.read"), h(async (req) => ({ runs: await db.rows(`SELECT r.*, e.number AS journal_number FROM payroll_runs r LEFT JOIN journal_entries e ON e.id=r.journal_id WHERE r.company_id=$1 ORDER BY r.period DESC`, [cid(req)]), gosi: GOSI })));
r4.get("/payroll/preview", perm("hr.read"), h(async (req) => {
  const period = /^\d{4}-\d{2}$/.test(String(req.query.period || "")) ? String(req.query.period) : today().slice(0, 7);
  return buildLines(db, cid(req), period, await payrollEmployees(db, cid(req), period), {});
}));
r4.post("/payroll", perm("hr.write"), h(async (req) => { const r = await tx((t) => createRun(t, cid(req), actor(req), req.body)); await audit(req, "CREATE", "payroll", r.id, { period: r.period, net: r.totalNet }); return r; }));
r4.post("/payroll/:id/post", perm("accounting.write"), h(async (req) => { const r = await tx((t) => postRun(t, cid(req), actor(req), p(req).id)); await audit(req, "POST", "payroll", r.id); return r; }));
r4.post("/payroll/:id/pay", perm("payments.write"), h(async (req) => { const r = await tx((t) => payRun(t, cid(req), actor(req), p(req).id, String(need(req.body, "accountId", "حساب البنك")), req.body.date)); await audit(req, "PAY", "payroll", r.id); return r; }));
r4.delete("/payroll/:id", perm("hr.write"), h(async (req) => { await tx((t) => deleteRun(t, cid(req), p(req).id)); return { ok: true }; }));
r4.get("/payroll/:id/wps.csv", perm("hr.read"), h(async (req, res) => {
  const run = await db.one(`SELECT * FROM payroll_runs WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="WPS-${run.period}.csv"`);
  res.send(wpsCsv(req.company, run));
}));
