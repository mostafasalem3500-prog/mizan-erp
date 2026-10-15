/** Round 20 routes: partner profile, invoice extras, treasury, account lines, inventory reports. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h, bad } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import * as s from "../services/round20";

export const r20 = Router();
r20.use(authenticate);

r20.get("/partners/:id/profile", perm("partners.read"), h(async (req) => s.partnerProfile(db, cid(req), p(req).id, String(req.query.role || ""))));
r20.post("/partners/:id/opening", perm("accounting.write"), h(async (req) => { const e = await tx((t) => s.partnerOpening(t, cid(req), actor(req), p(req).id, req.body || {})); await audit(req, "OPENING", "partner", p(req).id, { amount: req.body?.amount }); return e; }));
r20.post("/partners/openings/:entryId/cancel", perm("accounting.write"), h(async (req) => tx((t) => s.cancelPartnerOpening(t, cid(req), actor(req), p(req).entryId))));
r20.put("/partners/:id/settings", perm("partners.write"), h(async (req) => { const r = await tx((t) => s.partnerSettings(t, cid(req), p(req).id, req.body || {})); await audit(req, "UPDATE", "partner", p(req).id, req.body); return r; }));

r20.post("/invoices/:id/copy", perm("sales.read"), h(async (req) => { const d = await tx((t) => s.copyInvoice(t, req.company, actor(req), p(req).id, req.body || {})); await audit(req, "COPY", "invoice", d.id, { from: p(req).id }); return d; }));
r20.put("/invoices/:id/notes", perm("sales.read"), h(async (req) => s.setInvoiceNotes(db, cid(req), p(req).id, req.body?.notes)));
r20.get("/invoices/:id/extras", perm("sales.read"), h(async (req) => s.invoiceExtras(db, cid(req), p(req).id)));

r20.get("/treasury", perm("payments.read"), h(async (req) => s.treasury(db, cid(req))));
r20.post("/treasury/accounts", perm("accounting.write"), h(async (req) => tx((t) => s.createCashAccount(t, cid(req), req.body || {}))));
r20.put("/treasury/accounts/:id", perm("accounting.write"), h(async (req) => { const r = await tx((t) => s.treasuryAccount(t, cid(req), p(req).id, req.body || {})); await audit(req, "UPDATE", "account", p(req).id, req.body); return r; }));
r20.post("/treasury/transfers", perm("payments.write"), h(async (req) => { const r = await tx((t) => s.treasuryTransfer(t, cid(req), actor(req), req.body || {})); await audit(req, "CREATE", "treasury_transfer", r.id, { number: r.number, amount: r.amount }); return r; }));
r20.post("/treasury/transfers/:id/cancel", perm("accounting.write"), h(async (req) => tx((t) => s.cancelTransfer(t, cid(req), actor(req), p(req).id))));

r20.get("/accounts/:id/lines", perm("accounting.read"), h(async (req) => s.accountLines(db, cid(req), p(req).id, Number(req.query.limit) || 15)));
r20.get("/reports/count-sheet", perm("inventory.read"), h(async (req) => s.countSheet(db, cid(req), req.query)));
r20.get("/reports/inventory-ops", perm("inventory.read"), h(async (req) => s.inventoryOpsSummary(db, cid(req), req.query)));
r20.get("/products/:id/profile", perm("products.read"), h(async (req) => s.productProfile(db, cid(req), p(req).id)));
