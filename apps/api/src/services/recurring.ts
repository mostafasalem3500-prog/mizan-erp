/** Recurring templates: expenses, manual journals and sales invoices generated on a schedule. */
import { Db, tx, pool } from "../db/pool";
import { bad, isDate, today, addDays, addMonths } from "../lib/core";
import { createExpense } from "./expenses";
import { manualJournal } from "./misc";
import { saveDraft } from "./invoices";

const step = (d: string, f: string) => (f === "WEEKLY" ? addDays(d, 7) : f === "QUARTERLY" ? addMonths(d, 3) : f === "YEARLY" ? addMonths(d, 12) : addMonths(d, 1));

export async function runTemplate(t: Db, company: any, tpl: any, user: string) {
  const date = tpl.nextDate;
  const body = { ...tpl.payload, date };
  let created: any;
  if (tpl.kind === "EXPENSE") created = await createExpense(t, company.id, user, body);
  else if (tpl.kind === "JOURNAL") created = await manualJournal(t, company.id, user, { ...body, memo: body.memo || tpl.name });
  else if (tpl.kind === "SALE_INVOICE") created = await saveDraft(t, company, user, { ...body, direction: "SALE", kind: "INVOICE" });
  else throw bad("نوع القالب غير معروف");
  const next = step(date, tpl.frequency);
  const active = !tpl.endDate || next <= tpl.endDate;
  await t.exec(`UPDATE recurring_templates SET next_date=$2, last_run=$3, runs=runs+1, is_active=$4 WHERE id=$1`, [tpl.id, next, date, active]);
  return { templateId: tpl.id, name: tpl.name, date, createdId: created?.id, number: created?.number, next };
}

/** Runs every due template (next_date <= today) for one company. Each occurrence is its own transaction. */
export async function runDueForCompany(companyId: string, user: string, upTo = today()) {
  const company = (await pool.query(`SELECT * FROM companies WHERE id=$1`, [companyId])).rows[0];
  const out: any[] = [];
  for (let guard = 0; guard < 200; guard++) {
    const tpl = (await pool.query(`SELECT * FROM recurring_templates WHERE company_id=$1 AND is_active AND next_date <= $2 ORDER BY next_date LIMIT 1`, [companyId, upTo])).rows[0];
    if (!tpl) break;
    const row = camel(tpl);
    try {
      out.push(await tx((t) => runTemplate(t, camel(company), row, user)));
    } catch (e: any) {
      out.push({ templateId: row.id, name: row.name, date: row.nextDate, error: e.message });
      await pool.query(`UPDATE recurring_templates SET is_active=false WHERE id=$1`, [row.id]); // stop a failing template; user re-activates after fixing
    }
  }
  return out;
}

/** Hourly scheduler for all companies with an active subscription. */
export function startRecurringScheduler() {
  const tick = async () => {
    try {
      const rows = (await pool.query(`SELECT DISTINCT r.company_id FROM recurring_templates r JOIN companies c ON c.id=r.company_id WHERE r.is_active AND r.next_date <= $1 AND c.status='ACTIVE' AND (c.subscription_ends_at IS NULL OR c.subscription_ends_at > now())`, [today()])).rows;
      for (const r of rows) await runDueForCompany(r.company_id, "النظام (قيد دوري)");
    } catch (e) {
      console.error("[recurring]", e);
    }
  };
  setTimeout(tick, 15000);
  setInterval(tick, 60 * 60 * 1000);
}

function camel(row: any) {
  const o: any = {};
  for (const k of Object.keys(row)) o[k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())] = row[k];
  return o;
}
