/**
 * Smart auditor: the journal-analytics an external auditor runs (and that AI assistants such as Claude are asked for),
 * done on the books themselves — every test is a rule with its reason, so each finding says why it was raised and
 * where to look. Findings: possible duplicate supplier invoices, expenses and payments; manual entries on a weekend,
 * late at night, in round amounts, on control accounts that have their own sub-ledger, or dated far back; expenses far
 * above what their account usually takes; sales below cost; a high share of credit notes for a customer; negative
 * cash; and the first-digit distribution (Benford's law) of purchases and expenses. A finding the user has explained
 * is dismissed with a note and stays hidden.
 */
import { Db } from "../db/pool";
import { bad, num, r2, today, addDays, isDate } from "../lib/core";
import { settingsOf as attendanceSettings } from "./attendance";
import { IS_EG } from "../lib/country";

export type Finding = { kind: string; severity: "high" | "medium" | "low" | "info"; title: string; detail: string; amount?: number; date?: string; ref: string; to?: string };
const iso = (d: any) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
export const KINDS: Record<string, { title: string; why: string }> = {
  DUP_BILL: { title: "فاتورة مشتريات مكررة محتملة", why: "نفس المورد بنفس رقم فاتورته، أو بنفس المبلغ خلال 5 أيام — السداد مرتين أشهر أخطاء الدفع." },
  DUP_EXPENSE: { title: "مصروف مكرر محتمل", why: "نفس الحساب والمبلغ والمستفيد خلال 3 أيام." },
  DUP_PAYMENT: { title: "سند صرف مكرر محتمل", why: "سندا صرف لنفس المورد بنفس المبلغ خلال 3 أيام." },
  WEEKEND: { title: "قيد يدوي في يوم عطلة", why: "القيود اليدوية في أيام العطلة أقل خضوعاً للرقابة المعتادة." },
  AFTER_HOURS: { title: "قيد يدوي أُدخل ليلاً", why: "أُدخل بين العاشرة مساءً والخامسة فجراً." },
  ROUND: { title: "قيد يدوي بمبلغ مقرَّب كبير", why: "مبالغ مثل 50,000 بالضبط تكون غالباً تقديراً لا مستنداً." },
  CONTROL: { title: "قيد يدوي على حساب له دفتر مساعد", why: "العملاء والموردون والمخزون والضريبة تُسجَّل من مستنداتها؛ القيد اليدوي عليها لا يظهر في الدفتر المساعد فيختل التطابق." },
  BACKDATED: { title: "قيد بتاريخ قديم", why: "تاريخ القيد أقدم من تاريخ إدخاله بأكثر من 30 يوماً." },
  OUTLIER: { title: "مصروف أعلى كثيراً من المعتاد لحسابه", why: "أكبر من المتوسط بأكثر من ثلاثة انحرافات معيارية وضعف المتوسط، مقارنة بآخر 12 شهراً." },
  BELOW_COST: { title: "بيع بأقل من التكلفة", why: "صافي سعر البيع أقل من متوسط تكلفة الصنف وقت البيع." },
  CREDIT_NOTES: { title: "نسبة مرتجعات عالية لعميل", why: "الإشعارات الدائنة أكثر من 20% من مبيعاته في الفترة." },
  NEGATIVE_CASH: { title: "رصيد صندوق أو بنك سالب", why: "الصندوق لا يكون سالباً؛ غالباً مقبوضات لم تُسجَّل أو مدفوعات سُجلت على الحساب الخطأ." },
  BENFORD: { title: "توزيع الأرقام الأولى (قانون بنفورد)", why: "في البيانات المالية الطبيعية يبدأ نحو 30% من المبالغ بالرقم 1؛ الانحراف الكبير قد يدل على مبالغ مصطنعة أو مكررة." },
};

/** Mean absolute deviation from Benford's first-digit proportions (Nigrini: > 0.015 nonconformity, 0.012–0.015 marginal). */
export function benford(amounts: number[]) {
  const expect = Array.from({ length: 9 }, (_, i) => Math.log10(1 + 1 / (i + 1)));
  const counts = Array(9).fill(0);
  let n = 0;
  for (const a of amounts) { const x = Math.abs(a); if (x < 10) continue; const d = Number(String(Math.floor(x))[0]); if (d >= 1) { counts[d - 1]++; n++; } }
  const actual = counts.map((c) => (n ? c / n : 0));
  const mad = n ? actual.reduce((s, a, i) => s + Math.abs(a - expect[i]), 0) / 9 : 0;
  return { n, mad: Math.round(mad * 10000) / 10000, level: mad > 0.015 ? "nonconformity" : mad > 0.012 ? "marginal" : mad > 0.006 ? "acceptable" : "close", digits: counts.map((c, i) => ({ digit: i + 1, count: c, actual: Math.round(actual[i] * 1000) / 10, expected: Math.round(expect[i] * 1000) / 10 })) };
}

export async function auditScan(t: Db, company: any, q: { from?: string; to?: string; showDismissed?: boolean }) {
  const C = company.id;
  const to = isDate(q.to) ? String(q.to) : today();
  const from = isDate(q.from) ? String(q.from) : addDays(to, -90);
  if (from > to) throw bad("بداية الفترة بعد نهايتها");
  const weekend = attendanceSettings(company).weekend;
  const P = [C, from, to];
  const [dupRef, dupAmt, dupExp, dupPay, manual, outl, below, cn, cash, amounts, dismissed] = await Promise.all([
    t.rows(`SELECT a.id, a.number, a.partner_name, a.supplier_ref, a.total, a.date, b.id bid, b.number bnum FROM invoices a JOIN invoices b ON b.company_id=a.company_id AND b.partner_id=a.partner_id AND b.id>a.id AND b.direction='PURCHASE' AND b.kind='INVOICE' AND b.status='POSTED'
              AND lower(trim(b.supplier_ref))=lower(trim(a.supplier_ref))
            WHERE a.company_id=$1 AND a.direction='PURCHASE' AND a.kind='INVOICE' AND a.status='POSTED' AND COALESCE(trim(a.supplier_ref),'')<>'' AND (a.date BETWEEN $2 AND $3 OR b.date BETWEEN $2 AND $3) LIMIT 50`, P),
    t.rows(`SELECT a.id, a.number, a.partner_name, a.total, a.date, b.id bid, b.number bnum, b.date bdate FROM invoices a JOIN invoices b ON b.company_id=a.company_id AND b.partner_id=a.partner_id AND b.id>a.id AND b.direction='PURCHASE' AND b.kind='INVOICE' AND b.status='POSTED'
              AND b.total=a.total AND abs(b.date - a.date) <= 5 AND lower(trim(COALESCE(b.supplier_ref,''))) IS DISTINCT FROM lower(trim(COALESCE(a.supplier_ref,'x')))
            WHERE a.company_id=$1 AND a.direction='PURCHASE' AND a.kind='INVOICE' AND a.status='POSTED' AND a.total >= 100 AND (a.date BETWEEN $2 AND $3 OR b.date BETWEEN $2 AND $3) LIMIT 50`, P),
    t.rows(`SELECT a.id, a.number, a.description, a.total, a.date, b.id bid, b.number bnum, COALESCE(a.payee, '') payee, x.name_ar account FROM expenses a JOIN expenses b ON b.company_id=a.company_id AND b.id>a.id AND b.status='POSTED' AND b.account_id=a.account_id AND b.total=a.total
              AND abs(b.date - a.date) <= 3 AND COALESCE(b.partner_id::text, lower(trim(b.payee)), '') = COALESCE(a.partner_id::text, lower(trim(a.payee)), '') JOIN accounts x ON x.id=a.account_id
            WHERE a.company_id=$1 AND a.status='POSTED' AND a.total >= 50 AND a.date BETWEEN $2 AND $3 LIMIT 50`, P),
    t.rows(`SELECT a.id, a.number, a.amount, a.date, b.number bnum, p.name FROM payments a JOIN payments b ON b.company_id=a.company_id AND b.id>a.id AND b.direction='OUT' AND b.status='POSTED' AND b.partner_id=a.partner_id AND b.amount=a.amount AND abs(b.date - a.date) <= 3
              JOIN partners p ON p.id=a.partner_id WHERE a.company_id=$1 AND a.direction='OUT' AND a.status='POSTED' AND a.amount >= 100 AND a.date BETWEEN $2 AND $3 LIMIT 50`, P),
    t.rows(`SELECT e.id, e.number, e.date, e.memo, e.created_by, e.created_at, e.total_debit, EXTRACT(DOW FROM e.date)::int dow, EXTRACT(HOUR FROM (e.created_at AT TIME ZONE $4))::int hr,
                   (e.created_at AT TIME ZONE $4)::date - e.date late,
                   (SELECT string_agg(DISTINCT a.name_ar || ' (' || a.code || ')', '، ') FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE l.entry_id=e.id AND a.system_key IN ('AR','AP','INVENTORY','VAT_IN','VAT_OUT')) control,
                   (SELECT MAX(GREATEST(l.debit,l.credit)) FROM journal_lines l WHERE l.entry_id=e.id) big
              FROM journal_entries e WHERE e.company_id=$1 AND e.status='POSTED' AND e.type='MANUAL' AND e.reversed_by IS NULL AND e.reversal_of IS NULL AND e.date BETWEEN $2 AND $3 ORDER BY e.date DESC LIMIT 2000`, [...P, IS_EG ? "Africa/Cairo" : "Asia/Riyadh"]),
    t.rows(`WITH h AS (SELECT account_id, AVG(total) m, STDDEV_SAMP(total) sd, COUNT(*) n FROM expenses WHERE company_id=$1 AND status='POSTED' AND date BETWEEN ($2::date - 365) AND $3 GROUP BY 1 HAVING COUNT(*) >= 8)
            SELECT x.id, x.number, x.description, x.total, x.date, a.name_ar account, h.m, h.sd FROM expenses x JOIN h ON h.account_id=x.account_id JOIN accounts a ON a.id=x.account_id
             WHERE x.company_id=$1 AND x.status='POSTED' AND x.date BETWEEN $2 AND $3 AND h.sd > 0 AND x.total > h.m + 3*h.sd AND x.total > 2*h.m ORDER BY x.total DESC LIMIT 30`, P),
    t.rows(`SELECT i.id, i.number, i.date, i.partner_name, SUM(l.qty*l.factor*l.unit_cost - l.net_amount) loss
              FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id JOIN products p ON p.id=l.product_id
             WHERE i.company_id=$1 AND i.direction='SALE' AND i.kind='INVOICE' AND i.status='POSTED' AND i.date BETWEEN $2 AND $3 AND p.type='STOCK' AND l.unit_cost > 0 AND l.net_amount < l.qty*l.factor*l.unit_cost - 0.01
             GROUP BY i.id ORDER BY 5 DESC LIMIT 30`, P),
    t.rows(`SELECT partner_id, MAX(partner_name) name, SUM(CASE WHEN kind='INVOICE' THEN taxable ELSE 0 END) sales, SUM(CASE WHEN kind='CREDIT_NOTE' THEN taxable ELSE 0 END) returns
              FROM invoices WHERE company_id=$1 AND direction='SALE' AND status='POSTED' AND date BETWEEN $2 AND $3 AND kind IN ('INVOICE','CREDIT_NOTE') GROUP BY 1
            HAVING SUM(CASE WHEN kind='CREDIT_NOTE' THEN taxable ELSE 0 END) > 0.2 * SUM(CASE WHEN kind='INVOICE' THEN taxable ELSE 0 END) AND SUM(CASE WHEN kind='CREDIT_NOTE' THEN taxable ELSE 0 END) >= 500`, P),
    t.rows(`SELECT a.id, a.code, a.name_ar, SUM(l.debit - l.credit) b FROM accounts a JOIN journal_lines l ON l.account_id=a.id JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED'
             WHERE a.company_id=$1 AND a.is_cash_bank AND NOT a.is_group AND e.date <= $2 GROUP BY a.id HAVING SUM(l.debit - l.credit) < -0.01`, [C, to]),
    t.rows(`SELECT total v FROM invoices WHERE company_id=$1 AND direction='PURCHASE' AND kind='INVOICE' AND status='POSTED' AND date BETWEEN $2 AND $3
            UNION ALL SELECT total FROM expenses WHERE company_id=$1 AND status='POSTED' AND date BETWEEN $2 AND $3`, P),
    t.rows(`SELECT d.id, d.kind, d.ref, d.note, d.dismissed_by, d.dismissed_at, (SELECT json_agg(json_build_object('id', a.id, 'name', a.name)) FROM attachments a WHERE a.company_id=d.company_id AND a.entity='audit' AND a.entity_id=d.id) files FROM audit_dismissals d WHERE d.company_id=$1`, [C]),
  ]);

  const out: Finding[] = [];
  for (const r of dupRef) out.push({ kind: "DUP_BILL", severity: "high", title: KINDS.DUP_BILL.title, detail: `${r.partnerName}: الفاتورتان ${r.number} و${r.bnum} تحملان رقم فاتورة المورد نفسه «${r.supplierRef}».`, amount: Number(r.total), date: iso(r.date), ref: `${r.id}:${r.bid}`, to: `/doc/${r.bid}` });
  for (const r of dupAmt) if (!out.some((f) => f.ref === `${r.id}:${r.bid}`)) out.push({ kind: "DUP_BILL", severity: "medium", title: KINDS.DUP_BILL.title, detail: `${r.partnerName}: ${r.number} (${iso(r.date)}) و${r.bnum} (${iso(r.bdate)}) بالمبلغ نفسه خلال أيام.`, amount: Number(r.total), date: iso(r.date), ref: `${r.id}:${r.bid}`, to: `/doc/${r.bid}` });
  for (const r of dupExp) out.push({ kind: "DUP_EXPENSE", severity: "medium", title: KINDS.DUP_EXPENSE.title, detail: `${r.number} و${r.bnum} — ${r.account}${r.payee ? ` — ${r.payee}` : ""}: «${r.description}».`, amount: Number(r.total), date: iso(r.date), ref: `${r.id}:${r.bid}`, to: "/expenses" });
  for (const r of dupPay) out.push({ kind: "DUP_PAYMENT", severity: "high", title: KINDS.DUP_PAYMENT.title, detail: `${r.name}: السندان ${r.number} و${r.bnum}.`, amount: Number(r.amount), date: iso(r.date), ref: `${r.id}`, to: "/vouchers" });
  for (const e of manual) {
    const base = { amount: Number(e.totalDebit), date: iso(e.date), to: `/journals/${e.id}` };
    const label = `القيد ${e.number}${e.memo ? ` «${String(e.memo).slice(0, 60)}»` : ""}${e.createdBy ? ` — ${e.createdBy}` : ""}`;
    if (weekend.includes(e.dow)) out.push({ kind: "WEEKEND", severity: "low", title: KINDS.WEEKEND.title, detail: `${label} بتاريخ يوم ${DAYS[e.dow]}.`, ref: e.id, ...base });
    if (e.hr >= 22 || e.hr < 5) out.push({ kind: "AFTER_HOURS", severity: "low", title: KINDS.AFTER_HOURS.title, detail: `${label} أُدخل الساعة ${e.hr}:00.`, ref: e.id, ...base });
    if (Number(e.big) >= 10000 && Number(e.big) % 1000 === 0) out.push({ kind: "ROUND", severity: "low", title: KINDS.ROUND.title, detail: `${label}: سطر بمبلغ ${Number(e.big).toLocaleString("en")}.`, ref: e.id, ...base });
    if (e.control) out.push({ kind: "CONTROL", severity: "medium", title: KINDS.CONTROL.title, detail: `${label} على ${e.control}.`, ref: e.id, ...base });
    if (Number(e.late) > 30) out.push({ kind: "BACKDATED", severity: "medium", title: KINDS.BACKDATED.title, detail: `${label} بتاريخ ${iso(e.date)} وأُدخل بعده بـ${e.late} يوماً.`, ref: e.id, ...base });
  }
  for (const r of outl) out.push({ kind: "OUTLIER", severity: "medium", title: KINDS.OUTLIER.title, detail: `${r.number} — ${r.account}: ${Number(r.total).toLocaleString("en")} والمعتاد نحو ${Math.round(Number(r.m)).toLocaleString("en")} — «${r.description}».`, amount: Number(r.total), date: iso(r.date), ref: r.id, to: "/expenses" });
  for (const r of below) out.push({ kind: "BELOW_COST", severity: "medium", title: KINDS.BELOW_COST.title, detail: `${r.number} — ${r.partnerName}: خسارة ${r2(Number(r.loss))} عن التكلفة.`, amount: r2(Number(r.loss)), date: iso(r.date), ref: r.id, to: `/doc/${r.id}` });
  for (const r of cn) out.push({ kind: "CREDIT_NOTES", severity: "medium", title: KINDS.CREDIT_NOTES.title, detail: `${r.name}: إشعارات دائنة ${r2(Number(r.returns))} من مبيعات ${r2(Number(r.sales))} (${Number(r.sales) ? Math.round((Number(r.returns) / Number(r.sales)) * 100) : 100}%).`, amount: r2(Number(r.returns)), ref: `${r.partnerId}:${from}`, to: `/customers/${r.partnerId}` });
  for (const r of cash) out.push({ kind: "NEGATIVE_CASH", severity: "high", title: KINDS.NEGATIVE_CASH.title, detail: `${r.nameAr} (${r.code}) رصيده ${r2(Number(r.b))} في ${to}.`, amount: r2(Number(r.b)), date: to, ref: `${r.id}:${to}`, to: "/accounts" });
  const bf = benford(amounts.map((x) => Number(x.v)));
  if (bf.n >= 200 && (bf.level === "nonconformity" || bf.level === "marginal")) out.push({ kind: "BENFORD", severity: bf.level === "nonconformity" ? "medium" : "low", title: KINDS.BENFORD.title, detail: `توزيع الرقم الأول لـ${bf.n} مبلغاً من المشتريات والمصروفات ${bf.level === "nonconformity" ? "غير مطابق" : "مطابق جزئياً"} (متوسط الانحراف ${bf.mad}).`, ref: `benford:${from}:${to}` });

  const dmap = new Map(dismissed.map((d) => [`${d.kind}|${d.ref}`, d]));
  const all = out.map((f) => ({ ...f, why: KINDS[f.kind]?.why, dismissed: dmap.get(`${f.kind}|${f.ref}`) || null }));
  const open = all.filter((f) => !f.dismissed);
  const rank = { high: 0, medium: 1, low: 2, info: 3 } as const;
  const list = (q.showDismissed ? all : open).sort((a, b) => rank[a.severity] - rank[b.severity] || (b.amount || 0) - (a.amount || 0));
  const count = (s: string) => open.filter((f) => f.severity === s).length;
  const score = Math.max(0, 100 - count("high") * 12 - count("medium") * 4 - count("low"));
  return {
    from, to, score, level: score >= 85 ? "good" : score >= 65 ? "watch" : "critical",
    counts: { high: count("high"), medium: count("medium"), low: count("low"), dismissed: all.length - open.length },
    byKind: Object.entries(KINDS).map(([k, v]) => ({ kind: k, title: v.title, why: v.why, count: open.filter((f) => f.kind === k).length })),
    tested: { manualEntries: manual.length, amounts: bf.n }, benford: bf, findings: list.slice(0, 300),
  };
}

export async function dismiss(t: Db, C: string, user: string, b: any) {
  const kind = String(b?.kind || ""), ref = String(b?.ref || "").slice(0, 120), note = String(b?.note || "").trim().slice(0, 300);
  if (!KINDS[kind] || !ref) throw bad("الملاحظة غير معروفة");
  if (note.length < 3) throw bad("اكتب سبب اعتبار الملاحظة مبرَّرة");
  const row = await t.one(`INSERT INTO audit_dismissals (company_id, kind, ref, note, dismissed_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (company_id, kind, ref) DO UPDATE SET note=EXCLUDED.note, dismissed_by=EXCLUDED.dismissed_by, dismissed_at=now() RETURNING id`, [C, kind, ref, note, user]);
  return { ok: true, id: row.id };
}
export async function undismiss(t: Db, C: string, b: any) {
  await t.exec(`DELETE FROM audit_dismissals WHERE company_id=$1 AND kind=$2 AND ref=$3`, [C, String(b?.kind || ""), String(b?.ref || "")]);
  return { ok: true };
}

/**
 * Account suggestion for an expense: the account this payee/supplier was booked to before, then the account of past
 * expenses whose description shares the most words with this one (Arabic-normalised), then nothing.
 */
const norm = (s: string) => String(s || "").toLowerCase().replace(/[ً-ٟـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[^\p{L}\p{N}\s]/gu, " ");
const STOP = new Set(["من", "الى", "على", "في", "عن", "مع", "شهر", "سداد", "دفع", "قيمه", "فاتوره", "رقم", "for", "the", "and", "of", "to"]);
const stem = (w: string) => (w.length > 4 ? w.replace(/^(وال|بال|كال|فال|لل|ال)/, "") : w); // the Arabic article: «الكهرباء» = «كهرباء»
const words = (s: string) => [...new Set(norm(s).split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w)).map(stem))];
export async function suggestAccount(t: Db, C: string, q: { payee?: string; partnerId?: string; description?: string }) {
  const out: { accountId: string; code: string; name: string; reason: string; uses: number; score: number }[] = [];
  const push = (r: any, reason: string, score: number) => { if (!out.some((x) => x.accountId === r.accountId)) out.push({ accountId: r.accountId, code: r.code, name: r.nameAr, reason, uses: Number(r.n), score }); };
  const partnerId = /^[0-9a-f-]{36}$/i.test(String(q.partnerId || "")) ? q.partnerId : null;
  const payee = String(q.payee || "").trim();
  if (partnerId || payee) {
    const rows = await t.rows(`SELECT x.account_id, a.code, a.name_ar, COUNT(*)::int n, MAX(x.date) last FROM expenses x JOIN accounts a ON a.id=x.account_id
        WHERE x.company_id=$1 AND x.status='POSTED' AND NOT a.is_group AND a.type='EXPENSE' AND (${partnerId ? "x.partner_id=$2" : "lower(trim(x.payee))=lower(trim($2))"}) GROUP BY 1,2,3 ORDER BY 4 DESC, 5 DESC LIMIT 3`, [C, partnerId || payee]);
    rows.forEach((r, i) => push(r, `استُخدم ${r.n} ${r.n === 1 ? "مرة" : "مرات"} مع هذا المستفيد`, 100 - i));
  }
  const w = words(q.description || "");
  if (w.length) {
    const hist = await t.rows(`SELECT x.description, x.account_id, a.code, a.name_ar FROM expenses x JOIN accounts a ON a.id=x.account_id WHERE x.company_id=$1 AND x.status='POSTED' AND NOT a.is_group AND a.type='EXPENSE' ORDER BY x.date DESC LIMIT 800`, [C]);
    const score = new Map<string, { r: any; s: number; n: number; hit: string }>();
    for (const h of hist) {
      const hw = words(h.description); const common = w.filter((x) => hw.some((y) => y === x || (x.length > 3 && (y.startsWith(x) || x.startsWith(y)))));
      if (!common.length) continue;
      const cur = score.get(h.accountId) || { r: h, s: 0, n: 0, hit: common[0] };
      cur.s += common.length / Math.max(w.length, hw.length); cur.n++; score.set(h.accountId, cur);
    }
    [...score.values()].sort((a, b) => b.s - a.s).slice(0, 3).forEach((x) => push({ ...x.r, n: x.n }, `مصروفات سابقة مشابهة («${x.hit}») سُجلت عليه ${x.n} ${x.n === 1 ? "مرة" : "مرات"}`, Math.round(x.s * 10)));
  }
  return { suggestions: out.slice(0, 4) };
}
