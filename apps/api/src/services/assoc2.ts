/**
 * Financial reviewer's notes (associations edition):
 *   1. تنبيهات التقفيل: يومي (إقفال صندوق التحصيل)، أسبوعي (مراجعة الأسبوع وتوقيعها)، شهري (قفل الفترة المحاسبية)
 *   2. جدول ميزانية لكل مشروع: المقدّر والفعلي والمتبقي لكل بند، ومنع الصرف فوق الميزانية إلا بتجاوز مسجّل
 *   3. مسوغات الصرف: مرفقات على سندات الصرف وطلبات الصرف (المسار العام /attachments/ch_disb/:id)
 *   4. الصرف النهائي للمشروع: كشف ختامي، صرف نهائي اختياري، معالجة الرصيد المتبقي، ثم إقفال يمنع أي حركة عليه
 *   5. الحفظ والأرشفة اليومية: نسخة احتياطية تلقائية مضغوطة لكل منشأة كل يوم، وأرشيف اليوم بمستنداته
 */
import zlib from "zlib";
import { Db, db, pool } from "../db/pool";
import { AppError, bad, conflict, notFound, r2, num, isDate, today } from "../lib/core";
import { post } from "../accounting/engine";
import { ensureCharity, acct, createDisbursement } from "./charity";
import { voucherRegister } from "./assoc";
import { lockPeriod, closeCockpit } from "./round31";

const ymd = (v: any) => (v instanceof Date ? v.toISOString() : String(v || "")).slice(0, 10);
const addDays = (d: string, n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = (d: string) => new Date(d + "T00:00:00Z").getUTCDay(); // 0 = Sunday … 4 = Thursday

// ─── 1. closing ────────────────────────────────────────────────────────────
export const DEFAULT_CLOSING = { daily: true, weekly: true, monthly: true, weekEndDay: 4, requireDocs: false, monthGraceDays: 5 };
export function closingConfig(c: any) {
  const o = { ...DEFAULT_CLOSING, ...(c && typeof c === "object" ? c : {}) };
  return { daily: !!o.daily, weekly: !!o.weekly, monthly: !!o.monthly, requireDocs: !!o.requireDocs, weekEndDay: Math.min(6, Math.max(0, Math.floor(num(o.weekEndDay)))), monthGraceDays: Math.min(28, Math.max(0, Math.floor(num(o.monthGraceDays)))) };
}
export async function saveClosingConfig(t: Db, companyId: string, b: any) {
  await ensureCharity(t, companyId);
  const c = closingConfig(b);
  await t.exec(`UPDATE charity_settings SET closing=$2 WHERE company_id=$1`, [companyId, JSON.stringify(c)]);
  return c;
}
async function config(t: Db, companyId: string) {
  await ensureCharity(t, companyId);
  return closingConfig((await t.one(`SELECT closing FROM charity_settings WHERE company_id=$1`, [companyId])).closing);
}

/** The week that ends on `end` (the configured last working day). */
export const weekOf = (d: string, endDay: number) => { const end = addDays(d, (endDay - dow(d) + 7) % 7); return { key: end, from: addDays(end, -6), to: end }; };

async function cashBalances(t: Db, companyId: string, to: string) {
  return t.rows(
    `SELECT a.id, a.code, a.name_ar, COALESCE(SUM(l.debit-l.credit),0) balance FROM accounts a
     LEFT JOIN journal_lines l ON l.account_id=a.id AND EXISTS (SELECT 1 FROM journal_entries e WHERE e.id=l.entry_id AND e.status='POSTED' AND e.date <= $2)
     WHERE a.company_id=$1 AND a.is_cash_bank AND NOT a.is_group GROUP BY a.id ORDER BY a.code`, [companyId, to]);
}

/** Everything the reviewer signs for a week (or any range): movements by side, balances at its end, what is still open. */
export async function periodSummary(t: Db, companyId: string, from: string, to: string) {
  const vr = await voucherRegister(t, companyId, { from, to });
  const unclosedDays = (await t.rows(
    `SELECT DISTINCT r.date FROM charity_receipts r WHERE r.company_id=$1 AND r.status='POSTED' AND r.method='CASH' AND r.date BETWEEN $2 AND $3
       AND NOT EXISTS (SELECT 1 FROM charity_day_closings x WHERE x.company_id=$1 AND x.date=r.date) ORDER BY 1`, [companyId, from, to])).map((x: any) => ymd(x.date));
  const noDocs = await t.one(`SELECT COUNT(*)::int n, COALESCE(SUM(amount),0) a FROM charity_disbursements d WHERE d.company_id=$1 AND d.status='POSTED' AND d.date BETWEEN $2 AND $3 AND NOT EXISTS (SELECT 1 FROM attachments x WHERE x.company_id=$1 AND x.entity='ch_disb' AND x.entity_id=d.id)`, [companyId, from, to]);
  const pending = await t.one(`SELECT COUNT(*)::int n FROM charity_requests WHERE company_id=$1 AND status IN ('SUBMITTED','REVIEWED','APPROVED') AND date <= $2`, [companyId, to]);
  const bal = await cashBalances(t, companyId, to);
  return {
    from, to, totals: vr.totals, vouchers: vr.rows.filter((r: any) => r.status === "POSTED").length, mismatches: vr.mismatches,
    unclosedDays, disbursementsWithoutDocs: { count: noDocs.n, amount: r2(num(noDocs.a)) }, pendingRequests: pending.n,
    balances: bal.filter((b: any) => Math.abs(num(b.balance)) > 0.004).map((b: any) => ({ code: b.code, name: b.nameAr, balance: r2(num(b.balance)) })),
    cashTotal: r2(bal.reduce((a: number, b: any) => a + num(b.balance), 0)),
  };
}

export async function closingStatus(t: Db, companyId: string) {
  const cfg = await config(t, companyId);
  const td = today();
  // daily: cash collection days of the last two weeks not closed in «تحصيل دخول الأموال اليومية»
  const days = await t.rows(
    `SELECT g::date d, (SELECT COALESCE(SUM(amount),0) FROM charity_receipts r WHERE r.company_id=$1 AND r.date=g::date AND r.status='POSTED' AND r.method='CASH') cash,
       EXISTS (SELECT 1 FROM charity_day_closings x WHERE x.company_id=$1 AND x.date=g::date) closed
     FROM generate_series($2::date - 13, $2::date, '1 day') g ORDER BY 1 DESC`, [companyId, td]);
  const daily = days.map((x: any) => ({ date: ymd(x.d), cash: r2(num(x.cash)), closed: x.closed, due: !x.closed && num(x.cash) > 0 && ymd(x.d) < td, today: ymd(x.d) === td }));
  // weekly: the last 8 weeks ending on the configured day
  const closings = await t.rows(`SELECT kind, period_key, closed_by, closed_at, notes FROM assoc_closings WHERE company_id=$1 ORDER BY closed_at DESC LIMIT 200`, [companyId]);
  const weeks: any[] = [];
  let w = weekOf(td, cfg.weekEndDay);
  for (let i = 0; i < 8; i++) {
    const c = closings.find((x: any) => x.kind === "WEEKLY" && x.periodKey === w.key);
    weeks.push({ ...w, closed: !!c, closedBy: c?.closedBy || null, closedAt: c?.closedAt || null, notes: c?.notes || null, due: !c && w.to < td, current: w.from <= td && td <= w.to });
    w = weekOf(addDays(w.from, -1), cfg.weekEndDay);
  }
  // monthly: accounting periods of the last 6 months (locked = closed)
  const periods = await t.rows(`SELECT id, name, start_date, end_date, status FROM periods WHERE company_id=$1 AND start_date <= $2 ORDER BY start_date DESC LIMIT 6`, [companyId, td]);
  const months = periods.map((p: any) => {
    const key = ymd(p.startDate).slice(0, 7), end = ymd(p.endDate);
    const c = closings.find((x: any) => x.kind === "MONTHLY" && x.periodKey === key);
    const closed = p.status !== "OPEN";
    return { periodId: p.id, key, name: p.name, from: ymd(p.startDate), to: end, status: p.status, closed, closedBy: c?.closedBy || null, closedAt: c?.closedAt || null, due: !closed && end < td, overdue: !closed && addDays(end, cfg.monthGraceDays) < td };
  });
  return { config: cfg, today: td, daily, weeks, months };
}

/** Reminders for the alert centre and the bell (only what the settings ask for). */
const auditCache = new Map<string, { at: number; r: { errors: number; warnings: number; titles: string[] } }>();
export const clearAuditCache = (companyId: string) => auditCache.delete(companyId);
export async function closingAlerts(t: Db, companyId: string) {
  const s = await closingStatus(t, companyId);
  const out: { level: "danger" | "warn" | "info"; title: string; detail: string; link: string; kind: string }[] = [];
  if (s.config.weekly) {
    const due = s.weeks.filter((w) => w.due);
    if (due.length) out.push({ kind: "closing", level: due.length > 1 ? "danger" : "warn", title: `التقفيل الأسبوعي: ${due.length} أسبوع لم يُقفل`, detail: due.slice(0, 3).map((w) => `${w.from} ← ${w.to}`).join("، "), link: "/charity/closing?tab=weekly" });
    const cur = s.weeks.find((w) => w.current);
    if (cur && cur.to === s.today) out.push({ kind: "closing", level: "info", title: "اليوم آخر أيام الأسبوع — موعد التقفيل الأسبوعي", detail: `${cur.from} ← ${cur.to}`, link: "/charity/closing?tab=weekly" });
  }
  if (s.config.monthly) {
    const due = s.months.filter((m) => m.due);
    if (due.length) out.push({ kind: "closing", level: due.some((m) => m.overdue) ? "danger" : "warn", title: `التقفيل الشهري: ${due.map((m) => m.name).join("، ")} لم يُقفل`, detail: due.some((m) => m.overdue) ? `تجاوز مهلة ${s.config.monthGraceDays} أيام بعد نهاية الشهر` : "راجع الشهر وأقفله ليمنع أي قيد بتاريخه", link: "/charity/closing?tab=monthly" });
  }
  if (s.config.daily) {
    const t0 = s.daily.find((d) => d.today && d.cash > 0 && !d.closed);
    if (t0) out.push({ kind: "closing", level: "info", title: `تحصيل نقدي اليوم ${t0.cash} ريال — أقفل الصندوق آخر اليوم`, detail: "إقفال الصندوق يطابق النقد الفعلي مع المسجّل", link: "/charity/daily" });
  }
  const nd = await t.one(`SELECT COUNT(*)::int n FROM charity_disbursements d WHERE d.company_id=$1 AND d.status='POSTED' AND d.date >= CURRENT_DATE - 60 AND NOT EXISTS (SELECT 1 FROM attachments x WHERE x.company_id=$1 AND x.entity='ch_disb' AND x.entity_id=d.id)`, [companyId]);
  if (nd.n) out.push({ kind: "docs", level: s.config.requireDocs ? "warn" : "info", title: `${nd.n} سند صرف بلا مسوغات مرفقة (آخر 60 يوماً)`, detail: "ارفع الفاتورة أو الإيصال أو قرار الصرف من أيقونة 📎 في سندات الصرف", link: "/charity/expenses?docs=missing" });
  // the integration audit, at most every 10 minutes per establishment
  const hit = auditCache.get(companyId);
  let au = hit && Date.now() - hit.at < 600_000 ? hit.r : null;
  if (!au) { const { integrationAudit } = require("./assocAudit") as typeof import("./assocAudit"); const r = await integrationAudit(t, companyId); au = { errors: r.errors, warnings: r.warnings, titles: r.checks.filter((c) => !c.ok).map((c) => c.title) }; auditCache.set(companyId, { at: Date.now(), r: au }); }
  if (au.errors || au.warnings) out.push({ kind: "integration", level: au.errors ? "danger" : "warn", title: au.errors ? `فحص الربط المحاسبي: ${au.errors} خلل بين السندات والقيود` : `فحص الربط المحاسبي: ${au.warnings} ملاحظة`, detail: au.titles.slice(0, 2).join(" — "), link: "/charity/integration" });
  return out;
}

export async function closeWeek(t: Db, companyId: string, user: string, b: any) {
  const cfg = await config(t, companyId);
  if (!isDate(b.key)) throw bad("حدّد الأسبوع");
  const w = weekOf(b.key, cfg.weekEndDay);
  if (w.key !== b.key) throw bad(`الأسبوع ينتهي يوم ${w.key} بحسب الإعدادات`);
  if (w.to > today()) throw conflict("لا يُقفل أسبوع قبل نهايته");
  if (await t.maybe(`SELECT 1 FROM assoc_closings WHERE company_id=$1 AND kind='WEEKLY' AND period_key=$2`, [companyId, w.key])) throw conflict("الأسبوع مقفل مسبقاً");
  const sum = await periodSummary(t, companyId, w.from, w.to);
  if (sum.unclosedDays.length && !b.force) throw conflict(`أيام لم يُقفل صندوقها: ${sum.unclosedDays.join("، ")} — أقفلها أولاً من «تحصيل دخول الأموال اليومية» أو اختر الإقفال مع ملاحظة`);
  if (cfg.requireDocs && sum.disbursementsWithoutDocs.count && !b.force) throw conflict(`${sum.disbursementsWithoutDocs.count} سند صرف بلا مسوغات — المسوغات إلزامية في إعدادات التقفيل`);
  if (b.force && !String(b.notes || "").trim()) throw bad("اكتب سبب الإقفال مع وجود ملاحظات");
  return t.insert("assoc_closings", { companyId, kind: "WEEKLY", periodKey: w.key, fromDate: w.from, toDate: w.to, summary: JSON.stringify(sum), notes: b.notes || null, closedBy: user });
}

export async function reopenWeek(t: Db, companyId: string, key: string) {
  const r = await t.maybe(`DELETE FROM assoc_closings WHERE company_id=$1 AND kind='WEEKLY' AND period_key=$2 RETURNING id`, [companyId, key]);
  if (!r) throw notFound("الأسبوع غير مقفل");
  return { ok: true };
}

/** Monthly closing = the accounting period is locked (no entry can be dated in it), with the month's summary on record. */
export async function closeMonth(t: Db, companyId: string, user: string, b: any, canForce: boolean) {
  const p = await t.one(`SELECT * FROM periods WHERE id=$1 AND company_id=$2`, [b.periodId, companyId], "الفترة غير موجودة");
  if (ymd(p.endDate) >= today()) throw conflict("لا يُقفل الشهر قبل نهايته");
  const sum = await periodSummary(t, companyId, ymd(p.startDate), ymd(p.endDate));
  if (b.force && !canForce) throw conflict("تجاوز البنود المانعة للمالك أو المدير فقط");
  const r = await lockPeriod(t, companyId, p.id, true, !!b.force);
  const key = ymd(p.startDate).slice(0, 7);
  await t.exec(`INSERT INTO assoc_closings(company_id, kind, period_key, from_date, to_date, summary, notes, closed_by) VALUES ($1,'MONTHLY',$2,$3,$4,$5,$6,$7)
    ON CONFLICT (company_id, kind, period_key) DO UPDATE SET summary=EXCLUDED.summary, notes=EXCLUDED.notes, closed_by=EXCLUDED.closed_by, closed_at=now()`, [companyId, key, ymd(p.startDate), ymd(p.endDate), JSON.stringify({ ...sum, cockpit: { blockers: (r as any).blockers || 0, warnings: (r as any).warnings || 0 } }), b.notes || null, user]);
  return { ...r, summary: sum };
}
export async function monthCheck(t: Db, companyId: string, periodId: string) {
  const c: any = await closeCockpit(t, companyId, periodId);
  return { blockers: c.blockers || 0, warnings: c.warnings || 0, items: (c.items || []).filter((i: any) => i.level !== "ok").map((i: any) => ({ level: i.level, label: i.label, detail: i.detail })) };
}

// ─── 2. budget per project ─────────────────────────────────────────────────
async function projectRow(t: Db, companyId: string, id: string) {
  return t.one(`SELECT * FROM charity_projects WHERE id=$1 AND company_id=$2`, [id, companyId], "المشروع غير موجود");
}

/** The project's budget table: every budget line with what was actually spent / received on it (by the project's cost centre). */
export async function projectBudget(t: Db, companyId: string, id: string, q: any = {}) {
  const pr = await projectRow(t, companyId, id);
  const year = q.year === "all" || !q.year ? null : Math.floor(num(q.year));
  const ps: any[] = [companyId, id];
  const yw = year ? (ps.push(year), `AND b.year=$${ps.length}`) : "";
  const lines = await t.rows(
    `SELECT b.id, b.year, b.kind, b.name, b.amount, b.notes, a.id account_id, a.code account_code, a.name_ar account_name,
       COALESCE((SELECT SUM(CASE WHEN b.kind='REVENUE' THEN l.credit-l.debit ELSE l.debit-l.credit END) FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
          WHERE l.account_id=b.account_id AND e.status='POSTED' AND e.company_id=$1 AND e.type<>'CLOSING' AND EXTRACT(YEAR FROM e.date)=b.year AND l.cost_center_id=p.cost_center_id),0) actual
     FROM charity_budget_lines b JOIN accounts a ON a.id=b.account_id JOIN charity_projects p ON p.id=b.project_id
     WHERE b.company_id=$1 AND b.project_id=$2 ${yw} ORDER BY b.year DESC, b.kind DESC, a.code, b.name`, ps);
  const out = lines.map((l: any) => { const amount = r2(num(l.amount)), actual = r2(num(l.actual)); return { ...l, amount, actual, remaining: r2(amount - actual), pct: amount ? r2((actual / amount) * 100) : null, over: actual > amount + 0.004 }; });
  // spending on the project's cost centre that no budget line covers
  const up: any[] = [companyId, pr.costCenterId, id];
  if (year) up.push(year);
  const unb = pr.costCenterId ? await t.rows(
    `SELECT a.code, a.name_ar, EXTRACT(YEAR FROM e.date)::int AS year, SUM(l.debit-l.credit) amount FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id
     WHERE e.company_id=$1 AND e.status='POSTED' AND e.type<>'CLOSING' AND l.cost_center_id=$2 AND a.type='EXPENSE' ${year ? "AND EXTRACT(YEAR FROM e.date)=$4" : ""}
       AND NOT EXISTS (SELECT 1 FROM charity_budget_lines b WHERE b.project_id=$3 AND b.account_id=l.account_id AND b.year=EXTRACT(YEAR FROM e.date))
     GROUP BY 1,2,3 HAVING ABS(SUM(l.debit-l.credit)) > 0.004 ORDER BY 3 DESC, 1`, up) : [];
  const exp = out.filter((l) => l.kind === "EXPENSE"), rev = out.filter((l) => l.kind === "REVENUE");
  const s = (a: any[], k: string) => r2(a.reduce((x, l) => x + num(l[k]), 0));
  const flows = await t.one(
    `SELECT COALESCE((SELECT SUM(amount) FROM charity_receipts WHERE project_id=$1 AND status='POSTED'),0) received,
            COALESCE((SELECT SUM(amount) FROM charity_disbursements WHERE project_id=$1 AND status='POSTED'),0) spent`, [id]);
  const years = (await t.rows(`SELECT DISTINCT year FROM charity_budget_lines WHERE project_id=$1 ORDER BY 1 DESC`, [id])).map((x: any) => x.year);
  return {
    project: { id: pr.id, code: pr.code, name: pr.name, status: pr.status, restricted: pr.restricted, target: r2(num(pr.target)), startDate: pr.startDate, endDate: pr.endDate },
    year, years, lines: out, unbudgeted: unb.map((u: any) => ({ code: u.code, name: u.nameAr, year: u.year, amount: r2(num(u.amount)) })),
    totals: { expenseBudget: s(exp, "amount"), expenseActual: s(exp, "actual"), expenseRemaining: r2(s(exp, "amount") - s(exp, "actual")), revenueBudget: s(rev, "amount"), revenueActual: s(rev, "actual"), unbudgeted: r2(unb.reduce((a: number, u: any) => a + num(u.amount), 0)) },
    received: r2(num(flows.received)), spent: r2(num(flows.spent)), balance: r2(num(flows.received) - num(flows.spent)),
  };
}

/** A disbursement on a project with a budget must fit a budget line of its account and year (an explicit, recorded override aside). */
export async function checkProjectBudget(t: Db, companyId: string, b: any) {
  if (!b.projectId) return null;
  const pr = await projectRow(t, companyId, b.projectId);
  if (pr.status === "CLOSED") throw conflict(`المشروع «${pr.name}» مُقفل بعد الصرف النهائي — لا يُصرف عليه`);
  const year = Number(String(isDate(b.date) ? b.date : today()).slice(0, 4));
  const any = await t.maybe(`SELECT 1 FROM charity_budget_lines WHERE project_id=$1 AND kind='EXPENSE' AND year=$2 LIMIT 1`, [pr.id, year]);
  if (!any) return null; // no budget for that year: nothing to enforce
  const accountId = b.expenseAccountId || (b.requestId ? (await t.maybe(`SELECT expense_account_id FROM charity_requests WHERE id=$1`, [b.requestId]))?.expenseAccountId : null)
    || (await t.maybe(`SELECT id FROM accounts WHERE company_id=$1 AND system_key=$2`, [companyId, ({ BENEFICIARY: "CH_AID", VOLUNTEER: "CH_VOLUNTEERS" } as any)[b.capacity] || "CH_PROGRAMS"]))?.id;
  const tb = await projectBudget(t, companyId, pr.id, { year });
  const line = tb.lines.find((l: any) => l.kind === "EXPENSE" && l.accountId === accountId);
  const amount = r2(num(b.amount));
  const msg = !line ? `بند هذا المصروف غير مدرج في ميزانية مشروع «${pr.name}» لعام ${year}` : amount > line.remaining + 0.004 ? `المبلغ ${amount} يتجاوز المتبقي في بند «${line.name}» من ميزانية المشروع (${line.remaining} من ${line.amount})` : null;
  if (!msg) return { line: line!.name, remaining: line!.remaining };
  if (!b.overBudget) throw new AppError(409, `${msg} — عدّل الميزانية أو اختر «تجاوز الميزانية» مع ذكر السبب`, "OVER_BUDGET");
  if (!String(b.overBudgetReason || "").trim()) throw bad("اكتب سبب تجاوز ميزانية المشروع");
  return { override: msg };
}

// ─── 4. final disbursement & closing of a project ──────────────────────────
export async function projectFinal(t: Db, companyId: string, id: string) {
  const pr = await projectRow(t, companyId, id);
  const bud = await projectBudget(t, companyId, id, { year: "all" });
  const bySource = await t.rows(`SELECT source, SUM(amount) amount, COUNT(*)::int n FROM charity_receipts WHERE project_id=$1 AND status='POSTED' GROUP BY 1 ORDER BY 2 DESC`, [id]);
  const byAccount = await t.rows(`SELECT a.code, a.name_ar, SUM(d.amount) amount, COUNT(*)::int n FROM charity_disbursements d JOIN accounts a ON a.id=d.expense_account_id WHERE d.project_id=$1 AND d.status='POSTED' GROUP BY 1,2 ORDER BY 3 DESC`, [id]);
  const open: string[] = [];
  const rq = await t.one(`SELECT COUNT(*)::int n FROM charity_requests WHERE project_id=$1 AND status IN ('DRAFT','SUBMITTED','REVIEWED','APPROVED')`, [id]);
  if (rq.n) open.push(`${rq.n} طلب صرف غير منتهٍ`);
  const cu = await t.maybe(`SELECT COUNT(*)::int n FROM charity_custody WHERE project_id=$1 AND status NOT IN ('SETTLED','REJECTED','CANCELLED')`, [id]);
  if (cu?.n) open.push(`${cu.n} عهدة لم تُسوَّ`);
  const bt = await t.one(`SELECT COUNT(*)::int n FROM charity_batches WHERE project_id=$1 AND status='DRAFT'`, [id]);
  if (bt.n) open.push(`${bt.n} مسير مسودة`);
  const noDocs = await t.one(`SELECT COUNT(*)::int n FROM charity_disbursements d WHERE d.project_id=$1 AND d.status='POSTED' AND NOT EXISTS (SELECT 1 FROM attachments x WHERE x.entity='ch_disb' AND x.entity_id=d.id)`, [id]);
  return {
    project: { ...bud.project, closedAt: pr.closedAt, closedBy: pr.closedBy, finalSettlement: pr.finalSettlement },
    received: bud.received, spent: bud.spent, balance: bud.balance, targetPct: num(pr.target) ? r2((bud.received / num(pr.target)) * 100) : null,
    bySource: bySource.map((x: any) => ({ source: x.source, amount: r2(num(x.amount)), count: x.n })), byAccount: byAccount.map((x: any) => ({ code: x.code, name: x.nameAr, amount: r2(num(x.amount)), count: x.n })),
    budget: bud.totals, budgetLines: bud.lines, openItems: open, disbursementsWithoutDocs: noDocs.n,
  };
}

/**
 * Final disbursement and close. Optional final voucher (الصرف النهائي) on the project, then what happens to what is left:
 * KEEP (stays in the general net assets), RELEASE (a restricted balance is released to general donations),
 * TRANSFER (moved to another active project's cost centre). The project is then CLOSED: no voucher can name it again.
 */
export async function closeProject(t: Db, companyId: string, user: string, id: string, b: any) {
  const pr = await projectRow(t, companyId, id);
  if (pr.status === "CLOSED") throw conflict("المشروع مُقفل مسبقاً");
  let fin = await projectFinal(t, companyId, id);
  if (fin.openItems.length && !b.force) throw conflict(`لا يُقفل المشروع وفيه: ${fin.openItems.join("، ")}`);
  const d = isDate(b.date) ? b.date : today();
  let finalVoucher: any = null;
  if (b.finalDisbursement && num(b.finalDisbursement.amount) > 0) {
    const fd = b.finalDisbursement;
    if (!b.force) { const { checkDirectLimit } = require("./assoc3") as typeof import("./assoc3"); await checkDirectLimit(t, companyId, { amount: fd.amount }); }
    if (num(fd.amount) > fin.balance + 0.004 && !b.force) throw conflict(`مبلغ الصرف النهائي ${r2(num(fd.amount))} أكبر من رصيد المشروع ${fin.balance}`);
    finalVoucher = await createDisbursement(t, companyId, user, { ...fd, date: d, projectId: id, reason: fd.reason || `الصرف النهائي لمشروع ${pr.name}` });
    fin = await projectFinal(t, companyId, id);
  }
  const rest = fin.balance;
  const mode = ["KEEP", "RELEASE", "TRANSFER"].includes(b.remainder) ? b.remainder : "KEEP";
  let entry: any = null;
  if (rest > 0.004 && mode !== "KEEP") {
    const restricted = await acct(t, companyId, null, "DON_RESTRICTED", "التبرعات المقيدة");
    if (mode === "RELEASE") {
      const general = await acct(t, companyId, null, "DON_GENERAL", "التبرعات العامة");
      entry = await post(t, companyId, { date: d, type: "MANUAL", sourceType: "CHARITY_PROJECT_CLOSE", sourceId: id, reference: pr.code, memo: `فك قيد الرصيد المتبقي لمشروع ${pr.name} عند إقفاله`, createdBy: user,
        lines: [{ account: restricted.id, debit: rest, costCenterId: pr.costCenterId, description: `رصيد ${pr.name}` }, { account: general.id, credit: rest, description: "محوَّل إلى التبرعات العامة" }] });
    } else {
      const to = await projectRow(t, companyId, b.toProjectId);
      if (to.id === id || to.status === "CLOSED") throw bad("اختر مشروعاً آخر نشطاً لنقل الرصيد");
      entry = await post(t, companyId, { date: d, type: "MANUAL", sourceType: "CHARITY_PROJECT_CLOSE", sourceId: id, reference: pr.code, memo: `نقل الرصيد المتبقي لمشروع ${pr.name} إلى ${to.name}`, createdBy: user,
        lines: [{ account: restricted.id, debit: rest, costCenterId: pr.costCenterId, description: `من ${pr.name}` }, { account: restricted.id, credit: rest, costCenterId: to.costCenterId, description: `إلى ${to.name}` }] });
    }
  }
  const snapshot = { ...fin, project: undefined, closedOn: d, remainder: { mode, amount: rest, toProjectId: mode === "TRANSFER" ? b.toProjectId : null, journalId: entry?.id || null }, finalVoucher: finalVoucher ? { id: finalVoucher.id, number: finalVoucher.number, amount: num(finalVoucher.amount) } : null, notes: b.notes || null, forced: !!b.force && fin.openItems.length > 0 };
  await t.exec(`UPDATE charity_projects SET status='CLOSED', end_date=COALESCE(end_date, $2::date), closed_at=now(), closed_by=$3, final_settlement=$4 WHERE id=$1`, [id, d, user, JSON.stringify(snapshot)]);
  return { ok: true, ...snapshot };
}

export async function reopenProject(t: Db, companyId: string, id: string) {
  const pr = await projectRow(t, companyId, id);
  if (pr.status !== "CLOSED") throw bad("المشروع غير مُقفل");
  await t.exec(`UPDATE charity_projects SET status='ACTIVE', closed_at=NULL, closed_by=NULL WHERE id=$1`, [id]);
  return { ok: true, note: "أُعيد فتح المشروع. قيد معالجة الرصيد (إن وُجد) باقٍ — اعكسه من صفحة القيد إذا لزم." };
}

// ─── 5. daily backup & daily archive ───────────────────────────────────────
const SKIP = new Set(["company_backups", "attachments", "app_errors", "ai_conversations", "idempotency_keys"]);
let tableCache: string[] | null = null;
async function companyTables() {
  if (tableCache) return tableCache;
  const r = await db.rows(`SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables tb ON tb.table_name=c.table_name AND tb.table_schema=c.table_schema AND tb.table_type='BASE TABLE' WHERE c.table_schema='public' AND c.column_name='company_id' ORDER BY 1`);
  tableCache = r.map((x: any) => x.tableName).filter((n: string) => !SKIP.has(n));
  return tableCache;
}

/** Every row the company owns, as JSON, gzip-compressed. Attachments are listed (name, size, hash) but their files stay in the archive. */
export async function buildBackup(companyId: string) {
  const out: any = { format: "mizan-backup/1", exportedAt: new Date(), company: await db.one(`SELECT * FROM companies WHERE id=$1`, [companyId]) };
  let rows = 0, tables = 0;
  for (const tb of await companyTables()) {
    const r = await db.rows(`SELECT * FROM "${tb}" WHERE company_id=$1`, [companyId]);
    if (r.length) { out[tb] = r; rows += r.length; tables++; }
  }
  out.invoice_lines = await db.rows(`SELECT l.* FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.company_id=$1`, [companyId]);
  rows += out.invoice_lines.length;
  out.attachments_index = await db.rows(`SELECT id, entity, entity_id, name, mime, size, sha256, created_by, created_at FROM attachments WHERE company_id=$1`, [companyId]);
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(out)), { level: 6 });
  return { gz, rows, tables };
}

export async function makeBackup(companyId: string, kind: "AUTO" | "MANUAL", user: string | null) {
  const { gz, rows, tables } = await buildBackup(companyId);
  const day = today();
  const r = kind === "AUTO"
    ? await db.maybe(`INSERT INTO company_backups(company_id, day, kind, size, tables, rows, data, created_by) VALUES ($1,$2,'AUTO',$3,$4,$5,$6,$7) ON CONFLICT (company_id, day) WHERE kind='AUTO' DO NOTHING RETURNING id, day, kind, size, tables, rows, created_at`, [companyId, day, gz.length, tables, rows, gz, user || "النظام (حفظ يومي)"])
    : await db.one(`INSERT INTO company_backups(company_id, day, kind, size, tables, rows, data, created_by) VALUES ($1,$2,'MANUAL',$3,$4,$5,$6,$7) RETURNING id, day, kind, size, tables, rows, created_at`, [companyId, day, gz.length, tables, rows, gz, user]);
  // keep the last 30 automatic copies and the last 20 manual ones
  await db.exec(`DELETE FROM company_backups WHERE company_id=$1 AND kind='AUTO' AND id NOT IN (SELECT id FROM company_backups WHERE company_id=$1 AND kind='AUTO' ORDER BY day DESC LIMIT 30)`, [companyId]);
  await db.exec(`DELETE FROM company_backups WHERE company_id=$1 AND kind='MANUAL' AND id NOT IN (SELECT id FROM company_backups WHERE company_id=$1 AND kind='MANUAL' ORDER BY created_at DESC LIMIT 20)`, [companyId]);
  return r;
}

export async function listBackups(companyId: string) {
  const rows = await db.rows(`SELECT id, day, kind, size, tables, rows, created_by, created_at FROM company_backups WHERE company_id=$1 ORDER BY created_at DESC LIMIT 60`, [companyId]);
  const last = await db.maybe(`SELECT GREATEST((SELECT MAX(created_at) FROM journal_entries WHERE company_id=$1), (SELECT MAX(created_at) FROM audit_logs WHERE company_id=$1)) AS at`, [companyId]);
  return { rows, lastChange: last?.at || null, retention: { auto: 30, manual: 20 } };
}

export async function backupFile(companyId: string, id: string) {
  const r = await db.one(`SELECT day, kind, data FROM company_backups WHERE id=$1 AND company_id=$2`, [id, companyId], "النسخة غير موجودة");
  return { name: `mizan-backup-${ymd(r.day)}${r.kind === "MANUAL" ? "-manual" : ""}.json.gz`, data: r.data as Buffer };
}

/** Hourly: every active company changed since its last automatic copy gets one copy per (Riyadh) day. */
export function startDailyBackups() {
  const tick = async () => {
    try {
      const day = today();
      const due = (await pool.query(
        `SELECT c.id FROM companies c WHERE c.status='ACTIVE'
           AND NOT EXISTS (SELECT 1 FROM company_backups b WHERE b.company_id=c.id AND b.kind='AUTO' AND b.day=$1)
           AND GREATEST((SELECT MAX(created_at) FROM journal_entries e WHERE e.company_id=c.id), (SELECT MAX(created_at) FROM audit_logs a WHERE a.company_id=c.id))
               > COALESCE((SELECT MAX(created_at) FROM company_backups b WHERE b.company_id=c.id AND b.kind='AUTO'), 'epoch')
         LIMIT 200`, [day])).rows;
      for (const c of due) await makeBackup(c.id, "AUTO", null).catch((e) => console.error("[backup]", c.id, e.message));
      if (due.length) console.log(`[backup] daily copies: ${due.length}`);
    } catch (e: any) { console.error("[backup]", e.message); }
  };
  setTimeout(tick, 90_000).unref();
  setInterval(tick, 60 * 60 * 1000).unref();
}

/** The day's archive: every voucher of the day from both systems, with its supporting files and whether the day is closed and saved. */
export async function dailyArchive(t: Db, companyId: string, date: string) {
  const d = isDate(date) ? date : today();
  const vr = await voucherRegister(t, companyId, { from: d, to: d });
  const ENT: Record<string, string> = { CORE_PAY: "payment", CORE_EXP: "expense", CH_RCPT: "ch_rcpt", CH_DISB: "ch_disb" };
  const att = await t.rows(`SELECT entity, entity_id, COUNT(*)::int n FROM attachments WHERE company_id=$1 AND entity = ANY($2) AND entity_id = ANY($3::uuid[]) GROUP BY 1,2`, [companyId, Object.values(ENT), `{${vr.rows.map((r: any) => r.id).join(",")}}`]);
  const rows = vr.rows.map((r: any) => ({ ...r, entity: ENT[r.src] || null, attachments: att.find((a: any) => a.entity === ENT[r.src] && a.entityId === r.id)?.n || 0 }));
  const closed = await t.maybe(`SELECT closed_by, created_at, difference FROM charity_day_closings WHERE company_id=$1 AND date=$2`, [companyId, d]);
  const backup = await t.maybe(`SELECT id, kind, size, created_at FROM company_backups WHERE company_id=$1 AND day=$2 ORDER BY created_at DESC LIMIT 1`, [companyId, d]);
  const files = await t.one(`SELECT COUNT(*)::int n, COALESCE(SUM(size),0)::bigint bytes FROM attachments WHERE company_id=$1 AND entity<>'ai' AND (doc_date=$2 OR (doc_date IS NULL AND created_at::date=$2))`, [companyId, d]);
  return { date: d, rows, totals: vr.totals, mismatches: vr.mismatches, missingDocs: rows.filter((r: any) => r.status === "POSTED" && r.dir === "OUT" && r.entity && !r.attachments).length, dayClosed: closed || null, backup, filesThatDay: files };
}
