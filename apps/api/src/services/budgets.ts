/** Budgets: yearly plan per account (× optional cost center) by month, and budget-vs-actual reporting. */
import { Db } from "../db/pool";
import { bad, conflict, r2, num, isDate, today } from "../lib/core";

const ZERO = () => Array(12).fill(0);
const cleanMonths = (m: any) => { const a = Array.isArray(m) ? m : []; return ZERO().map((_, i) => r2(num(a[i]))); };

export async function listBudgets(t: Db, companyId: string) {
  return t.rows(`SELECT b.*, (SELECT COUNT(*)::int FROM budget_lines l WHERE l.budget_id=b.id) AS lines_count FROM budgets b WHERE b.company_id=$1 ORDER BY b.year DESC, b.created_at DESC`, [companyId]);
}

export async function getBudget(t: Db, companyId: string, id: string) {
  const b = await t.one(`SELECT * FROM budgets WHERE id=$1 AND company_id=$2`, [id, companyId], "الموازنة غير موجودة");
  const lines = await t.rows(
    `SELECT l.*, a.code, a.name_ar, a.type, a.subtype, c.name AS cost_center FROM budget_lines l JOIN accounts a ON a.id=l.account_id LEFT JOIN cost_centers c ON c.id=l.cost_center_id WHERE l.budget_id=$1 ORDER BY a.code, c.name NULLS FIRST`, [id]);
  return { ...b, lines: lines.map((l) => ({ ...l, months: cleanMonths(l.months), total: r2(cleanMonths(l.months).reduce((a, x) => a + x, 0)) })) };
}

export async function createBudget(t: Db, companyId: string, user: string, b: any) {
  const year = Number(b.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw bad("السنة غير صحيحة");
  const name = String(b.name || `موازنة ${year}`).trim();
  const dup = await t.maybe(`SELECT id FROM budgets WHERE company_id=$1 AND year=$2 AND name=$3`, [companyId, year, name]);
  if (dup) throw conflict("توجد موازنة بنفس الاسم لهذه السنة");
  const row = await t.insert("budgets", { companyId, name, year, notes: b.notes || null, isDemo: !!b.isDemo, createdBy: user });
  if (b.source === "ACTUAL") await fillFromActuals(t, companyId, row.id, Number(b.sourceYear) || year - 1, num(b.growthPct));
  else if (b.source === "ACCOUNTS") {
    // start with every leaf revenue/expense account at zero so the grid is ready to type into
    const accs = await t.rows(`SELECT id FROM accounts WHERE company_id=$1 AND NOT is_group AND is_active AND type IN ('REVENUE','EXPENSE') ORDER BY code`, [companyId]);
    await t.insertMany("budget_lines", accs.map((a) => ({ budgetId: row.id, accountId: a.id, months: ZERO() })));
  }
  return getBudget(t, companyId, row.id);
}

/** Monthly actuals of a year per revenue/expense account, expressed as positive amounts (revenue: credit, expense: debit). */
async function actualsByMonth(t: Db, companyId: string, year: number, byCostCenter = false) {
  return t.rows(
    `SELECT a.id AS account_id, a.type, ${byCostCenter ? "l.cost_center_id" : "NULL::uuid AS cost_center_id"}, EXTRACT(MONTH FROM e.date)::int AS m,
       SUM(CASE WHEN a.type='REVENUE' THEN l.credit-l.debit ELSE l.debit-l.credit END) amt
     FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id
     WHERE a.company_id=$1 AND a.type IN ('REVENUE','EXPENSE') AND e.status='POSTED' AND e.type<>'CLOSING' AND EXTRACT(YEAR FROM e.date)=$2
     GROUP BY 1,2,3,4`, [companyId, year]);
}

export async function fillFromActuals(t: Db, companyId: string, budgetId: string, sourceYear: number, growthPct = 0) {
  const rows = await actualsByMonth(t, companyId, sourceYear);
  const k = 1 + growthPct / 100;
  const by = new Map<string, number[]>();
  for (const r of rows) {
    const arr = by.get(r.accountId) || ZERO();
    arr[r.m - 1] = r2(Number(r.amt) * k);
    by.set(r.accountId, arr);
  }
  await t.exec(`DELETE FROM budget_lines WHERE budget_id=$1`, [budgetId]);
  await t.insertMany("budget_lines", [...by.entries()].map(([accountId, months]) => ({ budgetId, accountId, months })));
  return by.size;
}

export async function saveLines(t: Db, companyId: string, id: string, lines: any[]) {
  const b = await t.one(`SELECT * FROM budgets WHERE id=$1 AND company_id=$2`, [id, companyId], "الموازنة غير موجودة");
  if (b.status !== "DRAFT") throw conflict("الموازنة معتمدة — أعدها إلى مسودة للتعديل");
  if (!Array.isArray(lines)) throw bad("lines مطلوبة");
  await t.exec(`DELETE FROM budget_lines WHERE budget_id=$1`, [id]);
  const seen = new Set<string>();
  const rows: any[] = [];
  for (const l of lines) {
    if (!l.accountId) continue;
    const key = l.accountId + "|" + (l.costCenterId || "");
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ budgetId: id, accountId: l.accountId, costCenterId: l.costCenterId || null, months: cleanMonths(l.months) });
  }
  const ok = await t.rows(`SELECT id FROM accounts WHERE company_id=$1 AND id = ANY($2) AND NOT is_group`, [companyId, rows.map((r) => r.accountId)]);
  if (ok.length !== new Set(rows.map((r) => r.accountId)).size) throw bad("أحد الحسابات غير صالح");
  await t.insertMany("budget_lines", rows);
  return getBudget(t, companyId, id);
}

export async function setStatus(t: Db, companyId: string, id: string, status: string) {
  if (!["DRAFT", "APPROVED"].includes(status)) throw bad("حالة غير صحيحة");
  return t.update("budgets", { id, companyId }, { status });
}

export async function deleteBudget(t: Db, companyId: string, id: string) {
  await t.exec(`DELETE FROM budgets WHERE id=$1 AND company_id=$2`, [id, companyId]);
}

/** Budget vs actual for a date range inside the budget year. Variance sign: favourable = positive. */
export async function budgetVsActual(t: Db, companyId: string, id: string, q: any) {
  const b = await getBudget(t, companyId, id);
  const from = isDate(q.from) ? q.from : `${b.year}-01-01`;
  const td = today();
  const to = isDate(q.to) ? q.to : td >= `${b.year}-01-01` && td <= `${b.year}-12-31` ? td : `${b.year}-12-31`;
  const mFrom = from.slice(0, 4) === String(b.year) ? Number(from.slice(5, 7)) : from < `${b.year}-01-01` ? 1 : 13;
  const mTo = to.slice(0, 4) === String(b.year) ? Number(to.slice(5, 7)) : to > `${b.year}-12-31` ? 12 : 0;
  const hasCC = b.lines.some((l: any) => l.costCenterId);
  const act = await t.rows(
    `SELECT a.id AS account_id, ${hasCC ? "l.cost_center_id" : "NULL::uuid AS cost_center_id"},
       SUM(CASE WHEN a.type='REVENUE' THEN l.credit-l.debit ELSE l.debit-l.credit END) amt
     FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id
     WHERE a.company_id=$1 AND a.type IN ('REVENUE','EXPENSE') AND e.status='POSTED' AND e.type<>'CLOSING' AND e.date BETWEEN $2 AND $3 GROUP BY 1,2`, [companyId, from, to]);
  const actBy = new Map<string, number>();
  for (const r of act) actBy.set(r.accountId + "|" + (hasCC ? r.costCenterId || "" : ""), r2(r.amt));
  const rows = b.lines.map((l: any) => {
    const budget = r2(l.months.slice(Math.max(mFrom, 1) - 1, Math.max(mTo, 0)).reduce((a: number, x: number) => a + x, 0));
    const key = l.accountId + "|" + (hasCC ? l.costCenterId || "" : "");
    const actual = actBy.get(key) || 0;
    actBy.delete(key);
    const variance = l.type === "REVENUE" ? r2(actual - budget) : r2(budget - actual);
    return { accountId: l.accountId, code: l.code, name: l.nameAr, type: l.type, subtype: l.subtype, costCenter: l.costCenter, budget, actual, variance, pct: budget ? r2((actual / budget) * 100) : null, annual: l.total };
  });
  // accounts with actuals but no budget line
  if (actBy.size) {
    const ids = [...actBy.keys()].map((k) => k.split("|")[0]);
    const accs = await t.rows(`SELECT id, code, name_ar, type, subtype FROM accounts WHERE id = ANY($1)`, [ids]);
    for (const [key, actual] of actBy) {
      const a = accs.find((x) => x.id === key.split("|")[0]);
      if (!a || !actual) continue;
      rows.push({ accountId: a.id, code: a.code, name: a.nameAr, type: a.type, subtype: a.subtype, costCenter: null, budget: 0, actual, variance: a.type === "REVENUE" ? actual : -actual, pct: null, annual: 0, unbudgeted: true });
    }
  }
  rows.sort((x: any, y: any) => x.code.localeCompare(y.code));
  const tot = (f: (r: any) => boolean, k: string) => r2(rows.filter(f).reduce((a: number, r: any) => a + r[k], 0));
  const rev = { budget: tot((r) => r.type === "REVENUE", "budget"), actual: tot((r) => r.type === "REVENUE", "actual") };
  const exp = { budget: tot((r) => r.type === "EXPENSE", "budget"), actual: tot((r) => r.type === "EXPENSE", "actual") };
  return { budget: { id: b.id, name: b.name, year: b.year, status: b.status }, from, to, rows, revenue: { ...rev, variance: r2(rev.actual - rev.budget) }, expense: { ...exp, variance: r2(exp.budget - exp.actual) }, net: { budget: r2(rev.budget - exp.budget), actual: r2(rev.actual - exp.actual), variance: r2(rev.actual - exp.actual - (rev.budget - exp.budget)) } };
}
