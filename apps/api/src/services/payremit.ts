/**
 * Payroll remittances: what the payroll withheld for others and must be paid on.
 *   • Social insurance (employee + employer share) → the insurance authority, by the 15th of the following month
 *     (Saudi GOSI and Egyptian NOSI share that deadline).
 *   • Egypt: salary tax (كسب العمل) + martyrs fund → the tax authority, by the 15th of the following month.
 * A remittance clears the month's liability:  Dr payable(s)  /  Cr bank.  Cancelling reverses the entry.
 */
import { Db } from "../db/pool";
import { bad, conflict, r2, isDate, today, addMonths } from "../lib/core";
import { post, reverse, nextNumber } from "../accounting/engine";
import { IS_EG } from "../lib/country";

export const REMIT_KINDS: Record<string, string> = IS_EG
  ? { INSURANCE: "التأمينات الاجتماعية", SALARY_TAX: "ضريبة كسب العمل وصندوق الشهداء" }
  : { INSURANCE: "التأمينات الاجتماعية (GOSI)" };
/** 15th of the month after the payroll month. */
export const remitDue = (period: string) => addMonths(`${period}-01`, 1).slice(0, 8) + "15";

async function credit(t: Db, companyId: string, keys: string[], to: string) {
  const r = await t.one(`SELECT COALESCE(SUM(l.credit-l.debit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id
    WHERE a.company_id=$1 AND a.system_key = ANY($2) AND e.status='POSTED' AND e.date <= $3`, [companyId, `{${keys.join(",")}}`, to]);
  return r2(r.b);
}

export async function remitSummary(t: Db, companyId: string, q: any = {}) {
  const td = today();
  const year = /^\d{4}$/.test(String(q.year || "")) ? String(q.year) : null;
  const runs = await t.rows(
    `SELECT period, SUM(total_gosi_emp+total_gosi_er) insurance, SUM(total_salary_tax) salary_tax, SUM(total_martyrs) martyrs, SUM(total_gross) gross, COUNT(*)::int runs
       FROM payroll_runs WHERE company_id=$1 AND status IN ('POSTED','PAID') AND ${year ? "period LIKE $2" : "period >= $2"} GROUP BY period ORDER BY period DESC`,
    [companyId, year ? `${year}-%` : addMonths(td.slice(0, 8) + "01", -24).slice(0, 7)]);
  const paid = await t.rows(`SELECT r.*, a.name_ar account_name, j.number journal_number FROM payroll_remittances r LEFT JOIN accounts a ON a.id=r.account_id LEFT JOIN journal_entries j ON j.id=r.journal_id
    WHERE r.company_id=$1 AND r.status='POSTED' ORDER BY r.date DESC, r.created_at DESC`, [companyId]);
  const paidOf = (period: string, kind: string) => r2(paid.filter((p) => p.period === period && p.kind === kind).reduce((a, p) => a + Number(p.amount), 0));
  const rows = runs.map((r) => {
    const due = remitDue(r.period);
    const mk = (kind: string, accrued: number, parts: any) => {
      const done = paidOf(r.period, kind), outstanding = r2(accrued - done);
      return { kind, kindAr: REMIT_KINDS[kind], accrued: r2(accrued), paid: done, outstanding: outstanding > 0.005 ? outstanding : 0, parts, due, late: outstanding > 0.005 && due < td, days: Math.round((Date.parse(due) - Date.parse(td)) / 86400000) };
    };
    const items = [mk("INSURANCE", Number(r.insurance), { insurance: r2(r.insurance) })];
    if (IS_EG) items.push(mk("SALARY_TAX", Number(r.salaryTax) + Number(r.martyrs), { salaryTax: r2(r.salaryTax), martyrs: r2(r.martyrs) }));
    return { period: r.period, gross: r2(r.gross), runs: r.runs, due, items: items.filter((i) => i.accrued > 0.005) };
  });
  const balances: Record<string, number> = { INSURANCE: await credit(t, companyId, ["GOSI_PAYABLE"], td) };
  if (IS_EG) balances.SALARY_TAX = await credit(t, companyId, ["SALARY_TAX_PAYABLE", "MARTYRS_PAYABLE"], td);
  return { kinds: REMIT_KINDS, rows, remittances: paid.slice(0, 60), balances, today: td };
}

export async function remit(t: Db, companyId: string, user: string, b: any) {
  const kind = String(b.kind || ""), period = String(b.period || "");
  if (!REMIT_KINDS[kind]) throw bad("نوع التوريد غير صحيح");
  if (!/^\d{4}-\d{2}$/.test(period)) throw bad("حدد شهر المسير");
  const s = await remitSummary(t, companyId, { year: period.slice(0, 4) });
  const item = s.rows.find((r) => r.period === period)?.items.find((i) => i.kind === kind);
  if (!item) throw bad(`لا يوجد مسير رواتب مرحّل لشهر ${period}`);
  if (!(item.outstanding > 0)) throw conflict(`${REMIT_KINDS[kind]} لشهر ${period} مورَّدة بالكامل`);
  const date = isDate(b.date) ? b.date : today();
  const acc = await t.one(`SELECT id FROM accounts WHERE id=$1 AND company_id=$2 AND is_cash_bank AND NOT is_group`, [b.accountId, companyId], "اختر حساب البنك أو الصندوق");
  const number = await nextNumber(t, companyId, "RMT", date, 4);
  const memo = `توريد ${REMIT_KINDS[kind]} عن شهر ${period} — ${number}${b.reference ? " — " + b.reference : ""}`;
  // the GL payable must cover it: a balance already cleared by a manual entry is not paid twice
  const bal = s.balances[kind] || 0;
  if (bal + 0.005 < item.outstanding) throw conflict(`رصيد الحساب الدائن في الأستاذ (${bal.toFixed(2)}) أقل من المطلوب توريده (${item.outstanding.toFixed(2)}) — يبدو أنه سُدد بقيد يدوي؛ راجع كشف الحساب`);
  let lines: any[]; let parts: any;
  if (kind === "INSURANCE") { lines = [{ key: "GOSI_PAYABLE", debit: item.outstanding, description: memo }]; parts = { insurance: item.outstanding }; }
  else {
    // a partial earlier payment is taken off the tax first
    const martyrs = r2(Math.min(item.parts.martyrs, item.outstanding)), tax = r2(item.outstanding - martyrs);
    lines = [{ key: "SALARY_TAX_PAYABLE", debit: tax, description: memo }, { key: "MARTYRS_PAYABLE", debit: martyrs, description: memo }].filter((l) => l.debit > 0);
    parts = { salaryTax: tax, martyrs };
  }
  lines.push({ account: acc.id, credit: item.outstanding, description: memo });
  const je = await post(t, companyId, { date, type: "PAYMENT", sourceType: "PAYROLL_REMIT", reference: b.reference || number, memo, createdBy: user, lines });
  const row = await t.insert("payroll_remittances", { companyId, number, kind, period, date, amount: item.outstanding, parts: JSON.stringify(parts), accountId: acc.id, reference: b.reference || null, journalId: je!.id, createdBy: user });
  await t.exec(`UPDATE journal_entries SET source_id=$2 WHERE id=$1`, [je!.id, row.id]);
  return row;
}

export async function cancelRemit(t: Db, companyId: string, user: string, id: string) {
  const r = await t.one(`SELECT * FROM payroll_remittances WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "التوريد غير موجود");
  if (r.status !== "POSTED") throw conflict("التوريد ملغى مسبقاً");
  await reverse(t, companyId, r.journalId, today(), `إلغاء التوريد ${r.number}`, user);
  await t.exec(`UPDATE payroll_remittances SET status='CANCELLED' WHERE id=$1`, [id]);
  return { ok: true };
}

/** Dashboard alerts: months whose insurance / salary tax is still in the ledger close to or past the 15th. */
export async function remitAlerts(t: Db, companyId: string) {
  const s = await remitSummary(t, companyId);
  const out: { level: "err" | "warn"; text: string; to: string }[] = [];
  for (const kind of Object.keys(REMIT_KINDS)) {
    let left = s.balances[kind] || 0; // only what the ledger still shows as owed
    const open = s.rows.flatMap((r) => r.items.filter((i) => i.kind === kind && i.outstanding > 0.5).map((i) => ({ ...i, period: r.period }))).sort((a, b) => a.period.localeCompare(b.period));
    let total = 0, n = 0, worst: any = null;
    for (const i of open.reverse()) {
      if (left < 0.5) break;
      const amt = Math.min(left, i.outstanding); left = r2(left - amt);
      if (i.days > 7) continue;
      total = r2(total + amt); n++;
      if (!worst || i.days < worst.days) worst = i;
    }
    if (!worst) continue;
    const sum = total.toLocaleString("en-US", { minimumFractionDigits: 2 });
    out.push({ level: worst.late ? "err" : "warn", to: "/payroll/remittances", text: n === 1
      ? `${worst.kindAr} عن شهر ${worst.period}: ${sum} ${worst.late ? `متأخر ${-worst.days} يوم` : `يُورَّد حتى ${worst.due}`}`
      : `${worst.kindAr}: ${n} أشهر لم تُورَّد بإجمالي ${sum} — أقدمها ${worst.period} متأخر ${-worst.days} يوم` });
  }
  return out;

}
