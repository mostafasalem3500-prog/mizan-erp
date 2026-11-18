/**
 * Periodic financial reports: the written financial report for a month, a quarter or a financial year, issued once
 * the period has ended (automatically by the scheduler, or on demand) and kept as issued — later postings do not
 * change an issued report; it can be re-issued explicitly. Both the Arabic and the English text are stored.
 */
import { Db, db, tx } from "../db/pool";
import { bad, today, isDate, addDays, DEMO_LOADING } from "../lib/core";
import { financialReport, periodOf } from "./finreport";

const KINDS = ["MONTH", "QUARTER", "YEAR"] as const;
const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const iso = (d: any) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);

export function reportTitle(kind: string, from: string, to: string) {
  const y = from.slice(0, 4), mo = Number(from.slice(5, 7));
  if (kind === "MONTH") return `التقرير المالي الشهري — ${MONTHS_AR[mo - 1]} ${y}`;
  if (kind === "QUARTER") return `التقرير المالي الربع السنوي — الربع ${Math.floor((mo - 1) / 3) + 1} ${y}`;
  return `التقرير المالي السنوي — ${from} إلى ${to}`;
}

export async function periodicSettings(t: Db, C: string) {
  const r = await t.one(`SELECT accounting->'periodicReports' s FROM companies WHERE id=$1`, [C]);
  return { MONTH: true, QUARTER: true, YEAR: true, ...(r.s || {}) };
}
export async function savePeriodicSettings(t: Db, C: string, b: any) {
  const s = Object.fromEntries(KINDS.map((k) => [k, b?.[k] !== false]));
  await t.exec(`UPDATE companies SET accounting = jsonb_set(COALESCE(accounting,'{}'::jsonb), '{periodicReports}', $2::jsonb) WHERE id=$1`, [C, JSON.stringify(s)]);
  return s;
}

export async function listReports(t: Db, C: string) {
  const rows = await t.rows(`SELECT id, kind, period_from, period_to, title, level, health, auto, created_by, created_at FROM periodic_reports WHERE company_id=$1 ORDER BY period_to DESC, kind LIMIT 200`, [C]);
  return rows.map((r: any) => ({ ...r, periodFrom: iso(r.periodFrom), periodTo: iso(r.periodTo) }));
}
export async function getReport(t: Db, C: string, id: string, lang?: string) {
  const r = await t.maybe(`SELECT * FROM periodic_reports WHERE company_id=$1 AND id=$2`, [C, id]);
  if (!r) throw bad("التقرير غير موجود");
  return { id: r.id, kind: r.kind, periodFrom: iso(r.periodFrom), periodTo: iso(r.periodTo), title: r.title, auto: r.auto, createdBy: r.createdBy, createdAt: r.createdAt, report: lang === "en" && r.dataEn ? r.dataEn : r.data };
}
export async function deleteReport(t: Db, C: string, id: string) {
  const r = await t.maybe(`DELETE FROM periodic_reports WHERE company_id=$1 AND id=$2 RETURNING id`, [C, id]);
  if (!r) throw bad("التقرير غير موجود");
  return { ok: true };
}

/** Bounds of the period: a calendar month or quarter, or the financial year that contains the date. */
async function bounds(t: Db, C: string, kind: string, date: string) {
  if (kind === "YEAR") {
    const fy = await t.maybe(`SELECT start_date, end_date FROM fiscal_years WHERE company_id=$1 AND $2::date BETWEEN start_date AND end_date`, [C, date]);
    if (fy) return { from: iso(fy.startDate), to: iso(fy.endDate) };
  }
  return periodOf(kind, date);
}

/** Issues (or re-issues) the report of the period containing `date`. A period not yet ended is reported up to today. */
export async function issueReport(t: Db, C: string, user: string, b: any, auto = false) {
  const kind = String(b?.kind || "MONTH").toUpperCase();
  if (!KINDS.includes(kind as any)) throw bad("نوع التقرير غير صحيح (شهري أو ربع سنوي أو سنوي)");
  const date = isDate(b?.date) ? b.date : addDays(today().slice(0, 8) + "01", -1);
  const p = await bounds(t, C, kind, date);
  if (p.from > today()) throw bad("الفترة لم تبدأ بعد");
  const to = p.to > today() ? today() : p.to;
  const [ar, en] = [await financialReport(t, C, { from: p.from, to }), await financialReport(t, C, { from: p.from, to, lang: "en" })];
  const title = reportTitle(kind, p.from, p.to) + (to < p.to ? ` (حتى ${to})` : "");
  const row = await t.one(`INSERT INTO periodic_reports (company_id, kind, period_from, period_to, title, level, health, data, data_en, auto, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)
      ON CONFLICT (company_id, kind, period_from) DO UPDATE SET period_to=EXCLUDED.period_to, title=EXCLUDED.title, level=EXCLUDED.level, health=EXCLUDED.health, data=EXCLUDED.data, data_en=EXCLUDED.data_en, auto=EXCLUDED.auto, created_by=EXCLUDED.created_by, created_at=now()
      RETURNING id`, [C, kind, p.from, to, title, ar.verdict.level, ar.verdict.health, JSON.stringify(ar), JSON.stringify(en), auto, user]);
  return { id: row.id, kind, periodFrom: p.from, periodTo: to, title, level: ar.verdict.level };
}

/**
 * The scheduler's share: after a month ends, each active establishment gets its monthly report, and its quarterly
 * and annual ones when that month closes a quarter or a financial year. Establishments created in the last day
 * (new sign-ups, test runs) are left until they have a full period; a few per pass keep the load low.
 */
export async function runPeriodicReports(limit = 8) {
  const lastEnd = addDays(today().slice(0, 8) + "01", -1), lastStart = lastEnd.slice(0, 8) + "01";
  const due = await db.rows(`SELECT c.id FROM companies c
      WHERE c.status='ACTIVE' AND c.created_at < now() - interval '1 day' AND NOT ${DEMO_LOADING} AND COALESCE((c.accounting->'periodicReports'->>'MONTH')::boolean, true)
        AND EXISTS (SELECT 1 FROM journal_entries e WHERE e.company_id=c.id AND e.status='POSTED' AND e.date BETWEEN $1 AND $2)
        AND NOT EXISTS (SELECT 1 FROM periodic_reports r WHERE r.company_id=c.id AND r.kind='MONTH' AND r.period_from=$1)
      LIMIT $3`, [lastStart, lastEnd, limit]);
  let n = 0;
  for (const { id } of due) {
    await tx(async (t) => {
      const s = await periodicSettings(t, id);
      await issueReport(t, id, "النظام (تقرير دوري)", { kind: "MONTH", date: lastEnd }, true); n++;
      if (s.QUARTER && [3, 6, 9, 12].includes(Number(lastEnd.slice(5, 7)))) { await issueReport(t, id, "النظام (تقرير دوري)", { kind: "QUARTER", date: lastEnd }, true); n++; }
      const fy = await t.maybe(`SELECT 1 FROM fiscal_years WHERE company_id=$1 AND end_date=$2`, [id, lastEnd]);
      if (s.YEAR && (fy || lastEnd.slice(5) === "12-31")) { await issueReport(t, id, "النظام (تقرير دوري)", { kind: "YEAR", date: lastEnd }, true); n++; }
    }).catch((e) => console.error("[periodic-reports]", id, e.message));
  }
  return n;
}

/** On first visit: issue the last completed month's report when the establishment has activity and none exists. */
export async function ensureLatest(t: Db, C: string, user: string) {
  const lastEnd = addDays(today().slice(0, 8) + "01", -1), lastStart = lastEnd.slice(0, 8) + "01";
  const has = await t.maybe(`SELECT 1 FROM periodic_reports WHERE company_id=$1 LIMIT 1`, [C]);
  if (has) return null;
  if (await t.maybe(`SELECT 1 FROM companies c WHERE c.id=$1 AND ${DEMO_LOADING}`, [C])) return null; // not from half-loaded demo data
  const act = await t.maybe(`SELECT 1 FROM journal_entries WHERE company_id=$1 AND status='POSTED' AND date BETWEEN $2 AND $3 LIMIT 1`, [C, lastStart, lastEnd]);
  return act ? issueReport(t, C, user, { kind: "MONTH", date: lastEnd }, true) : null;
}
