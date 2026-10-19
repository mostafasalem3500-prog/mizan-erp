/** Round 22 routes: controlled correction of posted purchase invoices. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import * as s from "../services/round22";

export const r22 = Router();
r22.use(authenticate);

r22.get("/invoices/:id/revision-check", perm("purchases.read"), h(async (req) => s.revisionCheck(db, cid(req), p(req).id)));
r22.get("/invoices/:id/revisions", perm("purchases.read"), h(async (req) => s.listRevisions(db, cid(req), p(req).id)));
r22.post("/invoices/:id/revise", perm("accounting.write"), h(async (req) => {
  const r = await tx((t) => s.revisePurchase(t, req.company, actor(req), p(req).id, req.body || {}));
  await audit(req, "REVISE", "invoice", p(req).id, { revision: r.revision, reason: req.body?.revisionReason, total: r.invoice.total, cogsAdjustment: r.cogsAdjustment });
  return r;
}));
