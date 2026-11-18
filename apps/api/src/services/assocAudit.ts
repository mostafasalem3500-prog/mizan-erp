/** Integration audit for the associations edition: proves every association document and its journal
 *  entry agree, and that the ledger balances behind each sub-register (zakat fund, in-kind stock,
 *  custody, project cost centres, members' capital) equal the registers themselves.
 *  Read-only; every finding links to the screen where the document lives. */
import { Db } from "../db/pool";
import { r2, num } from "../lib/core";
import { ensureCharity } from "./charity";
import { zakatFund } from "./charity4";
import { assocChecks, voucherRegister } from "./assoc";

type Item = { type: string; id: string; number: string; date: string; link: string; issue: string };
type Check = { key: string; group: string; title: string; ok: boolean; level: "error" | "warn"; expected?: number; actual?: number; count?: number; items: Item[]; note?: string; labels?: [string, string] };

// each association document, how its amount is read, and which entries belong to it
const DOCS: { type: string; label: string; table: string; amount: string; src: string; link: string; journalCol?: string; liveWhen?: string }[] = [
  { type: "CH_RCPT", label: "سند قبض", table: "charity_receipts", amount: "amount", src: "CHARITY_RECEIPT", link: "/charity/receipts" },
  { type: "CH_DISB", label: "سند صرف", table: "charity_disbursements", amount: "amount", src: "CHARITY_DISB", link: "/charity/disbursements" },
  { type: "CH_INKIND", label: "سند عيني", table: "charity_inkind_docs", amount: "total", src: "CHARITY_INKIND", link: "/charity/inkind" },
  { type: "SHARES", label: "حركة أسهم", table: "assoc_share_txns", amount: "amount", src: "ASSOC_SHARES", link: "/charity/shares" },
  { type: "DIST", label: "توزيع فائض", table: "assoc_distributions", amount: "surplus", src: "ASSOC_DIST", link: "/charity/shares" },
  { type: "DIST_PAY", label: "صرف عائد", table: "assoc_dist_payments", amount: "amount", src: "ASSOC_DIST_PAY", link: "/charity/shares" },
];

export async function integrationAudit(t: Db, companyId: string) {
  await ensureCharity(t, companyId);
  const checks: Check[] = [];
  const add = (c: Omit<Check, "items"> & { items?: Item[] }) => checks.push({ ...c, items: (c.items || []).slice(0, 50), count: c.count ?? (c.items || []).length });
  let docs = 0;

  // 1) document ↔ entry, one by one
  for (const d of DOCS) {
    const rows = await t.rows(
      `SELECT x.id, x.number, x.date::text date, x.status, x.${d.amount} amount, x.journal_id,
         je.status je_status, je.reversed_by, je.total_debit, je.source_type je_src, je.source_id je_sid,
         (SELECT COUNT(*)::int FROM journal_entries l WHERE l.company_id=x.company_id AND l.source_type=$2 AND l.source_id=x.id AND l.type<>'REVERSAL' AND l.reversed_by IS NULL AND l.status='POSTED') live
       FROM ${d.table} x LEFT JOIN journal_entries je ON je.id=x.journal_id WHERE x.company_id=$1`,
      [companyId, d.src],
    );
    docs += rows.length;
    const bad: Item[] = [], cancelled: Item[] = [];
    for (const r of rows) {
      const it = (issue: string): Item => ({ type: d.label, id: r.id, number: r.number, date: r.date, link: d.link, issue });
      if (r.status === "POSTED") {
        const amt = num(r.amount);
        if (amt === 0 && !r.journalId) continue; // e.g. an in-kind document with no value
        if (!r.journalId) bad.push(it("مرحّل بلا قيد"));
        else if (r.jeStatus !== "POSTED") bad.push(it(`قيده بحالة ${r.jeStatus}`));
        else if (r.reversedBy) bad.push(it("قيده معكوس والسند ما زال مرحّلاً"));
        else if (r.jeSrc !== d.src || r.jeSid !== r.id) bad.push(it("القيد مربوط بمستند آخر"));
        else if (Math.abs(num(r.totalDebit) - amt) > 0.01 && d.type !== "DIST") bad.push(it(`مبلغ القيد ${r2(r.totalDebit)} ≠ مبلغ السند ${r2(amt)}`));
        else if (r.live !== 1) bad.push(it(`له ${r.live} قيود سارية`));
      } else if (r.status === "CANCELLED" && r.live > 0) cancelled.push(it("ملغى وقيده لم يُعكس"));
    }
    add({ key: `doc-${d.type}`, group: "المستندات والقيود", title: `كل ${d.label} مرحّل له قيد واحد سارٍ بنفس المبلغ (${rows.filter((r: any) => r.status === "POSTED").length})`, ok: !bad.length, level: "error", items: bad });
    if (rows.some((r: any) => r.status === "CANCELLED")) add({ key: `cancel-${d.type}`, group: "المستندات والقيود", title: `كل ${d.label} ملغى عُكس قيده`, ok: !cancelled.length, level: "error", items: cancelled });
  }

  // custody: a settled custody has one live settlement entry; an unsettled one none
  const cust = await t.rows(
    `SELECT c.id, c.number, c.created_at::date::text date, c.status,
       (SELECT COUNT(*)::int FROM journal_entries l WHERE l.company_id=c.company_id AND l.source_type='CHARITY_CUSTODY' AND l.source_id=c.id AND l.type<>'REVERSAL' AND l.reversed_by IS NULL) live
     FROM charity_custody c WHERE c.company_id=$1`, [companyId]);
  const custBad = cust.filter((c: any) => (c.status === "SETTLED" ? c.live !== 1 : c.live !== 0)).map((c: any) => ({ type: "عهدة", id: c.id, number: c.number, date: c.date, link: "/charity/custody", issue: c.status === "SETTLED" ? `مسوّاة ولها ${c.live} قيد تسوية سارٍ` : "غير مسوّاة ولها قيد تسوية سارٍ" }));
  if (cust.length) add({ key: "custody-settle", group: "المستندات والقيود", title: `قيود تسوية العهد تطابق حالتها (${cust.length})`, ok: !custBad.length, level: "error", items: custBad });

  // 2) entries that point at nothing
  const orphans = await t.rows(
    `SELECT e.id, e.number, e.date::text date, e.source_type FROM journal_entries e
     WHERE e.company_id=$1 AND e.status='POSTED' AND e.type<>'REVERSAL' AND e.reversed_by IS NULL AND e.source_type = ANY($2) AND (e.source_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM charity_receipts WHERE id=e.source_id AND status='POSTED' AND journal_id=e.id UNION ALL SELECT 1 FROM charity_disbursements WHERE id=e.source_id AND status='POSTED' AND journal_id=e.id
       UNION ALL SELECT 1 FROM charity_inkind_docs WHERE id=e.source_id AND status='POSTED' AND journal_id=e.id UNION ALL SELECT 1 FROM assoc_share_txns WHERE id=e.source_id AND status='POSTED' AND journal_id=e.id
       UNION ALL SELECT 1 FROM assoc_distributions WHERE id=e.source_id AND status='POSTED' AND journal_id=e.id UNION ALL SELECT 1 FROM assoc_dist_payments WHERE id=e.source_id AND status='POSTED' AND journal_id=e.id
       UNION ALL SELECT 1 FROM charity_custody WHERE id=e.source_id AND status='SETTLED' AND settle_journal_id=e.id))`,
    [companyId, ["CHARITY_RECEIPT", "CHARITY_DISB", "CHARITY_INKIND", "ASSOC_SHARES", "ASSOC_DIST", "ASSOC_DIST_PAY", "CHARITY_CUSTODY"]],
  );
  add({ key: "orphans", group: "المستندات والقيود", title: "كل قيد جمعية سارٍ مربوط بمستنده المرحّل (لا قيود يتيمة)", ok: !orphans.length, level: "error", items: orphans.map((e: any) => ({ type: "قيد", id: e.id, number: e.number, date: e.date, link: `/journals/${e.id}`, issue: `مستنده (${e.sourceType}) غير موجود أو ملغى أو غير مربوط بهذا القيد` })) });

  // 3) the ledger itself
  const unb = await t.rows(
    `SELECT e.id, e.number, e.date::text date, SUM(l.debit) d, SUM(l.credit) c FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id
     WHERE e.company_id=$1 AND e.status='POSTED' GROUP BY e.id HAVING ABS(SUM(l.debit)-SUM(l.credit))>0.005 OR ABS(SUM(l.debit)-e.total_debit)>0.005`, [companyId]);
  add({ key: "balanced", group: "الأستاذ العام", title: "كل قيد مرحّل متوازن (مدين = دائن = إجمالي القيد)", ok: !unb.length, level: "error", items: unb.map((e: any) => ({ type: "قيد", id: e.id, number: e.number, date: e.date, link: `/journals/${e.id}`, issue: `مدين ${r2(e.d)} / دائن ${r2(e.c)}` })) });
  const tb = await t.one(`SELECT COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE e.company_id=$1 AND e.status='POSTED'`, [companyId]);
  add({ key: "trial", group: "الأستاذ العام", title: "ميزان المراجعة متوازن", ok: Math.abs(num(tb.d) - num(tb.c)) < 0.01, level: "error", expected: r2(tb.d), actual: r2(tb.c), labels: ["المدين", "الدائن"] });
  const neg = await t.rows(
    `SELECT a.id, a.code, a.name_ar, SUM(l.debit-l.credit) bal FROM accounts a JOIN journal_lines l ON l.account_id=a.id JOIN journal_entries e ON e.id=l.entry_id
     WHERE a.company_id=$1 AND (a.is_cash_bank OR a.system_key IN ('CASH','BANK')) AND e.status='POSTED' GROUP BY a.id HAVING SUM(l.debit-l.credit) < -0.005`, [companyId]);
  add({ key: "cash-neg", group: "الأستاذ العام", title: "لا صندوق ولا بنك برصيد سالب", ok: !neg.length, level: "warn", items: neg.map((a: any) => ({ type: "حساب", id: a.id, number: a.code, date: "", link: "/accounts", issue: `${a.nameAr}: ${r2(a.bal)}` })) });

  // 4) sub-registers against the ledger
  const glBal = async (key: string, sign = 1) => {
    const r = await t.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) s FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id WHERE a.company_id=$1 AND a.system_key=$2 AND e.status='POSTED'`, [companyId, key]);
    return r2(num(r.s) * sign);
  };
  const stockReg = r2((await t.one(`SELECT COALESCE(SUM(value),0) s FROM charity_inkind_items WHERE company_id=$1`, [companyId])).s);
  const stockGl = await glBal("CH_INKIND_STOCK");
  add({ key: "inkind", group: "السجلات المساعدة ↔ الأستاذ", title: "مخزون التبرعات العينية في الأستاذ = قيمة أصناف المستودع", ok: Math.abs(stockReg - stockGl) < 0.01, level: "error", expected: stockReg, actual: stockGl });
  const custReg = r2((await t.one(`SELECT COALESCE(SUM(COALESCE(disbursed_amount,0)),0) s FROM charity_custody WHERE company_id=$1 AND status='DISBURSED'`, [companyId])).s);
  const custGl = await glBal("CH_CUSTODY");
  add({ key: "custody", group: "السجلات المساعدة ↔ الأستاذ", title: "حساب العهد في الأستاذ = العهد المصروفة غير المسوّاة", ok: Math.abs(custReg - custGl) < 0.01, level: "warn", expected: custReg, actual: custGl, note: "الفرق ينتج عادة من قيد يدوي على حساب العهد خارج شاشة العهد" });
  const z = await zakatFund(t, companyId);
  const zGl = r2(-(await glBal("DON_ZAKAT")));
  add({ key: "zakat", group: "السجلات المساعدة ↔ الأستاذ", title: `صندوق الزكاة: المحصّل ${z.received} − المصروف ${z.distributed} = المتاح ${z.available} (لا يكون سالباً)`, ok: z.available >= -0.005, level: "error", expected: z.received, actual: zGl, labels: ["المحصّل في السندات", "إيراد الزكاة في الأستاذ"] });
  if (Math.abs(z.received - zGl) > 0.01) add({ key: "zakat-gl", group: "السجلات المساعدة ↔ الأستاذ", title: "إيراد الزكاة في الأستاذ = سندات قبض الزكاة", ok: false, level: "warn", expected: z.received, actual: zGl, note: "سند زكاة سُجّل على حساب إيراد آخر، أو قيد يدوي على حساب الزكاة" });

  // project cost centres: what the documents say each project received and spent = what the ledger carries on its centre
  const pj = await t.rows(
    `SELECT p.id, p.code, p.name, p.cost_center_id,
       (SELECT COALESCE(SUM(amount),0) FROM charity_receipts WHERE company_id=p.company_id AND project_id=p.id AND status='POSTED') rin,
       (SELECT COALESCE(SUM(amount),0) FROM charity_disbursements WHERE company_id=p.company_id AND project_id=p.id AND status='POSTED') dout,
       (SELECT COALESCE(SUM(l.credit-l.debit),0) FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE e.company_id=p.company_id AND e.status='POSTED' AND e.source_type='CHARITY_RECEIPT' AND l.cost_center_id=p.cost_center_id) gin,
       (SELECT COALESCE(SUM(l.debit-l.credit),0) FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE e.company_id=p.company_id AND e.status='POSTED' AND e.source_type='CHARITY_DISB' AND l.cost_center_id=p.cost_center_id) gout
     FROM charity_projects p WHERE p.company_id=$1 AND p.cost_center_id IS NOT NULL ORDER BY p.code`, [companyId]);
  const pjBad = pj.filter((p: any) => Math.abs(num(p.rin) - num(p.gin)) > 0.01 || Math.abs(num(p.dout) - num(p.gout)) > 0.01)
    .map((p: any) => ({ type: "مشروع", id: p.id, number: p.code, date: "", link: "/charity/projects", issue: `مقبوض ${r2(p.rin)} مقابل ${r2(p.gin)} في الأستاذ، مصروف ${r2(p.dout)} مقابل ${r2(p.gout)}` }));
  add({ key: "projects", group: "السجلات المساعدة ↔ الأستاذ", title: `مقبوضات ومصروفات كل مشروع = حركة مركز تكلفته في الأستاذ (${pj.length})`, ok: !pjBad.length, level: "error", items: pjBad });

  for (const c of await assocChecks(t, companyId)) add({ key: "assoc-" + c.name, group: "السجلات المساعدة ↔ الأستاذ", title: c.name, ok: c.ok, level: "error", expected: c.expected, actual: c.actual });

  // 5) the cash/bank side of every voucher, both systems
  const vr = await voucherRegister(t, companyId, { from: "2000-01-01", to: "2999-12-31" });
  add({ key: "vouchers", group: "الصندوق والبنك", title: `كل سند (الجمعية والمحاسبي) حرّك الصندوق/البنك بمبلغه بالضبط (${vr.rows.length})`, ok: !vr.mismatches, level: "error",
    items: vr.rows.filter((r: any) => !r.ok).map((r: any) => ({ type: r.src, id: r.id, number: r.number, date: String(r.date).slice(0, 10), link: "/charity/vouchers", issue: `السند ${r2(r.amount)} والقيد على ${r.cashName || "الحساب"} ${r2(r.journalAmount)}` })) });

  const errors = checks.filter((c) => !c.ok && c.level === "error").length, warnings = checks.filter((c) => !c.ok && c.level === "warn").length;
  const entries = (await t.one(`SELECT COUNT(*)::int n FROM journal_entries WHERE company_id=$1 AND status='POSTED'`, [companyId])).n;
  return { ok: !errors, errors, warnings, docs, entries, checks, at: new Date().toISOString() };
}
