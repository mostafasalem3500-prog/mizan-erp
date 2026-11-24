/** 3.43.0 routes: customer/supplier set-off, product recipes, supplier bank details and the payment-run bank file. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import * as s from "../services/round343";

export const r343 = Router();
r343.use(authenticate);

r343.get("/setoffs/candidates", perm("payments.read"), h(async (req) => s.setoffCandidates(db, cid(req))));
r343.get("/setoffs", perm("payments.read"), h(async (req) => s.listSetoffs(db, cid(req))));
r343.post("/setoffs/preview", perm("payments.read"), h(async (req) => s.setoffPreview(db, cid(req), req.body || {})));
r343.post("/setoffs", perm("accounting.write"), h(async (req) => { const r = await tx((t) => s.createSetoff(t, cid(req), actor(req), req.body || {})); await audit(req, "POST", "setoff", r.id, { number: r.number, amount: r.amount, partner: r.partnerName }); return r; }));
r343.post("/setoffs/:id/cancel", perm("accounting.write"), h(async (req) => { const r = await tx((t) => s.cancelSetoff(t, cid(req), actor(req), p(req).id)); await audit(req, "CANCEL", "setoff", r.id, { number: r.number }); return r; }));

r343.get("/recipes", perm("products.read"), h(async (req) => s.recipeList(db, cid(req))));
r343.get("/products/:id/recipe", perm("products.read"), h(async (req) => s.getRecipe(db, cid(req), p(req).id)));
r343.put("/products/:id/recipe", perm("products.write"), h(async (req) => { const r = await tx((t) => s.saveRecipe(t, cid(req), p(req).id, req.body || {})); await audit(req, "UPDATE", "recipe", p(req).id, { components: r.lines.length, cost: r.cost }); return r; }));

r343.put("/partners/:id/bank", perm("accounting.write"), h(async (req) => { const r = await tx((t) => s.saveBank(t, cid(req), p(req).id, req.body || {})); await audit(req, "UPDATE", "partner_bank", r.id, { iban: r.iban ? "…" + r.iban.slice(-4) : null }); return r; }));
r343.get("/payment-runs/:id/bank-file", perm("accounting.write"), h(async (req) => s.bankFile(db, cid(req), p(req).id)));
