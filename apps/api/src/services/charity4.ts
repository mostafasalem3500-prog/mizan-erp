/**
 * Round 23 — charity: zakat fund compliance and social case studies.
 *
 * Zakat received by an association is a restricted fund: it may only be spent on the eight Sharia categories
 * (التوبة: 60) and never beyond what was collected. The share paid to «العاملين عليها» is capped by policy
 * (default ⅛ = 12.5% of the zakat collected in the year). A beneficiary's latest case study decides whether
 * zakat may be given to him (فقير / مسكين), with an explicit, recorded override when the board decides otherwise.
 */
import { Db } from "../db/pool";
import { bad, conflict, r2, D, num, isDate, today } from "../lib/core";
import { nextNumber } from "../accounting/engine";

export const ZAKAT_CATEGORIES: Record<string, string> = {
  FUQARA: "الفقراء", MASAKIN: "المساكين", AMILIN: "العاملين عليها", MUALLAFA: "المؤلفة قلوبهم",
  RIQAB: "في الرقاب", GHARIMIN: "الغارمين", FISABILILLAH: "في سبيل الله", IBN_SABIL: "ابن السبيل",
};
export const CASE_FLAGS: Record<string, { ar: string; pts: number }> = {
  ORPHAN: { ar: "أيتام في الأسرة", pts: 12 }, WIDOW: { ar: "أرملة", pts: 10 }, DIVORCED: { ar: "مطلقة", pts: 8 },
  DISABLED: { ar: "إعاقة", pts: 10 }, CHRONIC: { ar: "مرض مزمن", pts: 8 }, ELDERLY: { ar: "كبير سن", pts: 6 },
  UNEMPLOYED: { ar: "عائل بلا عمل", pts: 8 }, STUDENT: { ar: "طلاب في الأسرة", pts: 3 },
};
export const DEFAULT_POLICY = { faqirLine: 800, miskeenLine: 1500, amilinCapPct: 12.5, aidCooldownDays: 30, caseValidityDays: 365, requireCaseForZakat: true };

export async function policy(t: Db, companyId: string) {
  const s = await t.maybe(`SELECT policy FROM charity_settings WHERE company_id=$1`, [companyId]);
  return { ...DEFAULT_POLICY, ...(s?.policy || {}) };
}

export async function savePolicy(t: Db, companyId: string, b: any) {
  const cur = await policy(t, companyId);
  const nx = {
    faqirLine: b.faqirLine !== undefined ? Math.max(0, num(b.faqirLine)) : cur.faqirLine,
    miskeenLine: b.miskeenLine !== undefined ? Math.max(0, num(b.miskeenLine)) : cur.miskeenLine,
    amilinCapPct: b.amilinCapPct !== undefined ? Math.min(100, Math.max(0, num(b.amilinCapPct))) : cur.amilinCapPct,
    aidCooldownDays: b.aidCooldownDays !== undefined ? Math.max(0, Math.round(num(b.aidCooldownDays))) : cur.aidCooldownDays,
    caseValidityDays: b.caseValidityDays !== undefined ? Math.max(30, Math.round(num(b.caseValidityDays))) : cur.caseValidityDays,
    requireCaseForZakat: b.requireCaseForZakat !== undefined ? !!b.requireCaseForZakat : cur.requireCaseForZakat,
  };
  if (nx.miskeenLine < nx.faqirLine) throw bad("حد المسكين يجب أن يكون أعلى من حد الفقير أو مساوياً له");
  await t.exec(`UPDATE charity_settings SET policy=$2 WHERE company_id=$1`, [companyId, JSON.stringify(nx)]);
  return nx;
}

// ─── zakat fund ────────────────────────────────────────────────────────────
export async function zakatFund(t: Db, companyId: string, asOf?: string, exceptId?: string) {
  const d = isDate(asOf) ? asOf! : "9999-12-31";
  const r = await t.one(`SELECT COALESCE(SUM(amount),0) s FROM charity_receipts WHERE company_id=$1 AND status='POSTED' AND source='ZAKAT' AND date <= $2`, [companyId, d]);
  const x = await t.one(`SELECT COALESCE(SUM(amount),0) s FROM charity_disbursements WHERE company_id=$1 AND status='POSTED' AND fund='ZAKAT' AND date <= $2 ${exceptId ? "AND id<>$3" : ""}`, exceptId ? [companyId, d, exceptId] : [companyId, d]);
  return { received: r2(r.s), distributed: r2(x.s), available: r2(D(r.s).minus(x.s)) };
}

/** Validates a disbursement paid from the zakat fund (called inside createDisbursement, before posting). */
export async function checkZakatDisbursement(t: Db, companyId: string, b: { amount: number; date: string; category: string; capacity: string; partnerId?: string | null; override?: string | null }) {
  if (!ZAKAT_CATEGORIES[b.category]) throw bad("حدد مصرف الزكاة (أحد الأصناف الثمانية)");
  if (b.category !== "AMILIN" && b.capacity !== "BENEFICIARY") throw bad("الصرف من الزكاة لغير «العاملين عليها» يكون لمستفيد فقط");
  const pol = await policy(t, companyId);
  const f = await zakatFund(t, companyId, b.date);
  if (b.amount > f.available + 0.001) throw conflict(`رصيد صندوق الزكاة المتاح ${f.available.toFixed(2)} ر.س لا يكفي (المحصّل ${f.received.toFixed(2)} − المصروف ${f.distributed.toFixed(2)}) — الزكاة لا تُصرف من غير أموالها`);
  if (b.category === "AMILIN" && pol.amilinCapPct > 0) {
    const y = b.date.slice(0, 4);
    const rec = await t.one(`SELECT COALESCE(SUM(amount),0) s FROM charity_receipts WHERE company_id=$1 AND status='POSTED' AND source='ZAKAT' AND date BETWEEN $2 AND $3`, [companyId, `${y}-01-01`, `${y}-12-31`]);
    const used = await t.one(`SELECT COALESCE(SUM(amount),0) s FROM charity_disbursements WHERE company_id=$1 AND status='POSTED' AND fund='ZAKAT' AND zakat_category='AMILIN' AND date BETWEEN $2 AND $3`, [companyId, `${y}-01-01`, `${y}-12-31`]);
    const cap = r2(D(rec.s).times(pol.amilinCapPct).div(100));
    if (r2(D(used.s).plus(b.amount)) > cap + 0.001) throw conflict(`حصة «العاملين عليها» تتجاوز السقف ${pol.amilinCapPct}% من زكاة السنة (${cap.toFixed(2)} ر.س، المصروف ${r2(used.s).toFixed(2)})`);
  }
  if (["FUQARA", "MASAKIN"].includes(b.category) && b.partnerId && pol.requireCaseForZakat) {
    const cs = await latestCase(t, companyId, b.partnerId);
    const why = !cs ? "لا توجد دراسة حالة للمستفيد" : cs.validUntil && String(cs.validUntil).slice(0, 10) < b.date ? `دراسة الحالة ${cs.number} منتهية الصلاحية` : !cs.zakatEligible ? `دراسة الحالة ${cs.number} تصنّفه «غير مستحق للزكاة» (نصيب الفرد ${Number(cs.perCapita).toFixed(2)} ر.س)` : "";
    if (why && !(b.override && String(b.override).trim().length >= 5)) throw conflict(`${why} — أرفق دراسة حالة سارية، أو اكتب مبرر الاستثناء المعتمد من اللجنة`);
    return { override: why ? String(b.override).trim() : null };
  }
  return { override: null };
}

export async function zakatFundReport(t: Db, companyId: string, q: any) {
  const from = isDate(q.from) ? q.from : today().slice(0, 4) + "-01-01";
  const to = isDate(q.to) ? q.to : today();
  const rec = await t.one(`SELECT COALESCE(SUM(amount),0) s, COUNT(*)::int n FROM charity_receipts WHERE company_id=$1 AND status='POSTED' AND source='ZAKAT' AND date BETWEEN $2 AND $3`, [companyId, from, to]);
  const cats = await t.rows(`SELECT zakat_category k, COUNT(*)::int n, COUNT(DISTINCT COALESCE(partner_id::text, beneficiary_name))::int people, SUM(amount) s FROM charity_disbursements WHERE company_id=$1 AND status='POSTED' AND fund='ZAKAT' AND date BETWEEN $2 AND $3 GROUP BY zakat_category`, [companyId, from, to]);
  const opening = await zakatFund(t, companyId, new Date(new Date(from + "T00:00:00Z").getTime() - 86400000).toISOString().slice(0, 10));
  const pol = await policy(t, companyId);
  const distributed = r2(cats.reduce((a: any, c: any) => D(a).plus(c.s), D(0)));
  const amilin = r2(cats.find((c: any) => c.k === "AMILIN")?.s || 0);
  const rows = Object.entries(ZAKAT_CATEGORIES).map(([k, ar]) => { const c = cats.find((x: any) => x.k === k); return { key: k, category: ar, count: c?.n || 0, people: c?.people || 0, amount: r2(c?.s || 0), pct: distributed ? r2((Number(c?.s || 0) / distributed) * 100) : 0 }; });
  const recent = await t.rows(`SELECT id, number, date, beneficiary_name, zakat_category, amount, notes FROM charity_disbursements WHERE company_id=$1 AND status='POSTED' AND fund='ZAKAT' AND date BETWEEN $2 AND $3 ORDER BY date DESC, number DESC LIMIT 200`, [companyId, from, to]);
  return {
    from, to, opening: opening.available, received: r2(rec.s), receipts: rec.n, distributed, closing: r2(D(opening.available).plus(rec.s).minus(distributed)),
    amilin, amilinPct: Number(rec.s) ? r2((amilin / Number(rec.s)) * 100) : 0, amilinCapPct: pol.amilinCapPct, rows, recent: recent.map((r: any) => ({ ...r, categoryAr: ZAKAT_CATEGORIES[r.zakatCategory] || "—" })),
    totalAvailable: (await zakatFund(t, companyId)).available,
  };
}

// ─── beneficiary aid history (duplicate-aid warning) ───────────────────────
export async function aidHistory(t: Db, companyId: string, partnerId: string, q: any = {}) {
  const pol = await policy(t, companyId);
  const days = Math.max(1, Math.round(num(q.days) || pol.aidCooldownDays || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rows = await t.rows(`SELECT id, number, date, amount, fund, zakat_category, reason FROM charity_disbursements WHERE company_id=$1 AND partner_id=$2 AND status='POSTED' ORDER BY date DESC, number DESC LIMIT 20`, [companyId, partnerId]);
  const recent = rows.filter((r: any) => String(r.date).slice(0, 10) >= since);
  const cs = await latestCase(t, companyId, partnerId);
  const year = await t.one(`SELECT COALESCE(SUM(amount),0) s, COUNT(*)::int n FROM charity_disbursements WHERE company_id=$1 AND partner_id=$2 AND status='POSTED' AND date >= $3`, [companyId, partnerId, today().slice(0, 4) + "-01-01"]);
  return {
    days, recentCount: recent.length, recentTotal: r2(recent.reduce((a: any, r: any) => D(a).plus(r.amount), D(0))), lastDate: rows[0]?.date || null, lastAmount: rows[0] ? Number(rows[0].amount) : null,
    yearTotal: r2(year.s), yearCount: year.n, rows: rows.map((r: any) => ({ ...r, categoryAr: r.zakatCategory ? ZAKAT_CATEGORIES[r.zakatCategory] : null })),
    caseStudy: cs, warning: recent.length ? `صُرف لهذا المستفيد ${recent.length} مرة خلال آخر ${days} يوماً بإجمالي ${r2(recent.reduce((a: any, r: any) => D(a).plus(r.amount), D(0))).toFixed(2)} ر.س — آخرها ${String(rows[0].date).slice(0, 10)}` : null,
  };
}

// ─── case studies (دراسة الحالة) ───────────────────────────────────────────
export function assess(b: any, pol: typeof DEFAULT_POLICY) {
  const members = Math.max(1, Math.round(num(b.members)));
  const income = r2(Math.max(0, num(b.income)));
  const rent = r2(b.housing === "RENT" ? Math.max(0, num(b.rent)) : 0);
  const debt = r2(Math.max(0, num(b.debtMonthly)));
  const perCapita = r2(Math.max(0, (income - rent - debt) / members));
  const flags = (Array.isArray(b.flags) ? b.flags : []).filter((f: string) => CASE_FLAGS[f]);
  const verdict = perCapita <= pol.faqirLine ? "FAQIR" : perCapita <= pol.miskeenLine ? "MISKEEN" : "NOT_ZAKAT";
  // need score 0–100: income gap to the miskeen line (up to 60) + circumstances (up to 30) + housing/debts (up to 10)
  const gap = pol.miskeenLine > 0 ? Math.max(0, Math.min(1, (pol.miskeenLine - perCapita) / pol.miskeenLine)) : 0;
  const circ = Math.min(30, flags.reduce((a: number, f: string) => a + CASE_FLAGS[f].pts, 0));
  const extra = (b.housing === "RENT" ? 5 : 0) + (num(b.debtsTotal) > 0 ? 5 : 0);
  const score = Math.round(gap * 60 + circ + extra);
  return { members, income, rent, debt, perCapita, flags, verdict, zakatEligible: verdict !== "NOT_ZAKAT", score, priority: score >= 70 ? "عالية" : score >= 45 ? "متوسطة" : "منخفضة" };
}

export async function latestCase(t: Db, companyId: string, partnerId: string) {
  return t.maybe(`SELECT * FROM charity_case_studies WHERE company_id=$1 AND partner_id=$2 ORDER BY date DESC, created_at DESC LIMIT 1`, [companyId, partnerId]);
}

export async function listCases(t: Db, companyId: string, partnerId: string) {
  return t.rows(`SELECT * FROM charity_case_studies WHERE company_id=$1 AND partner_id=$2 ORDER BY date DESC, created_at DESC`, [companyId, partnerId]);
}

export async function saveCase(t: Db, companyId: string, user: string, partnerId: string, b: any) {
  const p = await t.one(`SELECT id, name, beneficiary_info FROM partners WHERE id=$1 AND company_id=$2 AND is_beneficiary`, [partnerId, companyId], "المستفيد غير موجود");
  if (!(num(b.members) >= 1)) throw bad("عدد أفراد الأسرة مطلوب");
  const pol = await policy(t, companyId);
  const a = assess(b, pol);
  const date = isDate(b.date) ? b.date : today();
  const validUntil = new Date(new Date(date + "T00:00:00Z").getTime() + pol.caseValidityDays * 86400000).toISOString().slice(0, 10);
  const number = await nextNumber(t, companyId, "CASE", date);
  const row = await t.insert("charity_case_studies", {
    companyId, partnerId, number, date, members: a.members, income: a.income, incomeSources: JSON.stringify(Array.isArray(b.incomeSources) ? b.incomeSources.slice(0, 10) : []),
    housing: ["RENT", "OWN", "FAMILY", "OTHER"].includes(b.housing) ? b.housing : "OTHER", rent: a.rent, debtMonthly: a.debt, debtsTotal: r2(Math.max(0, num(b.debtsTotal))),
    flags: JSON.stringify(a.flags), perCapita: a.perCapita, score: a.score, verdict: a.verdict, zakatEligible: a.zakatEligible,
    needs: b.needs || null, researcher: b.researcher || user, recommendation: b.recommendation || null, validUntil, createdBy: user,
  });
  const info = { ...(p.beneficiaryInfo || {}), familySize: a.members, assessment: { number, date, verdict: a.verdict, score: a.score, perCapita: a.perCapita, zakatEligible: a.zakatEligible, validUntil } };
  await t.exec(`UPDATE partners SET beneficiary_info=$2 WHERE id=$1`, [partnerId, JSON.stringify(info)]);
  return { ...row, priority: a.priority, policy: pol };
}
