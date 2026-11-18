/** Amortisation schedules: prepaid expenses and deferred revenue spread over the months they cover. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h, today, r2 } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import * as am from "../services/amortization";

export const amort = Router();
amort.use(authenticate);

amort.get("/amortizations", perm("accounting.read"), h(async (req) => am.listAmortizations(db, cid(req))));
amort.get("/amortizations/:id", perm("accounting.read"), h(async (req) => am.getAmortization(db, cid(req), p(req).id)));
amort.post("/amortizations", perm("accounting.write"), h(async (req) => { const a = await tx((t) => am.createAmortization(t, cid(req), actor(req), req.body || {})); await audit(req, "CREATE", "amortization", a.id, { number: a.number, total: a.total, months: a.months }); return a; }));

/** What the schedule will record — the payment / receipt and its first month — without saving anything. */
class Rollback { constructor(public data: any) {} }
amort.post("/amortizations/preview", perm("accounting.write"), h(async (req) => {
  try {
    await tx(async (t) => {
      const a = await am.createAmortization(t, cid(req), actor(req), req.body || {});
      await am.runAmortization(t, cid(req), actor(req), a.lines[0].periodEnd, a.id);
      const lines = await t.rows(`SELECT e.number, e.date, e.memo, l.debit, l.credit, a.code, a.name_ar FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id JOIN accounts a ON a.id=l.account_id
        WHERE e.company_id=$1 AND e.reference=$2 AND e.type='AMORTIZATION' ORDER BY e.date, e.number, l.sort`, [cid(req), a.number]);
      throw new Rollback({ monthly: a.monthly, endDate: a.endDate, schedule: a.lines.map((x: any) => ({ periodEnd: x.periodEnd, amount: x.amount })), lines });
    });
  } catch (e: any) { if (e instanceof Rollback) return e.data; throw e; }
  return {};
}));
amort.post("/amortizations/run", perm("accounting.write"), h(async (req) => { const r = await tx((t) => am.runAmortization(t, cid(req), actor(req), req.body?.through || today(), req.body?.id)); if (r.length) await audit(req, "RUN", "amortization", null, { count: r.length, total: r2(r.reduce((s, x) => s + x.amount, 0)) }); return r; }));
amort.post("/amortizations/:id/finish", perm("accounting.write"), h(async (req) => { const a = await tx((t) => am.finishAmortization(t, cid(req), actor(req), p(req).id, req.body?.date || today())); await audit(req, "FINISH", "amortization", a.id, { number: a.number }); return a; }));
amort.post("/amortizations/:id/cancel", perm("accounting.write"), h(async (req) => { const r = await tx((t) => am.cancelAmortization(t, cid(req), p(req).id)); await audit(req, "CANCEL", "amortization", p(req).id); return r; }));
amort.delete("/amortizations/:id", perm("accounting.write"), h(async (req) => { const r = await tx((t) => am.deleteAmortization(t, cid(req), actor(req), p(req).id)); await audit(req, "DELETE", "amortization", p(req).id); return r; }));
