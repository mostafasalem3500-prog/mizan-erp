/**
 * Clearing reconciliation — money others hold for us until they transfer it:
 *   • CARD        card-terminal sales (مدى / بطاقات): the acquirer deposits them a day or two later, less its fee.
 *   • SALLA / ZID e-store orders paid online (or collected on delivery): the platform transfers them, less its commission.
 * Each sale sits in a clearing account until its deposit arrives. A deposit (batch) names the transactions it pays:
 *     Dr Bank (net)   Dr Fees (5211 bank charges / 5304 platform fees)   Dr Input VAT (on the fees)   /   Cr Clearing (gross)
 * so every sale is matched one by one, its real fee is known, and what the acquirer never paid stays visible by age.
 * A statement line the books do not know (no such sale) is kept as «unmatched» and is NOT posted — it must be explained.
 * Deposits recorded the older way (a lump transfer with no transactions) are applied to the oldest open items, so the open
 * list always adds up to the clearing account's ledger balance.
 */
import { Db } from "../db/pool";
import { bad, conflict, r2, D, num, isDate, today } from "../lib/core";
import { post, reverse, nextNumber } from "../accounting/engine";
import { VAT_F, IS_EG } from "../lib/country";

export const SOURCES: Record<string, { ar: string; feeKey: string; prefix?: string }> = {
  CARD: { ar: "الشبكة والبطاقات", feeKey: "BANK_FEES" },
  ...(IS_EG ? {} : { SALLA: { ar: "متجر سلة", feeKey: "ESTORE_FEES", prefix: "salla" }, ZID: { ar: "متجر زد", feeKey: "ESTORE_FEES", prefix: "zid" } }),
};
const src = (s: any) => { const k = String(s || "").toUpperCase(); if (!SOURCES[k]) throw bad("مصدر التسوية غير معروف"); return k; };

export interface FeeRule { pct: number; fixed: number; cap: number; vat: boolean; bankAccountId: string | null }
const DEFAULT_RULE: Record<string, FeeRule> = {
  CARD: { pct: IS_EG ? 2 : 0.8, fixed: 0, cap: IS_EG ? 0 : 160, vat: true, bankAccountId: null }, // Saudi mada: 0.8% capped at SAR 160
  SALLA: { pct: 2.5, fixed: 1, cap: 0, vat: true, bankAccountId: null },
  ZID: { pct: 2.5, fixed: 1, cap: 0, vat: true, bankAccountId: null },
};
export function feeRule(company: any, source: string): FeeRule {
  const s = company.accounting?.clearing?.[source] || {}, d = DEFAULT_RULE[source];
  const n = (v: any, def: number, max: number) => (v === undefined || v === null || v === "" || !(num(v) >= 0) ? def : Math.min(max, num(v)));
  return { pct: n(s.pct, d.pct, 30), fixed: n(s.fixed, d.fixed, 1000), cap: n(s.cap, d.cap, 100000), vat: s.vat === undefined ? d.vat : !!s.vat, bankAccountId: s.bankAccountId || null };
}
/** Expected fee (before VAT) on one transaction under the rule. */
export function expectedFee(rule: FeeRule, gross: number) {
  if (!(gross > 0)) return 0;
  let f = D(gross).times(rule.pct).div(100).toNumber();
  if (rule.cap > 0) f = Math.min(f, rule.cap);
  return r2(f + rule.fixed);
}
export async function saveRule(t: Db, companyId: string, source: string, b: any) {
  const k = src(source);
  if (b.bankAccountId) await t.one(`SELECT id FROM accounts WHERE id=$1 AND company_id=$2 AND is_cash_bank AND NOT is_group`, [b.bankAccountId, companyId], "حساب البنك غير صحيح");
  const rule = feeRule({ accounting: { clearing: { [k]: b } } }, k);
  await t.exec(`UPDATE companies SET accounting = jsonb_set(jsonb_set(COALESCE(accounting,'{}'::jsonb), '{clearing}', COALESCE(accounting->'clearing','{}'::jsonb)), $2, $3::jsonb) WHERE id=$1`, [companyId, `{clearing,${k}}`, JSON.stringify(rule)]);
  return rule;
}

async function clearingAccounts(t: Db, companyId: string, source: string): Promise<string[]> {
  if (source === "CARD") return [(await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND system_key='CARD_CLEARING'`, [companyId], "حساب تسوية الشبكة غير معرف في دليل الحسابات")).id];
  const conn = await t.maybe(`SELECT deposit_account_id FROM salla_connections WHERE company_id=$1 AND platform=$2`, [companyId, source]);
  if (conn?.depositAccountId) return [conn.depositAccountId];
  return [(await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND system_key='ESTORE_CLEARING'`, [companyId], "حساب تسوية المتاجر غير معرف في دليل الحسابات")).id];
}

type Item = { invoiceId: string; number: string; kind: string; date: string; partnerName: string; total: number; amount: number; ref: string | null; externalRef: string | null; settled: number; open: number; fee: number | null; age: number; createdBy: string | null };

/** What each sale put into (or took out of) the clearing account. */
async function rawItems(t: Db, companyId: string, source: string, accs: string[]): Promise<Item[]> {
  let rows: any[];
  if (source === "CARD") {
    rows = await t.rows(
      `SELECT i.id invoice_id, i.number, i.kind, i.date, i.partner_name, i.total, i.external_ref, i.created_by,
              (SELECT SUM((x->>'amount')::numeric) FROM jsonb_array_elements(i.tenders) x WHERE x->>'method' IN ('CARD','BANK')) amt,
              (SELECT string_agg(x->>'ref', ' ') FROM jsonb_array_elements(i.tenders) x WHERE x->>'method' IN ('CARD','BANK') AND COALESCE(x->>'ref','')<>'') ref
         FROM invoices i WHERE i.company_id=$1 AND i.direction='SALE' AND i.status='POSTED' AND i.tenders IS NOT NULL AND jsonb_typeof(i.tenders)='array'
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(i.tenders) x WHERE x->>'method' IN ('CARD','BANK'))`, [companyId]);
    rows = rows.map((r) => ({ ...r, amt: r.kind === "CREDIT_NOTE" ? -Number(r.amt) : Number(r.amt) }));
  } else {
    const like = `${SOURCES[source].prefix}:%`;
    rows = await t.rows(
      `SELECT i.id invoice_id, i.number, i.kind, i.date, i.partner_name, i.total, i.external_ref, i.created_by, NULL ref,
              COALESCE((SELECT SUM((a->>'amount')::numeric) FROM payments p, jsonb_array_elements(p.allocations) a
                         WHERE p.company_id=$1 AND p.status='POSTED' AND p.direction='IN' AND p.account_id = ANY($3) AND (a->>'invoiceId')::uuid = i.id),0)
            - COALESCE((SELECT SUM(l.credit - l.debit) FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id
                         WHERE e.company_id=$1 AND e.status='POSTED' AND e.reversed_by IS NULL AND e.type='PAYMENT' AND e.source_type='INVOICE' AND e.source_id=i.id AND l.account_id = ANY($3)),0) amt
         FROM invoices i WHERE i.company_id=$1 AND i.direction='SALE' AND i.status='POSTED'
          AND (i.external_ref LIKE $2 OR i.origin_id IN (SELECT id FROM invoices o WHERE o.company_id=$1 AND o.external_ref LIKE $2))`, [companyId, like, `{${accs.join(",")}}`]);
    rows = rows.map((r) => ({ ...r, amt: Number(r.amt) }));
  }
  const td = today();
  return rows.filter((r) => Math.abs(r.amt) > 0.005).map((r) => ({
    invoiceId: r.invoiceId, number: r.number, kind: r.kind, date: String(r.date).slice(0, 10), partnerName: r.partnerName, total: Number(r.total), amount: r2(r.amt), ref: r.ref || null,
    externalRef: r.externalRef || null, settled: 0, open: r2(r.amt), fee: null, age: Math.max(0, Math.round((Date.parse(td) - Date.parse(String(r.date).slice(0, 10))) / 86400000)), createdBy: r.createdBy,
  }));
}

async function ledgerBalance(t: Db, companyId: string, accs: string[]) {
  const r = await t.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE e.company_id=$1 AND e.status='POSTED' AND l.account_id = ANY($2)`, [companyId, `{${accs.join(",")}}`]);
  return r2(r.b);
}

/** The reconciliation: open transactions, deposits, statement lines the books do not know, and the tie to the ledger. */
export async function clearingView(t: Db, company: any, source0: string, q: any = {}) {
  const source = src(source0), companyId = company.id;
  const accs = await clearingAccounts(t, companyId, source);
  const shared = source !== "CARD" && !(await t.maybe(`SELECT 1 FROM salla_connections WHERE company_id=$1 AND platform=$2 AND deposit_account_id IS NOT NULL`, [companyId, source]));
  const items = await rawItems(t, companyId, source, accs);
  const matched = await t.rows(`SELECT l.invoice_id, SUM(l.gross) g, SUM(l.fee) f, SUM(l.fee_vat) v FROM clearing_lines l JOIN clearing_batches b ON b.id=l.batch_id WHERE l.company_id=$1 AND l.source=$2 AND b.status='POSTED' AND l.invoice_id IS NOT NULL GROUP BY l.invoice_id`, [companyId, source]);
  const mm = new Map(matched.map((m) => [m.invoiceId, m]));
  for (const it of items) { const m = mm.get(it.invoiceId); if (m) { it.settled = r2(m.g); it.open = r2(it.amount - it.settled); it.fee = r2(Number(m.f)); } }
  // the ledger: when two platforms share one clearing account the balance is shown for both together
  let ledger = await ledgerBalance(t, companyId, accs);
  let openSum = r2(items.reduce((a, i) => a + i.open, 0));
  let otherOpen = 0;
  if (shared) {
    const other = source === "SALLA" ? "ZID" : "SALLA";
    const oi = await rawItems(t, companyId, other, accs);
    const om = await t.rows(`SELECT l.invoice_id, SUM(l.gross) g FROM clearing_lines l JOIN clearing_batches b ON b.id=l.batch_id WHERE l.company_id=$1 AND l.source=$2 AND b.status='POSTED' AND l.invoice_id IS NOT NULL GROUP BY l.invoice_id`, [companyId, other]);
    const omm = new Map(om.map((m) => [m.invoiceId, Number(m.g)]));
    otherOpen = r2(oi.reduce((a, i) => a + i.amount - (omm.get(i.invoiceId) || 0), 0));
  }
  // lump deposits recorded without transactions (older payouts, treasury transfers): applied to the oldest open items
  let lump = r2(openSum + otherOpen - ledger);
  if (source !== "CARD") {
    // only this platform's own lump payouts are applied here
    const mine = await t.one(`SELECT COALESCE(SUM(gross),0) g FROM estore_payouts WHERE company_id=$1 AND platform=$2 AND status='POSTED'`, [companyId, source]);
    lump = Math.min(Math.max(lump, 0), r2(mine.g));
  }
  let lumpApplied = 0;
  if (lump > 0.005) {
    for (const it of [...items].sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number))) {
      if (lump <= 0.005) break;
      if (it.open <= 0.005) continue;
      const take = Math.min(it.open, lump);
      it.open = r2(it.open - take); it.settled = r2(it.settled + take); lump = r2(lump - take); lumpApplied = r2(lumpApplied + take);
    }
  }
  openSum = r2(items.reduce((a, i) => a + i.open, 0));
  const rule = feeRule(company, source);
  const open = items.filter((i) => Math.abs(i.open) > 0.005).sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number))
    .map((i) => ({ ...i, expectedFee: expectedFee(rule, i.open), late: i.age > (source === "CARD" ? 3 : 14) }));
  const batches = await t.rows(`SELECT b.*, a.name_ar bank_name, j.number journal_number, (SELECT COUNT(*)::int FROM clearing_lines l WHERE l.batch_id=b.id AND l.invoice_id IS NOT NULL) lines,
       (SELECT COUNT(*)::int FROM clearing_lines l WHERE l.batch_id=b.id AND l.invoice_id IS NULL AND NOT l.resolved) unmatched
     FROM clearing_batches b LEFT JOIN accounts a ON a.id=b.bank_account_id LEFT JOIN journal_entries j ON j.id=b.journal_id WHERE b.company_id=$1 AND b.source=$2 ORDER BY b.date DESC, b.created_at DESC LIMIT 100`, [companyId, source]);
  const unmatched = await t.rows(`SELECT l.id, l.ref, l.txn_date, l.gross, l.fee, l.fee_vat, l.note, b.number batch_number, b.date batch_date FROM clearing_lines l JOIN clearing_batches b ON b.id=l.batch_id
     WHERE l.company_id=$1 AND l.source=$2 AND l.invoice_id IS NULL AND NOT l.resolved AND b.status='POSTED' ORDER BY b.date DESC LIMIT 200`, [companyId, source]);
  // by day: what was sold through the channel, what was deposited, what is still out
  const dayMap: Record<string, { date: string; sold: number; open: number; n: number }> = {};
  for (const i of items) { const d = (dayMap[i.date] ||= { date: i.date, sold: 0, open: 0, n: 0 }); d.sold = r2(d.sold + i.amount); d.open = r2(d.open + i.open); d.n++; }
  const from = isDate(q.from) ? q.from : null;
  const days = Object.values(dayMap).filter((d) => !from || d.date >= from).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 62);
  const fees = await t.one(`SELECT COALESCE(SUM(gross),0) g, COALESCE(SUM(fees),0) f, COALESCE(SUM(fee_vat),0) v, COUNT(*)::int n FROM clearing_batches WHERE company_id=$1 AND source=$2 AND status='POSTED'`, [companyId, source]);
  return {
    source, sourceAr: SOURCES[source].ar, sources: Object.entries(SOURCES).map(([k, v]) => ({ key: k, ar: v.ar })), rule, shared,
    ledger, open, openTotal: openSum, otherOpen, unexplained: r2(ledger - openSum - otherOpen), lumpApplied,
    late: { n: open.filter((o) => o.late).length, total: r2(open.filter((o) => o.late).reduce((a, o) => a + o.open, 0)) },
    batches, unmatched, days, totals: { deposits: fees.n, gross: r2(fees.g), fees: r2(fees.f), feeVat: r2(fees.v), feePct: Number(fees.g) ? r2((Number(fees.f) / Number(fees.g)) * 100) : 0 },
  };
}

export interface BatchInput {
  date?: string; bankAccountId: string; reference?: string | null; notes?: string | null; isDemo?: boolean;
  net?: number | null; // what reached the bank; when given, the difference from the gross is the fee (VAT inside it)
  lines: { invoiceId?: string | null; ref?: string | null; date?: string | null; gross: number; fee?: number | null; feeVat?: number | null }[];
}

/** Finds the open sale a statement line pays: by id, document number, order / approval reference, then a unique amount on its day. */
function matchLine(open: any[], used: Set<string>, l: BatchInput["lines"][number]) {
  const free = open.filter((o) => !used.has(o.invoiceId));
  if (l.invoiceId) return free.find((o) => o.invoiceId === l.invoiceId) || null;
  const ref = String(l.ref || "").trim().toLowerCase();
  if (ref) {
    const hit = free.find((o) => o.number.toLowerCase() === ref) || free.find((o) => (o.externalRef || "").toLowerCase().split(":").pop() === ref) || free.find((o) => (o.ref || "").toLowerCase().split(/\s+/).includes(ref));
    if (hit) return hit;
  }
  const g = r2(num(l.gross));
  const same = free.filter((o) => Math.abs(o.open - g) < 0.005 && (!l.date || o.date === l.date));
  return same.length === 1 && l.date ? same[0] : null;
}

export async function createBatch(t: Db, company: any, user: string, source0: string, b: BatchInput) {
  const source = src(source0), companyId = company.id;
  const date = isDate(b.date) ? b.date! : today();
  const bank = await t.one(`SELECT id FROM accounts WHERE id=$1 AND company_id=$2 AND is_cash_bank AND NOT is_group`, [b.bankAccountId, companyId], "اختر حساب البنك الذي وصله الإيداع");
  const accs = await clearingAccounts(t, companyId, source);
  if (accs.includes(bank.id)) throw bad("حساب البنك يجب أن يختلف عن حساب التسوية");
  if (!Array.isArray(b.lines) || !b.lines.length) throw bad("حدد العمليات التي يشملها الإيداع");
  if (b.lines.length > 2000) throw bad("الحد 2000 عملية في الإيداع الواحد — قسّم الملف");
  const view = await clearingView(t, company, source);
  const rule = view.rule, used = new Set<string>();
  const ok: { o: any; gross: number; fee: number | null; feeVat: number | null; ref: string | null; date: string | null }[] = [], miss: any[] = [];
  for (const l of b.lines) {
    const gross = r2(num(l.gross));
    if (!gross) continue;
    const o = matchLine(view.open, used, l);
    const fee = l.fee === undefined || l.fee === null || (l.fee as any) === "" ? null : r2(Math.abs(num(l.fee)));
    const feeVat = l.feeVat === undefined || l.feeVat === null || (l.feeVat as any) === "" ? null : r2(Math.abs(num(l.feeVat)));
    const d = isDate(l.date) ? l.date! : null, ref = l.ref ? String(l.ref).slice(0, 80) : null;
    if (!o) { miss.push({ gross, fee: fee || 0, feeVat: feeVat || 0, ref, date: d, note: l.invoiceId ? "العملية سُوّيت من قبل أو غير موجودة" : "لا توجد عملية بيع مطابقة في النظام" }); continue; }
    if (Math.abs(gross) > Math.abs(o.open) + 0.005 || Math.sign(gross) !== Math.sign(o.open)) { miss.push({ gross, fee: fee || 0, feeVat: feeVat || 0, ref: ref || o.number, date: d, note: `المبلغ ${gross.toFixed(2)} لا يطابق المتبقي على ${o.number} (${o.open.toFixed(2)})` }); continue; }
    used.add(o.invoiceId);
    ok.push({ o, gross, fee, feeVat, ref, date: d });
  }
  if (!ok.length) throw bad(`لم تُطابَق أي عملية مع المبيعات المفتوحة في ${SOURCES[source].ar} — راجع الأرقام المرجعية أو المبالغ`);
  const gross = r2(ok.reduce((a, x) => a + x.gross, 0));
  if (!(gross > 0)) throw bad("صافي العمليات المحددة ليس موجباً — المرتجعات تُسوّى مع مبيعات تغطيها");
  const posSum = r2(ok.filter((x) => x.gross > 0).reduce((a, x) => a + x.gross, 0));
  // fees: from the statement when it carries them; else from the net that reached the bank; else the rule
  let feeIncl: number;
  const haveFees = ok.some((x) => x.fee !== null);
  if (haveFees) {
    for (const x of ok) { if (x.fee === null) x.fee = 0; if (x.feeVat === null) x.feeVat = rule.vat ? r2(D(x.fee).times(VAT_F)) : 0; }
    feeIncl = r2(ok.reduce((a, x) => a + x.fee! + x.feeVat!, 0));
  } else {
    if (b.net !== undefined && b.net !== null && (b.net as any) !== "") {
      const net = r2(num(b.net));
      if (!(net > 0) || net > gross + 0.005) throw bad(`المبلغ الواصل للبنك يجب أن يكون بين 0 وإجمالي العمليات ${gross.toFixed(2)}`);
      feeIncl = r2(gross - net);
    } else feeIncl = r2(ok.reduce((a, x) => a + (x.gross > 0 ? expectedFee(rule, x.gross) * (rule.vat ? 1 + VAT_F : 1) : 0), 0));
    if (feeIncl > gross * 0.3) throw bad("العمولة تتجاوز 30% من إجمالي العمليات — راجع المبلغ الواصل للبنك");
    // spread over the sales by value; the last one takes the rounding
    let left = feeIncl; const pos = ok.filter((x) => x.gross > 0);
    pos.forEach((x, i) => { const share = i === pos.length - 1 ? left : r2((feeIncl * x.gross) / posSum); left = r2(left - share); x.feeVat = rule.vat ? r2(share - share / (1 + VAT_F)) : 0; x.fee = r2(share - x.feeVat); });
    for (const x of ok) if (x.fee === null) { x.fee = 0; x.feeVat = 0; }
  }
  const fees = r2(ok.reduce((a, x) => a + x.fee!, 0)), feeVat = r2(ok.reduce((a, x) => a + x.feeVat!, 0));
  const net = r2(gross - fees - feeVat);
  if (!(net > 0)) throw bad("صافي الإيداع بعد العمولة ليس موجباً");
  const number = await nextNumber(t, companyId, source === "CARD" ? "CST" : "EST", date);
  const memo = `تسوية ${SOURCES[source].ar} ${number} — ${ok.length} عملية${b.reference ? ` — ${b.reference}` : ""}`;
  const lines: any[] = [{ account: bank.id, debit: net, description: memo }];
  if (fees) lines.push({ key: SOURCES[source].feeKey, debit: fees, description: `عمولة ${SOURCES[source].ar} ${number}` });
  if (feeVat) lines.push({ key: "VAT_IN", debit: feeVat, description: `ضريبة مدخلات على عمولة ${SOURCES[source].ar} ${number}` });
  lines.push({ account: accs[0], credit: gross, description: memo });
  const je = await post(t, companyId, { date, type: "RECEIPT", sourceType: "CLEARING", reference: b.reference || number, memo, createdBy: user, isDemo: !!b.isDemo, lines });
  const row = await t.insert("clearing_batches", { companyId, source, number, date, reference: b.reference || null, bankAccountId: bank.id, clearingAccountId: accs[0], gross, fees, feeVat, net, journalId: je!.id, notes: b.notes || null, createdBy: user, isDemo: !!b.isDemo });
  await t.exec(`UPDATE journal_entries SET source_id=$2 WHERE id=$1`, [je!.id, row.id]);
  for (const x of ok) await t.insert("clearing_lines", { companyId, batchId: row.id, source, invoiceId: x.o.invoiceId, ref: x.ref || x.o.number, txnDate: x.date || x.o.date, gross: x.gross, fee: x.fee, feeVat: x.feeVat });
  for (const m of miss) await t.insert("clearing_lines", { companyId, batchId: row.id, source, invoiceId: null, ref: m.ref, txnDate: m.date, gross: m.gross, fee: m.fee, feeVat: m.feeVat, note: m.note });
  const unmatchedTotal = r2(miss.reduce((a, m) => a + m.gross - m.fee - m.feeVat, 0));
  return { ...row, matched: ok.length, unmatched: miss.length, unmatchedTotal, expectedBank: r2(net + unmatchedTotal) };
}

export async function cancelBatch(t: Db, companyId: string, user: string, id: string) {
  const b = await t.one(`SELECT * FROM clearing_batches WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "التسوية غير موجودة");
  if (b.status !== "POSTED") throw conflict("التسوية ملغاة مسبقاً");
  if (b.journalId) await reverse(t, companyId, b.journalId, today(), `إلغاء التسوية ${b.number}`, user);
  await t.exec(`UPDATE clearing_batches SET status='CANCELLED' WHERE id=$1`, [id]);
  return { ok: true };
}
export async function batchDetail(t: Db, companyId: string, id: string) {
  const b = await t.one(`SELECT b.*, a.name_ar bank_name, j.number journal_number FROM clearing_batches b LEFT JOIN accounts a ON a.id=b.bank_account_id LEFT JOIN journal_entries j ON j.id=b.journal_id WHERE b.id=$1 AND b.company_id=$2`, [id, companyId], "التسوية غير موجودة");
  b.lines = await t.rows(`SELECT l.*, i.number, i.partner_name, i.date invoice_date FROM clearing_lines l LEFT JOIN invoices i ON i.id=l.invoice_id WHERE l.batch_id=$1 ORDER BY l.invoice_id IS NULL DESC, l.txn_date, i.number`, [id]);
  return b;
}
/** A statement line with no sale: marked explained (with a note) once the missing sale is recorded or the bank corrects it. */
export async function resolveUnmatched(t: Db, companyId: string, id: string, note: string) {
  if (String(note || "").trim().length < 3) throw bad("اكتب كيف عولجت العملية");
  const l = await t.one(`SELECT id FROM clearing_lines WHERE id=$1 AND company_id=$2 AND invoice_id IS NULL`, [id, companyId], "السطر غير موجود");
  await t.exec(`UPDATE clearing_lines SET resolved=true, note=$2 WHERE id=$1`, [l.id, String(note).trim().slice(0, 300)]);
  return { ok: true };
}

/** Dashboard: sales the acquirer / platform has held longer than it should. */
export async function clearingAlerts(t: Db, company: any) {
  const out: { level: "err" | "warn"; text: string; to: string }[] = [];
  for (const s of Object.keys(SOURCES)) {
    if (s !== "CARD" && !(await t.maybe(`SELECT 1 FROM salla_connections WHERE company_id=$1 AND platform=$2`, [company.id, s]))) continue;
    if (s === "CARD" && !(await t.maybe(`SELECT 1 FROM clearing_batches WHERE company_id=$1 AND source='CARD' LIMIT 1`, [company.id]))) continue; // only once the establishment uses it
    const v = await clearingView(t, company, s);
    const to = s === "CARD" ? "/bank/card-settlement" : `/estore/settlement?s=${s}`;
    if (v.late.n) out.push({ level: "warn", text: `${SOURCES[s].ar}: ${v.late.n} عملية لم تصل البنك بعد بإجمالي ${v.late.total.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, to });
    if (v.unmatched.length) out.push({ level: "err", text: `${SOURCES[s].ar}: ${v.unmatched.length} عملية في كشف التسوية بلا بيع مسجل في النظام`, to });
  }
  return out;
}

/** True profit of each e-store order: revenue less cost of goods, the platform's fee (actual once settled, else the rule), per order and per unit. */
export async function estoreProfit(t: Db, company: any, q: any) {
  const companyId = company.id;
  const from = isDate(q.from) ? q.from : today().slice(0, 8) + "01", to = isDate(q.to) ? q.to : today();
  const platform = q.platform && SOURCES[String(q.platform)] && q.platform !== "CARD" ? String(q.platform) : null;
  const likes = (platform ? [platform] : Object.keys(SOURCES).filter((k) => k !== "CARD")).map((k) => `${SOURCES[k].prefix}:%`);
  if (!likes.length) return { from, to, orders: [], products: [], totals: {} };
  const rows = await t.rows(
    `SELECT i.id, i.number, i.date, i.partner_name, i.external_ref, i.total, i.vat_total, i.cost_total, i.payment_status,
            (SELECT COALESCE(SUM(l.net_amount),0) FROM invoice_lines l WHERE l.invoice_id=i.id AND l.product_id IS NOT NULL) goods,
            (SELECT COALESCE(SUM(l.net_amount),0) FROM invoice_lines l WHERE l.invoice_id=i.id AND l.product_id IS NULL) shipping,
            (SELECT COALESCE(SUM(l.qty*l.factor),0) FROM invoice_lines l WHERE l.invoice_id=i.id AND l.product_id IS NOT NULL) units,
            (SELECT COALESCE(SUM(c.total - c.vat_total),0) FROM invoices c WHERE c.origin_id=i.id AND c.kind='CREDIT_NOTE' AND c.status='POSTED' AND c.reversed_by IS NULL) ret_net,
            (SELECT COALESCE(SUM(c.cost_total),0) FROM invoices c WHERE c.origin_id=i.id AND c.kind='CREDIT_NOTE' AND c.status='POSTED' AND c.reversed_by IS NULL) ret_cost,
            (SELECT COALESCE(SUM(cl.fee),0) FROM clearing_lines cl JOIN clearing_batches b ON b.id=cl.batch_id WHERE cl.invoice_id=i.id AND b.status='POSTED') fee_actual,
            EXISTS (SELECT 1 FROM clearing_lines cl JOIN clearing_batches b ON b.id=cl.batch_id WHERE cl.invoice_id=i.id AND b.status='POSTED') settled
       FROM invoices i WHERE i.company_id=$1 AND i.direction='SALE' AND i.kind='INVOICE' AND i.status='POSTED' AND i.external_ref LIKE ANY($2) AND i.date BETWEEN $3 AND $4 ORDER BY i.date DESC, i.number DESC`,
    [companyId, `{${likes.map((l) => `"${l}"`).join(",")}}`, from, to]);
  const orders = rows.map((r) => {
    const pf = Object.keys(SOURCES).find((k) => SOURCES[k].prefix && String(r.externalRef).startsWith(SOURCES[k].prefix + ":"))!;
    const revenue = r2(Number(r.total) - Number(r.vatTotal) - Number(r.retNet));
    const cogs = r2(Number(r.costTotal) - Number(r.retCost));
    const fee = r.settled ? r2(r.feeActual) : expectedFee(feeRule(company, pf), Number(r.total));
    const profit = r2(revenue - cogs - fee), units = Number(r.units);
    return { id: r.id, number: r.number, date: String(r.date).slice(0, 10), platform: pf, platformAr: SOURCES[pf].ar, order: String(r.externalRef).split(":").pop(), partnerName: r.partnerName, total: Number(r.total),
      revenue, goods: r2(r.goods), shipping: r2(r.shipping), returned: r2(r.retNet), cogs, fee, feeActual: !!r.settled, profit, margin: revenue ? r2((profit / revenue) * 100) : 0, units, profitPerUnit: units ? r2(profit / units) : 0 };
  });
  // per product: the order's fee is shared by each line's value
  const pl = await t.rows(
    `SELECT l.invoice_id, l.product_id, p.name, p.sku, SUM(l.qty*l.factor) q, SUM(l.net_amount) net, SUM(l.qty*l.factor*l.unit_cost) cost
       FROM invoice_lines l JOIN products p ON p.id=l.product_id WHERE l.invoice_id = ANY($1) GROUP BY l.invoice_id, l.product_id, p.name, p.sku`, [`{${orders.map((o) => o.id).join(",")}}`]);
  const om = new Map(orders.map((o) => [o.id, o]));
  const pm: Record<string, any> = {};
  for (const l of pl) {
    const o = om.get(l.invoiceId)!; const base = o.goods + o.shipping || 1;
    const p = (pm[l.productId] ||= { productId: l.productId, name: l.name, sku: l.sku, units: 0, revenue: 0, cogs: 0, fee: 0, orders: 0 });
    p.units += Number(l.q); p.revenue += Number(l.net); p.cogs += Number(l.cost); p.fee += (o.fee * Number(l.net)) / base; p.orders++;
  }
  const products = Object.values(pm).map((p: any) => { const profit = r2(p.revenue - p.cogs - p.fee); return { ...p, revenue: r2(p.revenue), cogs: r2(p.cogs), fee: r2(p.fee), profit, margin: p.revenue ? r2((profit / p.revenue) * 100) : 0, profitPerUnit: p.units ? r2(profit / p.units) : 0 }; }).sort((a, b) => b.profit - a.profit);
  const s = (k: string) => r2(orders.reduce((a, o: any) => a + o[k], 0));
  // shipping charged to the customer is the order's revenue, not any product's: shown apart, with its share of the fee
  const shippingNet = r2(orders.reduce((a, o) => a + o.shipping - (o.fee * o.shipping) / (o.goods + o.shipping || 1), 0));
  const totals = { shippingNet, orders: orders.length, revenue: s("revenue"), cogs: s("cogs"), fee: s("fee"), profit: s("profit"), returned: s("returned"), units: s("units"), losing: orders.filter((o) => o.profit < 0).length, estimated: orders.filter((o) => !o.feeActual).length };
  return { from, to, platform, orders, products, totals: { ...totals, margin: totals.revenue ? r2((totals.profit / totals.revenue) * 100) : 0 } };
}
