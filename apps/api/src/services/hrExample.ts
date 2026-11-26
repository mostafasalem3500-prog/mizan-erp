/**
 * 3.52.0 worked example for the HR file, flagged as sample data, on the sample employees: identity documents and
 * insurance with their expiry (an iqama and work permit about to lapse, a driving licence lapsed), leave requests waiting for approval,
 * someone on leave today, a fixed-term contract ending soon and a raise that starts next month.
 */
import { Db } from "../db/pool";
import { today, addDays, addMonths } from "../lib/core";
import { saveDocument, requestLeave, salaryChange, ensureLeaveTypes } from "./hrcore";

export async function seedHrExample(t: Db, C: string, user: string) {
  // the four on the payroll today (the sample driver left with a final settlement)
  const emps = await t.rows(`SELECT * FROM employees WHERE company_id=$1 AND is_demo AND is_active ORDER BY code`, [C]);
  if (emps.length < 4) return { ok: false };
  const td = today(), D = { isDemo: true };
  const [ahmed, sara, mohammed, rahul] = emps;
  const types = await ensureLeaveTypes(t, C);
  // the Egyptian set has no marriage leave: the one off today is on exam leave there
  const today1 = types.some((x: any) => x.code === "MARRIAGE" && x.isActive) ? { type: "MARRIAGE", reason: "زواج" } : { type: "EXAM", reason: "امتحان" };
  const doc = (e: any, kind: string, number: string, expiry: string | null, issue?: string) => saveDocument(t, C, user, { employeeId: e.id, kind, number, issueDate: issue || null, expiryDate: expiry }, undefined, D);
  await doc(ahmed, "NATIONAL_ID", ahmed.idNumber, addMonths(td, 40));
  await doc(sara, "NATIONAL_ID", sara.idNumber, addMonths(td, 28));
  await doc(mohammed, "NATIONAL_ID", mohammed.idNumber, addMonths(td, 52));
  await doc(rahul, "IQAMA", rahul.idNumber, addDays(td, 18), addDays(addMonths(td, -12), 18));
  await doc(rahul, "PASSPORT", "Z4417852", addMonths(td, 30));
  await doc(ahmed, "DRIVING_LICENSE", "DL-10293", addDays(td, -5));
  await doc(rahul, "WORK_PERMIT", "WP-55120", addDays(td, 18));
  for (const e of emps) await doc(e, "HEALTH_INSURANCE", `BUPA-${String(e.code).slice(-3)}`, addMonths(td, 4));
  // contracts: a fixed-term one ending soon, a probation ending this month for the newest
  await t.exec(`UPDATE employees SET contract_type='FIXED', contract_end=$2 WHERE id=$1`, [rahul.id, addDays(td, 45)]);
  await t.exec(`UPDATE employees SET probation_end=$2 WHERE id=$1`, [mohammed.id, addDays(td, 12)]);
  // leave: someone off today, two requests to decide
  await requestLeave(t, C, user, { employeeId: sara.id, type: today1.type, fromDate: addDays(td, -1), toDate: addDays(td, 3), approve: true, reason: today1.reason }, D);
  await requestLeave(t, C, user, { employeeId: rahul.id, type: "SICK", fromDate: addDays(td, 2), toDate: addDays(td, 4), reason: "تقرير طبي — التهاب" }, D);
  await requestLeave(t, C, user, { employeeId: ahmed.id, type: "ANNUAL", fromDate: addDays(td, 20), toDate: addDays(td, 29), reason: "إجازة عائلية" }, D);
  // a 10% raise for the storekeeper from the first of next month
  await salaryChange(t, C, user, mohammed.id, { effectiveDate: addMonths(td.slice(0, 8) + "01", 1), basic: Math.round(Number(mohammed.basic) * 1.1), housing: Math.round(Number(mohammed.housing) * 1.1), reason: "ترقية بعد التقييم السنوي" }, D);
  return { ok: true };
}
