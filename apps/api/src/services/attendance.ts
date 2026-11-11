/**
 * Attendance: one row per employee per day (present with in/out times, absent, on leave, day off). Lateness and overtime
 * are worked out from the establishment's working hours; at month end the totals are turned into payroll transactions.
 */
import { Db } from "../db/pool";
import { bad, conflict, r2, num, isDate, today } from "../lib/core";
import { saveItem } from "./payroll";

export type AttSettings = { workStart: string; workHours: number; graceMinutes: number; overtimeAfter: number; weekend: number[] };
const DEF: AttSettings = { workStart: "08:00", workHours: 8, graceMinutes: 10, overtimeAfter: 0.5, weekend: [5] };
const HM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const mins = (t: string) => { const m = String(t).match(HM)!; return +m[1] * 60 + +m[2]; };
const hm = (v: any): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && v >= 0 && v < 1) { const t = Math.round(v * 1440); return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; } // Excel time fraction
  const s = String(v).trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  let m = s.match(/(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(am|pm|ص|م)?/i);
  if (!m) return null;
  let h = +m[1]; const ap = (m[3] || "").toLowerCase();
  if ((ap === "pm" || ap === "م") && h < 12) h += 12; if ((ap === "am" || ap === "ص") && h === 12) h = 0;
  const out = `${String(h).padStart(2, "0")}:${m[2]}`;
  return HM.test(out) ? out : null;
};
export function settingsOf(company: any): AttSettings {
  const s = company.accounting?.attendance || {};
  return { workStart: HM.test(s.workStart || "") ? s.workStart : DEF.workStart, workHours: num(s.workHours) > 0 ? num(s.workHours) : DEF.workHours, graceMinutes: s.graceMinutes === undefined ? DEF.graceMinutes : Math.max(0, Math.round(num(s.graceMinutes))), overtimeAfter: s.overtimeAfter === undefined ? DEF.overtimeAfter : Math.max(0, num(s.overtimeAfter)), weekend: Array.isArray(s.weekend) ? s.weekend.map(Number).filter((d: number) => d >= 0 && d <= 6) : DEF.weekend };
}
export async function saveSettings(t: Db, companyId: string, b: any) {
  if (b.workStart && !HM.test(b.workStart)) throw bad("بداية الدوام بصيغة HH:MM");
  if (b.workHours !== undefined && !(num(b.workHours) > 0 && num(b.workHours) <= 16)) throw bad("ساعات الدوام بين 1 و16");
  const v = { workStart: b.workStart, workHours: b.workHours === undefined ? undefined : num(b.workHours), graceMinutes: b.graceMinutes === undefined ? undefined : Math.max(0, Math.round(num(b.graceMinutes))), overtimeAfter: b.overtimeAfter === undefined ? undefined : Math.max(0, num(b.overtimeAfter)), weekend: Array.isArray(b.weekend) ? b.weekend.map(Number).filter((d: number) => d >= 0 && d <= 6) : undefined };
  const cur = await t.one(`SELECT accounting FROM companies WHERE id=$1`, [companyId]);
  const next = { ...(cur.accounting?.attendance || {}), ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) };
  await t.exec(`UPDATE companies SET accounting = jsonb_set(accounting, '{attendance}', $2::jsonb) WHERE id=$1`, [companyId, JSON.stringify(next)]);
  return settingsOf({ accounting: { attendance: next } });
}
/** Worked hours, lateness after the grace period, and overtime beyond the working day (ignored below the threshold). */
export function compute(s: AttSettings, status: string, timeIn: string | null, timeOut: string | null, dayOff: boolean) {
  if (status !== "PRESENT" || !timeIn || !timeOut) return { hours: 0, lateMinutes: 0, overtimeHours: 0 };
  let a = mins(timeIn), b = mins(timeOut); if (b < a) b += 1440; // shift past midnight
  const hours = r2((b - a) / 60);
  const late = dayOff ? 0 : Math.max(0, a - mins(s.workStart)); const lateMinutes = late > s.graceMinutes ? late : 0;
  // on a rest day every hour worked is overtime; on a working day, what exceeds the working day
  const extra = dayOff ? hours : hours - s.workHours; const overtimeHours = extra >= s.overtimeAfter && extra > 0 ? Math.floor(extra * 4) / 4 : 0;
  return { hours, lateMinutes, overtimeHours };
}
const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
export async function saveDay(t: Db, company: any, user: string, date: string, rows: any[], source = "MANUAL") {
  if (!isDate(date)) throw bad("التاريخ غير صحيح");
  if (date > today()) throw bad("لا يُسجَّل حضور يوم لم يأتِ");
  const s = settingsOf(company); const off = s.weekend.includes(dow(date));
  const emps = await t.rows(`SELECT id FROM employees WHERE company_id=$1`, [company.id]); const ok = new Set(emps.map((e) => e.id));
  let saved = 0;
  for (const r of rows || []) {
    if (!ok.has(r.employeeId)) continue;
    const status = ["PRESENT", "ABSENT", "LEAVE", "OFF"].includes(r.status) ? r.status : "PRESENT";
    if (r.status === "" || r.status === null) { await t.exec(`DELETE FROM attendance WHERE employee_id=$1 AND date=$2`, [r.employeeId, date]); continue; }
    const tin = status === "PRESENT" ? hm(r.timeIn) : null, tout = status === "PRESENT" ? hm(r.timeOut) : null;
    if (status === "PRESENT" && ((r.timeIn && !tin) || (r.timeOut && !tout))) throw bad("صيغة الوقت HH:MM");
    const c = compute(s, status, tin, tout, off);
    await t.exec(`INSERT INTO attendance(company_id, employee_id, date, status, time_in, time_out, hours, late_minutes, overtime_hours, note, source, created_by, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
      ON CONFLICT (employee_id, date) DO UPDATE SET status=EXCLUDED.status, time_in=EXCLUDED.time_in, time_out=EXCLUDED.time_out, hours=EXCLUDED.hours, late_minutes=EXCLUDED.late_minutes, overtime_hours=EXCLUDED.overtime_hours, note=EXCLUDED.note, source=EXCLUDED.source, created_by=EXCLUDED.created_by, updated_at=now()`,
      [company.id, r.employeeId, date, status, tin, tout, c.hours, c.lateMinutes, c.overtimeHours, r.note ? String(r.note).slice(0, 200) : null, source, user]);
    saved++;
  }
  return { saved };
}
/** Rows from a time-clock export: employee code (or name), date, time in, time out. */
export async function importRows(t: Db, company: any, user: string, rows: any[]) {
  if (!Array.isArray(rows) || !rows.length) throw bad("لا توجد سطور");
  if (rows.length > 5000) throw bad("حتى 5000 سطر في المرة");
  const emps = await t.rows(`SELECT id, code, name FROM employees WHERE company_id=$1`, [company.id]);
  const byCode = new Map(emps.map((e) => [String(e.code).trim().toLowerCase(), e.id])); const byName = new Map(emps.map((e) => [String(e.name).trim(), e.id]));
  const normDate = (v: any): string | null => { if (typeof v === "number") { const d = new Date(Math.round((v - 25569) * 86400000)); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); } const s = String(v || "").trim(); if (isDate(s.slice(0, 10))) return s.slice(0, 10); const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null; };
  const byDay = new Map<string, any[]>(); const errors: string[] = []; let skipped = 0;
  rows.forEach((r, i) => {
    const id = byCode.get(String(r.code ?? "").trim().toLowerCase()) || byName.get(String(r.name ?? "").trim());
    const date = normDate(r.date);
    if (!id || !date) { skipped++; if (errors.length < 8) errors.push(`سطر ${i + 2}: ${!id ? `موظف غير معروف (${r.code || r.name || "—"})` : "تاريخ غير صحيح"}`); return; }
    const tin = hm(r.timeIn), tout = hm(r.timeOut);
    (byDay.get(date) || byDay.set(date, []).get(date)!).push({ employeeId: id, status: tin || tout ? "PRESENT" : "ABSENT", timeIn: tin, timeOut: tout });
  });
  let saved = 0;
  for (const [date, list] of byDay) { if (date > today()) { skipped += list.length; continue; } saved += (await saveDay(t, company, user, date, list, "IMPORT")).saved; }
  return { saved, skipped, days: byDay.size, errors };
}
export async function monthSheet(t: Db, company: any, period: string) {
  if (!/^\d{4}-\d{2}$/.test(period || "")) throw bad("الشهر بصيغة YYYY-MM");
  const s = settingsOf(company); const from = `${period}-01`; const last = new Date(Date.UTC(+period.slice(0, 4), +period.slice(5, 7), 0)).getUTCDate(); const to = `${period}-${String(last).padStart(2, "0")}`;
  const emps = await t.rows(`SELECT id, code, name, department, basic, housing, transport, other_allow FROM employees WHERE company_id=$1 AND (is_active OR termination_date >= $2) AND (hire_date IS NULL OR hire_date <= $3) ORDER BY code`, [company.id, from, to]);
  const rows = await t.rows(`SELECT employee_id, date, status, time_in, time_out, hours, late_minutes, overtime_hours, note FROM attendance WHERE company_id=$1 AND date BETWEEN $2 AND $3`, [company.id, from, to]);
  const D = (v: any) => String(v instanceof Date ? v.toISOString() : v).slice(0, 10);
  const days = Array.from({ length: last }, (_, i) => { const d = `${period}-${String(i + 1).padStart(2, "0")}`; return { date: d, off: s.weekend.includes(dow(d)), future: d > today() }; });
  const posted = await t.one(`SELECT COUNT(*) FILTER (WHERE status='OPEN')::int open, COUNT(*) FILTER (WHERE status='INCLUDED')::int included FROM payroll_items WHERE company_id=$1 AND period=$2 AND source='ATTENDANCE'`, [company.id, period]);
  return { period, settings: s, days, posted, employees: emps.map((e) => {
    const mine = rows.filter((r) => r.employeeId === e.id); const map: Record<string, any> = {};
    for (const r of mine) map[D(r.date)] = { status: r.status, timeIn: r.timeIn, timeOut: r.timeOut, hours: Number(r.hours), late: r.lateMinutes, overtime: Number(r.overtimeHours), note: r.note };
    return { id: e.id, code: e.code, name: e.name, department: e.department, days: map,
      summary: { present: mine.filter((r) => r.status === "PRESENT").length, absent: mine.filter((r) => r.status === "ABSENT").length, leave: mine.filter((r) => r.status === "LEAVE").length, lateMinutes: mine.reduce((a, r) => a + r.lateMinutes, 0), lateDays: mine.filter((r) => r.lateMinutes > 0).length, overtimeHours: r2(mine.reduce((a, r) => a + Number(r.overtimeHours), 0)), hours: r2(mine.reduce((a, r) => a + Number(r.hours), 0)) } };
  }) };
}
/** Month totals → payroll transactions (absence days, lateness hours, overtime hours). Re-running replaces what is still open. */
export async function postToPayroll(t: Db, company: any, user: string, period: string) {
  const sheet = await monthSheet(t, company, period);
  const used = await t.one(`SELECT COUNT(*)::int c FROM payroll_items WHERE company_id=$1 AND period=$2 AND source='ATTENDANCE' AND status='INCLUDED'`, [company.id, period]);
  if (used.c) throw conflict("حركات الحضور لهذا الشهر دخلت مسيراً — احذف المسير المسودة أولاً، أو عدّل الحركات يدوياً إن كان مرحّلاً");
  await t.exec(`DELETE FROM payroll_items WHERE company_id=$1 AND period=$2 AND source='ATTENDANCE' AND status='OPEN'`, [company.id, period]);
  const date = sheet.days[sheet.days.length - 1].date > today() ? today() : sheet.days[sheet.days.length - 1].date; let n = 0;
  const add = async (employeeId: string, kind: string, qty: number, note: string) => { const it = await saveItem(t, company.id, user, { employeeId, kind, qty, date, period, note }); await t.exec(`UPDATE payroll_items SET source='ATTENDANCE' WHERE id=$1`, [it.id]); n++; };
  for (const e of sheet.employees) {
    const s = e.summary;
    if (s.absent > 0) await add(e.id, "ABSENCE", s.absent, `غياب ${s.absent} يوم — من سجل الحضور ${period}`);
    if (s.lateMinutes > 0) await add(e.id, "LATE", r2(s.lateMinutes / 60), `تأخير ${s.lateMinutes} دقيقة في ${s.lateDays} يوم — من سجل الحضور ${period}`);
    if (s.overtimeHours > 0) await add(e.id, "OVERTIME", s.overtimeHours, `عمل إضافي ${s.overtimeHours} ساعة — من سجل الحضور ${period}`);
  }
  return { ok: true, created: n };
}
