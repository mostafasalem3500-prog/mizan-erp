/**
 * Associations edition — what every association has besides donations: its members.
 *   • نوع الجمعية: خيرية / أهلية / مهنية (غير ربحية) أو تعاونية (توزّع فائضها على أعضائها)
 *   • سجل الأعضاء واشتراكاتهم السنوية (سند قبض جمعية بمصدر «اشتراك عضوية» مرتبط بالعضو والسنة)
 *   • أسهم الأعضاء (للتعاونية):  اكتتاب  Dr الصندوق/البنك  Cr رأس المال (أسهم الأعضاء)
 *                                 استرداد  Dr رأس المال        Cr الصندوق/البنك
 *   • توزيع الفائض (للتعاونية):  Dr الأرباح المبقاة  Cr الاحتياطي النظامي، عوائد مستحقة للأعضاء،
 *                                 مخصص الخدمات الاجتماعية، مخصص تدريب الأعضاء — ثم صرف العائد لكل عضو.
 */
import { Db } from "../db/pool";
import { bad, conflict, r2, num, isDate, today } from "../lib/core";
import { post, reverse, nextNumber } from "../accounting/engine";
import { ensureCharity, acct, nextPartnerCode } from "./charity";

export const ASSOC_TYPES: Record<string, { ar: string; profit: boolean }> = {
  CHARITY: { ar: "جمعية خيرية (غير ربحية)", profit: false },
  CIVIL: { ar: "جمعية أهلية (غير ربحية)", profit: false },
  PROFESSIONAL: { ar: "جمعية مهنية / علمية (غير ربحية)", profit: false },
  COOPERATIVE: { ar: "جمعية تعاونية (توزّع فائضها على الأعضاء)", profit: true },
};
export const MEMBER_KINDS: Record<string, string> = { FOUNDER: "مؤسس", WORKING: "عامل", AFFILIATE: "منتسب", HONORARY: "فخري" };
export const MEMBER_STATUS: Record<string, string> = { ACTIVE: "نشط", SUSPENDED: "موقوف", WITHDRAWN: "منسحب" };

/** Defaults follow the draft executive regulation of the cooperatives law (all editable to the association's bylaws). */
export const DEFAULT_DIST = { reserve: 20, capital: 20, social: 5, training: 5, basis: "TRANSACTIONS" };

const ASSOC_ACCOUNTS: [string, string, string, string][] = [
  ["210306", "عوائد وأرباح مستحقة للأعضاء", "Member Dividends & Patronage Payable", "ASSOC_DIVIDENDS"],
  ["210307", "مخصص الخدمات الاجتماعية", "Social Services Provision", "ASSOC_SOCIAL"],
  ["210308", "مخصص تدريب وتثقيف الأعضاء", "Member Training Provision", "ASSOC_TRAINING"],
];

async function ensureAssocAccounts(t: Db, companyId: string) {
  const parent = await t.maybe(`SELECT id FROM accounts WHERE company_id=$1 AND code='2103'`, [companyId]);
  for (const [code, nameAr, nameEn, key] of ASSOC_ACCOUNTS) {
    if (await t.maybe(`SELECT 1 FROM accounts WHERE company_id=$1 AND system_key=$2`, [companyId, key])) continue;
    const byCode = await t.maybe(`SELECT id FROM accounts WHERE company_id=$1 AND code=$2`, [companyId, code]);
    if (byCode) { await t.exec(`UPDATE accounts SET system_key=$1 WHERE id=$2 AND system_key IS NULL`, [key, byCode.id]); continue; }
    if (!parent) throw bad("دليل الحسابات لا يحتوي الحساب 2103 (مستحقات وأرصدة دائنة أخرى)");
    await t.insert("accounts", { companyId, code, nameAr, nameEn, type: "LIABILITY", subtype: "CURRENT_LIABILITY", parentId: parent.id, level: 4, isGroup: false, isSystem: true, systemKey: key, isCashBank: false });
  }
}

async function settingsRow(t: Db, companyId: string) {
  await ensureCharity(t, companyId);
  return t.one(`SELECT assoc_type, membership FROM charity_settings WHERE company_id=$1`, [companyId]);
}

export function membershipConfig(m: any) {
  const o = m && typeof m === "object" ? m : {};
  const d = { ...DEFAULT_DIST, ...(o.dist || {}) };
  return {
    annualFee: r2(num(o.annualFee)), shareValue: r2(num(o.shareValue)), minShares: Math.max(0, Math.floor(num(o.minShares))), maxSharePct: num(o.maxSharePct) || 20,
    dist: { reserve: num(d.reserve), capital: num(d.capital), social: num(d.social), training: num(d.training), basis: d.basis === "CAPITAL" ? "CAPITAL" : "TRANSACTIONS" },
  };
}

/** Validated association type + membership settings (called from «إعدادات الجمعية»). */
export function cleanAssocSettings(b: any) {
  const out: any = {};
  if (b.assocType !== undefined) { if (!ASSOC_TYPES[b.assocType]) throw bad("نوع الجمعية غير معروف"); out.assocType = b.assocType; }
  if (b.membership !== undefined) {
    const m = membershipConfig(b.membership);
    const d = m.dist;
    for (const [k, v] of Object.entries({ reserve: d.reserve, capital: d.capital, social: d.social, training: d.training })) if (v < 0 || v > 100) throw bad(`نسبة ${k} يجب أن تكون بين 0 و100`);
    if (d.reserve + d.capital + d.social + d.training > 100) throw bad("مجموع نسب التوزيع (الاحتياطي + عائد رأس المال + الخدمات الاجتماعية + التدريب) لا يتجاوز 100%");
    if (m.annualFee < 0 || m.shareValue < 0) throw bad("رسم الاشتراك وقيمة السهم لا تكون سالبة");
    if (m.maxSharePct <= 0 || m.maxSharePct > 100) throw bad("الحد الأعلى لملكية العضو بين 1 و100%");
    out.membership = JSON.stringify(m);
  }
  return out;
}

// ─── members ───────────────────────────────────────────────────────────────
const memberOut = (p: any) => ({ ...p, member: { no: p.memberInfo?.no || p.code, kind: p.memberInfo?.kind || "WORKING", joinDate: p.memberInfo?.joinDate || null, status: p.memberInfo?.status || "ACTIVE", iban: p.memberInfo?.iban || null, bankName: p.memberInfo?.bankName || null } });

export async function listMembers(t: Db, companyId: string, q: any) {
  const s = await settingsRow(t, companyId);
  const cfg = membershipConfig(s.membership);
  const year = Number(q.year) || new Date().getFullYear();
  const rows = await t.rows(
    `SELECT p.*,
       COALESCE((SELECT SUM(CASE WHEN x.kind='SUBSCRIBE' THEN x.shares ELSE -x.shares END) FROM assoc_share_txns x WHERE x.partner_id=p.id AND x.status='POSTED'),0)::int AS shares,
       COALESCE((SELECT SUM(CASE WHEN x.kind='SUBSCRIBE' THEN x.amount ELSE -x.amount END) FROM assoc_share_txns x WHERE x.partner_id=p.id AND x.status='POSTED'),0) AS share_capital,
       COALESCE((SELECT SUM(r.amount) FROM charity_receipts r WHERE r.partner_id=p.id AND r.status='POSTED' AND r.source='MEMBERSHIP' AND r.fee_year=$2),0) AS fee_paid,
       COALESCE((SELECT SUM(r.amount) FROM charity_receipts r WHERE r.partner_id=p.id AND r.status='POSTED' AND r.source='MEMBERSHIP'),0) AS fees_total
     FROM partners p WHERE p.company_id=$1 AND p.is_member ORDER BY p.code`,
    [companyId, year],
  );
  const text = String(q.q || "").trim();
  const list = rows.map(memberOut).filter((m: any) => !text || [m.name, m.code, m.member.no, m.phone, m.idNumber].some((v) => String(v || "").includes(text)));
  const totalShares = list.reduce((a: number, m: any) => a + Number(m.shares), 0);
  return list.slice(0, Number(q.limit) || 5000).map((m: any) => {
    const feeDue = m.member.status === "ACTIVE" && m.member.kind !== "HONORARY" ? cfg.annualFee : 0;
    return { ...m, feeDue, feeBalance: r2(Math.max(0, feeDue - Number(m.feePaid))), sharePct: totalShares ? r2((Number(m.shares) / totalShares) * 100) : 0 };
  });
}

export async function saveMember(t: Db, companyId: string, b: any, id?: string) {
  const name = String(b.name || "").trim();
  if (!name) throw bad("اسم العضو مطلوب");
  if (b.joinDate && !isDate(b.joinDate)) throw bad("تاريخ الانضمام غير صحيح");
  const kind = MEMBER_KINDS[b.kind] ? b.kind : "WORKING";
  const status = MEMBER_STATUS[b.status] ? b.status : "ACTIVE";
  const iban = b.iban ? String(b.iban).replace(/\s+/g, "").toUpperCase() : null;
  if (iban && !/^SA\d{22}$/.test(iban)) throw bad("الآيبان السعودي 24 خانة يبدأ بـ SA");
  const prev = id ? await t.one(`SELECT * FROM partners WHERE id=$1 AND company_id=$2`, [id, companyId], "العضو غير موجود") : null;
  if (status !== "ACTIVE" && prev) {
    const sh = await t.one(`SELECT COALESCE(SUM(CASE WHEN kind='SUBSCRIBE' THEN shares ELSE -shares END),0)::int n FROM assoc_share_txns WHERE partner_id=$1 AND status='POSTED'`, [id]);
    if (status === "WITHDRAWN" && sh.n > 0) throw conflict(`للعضو ${sh.n} سهماً قائماً — استردّ أسهمه أولاً ثم سجّل انسحابه`);
  }
  const memberNo = String(b.memberNo || prev?.memberInfo?.no || "").trim();
  if (memberNo) {
    const dup = await t.maybe(`SELECT name FROM partners WHERE company_id=$1 AND is_member AND member_info->>'no'=$2 AND id<>COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000')`, [companyId, memberNo, id || null]);
    if (dup) throw conflict(`رقم العضوية ${memberNo} مستخدم للعضو ${dup.name}`);
  }
  const data: any = {
    name, phone: b.phone || null, email: b.email || null, city: b.city || null, idNumber: b.idNumber || null, notes: b.notes || null,
    kind: "INDIVIDUAL", isMember: true,
    memberInfo: JSON.stringify({ no: memberNo || null, kind, joinDate: b.joinDate || prev?.memberInfo?.joinDate || today(), status, iban, bankName: b.bankName || null }),
  };
  // a cooperative's members buy from it: they are customers too, so their invoices count as member transactions
  if (b.isCustomer !== undefined) data.isCustomer = !!b.isCustomer;
  if (id) return memberOut(await t.update("partners", { id, companyId }, data));
  const code = await nextPartnerCode(t, companyId, "MB");
  if (!memberNo) data.memberInfo = JSON.stringify({ ...JSON.parse(data.memberInfo), no: code });
  return memberOut(await t.insert("partners", { companyId, code, ...data, isSupplier: false, isCustomer: data.isCustomer ?? false }));
}

/** Turns an existing donor / customer into a member (same partner, same statement). */
export async function makeMember(t: Db, companyId: string, partnerId: string) {
  const p = await t.one(`SELECT * FROM partners WHERE id=$1 AND company_id=$2`, [partnerId, companyId], "الطرف غير موجود");
  if (p.isMember) return memberOut(p);
  return saveMember(t, companyId, { name: p.name, phone: p.phone, email: p.email, idNumber: p.idNumber, city: p.city }, partnerId);
}

async function member(t: Db, companyId: string, id: any) {
  const p = await t.one(`SELECT * FROM partners WHERE id=$1 AND company_id=$2`, [id, companyId], "العضو غير موجود");
  if (!p.isMember) throw bad(`${p.name} ليس مسجلاً كعضو`);
  return memberOut(p);
}

export async function memberStatement(t: Db, companyId: string, id: string) {
  const m = await member(t, companyId, id);
  const fees = await t.rows(`SELECT id, number, date, amount, fee_year, status, method FROM charity_receipts WHERE company_id=$1 AND partner_id=$2 AND source='MEMBERSHIP' ORDER BY date DESC, number DESC`, [companyId, id]);
  const shares = await t.rows(`SELECT x.*, je.number journal_number FROM assoc_share_txns x LEFT JOIN journal_entries je ON je.id=x.journal_id WHERE x.company_id=$1 AND x.partner_id=$2 ORDER BY x.date DESC, x.number DESC`, [companyId, id]);
  const dists = await t.rows(
    `SELECT d.id, d.number, d.year, d.date, d.status, l->>'total' AS total, l->>'capitalReturn' AS capital_return, l->>'txReturn' AS tx_return,
       COALESCE((SELECT SUM(amount) FROM assoc_dist_payments p WHERE p.distribution_id=d.id AND p.partner_id=$2 AND p.status='POSTED'),0) AS paid
     FROM assoc_distributions d, jsonb_array_elements(d.lines) l WHERE d.company_id=$1 AND l->>'partnerId'=$2::text ORDER BY d.year DESC`, [companyId, id]);
  return { member: m, fees, shares, distributions: dists };
}

/** Membership fee: an ordinary charity receipt (source MEMBERSHIP) tied to the member and the year it covers. */
export async function feeReceiptBody(t: Db, companyId: string, b: any) {
  const m = await member(t, companyId, b.partnerId);
  const year = Math.floor(num(b.feeYear)) || new Date().getFullYear();
  if (year < 2000 || year > 2100) throw bad("سنة الاشتراك غير صحيحة");
  return { ...b, source: "MEMBERSHIP", partnerId: m.id, payerName: m.name, payerIdNo: m.idNumber, payerPhone: m.phone, payerType: "INDIVIDUAL", purpose: b.purpose || `اشتراك العضوية لعام ${year} — عضوية رقم ${m.member.no}`, feeYear: year };
}

// ─── shares (cooperatives) ─────────────────────────────────────────────────
async function sharesOf(t: Db, partnerId: string) {
  return (await t.one(`SELECT COALESCE(SUM(CASE WHEN kind='SUBSCRIBE' THEN shares ELSE -shares END),0)::int n FROM assoc_share_txns WHERE partner_id=$1 AND status='POSTED'`, [partnerId])).n as number;
}

export async function listShareTxns(t: Db, companyId: string, q: any) {
  const w = ["x.company_id=$1"]; const ps: any[] = [companyId];
  if (isDate(q.from)) { ps.push(q.from); w.push(`x.date >= $${ps.length}`); }
  if (isDate(q.to)) { ps.push(q.to); w.push(`x.date <= $${ps.length}`); }
  if (q.partnerId) { ps.push(q.partnerId); w.push(`x.partner_id = $${ps.length}`); }
  return t.rows(`SELECT x.*, p.name member_name, p.member_info->>'no' AS member_no, a.name_ar cash_account_name, je.number journal_number FROM assoc_share_txns x JOIN partners p ON p.id=x.partner_id JOIN accounts a ON a.id=x.cash_account_id LEFT JOIN journal_entries je ON je.id=x.journal_id WHERE ${w.join(" AND ")} ORDER BY x.date DESC, x.number DESC LIMIT 5000`, ps);
}

export async function createShareTxn(t: Db, companyId: string, user: string, b: any) {
  const s = await settingsRow(t, companyId);
  if (s.assocType !== "COOPERATIVE") throw bad("الأسهم خاصة بالجمعيات التعاونية — غيّر نوع الجمعية من الإعدادات");
  const cfg = membershipConfig(s.membership);
  const kind = b.kind === "REDEEM" ? "REDEEM" : "SUBSCRIBE";
  const shares = Math.floor(num(b.shares));
  if (!(shares > 0)) throw bad("عدد الأسهم يجب أن يكون عدداً صحيحاً أكبر من صفر");
  const unit = r2(num(b.unitValue) || cfg.shareValue);
  if (!(unit > 0)) throw bad("حدّد القيمة الاسمية للسهم في إعدادات الجمعية");
  const d = isDate(b.date) ? b.date : today();
  const m = await member(t, companyId, b.partnerId);
  if (kind === "SUBSCRIBE" && m.member.status !== "ACTIVE") throw conflict(`العضو ${m.name} ${MEMBER_STATUS[m.member.status]} — لا يكتتب`);
  const held = await sharesOf(t, m.id);
  if (kind === "REDEEM" && shares > held) throw conflict(`لا يملك العضو إلا ${held} سهماً`);
  if (kind === "SUBSCRIBE") {
    const total = (await t.one(`SELECT COALESCE(SUM(CASE WHEN kind='SUBSCRIBE' THEN shares ELSE -shares END),0)::int n FROM assoc_share_txns WHERE company_id=$1 AND status='POSTED'`, [companyId])).n as number;
    const after = held + shares, all = total + shares;
    // the ownership cap only means something once capital is spread over several shareholders (the founders subscribe one by one)
    const holders = (await t.one(`SELECT COUNT(*)::int n FROM (SELECT partner_id FROM assoc_share_txns WHERE company_id=$1 AND status='POSTED' GROUP BY partner_id HAVING SUM(CASE WHEN kind='SUBSCRIBE' THEN shares ELSE -shares END) > 0) x`, [companyId])).n + (held > 0 ? 0 : 1);
    if (holders >= 5 && all > 0 && (after / all) * 100 > cfg.maxSharePct + 1e-9 && !b.overrideCap) throw conflict(`بعد الاكتتاب يملك العضو ${r2((after / all) * 100)}% من الأسهم — الحد الأعلى ${cfg.maxSharePct}% (يمكن التجاوز بقرار مسجّل)`);
    if (cfg.minShares && after < cfg.minShares) throw bad(`الحد الأدنى للعضو ${cfg.minShares} سهماً`);
  }
  const amount = r2(shares * unit);
  const cash = await acct(t, companyId, b.cashAccountId, "CASH", "حساب الصندوق / البنك", { cash: true });
  const capital = await acct(t, companyId, null, "CAPITAL", "حساب رأس المال");
  const number = await nextNumber(t, companyId, kind === "SUBSCRIBE" ? "SHR" : "SHX", d);
  const memo = `${kind === "SUBSCRIBE" ? "اكتتاب" : "استرداد"} ${shares} سهماً × ${unit} — ${m.name} (عضوية ${m.member.no})`;
  const row = await t.insert("assoc_share_txns", { companyId, number, date: d, partnerId: m.id, kind, shares, unitValue: unit, amount, cashAccountId: cash.id, notes: b.notes || null, isDemo: !!b.isDemo, createdBy: user });
  const lines = kind === "SUBSCRIBE"
    ? [{ account: cash.id, debit: amount, description: memo }, { account: capital.id, credit: amount, partnerId: m.id, description: memo }]
    : [{ account: capital.id, debit: amount, partnerId: m.id, description: memo }, { account: cash.id, credit: amount, description: memo }];
  const je = await post(t, companyId, { date: d, type: "MANUAL", sourceType: "ASSOC_SHARES", sourceId: row.id, reference: number, memo, createdBy: user, isDemo: !!b.isDemo, lines });
  await t.exec(`UPDATE assoc_share_txns SET journal_id=$1 WHERE id=$2`, [je!.id, row.id]);
  return { ...row, journalId: je!.id };
}

export async function cancelShareTxn(t: Db, companyId: string, user: string, id: string, reason?: string) {
  const x = await t.one(`SELECT * FROM assoc_share_txns WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "الحركة غير موجودة");
  if (x.status !== "POSTED") throw bad("الحركة ملغاة مسبقاً");
  if (x.kind === "SUBSCRIBE" && (await sharesOf(t, x.partnerId)) < x.shares) throw conflict("استُرد جزء من هذه الأسهم — ألغِ الاسترداد أولاً");
  if (x.journalId) await reverse(t, companyId, x.journalId, today() < String(x.date).slice(0, 10) ? x.date : today(), `إلغاء ${x.number}${reason ? " — " + reason : ""}`, user);
  await t.exec(`UPDATE assoc_share_txns SET status='CANCELLED', notes=COALESCE(notes,'') || $2 WHERE id=$1`, [id, reason ? ` [إلغاء: ${reason}]` : ""]);
  return { ok: true };
}

// ─── surplus distribution (cooperatives) ───────────────────────────────────
/** Net surplus of the year from the ledger (revenue − expenses, closing entries excluded). */
async function yearSurplus(t: Db, companyId: string, year: number) {
  const r = await t.one(
    `SELECT COALESCE(SUM(CASE WHEN a.type='REVENUE' THEN l.credit-l.debit ELSE -(l.debit-l.credit) END),0) AS net
     FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id
     WHERE e.company_id=$1 AND e.status='POSTED' AND e.type<>'CLOSING' AND a.type IN ('REVENUE','EXPENSE') AND e.date BETWEEN $2 AND $3`,
    [companyId, `${year}-01-01`, `${year}-12-31`],
  );
  return r2(num(r.net));
}

/** Proposal (or the basis of a posting): pools by percentage, then each member's share. */
export async function distributionPlan(t: Db, companyId: string, q: any) {
  const s = await settingsRow(t, companyId);
  const cfg = membershipConfig(s.membership);
  const year = Math.floor(num(q.year)) || new Date().getFullYear() - 1;
  const pc = { ...cfg.dist, ...(q.pcts && typeof q.pcts === "object" ? Object.fromEntries(Object.entries(q.pcts).map(([k, v]) => [k, k === "basis" ? v : num(v)])) : {}) } as any;
  const ledger = await yearSurplus(t, companyId, year);
  const surplus = q.surplus !== undefined && q.surplus !== "" ? r2(num(q.surplus)) : ledger;
  const fy = await t.maybe(`SELECT status FROM fiscal_years WHERE company_id=$1 AND start_date <= $2 AND end_date >= $2`, [companyId, `${year}-06-30`]);
  const reserve = r2((surplus * pc.reserve) / 100), capitalPool = r2((surplus * pc.capital) / 100), social = r2((surplus * pc.social) / 100), training = r2((surplus * pc.training) / 100);
  const remainder = r2(surplus - reserve - capitalPool - social - training);
  const end = `${year}-12-31`, start = `${year}-01-01`;
  const mem = await t.rows(
    `SELECT p.id, p.name, p.code, p.member_info->>'no' AS no,
       COALESCE((SELECT SUM(CASE WHEN x.kind='SUBSCRIBE' THEN x.shares ELSE -x.shares END) FROM assoc_share_txns x WHERE x.partner_id=p.id AND x.status='POSTED' AND x.date <= $2),0)::int AS shares,
       COALESCE((SELECT SUM(CASE WHEN i.kind='CREDIT_NOTE' THEN -(i.total-i.vat_total) ELSE i.total-i.vat_total END) FROM invoices i WHERE i.partner_id=p.id AND i.direction='SALE' AND i.status='POSTED' AND i.kind IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE') AND i.date BETWEEN $3 AND $2),0) AS transactions
     FROM partners p WHERE p.company_id=$1 AND p.is_member ORDER BY p.code`, [companyId, end, start]);
  const totShares = mem.reduce((a: number, m: any) => a + Math.max(0, Number(m.shares)), 0);
  const totTx = mem.reduce((a: number, m: any) => a + Math.max(0, Number(m.transactions)), 0);
  const basis = pc.basis === "CAPITAL" || totTx <= 0 ? "CAPITAL" : "TRANSACTIONS";
  const share = (pool: number, w: (m: any) => number, tot: number) => {
    // largest-remainder rounding so the members' lines add up to the pool exactly
    if (!(pool > 0) || !(tot > 0)) return mem.map(() => 0);
    const raw = mem.map((m: any) => (pool * Math.max(0, w(m))) / tot);
    const fl = raw.map((v) => Math.floor(v * 100) / 100);
    let left = Math.round((pool - fl.reduce((a, b) => a + b, 0)) * 100);
    const order = raw.map((v, i) => [v * 100 - Math.floor(v * 100), i] as [number, number]).sort((a, b) => b[0] - a[0]);
    for (const [, i] of order) { if (left <= 0) break; fl[i] = r2(fl[i] + 0.01); left--; }
    return fl.map(r2);
  };
  const capShares = totShares > 0 ? share(capitalPool, (m) => m.shares, totShares) : mem.map(() => 0);
  const txShares = share(remainder, (m) => (basis === "CAPITAL" ? m.shares : m.transactions), basis === "CAPITAL" ? totShares : totTx);
  const lines = mem.map((m: any, i: number) => ({ partnerId: m.id, name: m.name, no: m.no || m.code, shares: Number(m.shares), transactions: r2(num(m.transactions)), capitalReturn: capShares[i], txReturn: txShares[i], total: r2(capShares[i] + txShares[i]) })).filter((l: any) => l.total > 0 || l.shares > 0);
  const toMembers = r2(lines.reduce((a: number, l: any) => a + l.total, 0));
  // whatever cannot be given to anyone (no shares / no transactions) stays in retained earnings
  const retained = r2(surplus - reserve - social - training - toMembers);
  const warnings: string[] = [];
  if (s.assocType !== "COOPERATIVE") warnings.push("نوع الجمعية غير ربحي: لا يجوز توزيع الفائض على الأعضاء. غيّر النوع إلى «تعاونية» إن كان نظامها يسمح.");
  if (surplus <= 0) warnings.push(`لا يوجد فائض للسنة ${year} (النتيجة ${ledger}).`);
  if (fy && fy.status !== "CLOSED") warnings.push(`السنة المالية ${year} لم تُقفل بعد — يُفضَّل التوزيع بعد اعتماد الجمعية العمومية للقوائم المالية وإقفال السنة.`);
  if (!totShares) warnings.push("لا توجد أسهم مكتتبة: يبقى نصيب عائد رأس المال في الأرباح المبقاة.");
  if (pc.basis !== "CAPITAL" && totTx <= 0) warnings.push("لا توجد تعاملات مبيعات مع الأعضاء خلال السنة: وُزّع الباقي حسب الأسهم.");
  return { year, ledgerSurplus: ledger, surplus, pcts: { ...pc, basis }, reserve, capitalPool, social, training, remainder, toMembers, retained, totalShares: totShares, totalTransactions: r2(totTx), basis, lines, warnings, fiscalYearStatus: fy?.status || null, assocType: s.assocType };
}

export async function postDistribution(t: Db, companyId: string, user: string, b: any) {
  const plan = await distributionPlan(t, companyId, b);
  if (plan.assocType !== "COOPERATIVE") throw conflict("توزيع الفائض خاص بالجمعيات التعاونية");
  if (!(plan.surplus > 0)) throw bad("لا يوجد فائض للتوزيع");
  if (await t.maybe(`SELECT 1 FROM assoc_distributions WHERE company_id=$1 AND year=$2 AND status='POSTED'`, [companyId, plan.year])) throw conflict(`سُجّل توزيع فائض لعام ${plan.year} — ألغه أولاً لإعادة التوزيع`);
  await ensureAssocAccounts(t, companyId);
  const d = isDate(b.date) ? b.date : today();
  const reserveAcc = await t.maybe(`SELECT id FROM accounts WHERE company_id=$1 AND code='3102' AND NOT is_group`, [companyId]);
  if (!reserveAcc) throw bad("حساب الاحتياطي النظامي 3102 غير موجود في دليل الحسابات");
  const retained = await acct(t, companyId, null, "RETAINED", "الأرباح المبقاة");
  const number = await nextNumber(t, companyId, "DST", d);
  const memo = `توزيع الفائض الصافي لعام ${plan.year} — قرار الجمعية العمومية${b.decisionRef ? " " + b.decisionRef : ""}`;
  const debit = r2(plan.reserve + plan.social + plan.training + plan.toMembers);
  const lines: any[] = [{ account: retained.id, debit, description: memo }];
  if (plan.reserve > 0) lines.push({ account: reserveAcc.id, credit: plan.reserve, description: `الاحتياطي النظامي ${plan.pcts.reserve}%` });
  if (plan.social > 0) lines.push({ key: "ASSOC_SOCIAL", credit: plan.social, description: `الخدمات الاجتماعية ${plan.pcts.social}%` });
  if (plan.training > 0) lines.push({ key: "ASSOC_TRAINING", credit: plan.training, description: `تدريب وتثقيف الأعضاء ${plan.pcts.training}%` });
  for (const l of plan.lines) if (l.total > 0) lines.push({ key: "ASSOC_DIVIDENDS", credit: l.total, partnerId: l.partnerId, description: `عائد ${l.name}: رأس مال ${l.capitalReturn} + ${plan.basis === "CAPITAL" ? "أسهم" : "تعاملات"} ${l.txReturn}` });
  const row = await t.insert("assoc_distributions", {
    companyId, number, year: plan.year, date: d, surplus: plan.surplus, reserve: plan.reserve, capitalReturn: plan.capitalPool, social: plan.social, training: plan.training, txReturn: plan.remainder, retained: plan.retained,
    basis: plan.basis, pcts: JSON.stringify(plan.pcts), lines: JSON.stringify(plan.lines.map((l: any) => ({ ...l, paid: 0 }))), notes: b.decisionRef ? `قرار ${b.decisionRef}` : null, isDemo: !!b.isDemo, createdBy: user,
  });
  const je = await post(t, companyId, { date: d, type: "MANUAL", sourceType: "ASSOC_DIST", sourceId: row.id, reference: number, memo, createdBy: user, isDemo: !!b.isDemo, lines });
  await t.exec(`UPDATE assoc_distributions SET journal_id=$1 WHERE id=$2`, [je!.id, row.id]);
  return { ...row, journalId: je!.id };
}

export async function listDistributions(t: Db, companyId: string) {
  return t.rows(`SELECT d.*, je.number journal_number, COALESCE((SELECT SUM(amount) FROM assoc_dist_payments p WHERE p.distribution_id=d.id AND p.status='POSTED'),0) AS paid FROM assoc_distributions d LEFT JOIN journal_entries je ON je.id=d.journal_id WHERE d.company_id=$1 ORDER BY d.year DESC, d.created_at DESC`, [companyId]);
}

export async function payDistribution(t: Db, companyId: string, user: string, id: string, b: any) {
  const dist = await t.one(`SELECT * FROM assoc_distributions WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "التوزيع غير موجود");
  if (dist.status !== "POSTED") throw bad("التوزيع ملغى");
  const d = isDate(b.date) ? b.date : today();
  const cash = await acct(t, companyId, b.cashAccountId, "BANK", "حساب الصرف (صندوق / بنك)", { cash: true });
  const who: string[] = Array.isArray(b.partnerIds) && b.partnerIds.length ? b.partnerIds : dist.lines.map((l: any) => l.partnerId);
  const out: any[] = [];
  for (const pid of who) {
    const l = dist.lines.find((x: any) => x.partnerId === pid);
    if (!l) throw bad("العضو ليس ضمن هذا التوزيع");
    const paid = num((await t.one(`SELECT COALESCE(SUM(amount),0) s FROM assoc_dist_payments WHERE distribution_id=$1 AND partner_id=$2 AND status='POSTED'`, [id, pid])).s);
    const due = r2(num(l.total) - paid);
    if (due <= 0) continue;
    const number = await nextNumber(t, companyId, "DSP", d);
    const memo = `صرف عائد ${dist.year} — ${l.name}`;
    const row = await t.insert("assoc_dist_payments", { companyId, distributionId: id, partnerId: pid, number, date: d, amount: due, cashAccountId: cash.id, createdBy: user });
    const je = await post(t, companyId, { date: d, type: "PAYMENT", sourceType: "ASSOC_DIST_PAY", sourceId: row.id, reference: number, memo, createdBy: user, lines: [{ key: "ASSOC_DIVIDENDS", debit: due, partnerId: pid, description: memo }, { account: cash.id, credit: due, description: memo }] });
    await t.exec(`UPDATE assoc_dist_payments SET journal_id=$1 WHERE id=$2`, [je!.id, row.id]);
    out.push({ ...row, name: l.name });
  }
  if (!out.length) throw bad("لا يوجد عائد مستحق غير مصروف لمن اخترت");
  return { paid: out, total: r2(out.reduce((a, x) => a + Number(x.amount), 0)) };
}

export async function cancelDistribution(t: Db, companyId: string, user: string, id: string, reason?: string) {
  const dist = await t.one(`SELECT * FROM assoc_distributions WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "التوزيع غير موجود");
  if (dist.status !== "POSTED") throw bad("التوزيع ملغى مسبقاً");
  if (await t.maybe(`SELECT 1 FROM assoc_dist_payments WHERE distribution_id=$1 AND status='POSTED'`, [id])) throw conflict("صُرف جزء من العوائد للأعضاء — لا يُلغى التوزيع بعد الصرف");
  if (dist.journalId) await reverse(t, companyId, dist.journalId, today() < String(dist.date).slice(0, 10) ? dist.date : today(), `إلغاء توزيع الفائض ${dist.number}${reason ? " — " + reason : ""}`, user);
  await t.exec(`UPDATE assoc_distributions SET status='CANCELLED', notes=COALESCE(notes,'') || $2 WHERE id=$1`, [id, reason ? ` [إلغاء: ${reason}]` : ""]);
  return { ok: true };
}

/** Sub-ledgers vs the general ledger (for the integrity screen and the tests). */
export async function assocChecks(t: Db, companyId: string) {
  const out: { name: string; ok: boolean; expected: number; actual: number }[] = [];
  const dividends = await t.maybe(`SELECT id FROM accounts WHERE company_id=$1 AND system_key='ASSOC_DIVIDENDS'`, [companyId]);
  if (dividends) {
    const gl = num((await t.one(`SELECT COALESCE(SUM(l.credit-l.debit),0) s FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id=$1 AND e.status='POSTED'`, [dividends.id])).s);
    const sub = num((await t.one(`SELECT COALESCE((SELECT SUM((l->>'total')::numeric) FROM assoc_distributions d, jsonb_array_elements(d.lines) l WHERE d.company_id=$1 AND d.status='POSTED'),0) - COALESCE((SELECT SUM(amount) FROM assoc_dist_payments WHERE company_id=$1 AND status='POSTED'),0) s`, [companyId])).s);
    out.push({ name: "عوائد الأعضاء المستحقة = سجل التوزيعات − المصروف", ok: Math.abs(gl - sub) < 0.01, expected: r2(sub), actual: r2(gl) });
  }
  const shares = num((await t.one(`SELECT COALESCE(SUM(CASE WHEN kind='SUBSCRIBE' THEN amount ELSE -amount END),0) s FROM assoc_share_txns WHERE company_id=$1 AND status='POSTED'`, [companyId])).s);
  const capGl = num((await t.one(`SELECT COALESCE(SUM(l.credit-l.debit),0) s FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id WHERE a.company_id=$1 AND a.system_key='CAPITAL' AND e.status='POSTED' AND e.source_type='ASSOC_SHARES'`, [companyId])).s);
  out.push({ name: "رأس مال الأعضاء في الأستاذ = سجل الأسهم", ok: Math.abs(shares - capGl) < 0.01, expected: r2(shares), actual: r2(capGl) });
  return out;
}

// ─── one register for every voucher, whichever screen made it ─────────────
/** Core receipts/payments and expenses sit next to the association's receipts, disbursements, share
 *  movements and dividend payments; each row carries its journal, and `journalAmount` is what the
 *  entry actually moved on the cash/bank side — a mismatch is flagged. */
export async function voucherRegister(t: Db, companyId: string, q: any) {
  const from = isDate(q.from) ? q.from : `${new Date().getFullYear()}-01-01`;
  const to = isDate(q.to) ? q.to : today();
  const rows = await t.rows(
    `WITH v AS (
       SELECT 'CORE_PAY' src, p.id, p.number, p.date, p.direction dir, pa.name party, COALESCE(p.net_paid, p.amount) AS amount, p.account_id cash_id, p.journal_id, p.status, COALESCE(p.notes, '') memo FROM payments p JOIN partners pa ON pa.id=p.partner_id WHERE p.company_id=$1
       UNION ALL SELECT 'CORE_EXP', e.id, e.number, e.date, 'OUT', COALESCE(pa.name, e.description), e.total, e.pay_account_id, e.journal_id, e.status, e.description FROM expenses e LEFT JOIN partners pa ON pa.id=e.partner_id WHERE e.company_id=$1 AND e.pay_account_id IS NOT NULL
       UNION ALL SELECT 'CH_RCPT', r.id, r.number, r.date, 'IN', r.payer_name, r.amount, r.cash_account_id, r.journal_id, r.status, COALESCE(r.purpose, '') FROM charity_receipts r WHERE r.company_id=$1
       UNION ALL SELECT 'CH_DISB', d.id, d.number, d.date, 'OUT', d.beneficiary_name, d.amount, d.pay_account_id, d.journal_id, d.status, d.reason FROM charity_disbursements d WHERE d.company_id=$1
       UNION ALL SELECT 'SHARES', x.id, x.number, x.date, CASE WHEN x.kind='SUBSCRIBE' THEN 'IN' ELSE 'OUT' END, pa.name, x.amount, x.cash_account_id, x.journal_id, x.status, CASE WHEN x.kind='SUBSCRIBE' THEN 'اكتتاب أسهم' ELSE 'استرداد أسهم' END FROM assoc_share_txns x JOIN partners pa ON pa.id=x.partner_id WHERE x.company_id=$1
       UNION ALL SELECT 'DIST_PAY', y.id, y.number, y.date, 'OUT', pa.name, y.amount, y.cash_account_id, y.journal_id, y.status, 'صرف عائد عضو' FROM assoc_dist_payments y JOIN partners pa ON pa.id=y.partner_id WHERE y.company_id=$1
     )
     SELECT v.*, a.name_ar cash_name, je.number journal_number, je.status journal_status,
       (SELECT COALESCE(SUM(CASE WHEN v.dir='IN' THEN l.debit-l.credit ELSE l.credit-l.debit END),0) FROM journal_lines l WHERE l.entry_id=v.journal_id AND l.account_id=v.cash_id) AS journal_amount
     FROM v LEFT JOIN accounts a ON a.id=v.cash_id LEFT JOIN journal_entries je ON je.id=v.journal_id
     WHERE v.date BETWEEN $2 AND $3 ORDER BY v.date DESC, v.number DESC LIMIT 10000`,
    [companyId, from, to],
  );
  const posted = rows.filter((r: any) => r.status === "POSTED");
  const bad = posted.filter((r: any) => !r.journalId || r.journalStatus !== "POSTED" || Math.abs(num(r.journalAmount) - num(r.amount)) > 0.01);
  const sumBy = (f: (r: any) => boolean) => r2(posted.filter(f).reduce((a: number, r: any) => a + num(r.amount), 0));
  return {
    from, to, rows: rows.map((r: any) => ({ ...r, ok: r.status !== "POSTED" || !bad.includes(r) })),
    totals: { in: sumBy((r) => r.dir === "IN"), out: sumBy((r) => r.dir === "OUT"), coreIn: sumBy((r) => r.dir === "IN" && r.src.startsWith("CORE")), coreOut: sumBy((r) => r.dir === "OUT" && r.src.startsWith("CORE")), assocIn: sumBy((r) => r.dir === "IN" && !r.src.startsWith("CORE")), assocOut: sumBy((r) => r.dir === "OUT" && !r.src.startsWith("CORE")) },
    mismatches: bad.length,
  };
}
