/** Fiscal-year closing: zero temporary accounts into retained earnings; reopen reverses it. */
import { Db } from "../db/pool";
import { bad, conflict, r2, D } from "../lib/core";
import { post, ensureFiscalYear } from "../accounting/engine";
import { addDays } from "../lib/core";

export async function closeFiscalYear(t: Db, companyId: string, user: string, fiscalYearId: string) {
  const fy = await t.one(`SELECT * FROM fiscal_years WHERE id=$1 AND company_id=$2 FOR UPDATE`, [fiscalYearId, companyId], "السنة المالية غير موجودة");
  if (fy.status === "CLOSED") throw conflict("السنة المالية مقفلة مسبقاً");
  // years close in order: an earlier year with postings that is still open would leave its result outside retained earnings
  const prevOpen = await t.rows(`SELECT y.name FROM fiscal_years y WHERE y.company_id=$1 AND y.start_date < $2 AND y.status='OPEN' AND EXISTS (SELECT 1 FROM journal_entries e WHERE e.company_id=$1 AND e.status='POSTED' AND e.date BETWEEN y.start_date AND y.end_date)`, [companyId, fy.startDate]);
  if (prevOpen.length) throw bad(`أقفل السنوات السابقة أولاً بالتسلسل: ${prevOpen.map((y) => y.name).join("، ")}`);
  const unb = await t.one(`SELECT COUNT(*)::int c FROM (SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id WHERE e.company_id=$1 AND e.status='POSTED' AND e.date BETWEEN $2 AND $3 GROUP BY e.id HAVING SUM(l.debit)<>SUM(l.credit)) x`, [companyId, fy.startDate, fy.endDate]);
  if (unb.c > 0) throw bad(`يوجد ${unb.c} قيد غير متوازن داخل السنة — صححه قبل الإقفال`);
  const drafts = await t.one(`SELECT COUNT(*)::int c FROM invoices WHERE company_id=$1 AND status='DRAFT' AND kind IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE') AND date BETWEEN $2 AND $3`, [companyId, fy.startDate, fy.endDate]);
  if (drafts.c > 0) throw bad(`يوجد ${drafts.c} مستند غير مرحل داخل السنة — رحّله أو احذفه قبل الإقفال`);
  const openSessions = await t.one(`SELECT COUNT(*)::int c FROM pos_sessions WHERE company_id=$1 AND status='OPEN'`, [companyId]);
  if (openSessions.c > 0) throw bad("أغلق ورديات نقاط البيع المفتوحة قبل إقفال السنة");
  const bals = await t.rows(
    `SELECT a.id, a.code, a.name_ar, a.type, COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c
     FROM accounts a JOIN journal_lines l ON l.account_id=a.id JOIN journal_entries e ON e.id=l.entry_id
     WHERE a.company_id=$1 AND a.type IN ('REVENUE','EXPENSE') AND e.status='POSTED' AND e.type<>'CLOSING' AND e.date BETWEEN $2 AND $3
     GROUP BY a.id, a.code, a.name_ar, a.type HAVING COALESCE(SUM(l.debit),0) <> COALESCE(SUM(l.credit),0)`,
    [companyId, fy.startDate, fy.endDate],
  );
  const lines: any[] = [];
  let net = D(0); // credit-positive = profit
  for (const b of bals) {
    const bal = D(b.c).minus(b.d); // credit balance
    if (bal.gt(0)) lines.push({ account: b.id, debit: bal.toNumber(), description: `إقفال ${b.nameAr}` });
    else lines.push({ account: b.id, credit: bal.neg().toNumber(), description: `إقفال ${b.nameAr}` });
    net = net.plus(bal);
  }
  let entry: any = null;
  if (lines.length) {
    const n = r2(net);
    lines.push(n >= 0 ? { key: "RETAINED", credit: n, description: `صافي ربح السنة ${fy.name}` } : { key: "RETAINED", debit: -n, description: `صافي خسارة السنة ${fy.name}` });
    entry = await post(t, companyId, { date: fy.endDate, type: "CLOSING", sourceType: "FISCAL_YEAR", sourceId: fy.id, reference: fy.name, memo: `قيد إقفال السنة المالية ${fy.name}`, createdBy: user, allowClosed: true, lines });
  }
  const summary = { netIncome: r2(net), accounts: bals.length, revenue: r2(bals.filter((b) => b.type === "REVENUE").reduce((a, b) => a + Number(b.c) - Number(b.d), 0)), expenses: r2(bals.filter((b) => b.type === "EXPENSE").reduce((a, b) => a + Number(b.d) - Number(b.c), 0)) };
  await t.exec(`UPDATE fiscal_years SET status='CLOSED', closing_entry_id=$2, closed_at=now(), closed_by=$3, close_summary=$4 WHERE id=$1`, [fy.id, entry?.id || null, user, JSON.stringify(summary)]);
  await t.exec(`UPDATE periods SET status='LOCKED' WHERE fiscal_year_id=$1`, [fy.id]);
  // the next year must exist so the balance sheet carries forward and postings continue without a gap
  const next = await ensureFiscalYear(t, companyId, addDays(fy.endDate, 1));
  return { entry, netIncome: r2(net), accounts: bals.length, nextYear: { id: next.id, name: next.name } };
}

export async function reopenFiscalYear(t: Db, companyId: string, fiscalYearId: string) {
  const fy = await t.one(`SELECT * FROM fiscal_years WHERE id=$1 AND company_id=$2 FOR UPDATE`, [fiscalYearId, companyId], "السنة المالية غير موجودة");
  if (fy.status !== "CLOSED") throw conflict("السنة المالية ليست مقفلة");
  const later = await t.maybe(`SELECT id FROM fiscal_years WHERE company_id=$1 AND start_date > $2 AND status='CLOSED'`, [companyId, fy.endDate]);
  if (later) throw bad("لا يمكن إعادة فتح سنة تليها سنة مقفلة");
  if (fy.closingEntryId) {
    await t.exec(`DELETE FROM journal_lines WHERE entry_id=$1`, [fy.closingEntryId]);
    await t.exec(`DELETE FROM journal_entries WHERE id=$1`, [fy.closingEntryId]);
  }
  await t.exec(`UPDATE fiscal_years SET status='OPEN', closing_entry_id=NULL, closed_at=NULL, closed_by=NULL, close_summary=NULL WHERE id=$1`, [fy.id]);
  await t.exec(`UPDATE periods SET status='OPEN' WHERE fiscal_year_id=$1`, [fy.id]);
  return { ok: true };
}
