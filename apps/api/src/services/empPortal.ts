/**
 * 3.53.0 employee self-service: a private link per employee that opens on the phone — the payslips of posted runs,
 * the leave balance, the documents and their expiry, and a leave request that waits for the HR decision.
 * The link is a random token the establishment can withdraw; when the employee has an ID number on file the link also
 * asks for its last four digits, and five wrong tries lock the link for fifteen minutes.
 */
import { Db } from "../db/pool";
import { AppError, bad, notFound } from "../lib/core";
import { today, addDays } from "../lib/core";
import { leaveBalances, listLeaves, listDocuments, ensureLeaveTypes, quoteLeave, requestLeave } from "./hrcore";
import { employeePosition } from "./hr";

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const tries = new Map<string, { n: number; until: number; at: number }>();
/** all but the last characters hidden: at most 3 shown, and never the whole number */
const mask = (v: string) => { const keep = Math.min(3, Math.max(0, v.length - 2)); return "•".repeat(v.length - keep) + v.slice(v.length - keep); };
const pinOf = (e: any) => { const d = String(e.idNumber || "").replace(/\D/g, ""); return d.length >= 4 ? d.slice(-4) : null; };

export async function portalLink(t: Db, C: string, employeeId: string, renew = false) {
  const e = await t.one(`UPDATE employees SET portal_token = CASE WHEN $3 OR portal_token IS NULL THEN gen_random_uuid() ELSE portal_token END WHERE id=$1 AND company_id=$2 RETURNING portal_token, id_number, phone, name`, [employeeId, C, renew], "الموظف غير موجود");
  return { token: e.portalToken, path: `/e/${e.portalToken}`, pinRequired: !!pinOf(e), phone: e.phone, name: e.name };
}
export async function revokePortal(t: Db, C: string, employeeId: string) {
  await t.exec(`UPDATE employees SET portal_token=NULL WHERE id=$1 AND company_id=$2`, [employeeId, C]);
  return { ok: true };
}

/** The employee behind a link, after the ID check. */
async function employeeOf(t: Db, token: string, pin: any) {
  if (!TOKEN.test(String(token))) throw notFound("الرابط غير صالح");
  const lock = tries.get(token);
  if (lock && lock.until > Date.now()) throw new AppError(429, `أُوقف الرابط مؤقتاً بعد محاولات خاطئة — حاول بعد ${Math.ceil((lock.until - Date.now()) / 60000)} دقيقة`, "LOCKED");
  const e = await t.maybe(`SELECT * FROM employees WHERE portal_token=$1 AND is_active`, [token]);
  if (!e) throw notFound("الرابط غير صالح أو أُلغي — اطلب رابطاً جديداً من الموارد البشرية");
  const need = pinOf(e);
  if (need) {
    if (pin === undefined || pin === null || pin === "") throw new AppError(401, "اكتب آخر 4 أرقام من رقم هويتك أو إقامتك", "PIN_REQUIRED");
    if (String(pin).replace(/\D/g, "") !== need) {
      // wrong tries counted over a 15-minute window from the first one; the fifth locks the link for 15 minutes
      const now = Date.now(), s = lock && now - lock.at < 15 * 60000 ? lock : { n: 0, until: 0, at: now };
      s.n += 1; if (s.n >= 5) { s.until = now + 15 * 60000; s.n = 0; s.at = now; }
      tries.set(token, s);
      throw new AppError(401, "الأرقام غير صحيحة", "PIN_WRONG");
    }
    tries.delete(token);
  }
  return e;
}

export async function portalView(t: Db, token: string, pin: any) {
  const e = await employeeOf(t, token, pin), C = e.companyId;
  const company = await t.one(`SELECT name_ar, name_en, logo, phone, email FROM companies WHERE id=$1`, [C]);
  const asOf = today();
  const [position, balances, leaves, documents, runs, types] = await Promise.all([
    employeePosition(t, C, e, asOf), leaveBalances(t, C, e.id), listLeaves(t, C, { employeeId: e.id }), listDocuments(t, C, { employeeId: e.id }),
    t.rows(`SELECT period, date, status, line FROM (SELECT r.period, r.date, r.status, jsonb_array_elements(r.lines) line FROM payroll_runs r WHERE r.company_id=$1 AND r.status IN ('POSTED','PAID')) q WHERE line->>'employeeId'=$2 ORDER BY period DESC LIMIT 12`, [C, e.id]),
    ensureLeaveTypes(t, C),
  ]);
  return {
    company: { nameAr: company.nameAr, nameEn: company.nameEn, logo: company.logo, phone: company.phone, email: company.email },
    employee: { name: e.name, code: e.code, jobTitle: e.jobTitle, department: e.department, hireDate: e.hireDate, contractType: e.contractType, contractEnd: e.contractEnd, ibanTail: e.iban ? String(e.iban).replace(/\s/g, "").slice(-4) : null },
    service: { years: position?.yearsExact ?? position?.years, eosbDue: position?.eosbDue },
    balances,
    leaves: leaves.slice(0, 20).map((l: any) => ({ id: l.id, typeName: l.typeName, fromDate: l.fromDate, toDate: l.toDate, days: l.days, status: l.status, reason: l.reason, decisionNote: l.decisionNote })),
    documents: documents.map((d: any) => ({ kind: d.kind, kindAr: d.kindAr, number: d.number ? mask(String(d.number)) : null, expiryDate: d.expiryDate, daysLeft: d.daysLeft, state: d.state })),
    payslips: runs.map((r: any) => { const l = r.line; return { period: r.period, date: r.date, basic: l.basic, housing: l.housing, transport: l.transport, other: l.other, bonus: l.bonus, overtime: l.overtime, gross: l.gross, gosiEmp: l.gosiEmp, deduction: l.deduction, absence: l.absence, loan: l.loan, salaryTax: l.salaryTax, martyrs: l.martyrs, net: l.net, leaveDeduction: l.leaveDeduction ? { days: l.leaveDeduction.days, amount: l.leaveDeduction.amount } : null }; }),
    leaveTypes: types.filter((x: any) => x.isActive && (x.gender === "ANY" || !e.gender || x.gender === e.gender)).map((x: any) => ({ id: x.id, code: x.code, name: x.name, note: x.note, needsDocument: x.needsDocument })),
  };
}

const leaveBody = (e: any, b: any) => {
  if (!b || !b.typeId) throw bad("اختر نوع الإجازة");
  if (b.fromDate && b.fromDate < addDays(today(), -60)) throw bad("لا يُطلب من الرابط إجازة مضى عليها أكثر من 60 يوماً — راجع الموارد البشرية");
  return { employeeId: e.id, typeId: String(b.typeId), fromDate: b.fromDate, toDate: b.toDate, reason: b.reason ? String(b.reason).slice(0, 300) : null };
};
export async function portalQuote(t: Db, token: string, b: any) {
  const e = await employeeOf(t, token, b?.pin);
  const q = await quoteLeave(t, e.companyId, leaveBody(e, b));
  return { days: q.days, pay: q.pay, unpaidDays: q.unpaidDays, balance: q.balance, warnings: q.warnings, type: { name: q.type.name } };
}
export async function portalRequest(t: Db, token: string, b: any) {
  const e = await employeeOf(t, token, b?.pin);
  const pending = await t.one(`SELECT COUNT(*)::int c FROM employee_leaves WHERE company_id=$1 AND employee_id=$2 AND status='PENDING'`, [e.companyId, e.id]);
  if (pending.c >= 5) throw bad("لديك 5 طلبات بانتظار القرار — انتظر الرد عليها");
  const l = await requestLeave(t, e.companyId, `${e.name} (بوابة الموظف)`, leaveBody(e, b));
  await t.exec(`UPDATE employee_leaves SET via='PORTAL' WHERE id=$1`, [l.id]);
  return { id: l.id, status: l.status };
}
export async function portalCancel(t: Db, token: string, b: any) {
  const e = await employeeOf(t, token, b?.pin);
  if (!TOKEN.test(String(b?.id || ""))) throw bad("الطلب غير موجود");
  const r = await t.maybe(`UPDATE employee_leaves SET status='CANCELLED', decided_by=$3, decided_at=now() WHERE id=$1 AND employee_id=$2 AND status='PENDING' RETURNING id`, [String(b?.id || ""), e.id, `${e.name} (بوابة الموظف)`]);
  if (!r) throw bad("يُلغى من الرابط فقط طلب لم يُقرَّر بعد");
  return { ok: true };
}
