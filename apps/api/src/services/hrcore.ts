/**
 * 3.52.0 — Human resources: the parts a full HR system adds on top of payroll accounting.
 *
 *  • GOSI by scheme: rates live in an effective-dated table (old scheme / the new law for first registrations from
 *    3 July 2024, whose pension branch steps up each July), per nationality and branch, with the wage cap. Nothing is
 *    hard-coded in the payroll: a new rate is a new row with the date it starts.
 *  • Leave: types with what they pay (sick leave in tiers over a rolling year, art. 117), how long, for whom; requests
 *    that wait for approval; the annual balance; the unpaid part of a leave becomes a payroll deduction.
 *  • Documents with expiry (iqama, passport, work permit, insurance…) and the alerts before they lapse.
 *  • Salary changes with an effective date and their history; future ones applied by the scheduler on the day.
 *  • Payroll proration for joiners and leavers, IBAN check (ISO 13616 mod 97) for the WPS file, the HR dashboard.
 */
import { Db } from "../db/pool";
import { AppError, bad, conflict, r2, r3, num, isDate, today, addDays, monthEnd, addMonths } from "../lib/core";
import { IS_EG } from "../lib/country";
import { leaveAccruedDays, leaveTakenDays } from "./hr";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uid = (x: any) => (UUID.test(String(x || "")) ? String(x) : null);
const iso = (d: any) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);
const txt = (x: any, max = 300) => (x === undefined || x === null || String(x).trim() === "" ? null : String(x).trim().slice(0, max));
const n = (x: any) => Number(x || 0);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);

// ───────────────────────── IBAN ─────────────────────────
/** ISO 13616: move the first four characters to the end, letters to numbers, remainder mod 97 must be 1. Saudi: SA + 22 digits. */
export function ibanCheck(raw: any): { ok: boolean; iban: string; error?: string } {
  const iban = String(raw || "").replace(/\s+/g, "").toUpperCase();
  if (!iban) return { ok: false, iban, error: "لا يوجد IBAN" };
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return { ok: false, iban, error: "صيغة IBAN غير صحيحة" };
  if (iban.startsWith("SA") && !/^SA\d{22}$/.test(iban)) return { ok: false, iban, error: "IBAN السعودي: SA ثم 22 رقماً" };
  if (iban.startsWith("EG") && iban.length !== 29) return { ok: false, iban, error: "IBAN المصري 29 خانة" };
  const s = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0; for (const ch of s) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1 ? { ok: true, iban } : { ok: false, iban, error: "رقم IBAN غير صحيح (خانات التحقق لا تطابق)" };
}
/** A valid IBAN from a country and the account part (for sample data). */
export function makeIban(country: string, bban: string) {
  const s = (bban + country + "00").replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0; for (const ch of s) rem = (rem * 10 + Number(ch)) % 97;
  return country + String(98 - rem).padStart(2, "0") + bban;
}

// ───────────────────────── GOSI ─────────────────────────
export const NEW_LAW_FROM = "2024-07-03";
export const BRANCH_AR: Record<string, string> = { PENSION: "المعاشات", SANED: "ساند (التعطل عن العمل)", HAZARD: "الأخطار المهنية" };
/** Which GOSI scheme an employee is on: stated, or by the first registration date (or the hire date when none). */
export function gosiScheme(e: any): "OLD" | "NEW" {
  if (e.gosiScheme === "OLD" || e.gosiScheme === "NEW") return e.gosiScheme;
  const reg = iso(e.gosiRegDate) || iso(e.hireDate);
  return reg && reg >= NEW_LAW_FROM ? "NEW" : "OLD";
}
export type GosiTable = { rate: (e: any) => { scheme: string; employee: number; employer: number; branches: { branch: string; employee: number; employer: number }[] }; maxBase: number; minBase: number; asOf: string };
/** The rates in force on a day (an establishment's own rows win over the published ones from their date). */
export async function gosiTable(t: Db, C: string, asOf: string): Promise<GosiTable> {
  const rows = await t.rows(`SELECT * FROM hr_gosi_rates WHERE (company_id IS NULL OR company_id=$1) AND effective_from <= $2 ORDER BY effective_from, company_id NULLS FIRST, created_at`, [C, asOf]);
  const cur = new Map<string, any>(); for (const r of rows) cur.set(`${r.scheme}|${r.nationality}|${r.branch}`, r);
  const lim = await t.maybe(`SELECT * FROM hr_gosi_limits WHERE (company_id IS NULL OR company_id=$1) AND effective_from <= $2 ORDER BY effective_from DESC, company_id NULLS LAST LIMIT 1`, [C, asOf]);
  return {
    asOf, maxBase: lim ? n(lim.maxBase) : 45000, minBase: lim ? n(lim.minBase) : 0,
    rate: (e: any) => {
      const scheme = gosiScheme(e), nat = e.nationality === "SAUDI" ? "SAUDI" : "NON_SAUDI";
      const branches = ["PENSION", "SANED", "HAZARD"].map((b) => cur.get(`${scheme}|${nat}|${b}`)).filter(Boolean).map((r: any) => ({ branch: r.branch, employee: n(r.employeePct) / 100, employer: n(r.employerPct) / 100 }));
      return { scheme, employee: branches.reduce((a, b) => a + b.employee, 0), employer: branches.reduce((a, b) => a + b.employer, 0), branches };
    },
  };
}
export async function listGosiRates(t: Db, C: string) {
  const rows = await t.rows(`SELECT * FROM hr_gosi_rates WHERE company_id IS NULL OR company_id=$1 ORDER BY scheme, nationality, branch, effective_from`, [C]);
  const limits = await t.rows(`SELECT * FROM hr_gosi_limits WHERE company_id IS NULL OR company_id=$1 ORDER BY effective_from`, [C]);
  const td = today(), T = await gosiTable(t, C, td);
  const now = ["OLD", "NEW"].flatMap((scheme) => ["SAUDI", "NON_SAUDI"].map((nationality) => { const r = T.rate({ gosiScheme: scheme, nationality }); return { scheme, nationality, employee: r3(r.employee * 100), employer: r3(r.employer * 100), branches: r.branches.map((b) => ({ ...b, employee: r3(b.employee * 100), employer: r3(b.employer * 100) })) }; }));
  return { rates: rows.map((r: any) => ({ ...r, effectiveFrom: iso(r.effectiveFrom), employeePct: n(r.employeePct), employerPct: n(r.employerPct), own: !!r.companyId })), limits: limits.map((l: any) => ({ ...l, effectiveFrom: iso(l.effectiveFrom), minBase: n(l.minBase), maxBase: n(l.maxBase), own: !!l.companyId })), now, maxBase: T.maxBase, newLawFrom: NEW_LAW_FROM };
}
export async function addGosiRate(t: Db, C: string, b: any) {
  if (!["OLD", "NEW"].includes(b.scheme)) throw bad("اختر النظام (السابق أو الجديد)");
  if (!["SAUDI", "NON_SAUDI"].includes(b.nationality)) throw bad("اختر الجنسية");
  if (!["PENSION", "SANED", "HAZARD"].includes(b.branch)) throw bad("اختر فرع التأمين");
  if (!isDate(b.effectiveFrom)) throw bad("تاريخ السريان مطلوب");
  const e = num(b.employeePct), r = num(b.employerPct);
  if (e < 0 || r < 0 || e > 30 || r > 30) throw bad("النسبة بين 0 و30%");
  return t.insert("hr_gosi_rates", { companyId: C, scheme: b.scheme, nationality: b.nationality, branch: b.branch, employeePct: e, employerPct: r, effectiveFrom: b.effectiveFrom, note: txt(b.note, 200) });
}
export async function addGosiLimit(t: Db, C: string, b: any) {
  if (!isDate(b.effectiveFrom)) throw bad("تاريخ السريان مطلوب");
  const mx = num(b.maxBase), mn = num(b.minBase);
  if (!(mx > 0) || mn < 0 || mn > mx) throw bad("الحد الأعلى أكبر من صفر والحد الأدنى بينه وبين الصفر");
  return t.insert("hr_gosi_limits", { companyId: C, minBase: mn, maxBase: mx, effectiveFrom: b.effectiveFrom, note: txt(b.note, 200) });
}
export async function deleteOwnGosiRow(t: Db, C: string, kind: string, id: string) {
  const tbl = kind === "limit" ? "hr_gosi_limits" : "hr_gosi_rates";
  const r = await t.maybe(`DELETE FROM ${tbl} WHERE id=$1 AND company_id=$2 RETURNING id`, [uid(id), C]);
  if (!r) throw bad("يُحذف فقط ما أضافته المنشأة");
  return { ok: true };
}

// ───────────────────────── leave types ─────────────────────────
type LT = { code: string; name: string; kind: string; maxDays: number | null; per: string; tiers?: any[]; paidPct: number; gender?: string; minServiceMonths?: number; needsDocument?: boolean; usesBalance?: boolean; note?: string };
// Saudi Labour Law as amended (in force 19 Feb 2025): verify against hrsd.gov.sa before relying on the numbers
const SA_TYPES: LT[] = [
  { code: "ANNUAL", name: "إجازة سنوية", kind: "ANNUAL", maxDays: null, per: "YEAR", paidPct: 100, usesBalance: true, note: "21 يوماً، و30 بعد خمس سنوات خدمة (م 109)" },
  { code: "SICK", name: "إجازة مرضية", kind: "SICK", maxDays: 120, per: "YEAR", paidPct: 100, tiers: [{ days: 30, pct: 100 }, { days: 60, pct: 75 }, { days: 30, pct: 0 }], needsDocument: true, note: "30 يوماً بأجر كامل ثم 60 بثلاثة أرباعه ثم 30 بلا أجر خلال سنة (م 117)" },
  { code: "MATERNITY", name: "إجازة وضع", kind: "MATERNITY", maxDays: 84, per: "OCCURRENCE", paidPct: 100, gender: "F", needsDocument: true, note: "12 أسبوعاً بأجر كامل (م 151 بعد التعديل)" },
  { code: "PATERNITY", name: "إجازة مولود", kind: "PATERNITY", maxDays: 3, per: "OCCURRENCE", paidPct: 100, gender: "M", note: "3 أيام (م 113)" },
  { code: "MARRIAGE", name: "إجازة زواج", kind: "MARRIAGE", maxDays: 5, per: "OCCURRENCE", paidPct: 100, note: "5 أيام (م 113)" },
  { code: "BEREAVEMENT", name: "إجازة وفاة (زوج، أصل، فرع)", kind: "BEREAVEMENT", maxDays: 5, per: "OCCURRENCE", paidPct: 100, note: "5 أيام (م 113)" },
  { code: "BEREAVEMENT_SIBLING", name: "إجازة وفاة أخ أو أخت", kind: "BEREAVEMENT", maxDays: 3, per: "OCCURRENCE", paidPct: 100, note: "3 أيام (التعديل)" },
  { code: "IDDAH", name: "إجازة عدة", kind: "IDDAH", maxDays: 130, per: "OCCURRENCE", paidPct: 100, gender: "F", note: "4 أشهر و10 أيام للمسلمة، و15 يوماً لغيرها (م 160)" },
  { code: "HAJJ", name: "إجازة حج", kind: "HAJJ", maxDays: 15, per: "SERVICE", paidPct: 100, minServiceMonths: 24, note: "10–15 يوماً مرة واحدة بعد سنتين خدمة (م 114)" },
  { code: "EXAM", name: "إجازة امتحان", kind: "EXAM", maxDays: null, per: "OCCURRENCE", paidPct: 100, needsDocument: true, note: "أيام الامتحان الفعلية (م 115)" },
  { code: "UNPAID", name: "إجازة بدون أجر", kind: "UNPAID", maxDays: null, per: "OCCURRENCE", paidPct: 0, note: "بالاتفاق مع صاحب العمل (م 116)" },
];
// Egypt (Labour Law 14/2025): verify against the law and the social insurance rules before relying on the numbers
const EG_TYPES: LT[] = [
  { code: "ANNUAL", name: "إجازة سنوية", kind: "ANNUAL", maxDays: null, per: "YEAR", paidPct: 100, usesBalance: true, note: "15 يوماً في السنة الأولى، 21 بعدها، 30 بعد عشر سنوات أو سن الخمسين" },
  { code: "SICK", name: "إجازة مرضية", kind: "SICK", maxDays: 180, per: "YEAR", paidPct: 75, needsDocument: true, note: "تعويض الأجر من التأمينات حسب القانون — راجع النسبة المطبقة" },
  { code: "MATERNITY", name: "إجازة وضع", kind: "MATERNITY", maxDays: 120, per: "OCCURRENCE", paidPct: 100, gender: "F", needsDocument: true, note: "أربعة أشهر" },
  { code: "HAJJ", name: "إجازة حج أو زيارة القدس", kind: "HAJJ", maxDays: 30, per: "SERVICE", paidPct: 100, minServiceMonths: 60, note: "مرة واحدة بعد خمس سنوات" },
  { code: "EXAM", name: "إجازة امتحان", kind: "EXAM", maxDays: null, per: "OCCURRENCE", paidPct: 100, needsDocument: true },
  { code: "UNPAID", name: "إجازة بدون أجر", kind: "UNPAID", maxDays: null, per: "OCCURRENCE", paidPct: 0 },
];
export async function ensureLeaveTypes(t: Db, C: string) {
  const have = await t.one(`SELECT COUNT(*)::int c FROM hr_leave_types WHERE company_id=$1`, [C]);
  if (!have.c) {
    const list = IS_EG ? EG_TYPES : SA_TYPES;
    for (const [i, x] of list.entries()) await t.exec(`INSERT INTO hr_leave_types (company_id, code, name, kind, max_days, per, tiers, paid_pct, gender, min_service_months, needs_document, uses_balance, sort, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (company_id, code) DO NOTHING`,
      [C, x.code, x.name, x.kind, x.maxDays, x.per, JSON.stringify(x.tiers || []), x.paidPct, x.gender || "ANY", x.minServiceMonths || 0, !!x.needsDocument, !!x.usesBalance, i, x.note || null]);
  }
  return (await t.rows(`SELECT * FROM hr_leave_types WHERE company_id=$1 ORDER BY sort, name`, [C])).map(shapeType);
}
const shapeType = (x: any) => ({ ...x, maxDays: x.maxDays === null ? null : n(x.maxDays), paidPct: n(x.paidPct), tiers: x.tiers || [] });
export async function saveLeaveType(t: Db, C: string, b: any, id?: string) {
  await ensureLeaveTypes(t, C);
  const name = txt(b.name, 80); if (!name) throw bad("اسم نوع الإجازة مطلوب");
  const maxDays = b.maxDays === "" || b.maxDays === null || b.maxDays === undefined ? null : num(b.maxDays);
  if (maxDays !== null && !(maxDays > 0)) throw bad("الحد الأقصى أكبر من صفر أو فارغ");
  const paidPct = Math.max(0, Math.min(100, num(b.paidPct)));
  const tiers = Array.isArray(b.tiers) ? b.tiers.map((x: any) => ({ days: Math.max(0, num(x.days)), pct: Math.max(0, Math.min(100, num(x.pct))) })).filter((x: any) => x.days > 0) : undefined;
  const row: any = { name, maxDays, per: ["OCCURRENCE", "YEAR", "SERVICE"].includes(b.per) ? b.per : "OCCURRENCE", paidPct, gender: ["ANY", "F", "M"].includes(b.gender) ? b.gender : "ANY", minServiceMonths: Math.max(0, Math.trunc(num(b.minServiceMonths))), needsDocument: !!b.needsDocument, isActive: b.isActive === undefined ? true : !!b.isActive, note: txt(b.note, 300), ...(tiers ? { tiers: JSON.stringify(tiers) } : {}) };
  if (id) { const r = await t.update("hr_leave_types", { id: uid(id), companyId: C }, row); if (!r) throw new AppError(404, "نوع الإجازة غير موجود"); return shapeType(r); }
  const code = (txt(b.code, 30) || name).toUpperCase().replace(/\s+/g, "_");
  if (await t.maybe(`SELECT 1 FROM hr_leave_types WHERE company_id=$1 AND code=$2`, [C, code])) throw conflict("الرمز مستخدم لنوع آخر");
  return shapeType(await t.insert("hr_leave_types", { companyId: C, code, kind: "OTHER", usesBalance: false, sort: 99, ...row }));
}

// ───────────────────────── leave requests ─────────────────────────
const LEGACY: Record<string, string> = { ANNUAL: "ANNUAL", SICK: "SICK", UNPAID: "UNPAID", OTHER: "UNPAID" };
async function typeOf(t: Db, C: string, b: any) {
  const types = await ensureLeaveTypes(t, C);
  const ty = types.find((x: any) => x.id === b.typeId) || types.find((x: any) => x.code === b.type) || types.find((x: any) => x.code === LEGACY[b.type]);
  if (!ty) throw bad("اختر نوع الإجازة");
  if (!ty.isActive) throw bad(`نوع الإجازة «${ty.name}» موقوف`);
  return ty;
}
/** Days of a type already taken (approved) in the window that matters for it. */
async function usedDays(t: Db, C: string, employeeId: string, ty: any, from: string, exceptId?: string | null) {
  const since = ty.per === "SERVICE" ? "1900-01-01" : ty.per === "YEAR" ? addDays(from, -364) : from;
  if (ty.per === "OCCURRENCE") return 0;
  // leaves recorded before the types existed count by their old type code
  const r = await t.one(`SELECT COALESCE(SUM(days),0) d FROM employee_leaves WHERE company_id=$1 AND employee_id=$2 AND (type_id=$3 OR (type_id IS NULL AND type=$6)) AND status='APPROVED' AND from_date >= $4 AND from_date <= $5 ${exceptId ? "AND id<>$7" : ""}`, exceptId ? [C, employeeId, ty.id, since, from, ty.code, exceptId] : [C, employeeId, ty.id, since, from, ty.code]);
  return n(r.d);
}
/** How the days of a leave are paid: by the type's tiers across a rolling year (sick leave), or one rate. */
function payOf(ty: any, days: number, usedBefore: number) {
  if (!ty.tiers?.length) return [{ days, pct: n(ty.paidPct) }];
  const out: { days: number; pct: number }[] = []; let skip = usedBefore, left = days;
  for (const tr of ty.tiers) {
    let cap = n(tr.days); const s = Math.min(skip, cap); skip -= s; cap -= s;
    const take = Math.min(cap, left); if (take > 0) { out.push({ days: take, pct: n(tr.pct) }); left -= take; }
    if (left <= 0) break;
  }
  if (left > 0) out.push({ days: left, pct: 0 });
  return out;
}
export async function quoteLeave(t: Db, C: string, b: any, exceptId?: string | null) {
  const e = await t.one(`SELECT * FROM employees WHERE id=$1 AND company_id=$2`, [uid(b.employeeId), C], "اختر الموظف");
  const ty = await typeOf(t, C, b);
  if (!isDate(b.fromDate) || !isDate(b.toDate) || b.toDate < b.fromDate) throw bad("تاريخ الإجازة غير صحيح");
  const days = b.days ? r3(num(b.days)) : dayDiff(b.fromDate, b.toDate) + 1;
  if (!(days > 0)) throw bad("عدد الأيام يجب أن يكون أكبر من صفر");
  const warnings: string[] = [];
  if (ty.gender !== "ANY" && e.gender && e.gender !== ty.gender) throw bad(`«${ty.name}» ${ty.gender === "F" ? "للموظفات" : "للموظفين"} فقط`);
  if (ty.gender !== "ANY" && !e.gender) warnings.push("جنس الموظف غير مسجل في ملفه");
  const hire = iso(e.hireDate);
  if (ty.minServiceMonths && hire && addMonths(hire, ty.minServiceMonths) > b.fromDate) throw bad(`«${ty.name}» بعد ${ty.minServiceMonths} شهراً من الخدمة`);
  const used = await usedDays(t, C, e.id, ty, b.fromDate, exceptId);
  if (ty.maxDays !== null && !ty.tiers?.length) {
    const cap = ty.per === "OCCURRENCE" ? ty.maxDays : ty.maxDays - used;
    if (days > cap + 1e-9) throw bad(cap <= 0 ? `استُنفد «${ty.name}» (${ty.maxDays} يوماً${ty.per === "SERVICE" ? " طوال الخدمة" : " في السنة"})` : `الحد الأقصى لـ«${ty.name}» ${r3(cap)} يوماً${ty.per !== "OCCURRENCE" ? ` (استُخدم ${r3(used)})` : ""}`);
  }
  // overlap with another approved or pending leave
  const clash = await t.maybe(`SELECT from_date, to_date FROM employee_leaves WHERE company_id=$1 AND employee_id=$2 AND status IN ('APPROVED','PENDING') AND from_date <= $4 AND to_date >= $3 ${exceptId ? "AND id<>$5" : ""} LIMIT 1`, exceptId ? [C, e.id, b.fromDate, b.toDate, exceptId] : [C, e.id, b.fromDate, b.toDate]);
  if (clash) throw conflict(`تتداخل مع إجازة أخرى (${iso(clash.fromDate)} إلى ${iso(clash.toDate)})`);
  let balance: number | null = null;
  if (ty.usesBalance) {
    balance = r3(leaveAccruedDays(e, b.fromDate) - (await leaveTakenDays(t, C, e.id, e, b.fromDate)));
    if (days > balance + 1e-9) warnings.push(`الرصيد المستحق ${balance} يوماً فقط — الزائد يُحسب سلفة على رصيد الإجازة`);
  }
  const pay = payOf(ty, days, used);
  const unpaid = r3(pay.reduce((a, p) => a + (p.days * (100 - p.pct)) / 100, 0));
  return { employee: { id: e.id, name: e.name }, type: ty, days, used, pay, unpaidDays: unpaid, balance, warnings };
}
export async function requestLeave(t: Db, C: string, user: string, b: any, opts: { isDemo?: boolean } = {}) {
  const q = await quoteLeave(t, C, b);
  const approve = b.approve === true;
  return t.insert("employee_leaves", { companyId: C, employeeId: q.employee.id, type: LEGACY[q.type.code] ? q.type.code : q.type.kind === "UNPAID" ? "UNPAID" : "OTHER", typeId: q.type.id, fromDate: b.fromDate, toDate: b.toDate, days: q.days, notes: txt(b.notes, 500), reason: txt(b.reason, 300), pay: JSON.stringify(q.pay), status: approve ? "APPROVED" : "PENDING", decidedBy: approve ? user : null, decidedAt: approve ? new Date() : null, isDemo: !!opts.isDemo || !!b.isDemo, createdBy: user });
}
export async function decideLeave(t: Db, C: string, user: string, id: string, decision: "APPROVED" | "REJECTED" | "CANCELLED", note?: string) {
  const l = await t.one(`SELECT * FROM employee_leaves WHERE id=$1 AND company_id=$2 FOR UPDATE`, [uid(id), C], "الإجازة غير موجودة");
  if (decision === "CANCELLED") { if (!["PENDING", "APPROVED"].includes(l.status)) throw conflict("الإجازة ملغاة أو مرفوضة من قبل"); }
  else if (l.status !== "PENDING") throw conflict("الطلب ليس بانتظار القرار");
  if (decision === "CANCELLED" && l.status === "APPROVED" && await t.maybe(`SELECT 1 FROM payroll_runs WHERE company_id=$1 AND status<>'DRAFT' AND period >= $2 AND period <= $3 AND lines @> $4::jsonb`, [C, iso(l.fromDate)!.slice(0, 7), iso(l.toDate)!.slice(0, 7), JSON.stringify([{ employeeId: l.employeeId }])])) throw conflict("دخلت الإجازة في مسير رواتب مرحّل — صحّح الفرق في المسير القادم");
  if (decision === "APPROVED" && l.typeId) {
    // re-check limits and overlaps at the moment of approval
    const ty = (await ensureLeaveTypes(t, C)).find((x: any) => x.id === l.typeId);
    if (ty) { const q = await quoteLeave(t, C, { employeeId: l.employeeId, typeId: ty.id, fromDate: iso(l.fromDate), toDate: iso(l.toDate), days: n(l.days) }, l.id); await t.exec(`UPDATE employee_leaves SET pay=$2 WHERE id=$1`, [l.id, JSON.stringify(q.pay)]); }
  }
  return t.update("employee_leaves", { id: l.id }, { status: decision, decidedBy: user, decidedAt: new Date(), decisionNote: txt(note, 300) });
}
export async function listLeaves(t: Db, C: string, q: any = {}) {
  const where = ["l.company_id=$1"]; const p: any[] = [C];
  if (["PENDING", "APPROVED", "REJECTED", "CANCELLED"].includes(q.status)) { p.push(q.status); where.push(`l.status=$${p.length}`); }
  if (uid(q.employeeId)) { p.push(q.employeeId); where.push(`l.employee_id=$${p.length}`); }
  if (isDate(q.from)) { p.push(q.from); where.push(`l.to_date >= $${p.length}`); }
  if (isDate(q.to)) { p.push(q.to); where.push(`l.from_date <= $${p.length}`); }
  const rows = await t.rows(`SELECT l.*, e.name employee_name, e.code employee_code, e.department, lt.name type_name, lt.code type_code, lt.needs_document FROM employee_leaves l JOIN employees e ON e.id=l.employee_id LEFT JOIN hr_leave_types lt ON lt.id=l.type_id WHERE ${where.join(" AND ")} ORDER BY (l.status='PENDING') DESC, l.from_date DESC LIMIT 1000`, p);
  return rows.map((l: any) => ({ ...l, fromDate: iso(l.fromDate), toDate: iso(l.toDate), days: n(l.days), typeName: l.typeName || ({ ANNUAL: "إجازة سنوية", SICK: "إجازة مرضية", UNPAID: "إجازة بدون أجر", OTHER: "أخرى" } as any)[l.type] || l.type, unpaidDays: r3((l.pay || [{ days: n(l.days), pct: l.type === "UNPAID" ? 0 : 100 }]).reduce((a: number, x: any) => a + (n(x.days) * (100 - n(x.pct))) / 100, 0)) }));
}
/** Annual balance and the use of every other type, for one employee. */
export async function leaveBalances(t: Db, C: string, employeeId: string, asOf = today()) {
  const e = await t.one(`SELECT * FROM employees WHERE id=$1 AND company_id=$2`, [uid(employeeId), C], "الموظف غير موجود");
  const accrued = leaveAccruedDays(e, asOf), taken = await leaveTakenDays(t, C, e.id, e, asOf);
  const types = await ensureLeaveTypes(t, C);
  const out: any[] = [];
  for (const ty of types.filter((x: any) => x.isActive && !x.usesBalance)) {
    const used = ty.per === "OCCURRENCE" ? n((await t.one(`SELECT COALESCE(SUM(days),0) d FROM employee_leaves WHERE company_id=$1 AND employee_id=$2 AND type_id=$3 AND status='APPROVED' AND from_date > $4`, [C, e.id, ty.id, addDays(asOf, -365)])).d) : await usedDays(t, C, e.id, ty, asOf);
    out.push({ code: ty.code, name: ty.name, per: ty.per, maxDays: ty.maxDays, used: r3(used), left: ty.maxDays === null || ty.per === "OCCURRENCE" ? null : r3(Math.max(0, ty.maxDays - used)), tiers: ty.tiers });
  }
  return { annual: { accrued: r3(accrued), taken: r3(taken), balance: r3(accrued - taken), perYear: n(e.leaveDaysPerYear) || 21 }, others: out };
}
/** Unpaid days of approved leaves falling in a month, per employee (for the payroll). */
export async function unpaidLeaveDays(t: Db, C: string, period: string) {
  const from = period + "-01", to = monthEnd(from);
  const rows = await t.rows(`SELECT id, employee_id, from_date, to_date, days, pay, type FROM employee_leaves WHERE company_id=$1 AND status='APPROVED' AND from_date <= $3 AND to_date >= $2`, [C, from, to]);
  const out: Record<string, { days: number; items: any[] }> = {};
  for (const l of rows) {
    const f = iso(l.fromDate)!, tt = iso(l.toDate)!, span = dayDiff(f, tt) + 1;
    const pay = l.pay || [{ days: n(l.days), pct: l.type === "UNPAID" ? 0 : 100 }];
    // day by day: the pay tiers fall on the leave's days in order (full pay first, then three quarters, then none),
    // so a leave across two months puts each day's unpaid share in its own month
    const pcts: number[] = []; for (const x of pay) for (let i = 0; i < Math.round(n(x.days)); i++) pcts.push(n(x.pct));
    let share = 0;
    for (let i = 0; i < pcts.length && i < span; i++) { const d = addDays(f, i); if (d >= from && d <= to) share += (100 - pcts[i]) / 100; }
    share = r3(share);
    if (share <= 0) continue;
    const g = out[l.employeeId] || (out[l.employeeId] = { days: 0, items: [] }); g.days = r3(g.days + share); g.items.push({ leaveId: l.id, from: f, to: tt, days: share, span });
  }
  return out;
}

// ───────────────────────── documents ─────────────────────────
export const DOC_KINDS: Record<string, string> = { NATIONAL_ID: "الهوية الوطنية", IQAMA: "الإقامة", PASSPORT: "جواز السفر", WORK_PERMIT: "رخصة العمل", HEALTH_INSURANCE: "التأمين الطبي", CONTRACT: "عقد العمل", DRIVING_LICENSE: "رخصة القيادة", CERTIFICATE: "شهادة / مؤهل", MEDICAL: "شهادة صحية", OTHER: "أخرى" };
export async function saveDocument(t: Db, C: string, user: string, b: any, id?: string, opts: { isDemo?: boolean } = {}) {
  const kind = DOC_KINDS[b.kind] ? b.kind : null; if (!kind) throw bad("اختر نوع الوثيقة");
  if (b.issueDate && !isDate(b.issueDate)) throw bad("تاريخ الإصدار غير صحيح");
  if (b.expiryDate && !isDate(b.expiryDate)) throw bad("تاريخ الانتهاء غير صحيح");
  if (b.issueDate && b.expiryDate && b.expiryDate < b.issueDate) throw bad("الانتهاء قبل الإصدار");
  const row: any = { kind, number: txt(b.number, 60), issueDate: b.issueDate || null, expiryDate: b.expiryDate || null, issuer: txt(b.issuer, 100), notes: txt(b.notes, 500) };
  if (id) { const r = await t.update("hr_documents", { id: uid(id), companyId: C }, row); if (!r) throw new AppError(404, "الوثيقة غير موجودة"); return r; }
  const e = await t.one(`SELECT id FROM employees WHERE id=$1 AND company_id=$2`, [uid(b.employeeId), C], "اختر الموظف");
  return t.insert("hr_documents", { companyId: C, employeeId: e.id, ...row, isDemo: !!opts.isDemo, createdBy: user });
}
export async function listDocuments(t: Db, C: string, q: any = {}) {
  const where = ["d.company_id=$1"]; const p: any[] = [C];
  if (uid(q.employeeId)) { p.push(q.employeeId); where.push(`d.employee_id=$${p.length}`); }
  if (q.within) { p.push(addDays(today(), Math.max(0, Math.min(3650, num(q.within))))); where.push(`d.expiry_date IS NOT NULL AND d.expiry_date <= $${p.length}`); }
  const rows = await t.rows(`SELECT d.*, e.name employee_name, e.code employee_code, e.is_active FROM hr_documents d JOIN employees e ON e.id=d.employee_id WHERE ${where.join(" AND ")} ORDER BY d.expiry_date NULLS LAST, e.name LIMIT 2000`, p);
  const td = today();
  return rows.filter((d: any) => !q.within || d.isActive).map((d: any) => { const ex = iso(d.expiryDate); const left = ex ? dayDiff(td, ex) : null; return { ...d, issueDate: iso(d.issueDate), expiryDate: ex, kindAr: DOC_KINDS[d.kind] || d.kind, daysLeft: left, state: left === null ? "NONE" : left < 0 ? "EXPIRED" : left <= 30 ? "SOON" : left <= 90 ? "UPCOMING" : "OK" }; });
}

// ───────────────────────── salary changes ─────────────────────────
const PAY_KEYS = ["basic", "housing", "transport", "otherAllow"] as const;
export async function salaryChange(t: Db, C: string, user: string, employeeId: string, b: any, opts: { isDemo?: boolean } = {}) {
  const e = await t.one(`SELECT * FROM employees WHERE id=$1 AND company_id=$2 FOR UPDATE`, [uid(employeeId), C], "الموظف غير موجود");
  const date = isDate(b.effectiveDate) ? String(b.effectiveDate) : today();
  const before: any = {}, after: any = {};
  for (const k of PAY_KEYS) { before[k] = n(e[k]); after[k] = b[k] === undefined || b[k] === "" ? n(e[k]) : r2(num(b[k])); if (after[k] < 0) throw bad("المبالغ لا تكون سالبة"); }
  if (PAY_KEYS.every((k) => after[k] === before[k])) throw bad("لم يتغير شيء في الراتب");
  if (!(after.basic > 0)) throw bad("الراتب الأساسي مطلوب");
  if (await t.maybe(`SELECT 1 FROM hr_salary_changes WHERE company_id=$1 AND employee_id=$2 AND status='PENDING'`, [C, e.id])) throw conflict("للموظف تعديل راتب لم يسرِ بعد — ألغِه أولاً");
  const ch = await t.insert("hr_salary_changes", { companyId: C, employeeId: e.id, effectiveDate: date, oldPay: JSON.stringify(before), newPay: JSON.stringify(after), reason: txt(b.reason, 300), status: "PENDING", isDemo: !!opts.isDemo, createdBy: user });
  if (date <= today()) await applyChange(t, ch.id);
  return t.one(`SELECT * FROM hr_salary_changes WHERE id=$1`, [ch.id]);
}
async function applyChange(t: Db, id: string) {
  const c = await t.one(`SELECT * FROM hr_salary_changes WHERE id=$1 FOR UPDATE`, [id]);
  if (c.status !== "PENDING") return;
  const a = c.newPay; await t.update("employees", { id: c.employeeId }, { basic: a.basic, housing: a.housing, transport: a.transport, otherAllow: a.otherAllow });
  await t.update("hr_salary_changes", { id }, { status: "APPLIED", appliedAt: new Date() });
}
export async function applyDueSalaryChanges(t: Db, C?: string) {
  const due = await t.rows(`SELECT id FROM hr_salary_changes WHERE status='PENDING' AND effective_date <= $1 ${C ? "AND company_id=$2" : ""}`, C ? [today(), C] : [today()]);
  for (const r of due) await applyChange(t, r.id);
  return due.length;
}
export async function cancelSalaryChange(t: Db, C: string, id: string) {
  const r = await t.maybe(`UPDATE hr_salary_changes SET status='CANCELLED' WHERE id=$1 AND company_id=$2 AND status='PENDING' RETURNING id`, [uid(id), C]);
  if (!r) throw conflict("يُلغى فقط تعديل لم يسرِ بعد");
  return { ok: true };
}
export async function salaryHistory(t: Db, C: string, employeeId: string) {
  return (await t.rows(`SELECT * FROM hr_salary_changes WHERE company_id=$1 AND employee_id=$2 ORDER BY effective_date DESC, created_at DESC`, [C, uid(employeeId)])).map((c: any) => ({ ...c, effectiveDate: iso(c.effectiveDate), oldTotal: r2(PAY_KEYS.reduce((a, k) => a + n(c.oldPay[k]), 0)), newTotal: r2(PAY_KEYS.reduce((a, k) => a + n(c.newPay[k]), 0)) }));
}

// ───────────────────────── payroll helpers ─────────────────────────
/** Share of the month an employee is on the payroll: from the hire date, until the termination date. */
export function prorateOf(e: any, period: string) {
  const from = period + "-01", to = monthEnd(from), dim = dayDiff(from, to) + 1;
  const hire = iso(e.hireDate), end = iso(e.terminationDate);
  const a = hire && hire > from ? hire : from, b = end && end < to ? end : to;
  if (b < a) return { factor: 0, days: 0, of: dim };
  const days = dayDiff(a, b) + 1;
  return { factor: days >= dim ? 1 : days / dim, days, of: dim, from: a, to: b };
}
/** Employees on the payroll for a month: active, or who left during it; not those hired after it. */
export async function payrollEmployees(t: Db, C: string, period: string) {
  const from = period + "-01", to = monthEnd(from);
  return t.rows(`SELECT * FROM employees WHERE company_id=$1 AND (hire_date IS NULL OR hire_date <= $3) AND (is_active OR (termination_date IS NOT NULL AND termination_date >= $2)) AND (termination_date IS NULL OR termination_date >= $2) ORDER BY code`, [C, from, to]);
}
/** What would stop the WPS file from being accepted. */
export function wpsProblems(lines: any[]) {
  const out: { code: string; name: string; problems: string[] }[] = [];
  for (const l of lines) {
    const p: string[] = [];
    const ib = ibanCheck(l.iban); if (!ib.ok) p.push(ib.error!);
    if (!l.idNumber) p.push("رقم الهوية أو الإقامة غير مسجل");
    else if (!IS_EG && !/^[12]\d{9}$/.test(String(l.idNumber))) p.push("رقم الهوية/الإقامة 10 أرقام يبدأ بـ 1 أو 2");
    if (!(l.net > 0)) p.push("الصافي صفر أو سالب");
    if (p.length) out.push({ code: l.code, name: l.name, problems: p });
  }
  return out;
}

// ───────────────────────── dashboard ─────────────────────────
export async function hrDashboard(t: Db, C: string) {
  const td = today(), m0 = td.slice(0, 7) + "-01";
  const emps = await t.rows(`SELECT * FROM employees WHERE company_id=$1`, [C]);
  const active = emps.filter((e: any) => e.isActive);
  const saudi = active.filter((e: any) => e.nationality === "SAUDI" || e.nationality === "EGYPTIAN").length;
  const joiners = emps.filter((e: any) => iso(e.hireDate) && iso(e.hireDate)! >= m0);
  const leavers = emps.filter((e: any) => iso(e.terminationDate) && iso(e.terminationDate)! >= m0);
  const yearAgo = addDays(td, -365);
  const left12 = emps.filter((e: any) => iso(e.terminationDate) && iso(e.terminationDate)! >= yearAgo).length;
  const [pending, onLeave, docs, runs, prov, changes] = await Promise.all([
    listLeaves(t, C, { status: "PENDING" }),
    listLeaves(t, C, { status: "APPROVED", from: td, to: td }),
    listDocuments(t, C, { within: 60 }),
    t.rows(`SELECT period, total_gross, total_gosi_er, total_net, lines FROM payroll_runs WHERE company_id=$1 ORDER BY period DESC LIMIT 6`, [C]),
    t.one(`SELECT COALESCE(SUM(amount) FILTER (WHERE type='EOSB'),0) eosb, COALESCE(SUM(amount) FILTER (WHERE type='LEAVE'),0) leave FROM employee_provision_ledger WHERE company_id=$1`, [C]),
    t.rows(`SELECT c.*, e.name employee_name FROM hr_salary_changes c JOIN employees e ON e.id=c.employee_id WHERE c.company_id=$1 AND c.status='PENDING' ORDER BY c.effective_date`, [C]),
  ]);
  const soon = (k: string, within: number) => active.filter((e: any) => { const d = iso(e[k]); return d && d >= td && d <= addDays(td, within); }).map((e: any) => ({ id: e.id, name: e.name, date: iso(e[k]) }));
  const byDept = new Map<string, number>(); for (const e of active) byDept.set(e.department || "—", (byDept.get(e.department || "—") || 0) + 1);
  const monthly = r2(active.reduce((a: number, e: any) => a + n(e.basic) + n(e.housing) + n(e.transport) + n(e.otherAllow), 0));
  const anniversaries = active.filter((e: any) => { const h = iso(e.hireDate); if (!h) return false; const md = h.slice(5); const tdmd = td.slice(5), end = addDays(td, 7).slice(5); return h.slice(0, 4) < td.slice(0, 4) && (tdmd <= end ? md >= tdmd && md <= end : md >= tdmd || md <= end); }).map((e: any) => ({ id: e.id, name: e.name, years: Number(td.slice(0, 4)) - Number(iso(e.hireDate)!.slice(0, 4)), date: td.slice(0, 4) + "-" + iso(e.hireDate)!.slice(5) }));
  return {
    headcount: { active: active.length, saudi, nonSaudi: active.length - saudi, saudizationPct: active.length ? r2((saudi / active.length) * 100) : 0, female: active.filter((e: any) => e.gender === "F").length, joiners: joiners.length, leavers: leavers.length, turnoverPct: active.length ? r2((left12 / Math.max(1, active.length)) * 100) : 0 },
    monthlyPayroll: monthly, departments: [...byDept.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    pendingLeaves: pending, onLeaveToday: onLeave, documents: { expired: docs.filter((d: any) => d.state === "EXPIRED"), soon: docs.filter((d: any) => d.state !== "EXPIRED") },
    probationEnding: soon("probationEnd", 30), contractsEnding: soon("contractEnd", 60), anniversaries,
    payrollTrend: runs.reverse().map((r: any) => ({ period: r.period, gross: n(r.totalGross), gosiEr: n(r.totalGosiEr), net: n(r.totalNet), count: (r.lines || []).length })),
    liabilities: { eosb: r2(n(prov.eosb)), leave: r2(n(prov.leave)) }, pendingChanges: changes.map((c: any) => ({ ...c, effectiveDate: iso(c.effectiveDate) })),
    missing: { iban: active.filter((e: any) => !ibanCheck(e.iban).ok).length, idNumber: active.filter((e: any) => !e.idNumber).length },
  };
}
