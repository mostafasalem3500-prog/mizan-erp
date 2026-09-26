/** Fiscal-year closing: zero temporary accounts into retained earnings; reopen reverses it. */
import { Db } from "../db/pool";
import { bad, conflict, r2, D } from "../lib/core";
import { post } from "../accounting/engine";

export async function closeFiscalYear(t: Db, companyId: string, user: string, fiscalYearId: string) {
  const fy = await t.one(`SELECT * FROM fiscal_years WHERE id=$1 AND company_id=$2 FOR UPDATE`, [fiscalYearId, companyId], "السنة المالية غير موجودة");
  if (fy.status === "CLOSED") throw conflict("السنة المالية مقفلة مسبقاً");
  const drafts = await t.one(`SELECT COUNT(*)::int c FROM invoices WHERE company_id=$1 AND status='DRAFT' AND kind IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE') AND date BETWEEN $2 AND $3`, [companyId, fy.startDate, fy.endDate]);
  if (drafts.c > 0) throw bad(`يوجد ${drafts.c} مستند غير مرحل داخل السنة — رحّله أو احذفه قبل الإقفال`);
  const openSessions = await t.one(`SELECT COUNT(*)::int c FROM pos_sessions WHERE company_id=$1 AND status='OPEN'`, [companyId]);
  if (openSessions.c > 0) throw bad("أغلق ورديات نقاط البيع المفتوحة قبل إقفال السنة");
  const bals = await t.rows(
    `SELECT a.id, a.code, a.name_ar, a.type, COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c
     FROM accounts a JOIN journal_lines l ON l.account_id=a.id JOIN journal_entries e ON e.id=l.entry_id
     WHERE a.company_id=$1 AND a.type IN ('REVENUE','EXPENSE') AND e.status='POSTED' AND e.date BETWEEN $2 AND $3
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
  await t.exec(`UPDATE fiscal_years SET status='CLOSED', closing_entry_id=$2, closed_at=now() WHERE id=$1`, [fy.id, entry?.id || null]);
  await t.exec(`UPDATE periods SET status='LOCKED' WHERE fiscal_year_id=$1`, [fy.id]);
  return { entry, netIncome: r2(net), accounts: bals.length };
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
  await t.exec(`UPDATE fiscal_years SET status='OPEN', closing_entry_id=NULL, closed_at=NULL WHERE id=$1`, [fy.id]);
  await t.exec(`UPDATE periods SET status='OPEN' WHERE fiscal_year_id=$1`, [fy.id]);
  return { ok: true };
}
