/**
 * Allowance for doubtful debts — expected credit losses with a provision matrix (IFRS 9 simplified approach, also
 * IFRS for SMEs impairment): customer balances are aged as at a date, each age band carries a loss rate, and the
 * allowance account is brought to the required amount with one adjusting entry:
 *   increase: Dr bad-debt expense / Cr allowance for doubtful debts
 *   release:  Dr allowance for doubtful debts / Cr bad-debt expense
 * The rates of the last run are the defaults of the next one.
 */
import { Db } from "../db/pool";
import { bad, isDate, today, r2, num } from "../lib/core";
import { post } from "../accounting/engine";
import { aging } from "./reports";

export const BANDS = ["current", "d30", "d60", "d90", "d120"] as const;
type Band = (typeof BANDS)[number];
export const BAND_AR: Record<Band, string> = { current: "لم تستحق", d30: "1–30 يوماً", d60: "31–60 يوماً", d90: "61–90 يوماً", d120: "أكثر من 90 يوماً" };
/** A common starting matrix; each establishment adjusts it to its own collection history. */
export const DEFAULT_RATES: Record<Band, number> = { current: 1, d30: 3, d60: 10, d90: 25, d120: 50 };

function cleanRates(input: any, fallback: Record<Band, number>) {
  const out = { ...fallback };
  for (const b of BANDS) {
    if (input?.[b] === undefined || input[b] === "") continue;
    const v = num(input[b], NaN);
    if (!(v >= 0 && v <= 100)) throw bad(`نسبة «${BAND_AR[b]}» يجب أن تكون بين 0 و100`);
    out[b] = r2(v);
  }
  return out;
}

async function lastRates(t: Db, C: string): Promise<Record<Band, number>> {
  const r = await t.maybe(`SELECT rates FROM ecl_runs WHERE company_id=$1 ORDER BY created_at DESC LIMIT 1`, [C]);
  return r ? { ...DEFAULT_RATES, ...r.rates } : { ...DEFAULT_RATES };
}

async function accounts(t: Db, C: string) {
  const rows = await t.rows(`SELECT id, code, name_ar, system_key FROM accounts WHERE company_id=$1 AND system_key IN ('DOUBTFUL_ALLOWANCE','BAD_DEBT','AR')`, [C]);
  const k = Object.fromEntries(rows.map((r) => [r.systemKey, r]));
  if (!k.DOUBTFUL_ALLOWANCE || !k.BAD_DEBT) throw bad("حسابا مخصص الديون المشكوك فيها ومصروفها غير موجودين في الدليل");
  return k;
}

/** The matrix as at a date: balances per band, the allowance each band needs, and the entry that would bring the books there. */
export async function eclCalc(t: Db, C: string, q: any) {
  const asOf = isDate(q.asOf) ? q.asOf : today();
  const rates = cleanRates(q.rates || q, await lastRates(t, C));
  const acc = await accounts(t, C);
  const ag = await aging(t, C, { to: asOf, role: "CUSTOMER" });
  const bands = BANDS.map((b) => ({ band: b, label: BAND_AR[b], balance: r2(ag.totals[b] || 0), rate: rates[b], provision: r2(((ag.totals[b] || 0) * rates[b]) / 100) }));
  const required = r2(bands.reduce((s, x) => s + x.provision, 0));
  const bal = await t.one(`SELECT COALESCE(SUM(l.credit-l.debit),0) b FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id=$1 AND e.status='POSTED' AND e.date <= $2`, [acc.DOUBTFUL_ALLOWANCE.id, asOf]);
  const existing = r2(bal.b);
  const adjustment = r2(required - existing);
  const customers = ag.rows.map((p: any) => ({ name: p.name, total: p.total, provision: r2(BANDS.reduce((s, b) => s + (p[b] * rates[b]) / 100, 0)) }))
    .filter((p: any) => p.provision > 0).sort((a: any, b: any) => b.provision - a.provision).slice(0, 50);
  const lines = adjustment === 0 ? [] : adjustment > 0
    ? [{ code: acc.BAD_DEBT.code, nameAr: acc.BAD_DEBT.nameAr, debit: adjustment, credit: 0 }, { code: acc.DOUBTFUL_ALLOWANCE.code, nameAr: acc.DOUBTFUL_ALLOWANCE.nameAr, debit: 0, credit: adjustment }]
    : [{ code: acc.DOUBTFUL_ALLOWANCE.code, nameAr: acc.DOUBTFUL_ALLOWANCE.nameAr, debit: -adjustment, credit: 0 }, { code: acc.BAD_DEBT.code, nameAr: acc.BAD_DEBT.nameAr, debit: 0, credit: -adjustment }];
  return { asOf, rates, bands, receivables: r2(ag.totals.total || 0), required, existing, adjustment, coverage: ag.totals.total ? r2((required / ag.totals.total) * 100) : 0, lines, customers };
}

/** Posts the adjusting entry (when there is a difference) and keeps the run. */
export async function eclPost(t: Db, C: string, user: string, b: any) {
  const c = await eclCalc(t, C, b);
  const acc = await accounts(t, C);
  let entryId: string | null = null, number: string | null = null;
  if (c.adjustment !== 0) {
    const a = Math.abs(c.adjustment), up = c.adjustment > 0;
    const memo = `${up ? "تكوين" : "تخفيض"} مخصص الديون المشكوك في تحصيلها كما في ${c.asOf} (المطلوب ${c.required})`;
    const e = await post(t, C, { date: c.asOf, type: "ECL", sourceType: "ECL", memo, createdBy: user, lines: up
      ? [{ account: acc.BAD_DEBT.id, debit: a, description: memo }, { account: acc.DOUBTFUL_ALLOWANCE.id, credit: a, description: memo }]
      : [{ account: acc.DOUBTFUL_ALLOWANCE.id, debit: a, description: memo }, { account: acc.BAD_DEBT.id, credit: a, description: memo }] });
    entryId = e!.id; number = e!.number;
  }
  const run = await t.insert("ecl_runs", { companyId: C, asOf: c.asOf, rates: JSON.stringify(c.rates), receivables: c.receivables, required: c.required, existing: c.existing, adjustment: c.adjustment, entryId, createdBy: user });
  if (entryId) await t.exec(`UPDATE journal_entries SET source_id=$2 WHERE id=$1`, [entryId, run.id]);
  return { ...c, runId: run.id, entryId, entryNumber: number };
}

export async function eclRuns(t: Db, C: string) {
  return t.rows(`SELECT r.*, e.number entry_number, e.reversed_by FROM ecl_runs r LEFT JOIN journal_entries e ON e.id=r.entry_id WHERE r.company_id=$1 ORDER BY r.created_at DESC LIMIT 50`, [C]);
}
