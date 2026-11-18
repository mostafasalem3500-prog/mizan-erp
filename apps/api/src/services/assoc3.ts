/**
 * What a Saudi association needs on top of its vouchers:
 *   • لائحة الصلاحيات المالية — approval levels by amount (number of approvers, board decision above a limit),
 *     separation of duties (the requester does not approve), and a ceiling for disbursing without a request
 *   • الحوكمة — board / general-assembly meetings with quorum and minutes, and the decisions register with follow-up
 *   • المنح — agreements with donor entities: tranches, receipts against them, reports owed to the donor
 *   • القوائم المالية للمنشآت غير الهادفة للربح — statement of activities by fund (unrestricted / restricted / endowment)
 *     and net assets by fund on the statement of financial position
 */
import { Db } from "../db/pool";
import { AppError, bad, conflict, r2, num, isDate, today } from "../lib/core";
import { nextNumber } from "../accounting/engine";
import { ensureCharity } from "./charity";
import { balanceSheet } from "./reports";

const ymd = (v: any) => (v instanceof Date ? v.toISOString() : String(v || "")).slice(0, 10);
const addDays = (d: string, n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// ─── authority matrix ──────────────────────────────────────────────────────
export const DEFAULT_AUTHORITY = {
  enabled: true, separation: true, directLimit: 5000,
  levels: [
    { upTo: 10000, title: "المدير التنفيذي", approvals: 1, decision: false },
    { upTo: 50000, title: "المدير التنفيذي والمدير المالي", approvals: 2, decision: false },
    { upTo: null, title: "رئيس مجلس الإدارة بقرار من المجلس", approvals: 2, decision: true },
  ],
};
export function authorityConfig(a: any) {
  const o = a && typeof a === "object" && Object.keys(a).length ? a : DEFAULT_AUTHORITY;
  const levels = (Array.isArray(o.levels) && o.levels.length ? o.levels : DEFAULT_AUTHORITY.levels)
    .map((l: any) => ({ upTo: l.upTo === null || l.upTo === "" || l.upTo === undefined ? null : r2(num(l.upTo)), title: String(l.title || "صاحب الصلاحية").slice(0, 120), approvals: Math.min(5, Math.max(1, Math.floor(num(l.approvals) || 1))), decision: !!l.decision }))
    .sort((x: any, y: any) => (x.upTo ?? Infinity) - (y.upTo ?? Infinity));
  return { enabled: o.enabled !== false, separation: o.separation !== false, directLimit: Math.max(0, r2(num(o.directLimit ?? DEFAULT_AUTHORITY.directLimit))), levels };
}
export async function getAuthority(t: Db, companyId: string) {
  await ensureCharity(t, companyId);
  return authorityConfig((await t.one(`SELECT authority FROM charity_settings WHERE company_id=$1`, [companyId])).authority);
}
export async function saveAuthority(t: Db, companyId: string, b: any) {
  await ensureCharity(t, companyId);
  const c = authorityConfig(b);
  const ups = c.levels.map((l) => l.upTo);
  if (ups.filter((u) => u === null).length !== 1 || ups[ups.length - 1] !== null) throw bad("آخر مستوى يكون «بلا حد أعلى» ومستوى واحد فقط كذلك");
  if (new Set(ups).size !== ups.length) throw bad("حدود المستويات مكررة");
  await t.exec(`UPDATE charity_settings SET authority=$2 WHERE company_id=$1`, [companyId, JSON.stringify(c)]);
  return c;
}
export const levelFor = (c: ReturnType<typeof authorityConfig>, amount: number) => c.levels.find((l) => l.upTo === null || amount <= l.upTo + 0.004)!;

/** One approval on a payment request; the request becomes APPROVED when its level is satisfied (PARTIAL until then). */
export async function approveRequest(t: Db, companyId: string, user: string, id: string, b: any) {
  const r = await t.one(`SELECT * FROM charity_requests WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "الطلب غير موجود");
  if (!["SUBMITTED", "REVIEWED", "PARTIAL"].includes(r.status)) throw bad("لا يمكن اعتماد الطلب في حالته الحالية");
  const c = await getAuthority(t, companyId);
  const approvals: any[] = Array.isArray(r.approvals) ? r.approvals : [];
  if (!c.enabled) {
    return t.update("charity_requests", { id, companyId }, { status: "APPROVED", approvedBy: user, approvedAt: new Date(), decisionNote: b.note ?? r.decisionNote, approvals: JSON.stringify([...approvals, { by: user, at: new Date(), note: b.note || null }]) });
  }
  const lv = levelFor(c, num(r.amount));
  if (c.separation && (r.createdBy === user || String(r.requester || "").trim() === user)) throw new AppError(409, "فصل المهام: مقدّم الطلب أو مُدخله لا يعتمده", "SEPARATION");
  const again = approvals.some((a) => a.by === user);
  if (again && !(b.decisionId && lv.decision && !r.decisionId)) throw conflict("سبق أن اعتمدت هذا الطلب — يلزم معتمد آخر");
  let decisionId = r.decisionId;
  if (b.decisionId) {
    const d = await t.one(`SELECT id, status FROM assoc_decisions WHERE id=$1 AND company_id=$2`, [b.decisionId, companyId], "القرار غير موجود");
    if (d.status === "CANCELLED") throw bad("القرار ملغى");
    decisionId = d.id;
  }
  const next = again ? approvals : [...approvals, { by: user, at: new Date(), note: b.note || null }];
  const done = next.length >= lv.approvals && (!lv.decision || decisionId);
  const upd: any = { approvals: JSON.stringify(next), decisionId: decisionId || null, decisionNote: b.note ?? r.decisionNote };
  if (done) Object.assign(upd, { status: "APPROVED", approvedBy: next.map((a) => a.by).join(" + "), approvedAt: new Date() });
  else upd.status = "PARTIAL";
  const row = await t.update("charity_requests", { id, companyId }, upd);
  return { ...row, level: lv, missing: done ? null : [next.length < lv.approvals ? `${lv.approvals - next.length} اعتماد إضافي` : null, lv.decision && !decisionId ? "ربط قرار مجلس الإدارة" : null].filter(Boolean).join(" و") };
}

/** A disbursement that does not come from an approved request (or a run) is capped. */
export async function checkDirectLimit(t: Db, companyId: string, b: any) {
  if (b.requestId || b.batchId) return;
  const c = await getAuthority(t, companyId);
  if (!c.enabled || !c.directLimit) return;
  if (num(b.amount) > c.directLimit + 0.004) throw new AppError(409, `المبلغ ${r2(num(b.amount))} يتجاوز حد الصرف المباشر (${c.directLimit}) في لائحة الصلاحيات — قدّم «طلب صرف» واعتمده ثم اصرفه منه`, "AUTHORITY");
}

// ─── governance ────────────────────────────────────────────────────────────
export const MEETING_KINDS: Record<string, string> = { BOARD: "مجلس الإدارة", GA: "الجمعية العمومية العادية", EGA: "الجمعية العمومية غير العادية", COMMITTEE: "لجنة" };
export const DECISION_CATS: Record<string, string> = { FINANCIAL: "مالي", PROGRAM: "برامج ومشاريع", ADMIN: "إداري", HR: "موارد بشرية", OTHER: "أخرى" };

const quorum = (m: any) => { const present = (m.attendees || []).filter((a: any) => a.present !== false).length; const total = num(m.membersTotal) || (m.attendees || []).length; return { present, total, ok: total > 0 && present > total / 2, pct: total ? r2((present / total) * 100) : 0 }; };

export async function listMeetings(t: Db, companyId: string) {
  const rows = await t.rows(`SELECT m.*, (SELECT COUNT(*)::int FROM assoc_decisions d WHERE d.meeting_id=m.id) decisions FROM assoc_meetings m WHERE m.company_id=$1 ORDER BY m.date DESC, m.number DESC`, [companyId]);
  return rows.map((m: any) => ({ ...m, quorum: quorum(m) }));
}
export async function saveMeeting(t: Db, companyId: string, user: string, b: any, id?: string) {
  const kind = MEETING_KINDS[b.kind] ? b.kind : "BOARD";
  if (!isDate(b.date)) throw bad("تاريخ الاجتماع مطلوب");
  const attendees = (Array.isArray(b.attendees) ? b.attendees : []).filter((a: any) => a && String(a.name || "").trim()).slice(0, 200).map((a: any) => ({ name: String(a.name).trim().slice(0, 120), role: a.role ? String(a.role).slice(0, 80) : null, present: a.present !== false }));
  const data: any = { kind, title: b.title || null, date: b.date, location: b.location || null, membersTotal: Math.max(0, Math.floor(num(b.membersTotal))), attendees: JSON.stringify(attendees), agenda: b.agenda || null, minutes: b.minutes || null };
  if (id) {
    const m = await t.one(`SELECT status FROM assoc_meetings WHERE id=$1 AND company_id=$2`, [id, companyId], "الاجتماع غير موجود");
    if (m.status === "APPROVED" && !b.reopen) throw conflict("المحضر معتمد — لا يُعدَّل");
    if (b.status === "APPROVED") { if (!quorum({ ...data, attendees }).ok && !b.noQuorumNote) throw conflict("النصاب غير مكتمل (أكثر من النصف) — اكتب سبب اعتماد المحضر رغم ذلك أو صحّح الحضور"); data.status = "APPROVED"; }
    return t.update("assoc_meetings", { id, companyId }, data);
  }
  const number = await nextNumber(t, companyId, kind === "BOARD" ? "BRD" : kind === "COMMITTEE" ? "CMT" : "GAM", b.date, 3);
  return t.insert("assoc_meetings", { companyId, number, ...data, isDemo: !!b.isDemo, createdBy: user });
}

export async function listDecisions(t: Db, companyId: string, q: any) {
  const w = ["d.company_id=$1"]; const ps: any[] = [companyId];
  if (q.status) { ps.push(q.status); w.push(`d.status=$${ps.length}`); }
  if (q.meetingId) { ps.push(q.meetingId); w.push(`d.meeting_id=$${ps.length}`); }
  const rows = await t.rows(`SELECT d.*, m.number meeting_number, m.kind meeting_kind, p.name project_name,
      (SELECT COUNT(*)::int FROM charity_requests r WHERE r.decision_id=d.id) requests
    FROM assoc_decisions d LEFT JOIN assoc_meetings m ON m.id=d.meeting_id LEFT JOIN charity_projects p ON p.id=d.project_id WHERE ${w.join(" AND ")} ORDER BY d.date DESC, d.number DESC LIMIT 2000`, ps);
  const td = today();
  return rows.map((d: any) => ({ ...d, overdue: d.status === "OPEN" && d.dueDate && ymd(d.dueDate) < td }));
}
export async function saveDecision(t: Db, companyId: string, user: string, b: any, id?: string) {
  const text = String(b.text || "").trim();
  if (!text) throw bad("نص القرار مطلوب");
  let date = isDate(b.date) ? b.date : today();
  if (b.meetingId) { const m = await t.one(`SELECT date FROM assoc_meetings WHERE id=$1 AND company_id=$2`, [b.meetingId, companyId], "الاجتماع غير موجود"); if (!isDate(b.date)) date = ymd(m.date); }
  if (b.projectId) await t.one(`SELECT 1 FROM charity_projects WHERE id=$1 AND company_id=$2`, [b.projectId, companyId], "المشروع غير موجود");
  const data: any = { meetingId: b.meetingId || null, date, text: text.slice(0, 4000), category: DECISION_CATS[b.category] ? b.category : "ADMIN", amount: b.amount === "" || b.amount === undefined || b.amount === null ? null : r2(num(b.amount)), projectId: b.projectId || null, owner: b.owner || null, dueDate: isDate(b.dueDate) ? b.dueDate : null };
  if (b.status && ["OPEN", "DONE", "CANCELLED"].includes(b.status)) { data.status = b.status; if (b.status === "DONE") { data.doneAt = isDate(b.doneAt) ? b.doneAt : today(); data.doneNote = b.doneNote || null; } }
  if (id) return t.update("assoc_decisions", { id, companyId }, data);
  const number = String(b.number || "").trim() || await nextNumber(t, companyId, "DEC", date, 3);
  if (await t.maybe(`SELECT 1 FROM assoc_decisions WHERE company_id=$1 AND number=$2`, [companyId, number])) throw conflict(`رقم القرار ${number} مستخدم`);
  return t.insert("assoc_decisions", { companyId, number, ...data, isDemo: !!b.isDemo, createdBy: user });
}

// ─── grants ────────────────────────────────────────────────────────────────
function cleanTranches(v: any) { return (Array.isArray(v) ? v : []).filter((x: any) => x && num(x.amount) > 0).slice(0, 60).map((x: any) => ({ dueDate: isDate(x.dueDate) ? x.dueDate : null, amount: r2(num(x.amount)) })).sort((a: any, b: any) => String(a.dueDate || "9").localeCompare(String(b.dueDate || "9"))); }
function cleanReports(v: any) { return (Array.isArray(v) ? v : []).filter((x: any) => x && String(x.title || "").trim()).slice(0, 60).map((x: any) => ({ dueDate: isDate(x.dueDate) ? x.dueDate : null, title: String(x.title).slice(0, 200), submittedAt: isDate(x.submittedAt) ? x.submittedAt : null, note: x.note ? String(x.note).slice(0, 300) : null })); }

function grantView(g: any, received: number, spent: number) {
  const td = today();
  let left = received;
  const tranches = (g.tranches || []).map((x: any) => { const got = Math.min(left, x.amount); left = r2(left - got); return { ...x, received: r2(got), status: got >= x.amount - 0.004 ? "RECEIVED" : x.dueDate && x.dueDate < td ? "OVERDUE" : got > 0 ? "PARTIAL" : "PENDING" }; });
  const reports = (g.reports || []).map((x: any) => ({ ...x, status: x.submittedAt ? "SUBMITTED" : x.dueDate && x.dueDate < td ? "OVERDUE" : x.dueDate && x.dueDate <= addDays(td, 14) ? "SOON" : "PENDING" }));
  return { ...g, amount: r2(num(g.amount)), received: r2(received), remaining: r2(num(g.amount) - received), spent: r2(spent), pct: num(g.amount) ? r2((received / num(g.amount)) * 100) : 0, tranches, reports, overdueTranches: tranches.filter((x: any) => x.status === "OVERDUE").length, dueReports: reports.filter((x: any) => x.status === "OVERDUE" || x.status === "SOON").length };
}
export async function listGrants(t: Db, companyId: string) {
  const rows = await t.rows(`SELECT g.*, p.name project_name,
      COALESCE((SELECT SUM(amount) FROM charity_receipts r WHERE r.grant_id=g.id AND r.status='POSTED'),0) received,
      COALESCE((SELECT SUM(amount) FROM charity_disbursements d WHERE d.project_id=g.project_id AND d.status='POSTED' AND g.project_id IS NOT NULL AND d.date >= COALESCE(g.start_date, '1900-01-01')),0) spent
    FROM assoc_grants g LEFT JOIN charity_projects p ON p.id=g.project_id WHERE g.company_id=$1 ORDER BY g.status, g.created_at DESC`, [companyId]);
  return rows.map((g: any) => grantView(g, num(g.received), num(g.spent)));
}
export async function saveGrant(t: Db, companyId: string, user: string, b: any, id?: string) {
  const title = String(b.title || "").trim();
  if (!title) throw bad("عنوان المنحة مطلوب");
  const p = b.partnerId ? await t.one(`SELECT id, name FROM partners WHERE id=$1 AND company_id=$2`, [b.partnerId, companyId], "الجهة المانحة غير موجودة") : null;
  const grantor = String(b.grantorName || p?.name || "").trim();
  if (!grantor) throw bad("اسم الجهة المانحة مطلوب");
  const amount = r2(num(b.amount));
  if (!(amount > 0)) throw bad("قيمة المنحة مطلوبة");
  const tranches = cleanTranches(b.tranches);
  const tsum = r2(tranches.reduce((a: number, x: any) => a + x.amount, 0));
  if (tranches.length && Math.abs(tsum - amount) > 0.01) throw bad(`مجموع الدفعات (${tsum}) لا يساوي قيمة المنحة (${amount})`);
  if (b.projectId) await t.one(`SELECT 1 FROM charity_projects WHERE id=$1 AND company_id=$2`, [b.projectId, companyId], "المشروع غير موجود");
  const data: any = { title, partnerId: p?.id || null, grantorName: grantor, agreementNo: b.agreementNo || null, projectId: b.projectId || null, amount, startDate: isDate(b.startDate) ? b.startDate : null, endDate: isDate(b.endDate) ? b.endDate : null, tranches: JSON.stringify(tranches), reports: JSON.stringify(cleanReports(b.reports)), status: b.status === "CLOSED" ? "CLOSED" : "ACTIVE", notes: b.notes || null };
  if (id) return t.update("assoc_grants", { id, companyId }, data);
  const number = await nextNumber(t, companyId, "GRT", isDate(b.startDate) ? b.startDate : today(), 3);
  return t.insert("assoc_grants", { companyId, number, ...data, isDemo: !!b.isDemo, createdBy: user });
}
export async function grantDetail(t: Db, companyId: string, id: string) {
  const g = (await listGrants(t, companyId)).find((x: any) => x.id === id);
  if (!g) throw bad("المنحة غير موجودة");
  const receipts = await t.rows(`SELECT id, number, date, amount, method, status FROM charity_receipts WHERE grant_id=$1 ORDER BY date`, [id]);
  return { ...g, receiptsList: receipts };
}

// ─── alerts ────────────────────────────────────────────────────────────────
export async function governanceAlerts(t: Db, companyId: string) {
  const out: { level: "danger" | "warn" | "info"; title: string; detail: string; link: string }[] = [];
  const od = await t.rows(`SELECT number, text FROM assoc_decisions WHERE company_id=$1 AND status='OPEN' AND due_date < CURRENT_DATE ORDER BY due_date LIMIT 20`, [companyId]);
  if (od.length) out.push({ level: "warn", title: `${od.length} قرار تجاوز موعد تنفيذه`, detail: od.slice(0, 3).map((d: any) => `${d.number}: ${String(d.text).slice(0, 40)}`).join("، "), link: "/charity/governance?tab=decisions" });
  const pr = await t.one(`SELECT COUNT(*)::int n FROM charity_requests WHERE company_id=$1 AND status='PARTIAL'`, [companyId]);
  if (pr.n) out.push({ level: "info", title: `${pr.n} طلب صرف باعتماد جزئي`, detail: "ينتظر بقية المعتمدين أو قرار المجلس بحسب لائحة الصلاحيات", link: "/charity/requests" });
  const ga = await t.maybe(`SELECT MAX(date) d FROM assoc_meetings WHERE company_id=$1 AND kind='GA' AND status='APPROVED'`, [companyId]);
  const anyMeeting = await t.maybe(`SELECT 1 FROM assoc_meetings WHERE company_id=$1 LIMIT 1`, [companyId]);
  if (anyMeeting && (!ga?.d || ymd(ga.d) < addDays(today(), -365))) out.push({ level: "info", title: "لم يُعتمد محضر جمعية عمومية عادية خلال آخر 12 شهراً", detail: "الجمعية العمومية العادية تعتمد القوائم المالية والميزانية سنوياً", link: "/charity/governance" });
  for (const g of await listGrants(t, companyId)) {
    if (g.status !== "ACTIVE") continue;
    if (g.overdueTranches) out.push({ level: "warn", title: `منحة «${g.title}»: ${g.overdueTranches} دفعة متأخرة`, detail: `من ${g.grantorName} — المستلم ${g.received} من ${g.amount}`, link: "/charity/grants" });
    const rep = g.reports.filter((x: any) => x.status === "OVERDUE" || x.status === "SOON");
    if (rep.length) out.push({ level: rep.some((x: any) => x.status === "OVERDUE") ? "danger" : "warn", title: `منحة «${g.title}»: تقرير للمانح ${rep.some((x: any) => x.status === "OVERDUE") ? "متأخر" : "مستحق قريباً"}`, detail: rep.map((x: any) => `${x.title} (${x.dueDate})`).join("، "), link: "/charity/grants" });
  }
  return out;
}

// ─── non-profit statements by fund ─────────────────────────────────────────
/**
 * Fund of a journal line: ENDOWMENT if on an endowment program's cost centre, RESTRICTED if a restricted revenue account
 * (restricted donations, zakat) or a restricted program's cost centre, otherwise UNRESTRICTED. Expenses are reported in the
 * unrestricted column; spending on restricted programs and from zakat is "released from restriction".
 */
export async function npoStatements(t: Db, companyId: string, q: any) {
  await ensureCharity(t, companyId);
  const to = isDate(q.to) ? q.to : today();
  const from = isDate(q.from) ? q.from : `${to.slice(0, 4)}-01-01`;
  const fundSql = `CASE WHEN cc.kind='ENDOWMENT' THEN 'E' WHEN a.system_key IN ('DON_RESTRICTED','DON_ZAKAT') OR cc.restricted THEN 'R' ELSE 'U' END`;
  const base = `FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id
    LEFT JOIN charity_projects cc ON cc.company_id=e.company_id AND cc.cost_center_id IS NOT NULL AND cc.cost_center_id=l.cost_center_id
    WHERE e.company_id=$1 AND e.status='POSTED' AND e.type<>'CLOSING' AND a.type IN ('REVENUE','EXPENSE')`;
  const rev = await t.rows(`SELECT a.code, a.name_ar, ${fundSql} fund, SUM(l.credit-l.debit) amount ${base} AND a.type='REVENUE' AND e.date BETWEEN $2 AND $3 GROUP BY 1,2,3 HAVING SUM(l.credit-l.debit)<>0 ORDER BY 1`, [companyId, from, to]);
  const exp = await t.rows(`SELECT a.code, a.name_ar, SUM(l.debit-l.credit) amount ${base} AND a.type='EXPENSE' AND e.date BETWEEN $2 AND $3 GROUP BY 1,2 HAVING SUM(l.debit-l.credit)<>0 ORDER BY 1`, [companyId, from, to]);
  // released from restriction: expenses on restricted programs, or paid from the zakat fund
  const relSql = (range: string) => `SELECT COALESCE(SUM(l.debit-l.credit),0) s ${base} AND a.type='EXPENSE' AND ${range}
      AND ((cc.restricted AND cc.kind<>'ENDOWMENT') OR e.source_id IN (SELECT id FROM charity_disbursements WHERE company_id=$1 AND fund='ZAKAT'))`;
  const released = r2(num((await t.one(relSql("e.date BETWEEN $2 AND $3"), [companyId, from, to])).s));
  const revByFund = (f: string) => r2(rev.filter((r: any) => r.fund === f).reduce((a: number, r: any) => a + num(r.amount), 0));
  const totalExp = r2(exp.reduce((a: number, r: any) => a + num(r.amount), 0));
  const cols = {
    U: { revenue: revByFund("U"), released, expenses: totalExp, change: 0 },
    R: { revenue: revByFund("R"), released: -released, expenses: 0, change: 0 },
    E: { revenue: revByFund("E"), released: 0, expenses: 0, change: 0 },
  };
  for (const k of ["U", "R", "E"] as const) cols[k].change = r2(cols[k].revenue + cols[k].released - cols[k].expenses);
  // closing restricted & endowment balances: cumulative to `to`; unrestricted = total net assets − the rest
  const cumRev = await t.rows(`SELECT ${fundSql} fund, SUM(l.credit-l.debit) s ${base} AND a.type='REVENUE' AND e.date <= $2 GROUP BY 1`, [companyId, to]);
  const cumRel = r2(num((await t.one(relSql("e.date <= $2"), [companyId, to])).s));
  const cum = (f: string) => r2(num(cumRev.find((x: any) => x.fund === f)?.s));
  const bs: any = await balanceSheet(t, companyId, { to });
  const totalNet = r2(num(bs.totalEquity));
  const closingR = r2(cum("R") - cumRel), closingE = cum("E");
  const closing = { U: r2(totalNet - closingR - closingE), R: closingR, E: closingE };
  const opening = { U: r2(closing.U - cols.U.change), R: r2(closing.R - cols.R.change), E: r2(closing.E - cols.E.change) };
  const programExp = r2(exp.filter((r: any) => String(r.code).startsWith("55")).reduce((a: number, r: any) => a + num(r.amount), 0));
  return {
    from, to,
    revenues: rev.map((r: any) => ({ code: r.code, name: r.nameAr, fund: r.fund, amount: r2(num(r.amount)) })),
    expenses: exp.map((r: any) => ({ code: r.code, name: r.nameAr, amount: r2(num(r.amount)), program: String(r.code).startsWith("55") })),
    columns: cols, opening, closing, totalNetAssets: totalNet,
    position: { totalAssets: r2(num(bs.totalAssets)), totalLiabilities: r2(num(bs.totalLiab)), totalNetAssets: totalNet, balanced: !!bs.balanced },
    ratios: { programPct: totalExp ? r2((programExp / totalExp) * 100) : 0, adminPct: totalExp ? r2(((totalExp - programExp) / totalExp) * 100) : 0 },
    warnings: closing.R < -0.004 ? ["الصرف على البرامج المقيدة أو من الزكاة تجاوز ما وَرَد لها — صافي الأصول المقيدة سالب: راجع تصنيف الإيرادات أو مراكز التكلفة"] : [],
  };
}
