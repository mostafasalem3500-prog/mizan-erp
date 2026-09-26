/**
 * Bank statement import & matching: statement lines (from CSV/Excel) are matched to
 * un-cleared journal lines of the bank account by amount and date proximity, then cleared
 * through the existing reconciliation tables. Unmatched lines can be turned into vouchers.
 */
import { createHash } from "crypto";
import { Db } from "../db/pool";
import { bad, r2, num, isDate, addDays } from "../lib/core";

export interface StatementRow { date: string; description?: string; reference?: string; debit?: number; credit?: number; amount?: number; balance?: number | null }

export async function importStatement(t: Db, companyId: string, accountId: string, rows: StatementRow[], batch: string) {
  const acc = await t.one(`SELECT id FROM accounts WHERE id=$1 AND company_id=$2 AND is_cash_bank`, [accountId, companyId], "حساب البنك غير موجود");
  if (!Array.isArray(rows) || !rows.length) throw bad("لا توجد سطور للاستيراد");
  let inserted = 0, skipped = 0;
  for (const r of rows) {
    const date = normDate(r.date);
    if (!date) { skipped++; continue; }
    // amount: signed (deposit +, withdrawal −) or debit/credit columns (bank perspective: credit = money in)
    let amount = r.amount !== undefined && r.amount !== null && String(r.amount) !== "" ? r2(num(r.amount)) : r2(num(r.credit) - num(r.debit));
    if (!amount) { skipped++; continue; }
    const description = String(r.description || "").trim().slice(0, 300) || null;
    const reference = String(r.reference || "").trim().slice(0, 100) || null;
    const balance = r.balance === undefined || r.balance === null || String(r.balance) === "" ? null : r2(num(r.balance));
    const fingerprint = createHash("sha1").update([date, amount.toFixed(2), description || "", reference || "", balance ?? ""].join("|")).digest("hex");
    const n = await t.exec(`INSERT INTO bank_statement_lines(company_id, account_id, date, description, reference, amount, balance, batch, fingerprint) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (account_id, fingerprint) WHERE fingerprint IS NOT NULL DO NOTHING`, [companyId, acc.id, date, description, reference, amount, balance, batch, fingerprint]);
    if (n) inserted++; else skipped++;
  }
  return { inserted, skipped };
}

function normDate(v: any): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") { // Excel serial
    const d = new Date(Math.round((v - 25569) * 86400000));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (isDate(s)) return s;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; // dd/mm/yyyy (Saudi banks)
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Open statement lines with a suggested journal line (same amount, ±windowDays, not cleared, not matched). */
export async function suggestMatches(t: Db, companyId: string, accountId: string, windowDays = 5) {
  const open = await t.rows(`SELECT * FROM bank_statement_lines WHERE company_id=$1 AND account_id=$2 AND status='OPEN' ORDER BY date, created_at`, [companyId, accountId]);
  const candidates = await t.rows(
    `SELECT l.id, l.debit, l.credit, l.description, e.date, e.number, e.memo, e.reference, e.type
     FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id LEFT JOIN bank_cleared_lines c ON c.line_id=l.id
     WHERE l.account_id=$1 AND e.status='POSTED' AND c.line_id IS NULL AND NOT EXISTS (SELECT 1 FROM bank_statement_lines s WHERE s.matched_line_id=l.id)
     ORDER BY e.date`, [accountId]);
  const used = new Set<string>();
  const out = open.map((s) => {
    const amt = Number(s.amount);
    const best = candidates
      .filter((c) => !used.has(c.id) && Math.abs((amt > 0 ? Number(c.debit) : Number(c.credit)) - Math.abs(amt)) < 0.005 && (amt > 0 ? Number(c.debit) : Number(c.credit)) > 0)
      .map((c) => ({ c, dist: Math.abs((Date.parse(String(c.date).slice(0, 10)) - Date.parse(String(s.date).slice(0, 10))) / 86400000) }))
      .filter((x) => x.dist <= windowDays)
      .sort((a, b) => a.dist - b.dist)[0];
    if (best) used.add(best.c.id);
    return { ...s, suggestion: best ? { ...best.c, daysApart: best.dist } : null };
  });
  const unclearedCount = candidates.length - used.size;
  return { rows: out, unclearedJournalLines: unclearedCount, candidates: candidates.slice(0, 500) };
}

export async function confirmMatch(t: Db, companyId: string, statementLineId: string, journalLineId: string) {
  const s = await t.one(`SELECT * FROM bank_statement_lines WHERE id=$1 AND company_id=$2 FOR UPDATE`, [statementLineId, companyId], "سطر الكشف غير موجود");
  if (s.status !== "OPEN") throw bad("سطر الكشف مطابَق مسبقاً");
  const l = await t.one(`SELECT l.id, l.debit, l.credit FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.id=$1 AND l.account_id=$2 AND e.status='POSTED'`, [journalLineId, s.accountId], "حركة الحساب غير موجودة");
  const amt = Number(s.amount);
  if (Math.abs((amt > 0 ? Number(l.debit) : Number(l.credit)) - Math.abs(amt)) > 0.005) throw bad("مبلغ الحركة لا يساوي مبلغ سطر الكشف");
  await t.exec(`INSERT INTO bank_cleared_lines(line_id, company_id, cleared_date) VALUES ($1,$2,$3) ON CONFLICT (line_id) DO UPDATE SET cleared_date=EXCLUDED.cleared_date`, [l.id, companyId, String(s.date).slice(0, 10)]);
  await t.exec(`UPDATE bank_statement_lines SET status='MATCHED', matched_line_id=$2 WHERE id=$1`, [s.id, l.id]);
  return { ok: true };
}

export async function unmatch(t: Db, companyId: string, statementLineId: string) {
  const s = await t.one(`SELECT * FROM bank_statement_lines WHERE id=$1 AND company_id=$2 FOR UPDATE`, [statementLineId, companyId], "سطر الكشف غير موجود");
  if (s.matchedLineId) await t.exec(`DELETE FROM bank_cleared_lines WHERE line_id=$1 AND reconciliation_id IS NULL`, [s.matchedLineId]);
  await t.exec(`UPDATE bank_statement_lines SET status='OPEN', matched_line_id=NULL WHERE id=$1`, [s.id]);
  return { ok: true };
}

export async function setIgnored(t: Db, companyId: string, statementLineId: string, ignored: boolean) {
  await t.exec(`UPDATE bank_statement_lines SET status=$3 WHERE id=$1 AND company_id=$2 AND status<>'MATCHED'`, [statementLineId, companyId, ignored ? "IGNORED" : "OPEN"]);
  return { ok: true };
}

export async function statementSummary(t: Db, companyId: string, accountId: string) {
  const r = await t.one(`SELECT COUNT(*) FILTER (WHERE status='OPEN')::int open, COUNT(*) FILTER (WHERE status='MATCHED')::int matched, COUNT(*) FILTER (WHERE status='IGNORED')::int ignored, MAX(date) last_date, COALESCE(SUM(amount) FILTER (WHERE status='OPEN'),0) open_amount FROM bank_statement_lines WHERE company_id=$1 AND account_id=$2`, [companyId, accountId]);
  return { ...r, openAmount: r2(r.openAmount) };
}

export const windowFrom = (d: string, n: number) => addDays(d, -n);
