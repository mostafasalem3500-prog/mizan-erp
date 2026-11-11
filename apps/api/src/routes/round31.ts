/** Round 31 routes: parked journals & approval, bank rules / group matching / reconciliation statement, month-end close, cost allocation, CVP. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h, bad, isDate, today, AppError } from "../lib/core";
import { authenticate, perm, cid, actor, p, can } from "../lib/auth";
import { audit } from "./master";
import { reverse } from "../accounting/engine";
import { manualJournal } from "../services/misc";
import { suggestMatches, statementSummary } from "../services/bankimport";
import * as s from "../services/round31";
import * as pay from "../services/payroll";
import * as hr from "../services/hr";
import * as att from "../services/attendance";
import { IS_EG } from "../lib/country";
import { computeLineEG } from "../services/egypt";

export const r31 = Router();
r31.use(authenticate);
const who = (req: any) => ({ userId: req.auth.userId, userName: actor(req), role: req.auth.role, superAdmin: !!req.auth.superAdmin });

// ── parked journals ──
r31.get("/journal-drafts", perm("accounting.read"), h(async (req) => ({ ...(await s.listDrafts(db, cid(req), ["DRAFT", "SUBMITTED", "REJECTED", "POSTED"].includes(String(req.query.status)) ? String(req.query.status) : undefined)), approval: !!req.company.accounting?.journalApproval, me: req.auth.userId })));
r31.post("/journal-drafts", perm("accounting.write"), h(async (req) => { const d = await tx((t) => s.saveDraft(t, cid(req), who(req), req.body || {})); await audit(req, "CREATE", "journal_draft", d.id, { total: d.total, status: d.status }); return d; }));
r31.put("/journal-drafts/:id", perm("accounting.write"), h(async (req) => tx((t) => s.saveDraft(t, cid(req), who(req), req.body || {}, p(req).id))));
r31.post("/journal-drafts/:id/:action", perm("accounting.write"), h(async (req) => { const r = await tx((t) => s.draftAction(t, cid(req), who(req), p(req).id, p(req).action, req.body, req.company)); await audit(req, p(req).action.toUpperCase(), "journal_draft", p(req).id, { number: (r as any)?.number, reason: req.body?.reason }); return r; }));
r31.put("/accounting-settings", perm("settings.write"), h(async (req) => { const v = !!req.body?.journalApproval; await db.exec(`UPDATE companies SET accounting = jsonb_set(accounting, '{journalApproval}', to_jsonb($2::boolean)) WHERE id=$1`, [cid(req), v]); await audit(req, "UPDATE", "settings", cid(req), { journalApproval: v }); return { journalApproval: v }; }));
/** Post a journal now; with `reverseOn` its mirror entry is posted on that date (month-end accrual). With approval switched on, only owners/managers post directly. */
r31.post("/journals/post", perm("accounting.write"), h(async (req) => {
  if (req.company.accounting?.journalApproval && !req.auth.superAdmin && !["OWNER", "ADMIN"].includes(req.auth.role || "")) throw new AppError(409, "اعتماد القيود مفعّل: احفظ القيد وأرسله للاعتماد من «قيود بانتظار الاعتماد»", "APPROVAL_REQUIRED");
  const b = req.body || {};
  if (b.reverseOn && (!isDate(b.reverseOn) || b.reverseOn <= b.date)) throw bad("تاريخ العكس يجب أن يكون بعد تاريخ القيد");
  const r = await tx(async (t) => { const e = await manualJournal(t, cid(req), actor(req), b); const rev = b.reverseOn ? await reverse(t, cid(req), e!.id, b.reverseOn, `عكس تلقائي لقيد الاستحقاق ${e!.number}`, actor(req)) : null; return { ...e, reversal: rev ? { id: rev.id, number: rev.number, date: b.reverseOn } : null }; });
  await audit(req, "CREATE", "journal", r.id || null, { number: r.number, reversal: r.reversal?.number });
  return r;
}));

// ── bank ──
r31.get("/bank-rules", perm("accounting.read"), h(async (req) => s.listRules(db, cid(req))));
r31.post("/bank-rules", perm("accounting.write"), h(async (req) => s.saveRule(db, cid(req), req.body || {})));
r31.put("/bank-rules/:id", perm("accounting.write"), h(async (req) => s.saveRule(db, cid(req), req.body || {}, p(req).id)));
r31.delete("/bank-rules/:id", perm("accounting.write"), h(async (req) => { await db.exec(`DELETE FROM bank_rules WHERE id=$1 AND company_id=$2`, [p(req).id.length === 36 ? p(req).id : "00000000-0000-0000-0000-000000000000", cid(req)]); return { ok: true }; }));
/** Open statement lines, each with the best of: an exact entry, a set of entries adding up to it, or a rule that can book it. */
async function proposals(companyId: string, accountId: string, window: number) {
  const base = await suggestMatches(db, companyId, accountId, window);
  const rules = await s.listRules(db, companyId);
  const used = new Set<string>(base.rows.filter((r: any) => r.suggestion).map((r: any) => r.suggestion.id));
  const rows = base.rows.map((r: any) => {
    if (r.suggestion) return r;
    const group = s.groupFor(r, base.candidates, used, window);
    if (group) { group.forEach((g: any) => used.add(g.id)); return { ...r, group }; }
    const rule = s.ruleFor(rules, r);
    return rule ? { ...r, rule: { id: rule.id, name: rule.name, accountId: rule.accountId, account: `${rule.accountCode} ${rule.accountName}`, taxCode: rule.taxCode } } : r;
  });
  return { ...base, rows, rules: rules.length };
}
r31.get("/bank/:accountId/proposals", perm("accounting.read"), h(async (req) => ({ ...(await proposals(cid(req), p(req).accountId, Number(req.query.window) || 5)), summary: await statementSummary(db, cid(req), p(req).accountId) })));
r31.post("/bank/statement/:id/match-group", perm("accounting.write"), h(async (req) => tx((t) => s.matchGroup(t, cid(req), p(req).id, req.body?.journalLineIds || []))));
r31.post("/bank/statement/:id/post", perm("accounting.write"), h(async (req) => { const r = await tx((t) => s.postStatementLine(t, cid(req), actor(req), p(req).id, req.body || {})); await audit(req, "CREATE", "journal", r.entryId, { number: r.number, from: "bank_statement" }); return r; }));
r31.post("/bank/:accountId/apply-rules", perm("accounting.write"), h(async (req) => {
  const pr = await proposals(cid(req), p(req).accountId, Number(req.body?.window) || 5); let posted = 0, grouped = 0; const errors: string[] = [];
  for (const r of pr.rows as any[]) {
    try {
      if (r.rule) { await tx((t) => s.postStatementLine(t, cid(req), actor(req), r.id, { accountId: r.rule.accountId, taxCode: r.rule.taxCode })); posted++; }
      else if (r.group && req.body?.groups !== false) { await tx((t) => s.matchGroup(t, cid(req), r.id, r.group.map((g: any) => g.id))); grouped++; }
    } catch (e: any) { errors.push(`${String(r.date).slice(0, 10)} ${r.amount}: ${e.message}`); }
  }
  await audit(req, "MATCH", "bank_statement", p(req).accountId, { posted, grouped, errors: errors.length });
  return { posted, grouped, errors: errors.slice(0, 10) };
}));
r31.get("/bank/:accountId/report", perm("accounting.read"), h(async (req) => s.bankReport(db, cid(req), p(req).accountId, req.query)));

// ── month-end close ──
r31.get("/closing", perm("accounting.read"), h(async (req) => s.closeCockpit(db, cid(req), req.query.periodId ? String(req.query.periodId) : undefined)));
r31.put("/closing/:periodId/tasks/:key", perm("accounting.write"), h(async (req) => s.setCloseTask(db, cid(req), p(req).periodId, p(req).key, req.body || {}, actor(req))));
r31.post("/closing/:periodId/lock", perm("accounting.write"), h(async (req) => {
  const lock = req.body?.lock !== false, force = !!req.body?.force;
  if ((force || !lock) && !req.auth.superAdmin && !["OWNER", "ADMIN"].includes(req.auth.role || "")) throw new AppError(403, lock ? "تجاوز البنود المانعة للمالك أو المدير فقط" : "إعادة فتح الفترة للمالك أو المدير فقط", "FORBIDDEN");
  const r = await tx((t) => s.lockPeriod(t, cid(req), p(req).periodId, lock, force));
  await audit(req, lock ? "LOCK_PERIOD" : "UNLOCK_PERIOD", "period", p(req).periodId, { force, blockers: (r as any).blockers });
  return r;
}));

// ── cost allocation & CVP ──
r31.get("/cost-allocations", perm("accounting.read"), h(async (req) => s.listAllocations(db, cid(req))));
r31.post("/cost-allocations", perm("accounting.write"), h(async (req) => s.saveAllocation(db, cid(req), req.body || {})));
r31.put("/cost-allocations/:id", perm("accounting.write"), h(async (req) => s.saveAllocation(db, cid(req), req.body || {}, p(req).id)));
r31.delete("/cost-allocations/:id", perm("accounting.write"), h(async (req) => { const n = await db.one(`SELECT COUNT(*)::int c FROM cost_allocation_runs r JOIN cost_allocations a ON a.id=r.allocation_id WHERE a.id=$1 AND a.company_id=$2`, [p(req).id, cid(req)]); if (n.c) { await db.exec(`UPDATE cost_allocations SET is_active=false WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]); return { ok: true, deactivated: true }; } await db.exec(`DELETE FROM cost_allocations WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]); return { ok: true }; }));
r31.get("/cost-allocations/:id/preview", perm("accounting.read"), h(async (req) => s.allocationPreview(db, cid(req), p(req).id, String(req.query.from || ""), String(req.query.to || ""))));
r31.post("/cost-allocations/:id/run", perm("accounting.write"), h(async (req) => { const r = await tx((t) => s.runAllocation(t, cid(req), actor(req), p(req).id, String(req.body?.from || ""), String(req.body?.to || ""))); await audit(req, "CREATE", "journal", r.entryId, { number: r.number, allocation: p(req).id, total: r.total }); return r; }));
r31.get("/reports/cvp", perm("reports.read"), h(async (req) => s.cvp(db, cid(req), req.query)));
r31.put("/accounts/:id/cost-behavior", perm("accounting.write"), h(async (req) => s.setBehavior(db, cid(req), p(req).id, req.body?.behavior)));

// ── payroll transactions, run preview / recalculation, loans ──
r31.get("/payroll-items", perm("accounting.read"), h(async (req) => {
  const q: any = req.query; const params: any[] = [cid(req)]; const w = ["i.company_id=$1"];
  if (/^\d{4}-\d{2}$/.test(q.period || "")) { params.push(q.period); w.push(`i.period=$${params.length}`); }
  if (q.employeeId) { params.push(String(q.employeeId)); w.push(`i.employee_id=$${params.length}`); }
  if (q.status === "OPEN" || q.status === "INCLUDED") { params.push(q.status); w.push(`i.status=$${params.length}`); }
  const rows = await db.rows(`SELECT i.*, e.name employee_name, e.code employee_code, r.period run_period, r.status run_status FROM payroll_items i JOIN employees e ON e.id=i.employee_id LEFT JOIN payroll_runs r ON r.id=i.run_id WHERE ${w.join(" AND ")} ORDER BY i.date DESC, i.created_at DESC LIMIT 1000`, params);
  return { rows, kinds: pay.ITEM_KINDS, overtimeFactor: pay.OVERTIME_FACTOR };
}));
r31.post("/payroll-items/quote", perm("accounting.read"), h(async (req) => { const e = await db.one(`SELECT * FROM employees WHERE id=$1 AND company_id=$2`, [req.body?.employeeId, cid(req)], "الموظف غير موجود"); const wage = Number(e.basic) + Number(e.housing) + Number(e.transport) + Number(e.otherAllow); return { amount: pay.itemAmount(e, String(req.body?.kind), Number(req.body?.qty) || 0, Number(req.body?.factor) || null), wage, daily: Math.round((wage / 30) * 100) / 100, hourly: Math.round((wage / 240) * 100) / 100 }; }));
r31.post("/payroll-items", perm("accounting.write"), h(async (req) => { const r = await tx((t) => pay.saveItem(t, cid(req), actor(req), req.body || {})); await audit(req, "CREATE", "payroll", r.id, { kind: r.kind, amount: r.amount }); return r; }));
r31.put("/payroll-items/:id", perm("accounting.write"), h(async (req) => tx((t) => pay.saveItem(t, cid(req), actor(req), req.body || {}, p(req).id))));
r31.delete("/payroll-items/:id", perm("accounting.write"), h(async (req) => { await tx((t) => pay.deleteItem(t, cid(req), p(req).id)); return { ok: true }; }));
/** What the month's run would contain right now (fixed pay + open transactions + loan instalments). */
r31.get("/payroll/preview2", perm("accounting.read"), h(async (req) => { const emps = await db.rows(`SELECT * FROM employees WHERE company_id=$1 AND is_active ORDER BY code`, [cid(req)]); return pay.buildLines(db, cid(req), String(req.query.period || ""), emps, {}); }));
r31.post("/payroll/:id/recalc", perm("accounting.write"), h(async (req) => tx((t) => pay.recalcRun(t, cid(req), p(req).id))));
r31.post("/hr/loans/:id/repay", perm("payments.write"), h(async (req) => { const r = await tx((t) => hr.repayLoan(t, cid(req), actor(req), p(req).id, req.body || {})); await audit(req, "UPDATE", "loan", p(req).id, r); return r; }));
r31.put("/hr/loans/:id", perm("payments.write"), h(async (req) => { const r = await tx((t) => hr.rescheduleLoan(t, cid(req), p(req).id, req.body || {})); await audit(req, "UPDATE", "loan", p(req).id, { installment: r.installment, startPeriod: r.startPeriod }); return r; }));

// ── attendance ──
r31.get("/attendance", perm("accounting.read"), h(async (req) => att.monthSheet(db, req.company, String(req.query.period || ""))));
r31.put("/attendance/day", perm("accounting.write"), h(async (req) => tx((t) => att.saveDay(t, req.company, actor(req), String(req.body?.date || ""), req.body?.rows || []))));
r31.post("/attendance/import", perm("accounting.write"), h(async (req) => { const r = await tx((t) => att.importRows(t, req.company, actor(req), req.body?.rows)); await audit(req, "IMPORT", "attendance", cid(req), { saved: r.saved, skipped: r.skipped }); return r; }));
r31.put("/attendance/settings", perm("settings.write"), h(async (req) => tx((t) => att.saveSettings(t, cid(req), req.body || {}))));
r31.post("/attendance/post", perm("accounting.write"), h(async (req) => { const r = await tx((t) => att.postToPayroll(t, req.company, actor(req), String(req.body?.period || ""))); await audit(req, "CREATE", "payroll", cid(req), { attendance: req.body?.period, items: r.created }); return r; }));
void can; void today; void IS_EG; void computeLineEG;
