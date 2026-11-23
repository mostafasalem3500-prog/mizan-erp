/** 3.40.0 routes: clearing reconciliation (card terminals, e-store platforms), e-store order profit, reversing a posted return, staff numbers, POS oversell setting. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h, bad } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import { IS_EG } from "../lib/country";
import * as cl from "../services/clearing";
import * as r3 from "../services/round340";
import { submitInvoice } from "../zatca/stamp";
import { autoSubmit } from "../eta/eta";

export const r340 = Router();
r340.use(authenticate);

r340.get("/clearing/:source", perm("payments.read"), h(async (req) => cl.clearingView(db, req.company, p(req).source, req.query)));
r340.put("/clearing/:source/rule", perm("settings.write"), h(async (req) => { const r = await tx((t) => cl.saveRule(t, cid(req), p(req).source, req.body || {})); await audit(req, "UPDATE", "clearing_rule", null, { source: p(req).source, ...r }); return r; }));
r340.post("/clearing/:source/batches", perm("payments.write"), h(async (req) => { const r = await tx((t) => cl.createBatch(t, req.company, actor(req), p(req).source, req.body || {})); await audit(req, "CLEARING_SETTLE", "clearing_batch", r.id, { number: r.number, gross: r.gross, fees: r.fees, net: r.net, matched: r.matched, unmatched: r.unmatched }); return r; }));
r340.get("/clearing-batches/:id", perm("payments.read"), h(async (req) => cl.batchDetail(db, cid(req), p(req).id)));
r340.post("/clearing-batches/:id/cancel", perm("payments.write"), h(async (req) => { const r = await tx((t) => cl.cancelBatch(t, cid(req), actor(req), p(req).id)); await audit(req, "CANCEL", "clearing_batch", p(req).id); return r; }));
r340.post("/clearing-lines/:id/resolve", perm("payments.write"), h(async (req) => { const r = await tx((t) => cl.resolveUnmatched(t, cid(req), p(req).id, req.body?.note)); await audit(req, "RESOLVE", "clearing_line", p(req).id, { note: req.body?.note }); return r; }));
r340.get("/estore/profit", perm("accounting.read"), h(async (req) => { if (IS_EG) throw bad("غير متاح في هذه النسخة"); return cl.estoreProfit(db, req.company, req.query); }));

r340.post("/invoices/:id/reverse-return", perm("accounting.write"), h(async (req) => {
  const r: any = await tx((t) => r3.reverseReturn(t, req.company, actor(req), p(req).id, req.body || {}));
  await audit(req, "REVERSE_RETURN", "invoice", p(req).id, { debitNote: r.number, reason: req.body?.reason, collect: r.collect });
  if (r.zatcaStatus === "PENDING") submitInvoice(req.company, r.id).catch(() => undefined);
  if (IS_EG) await autoSubmit(req.company, r.id);
  return r;
}));
r340.put("/users/:id/staff-no", perm("users.write"), h(async (req) => { const r = await tx((t) => r3.setStaffNo(t, cid(req), p(req).id, req.body?.staffNo)); await audit(req, "UPDATE", "user", p(req).id, { staffNo: r.staffNo }); return r; }));
r340.put("/pos/oversell", perm("settings.write"), h(async (req) => {
  const v = req.body?.mode === "BLOCK" ? "BLOCK" : "ASK";
  await db.exec(`UPDATE companies SET accounting = jsonb_set(jsonb_set(COALESCE(accounting,'{}'::jsonb), '{pos}', COALESCE(accounting->'pos','{}'::jsonb)), '{pos,oversell}', to_jsonb($2::text)) WHERE id=$1`, [cid(req), v]);
  await audit(req, "UPDATE", "pos_settings", null, { oversell: v });
  return { mode: v };
}));
