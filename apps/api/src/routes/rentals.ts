/** 3.50.0 routes: rentals — assets, maintenance, contracts (quote, reserve, deliver, bill, extend, return, deposits), calendar, reports. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import * as s from "../services/rentals";
import { seedRentalExample } from "../services/rentalExample";

export const rentals = Router();
rentals.use(authenticate);
const R = perm("sales.read"), W = perm("sales.write");

rentals.get("/rentals/dashboard", R, h(async (req) => s.dashboard(db, cid(req))));
rentals.get("/rentals/assets", R, h(async (req) => s.listAssets(db, cid(req))));
rentals.post("/rentals/assets", W, h(async (req) => { const r = await tx((t) => s.saveAsset(t, cid(req), req.body || {})); await audit(req, "CREATE", "rental_asset", r.id, { name: r.name }); return r; }));
rentals.put("/rentals/assets/:id", W, h(async (req) => tx((t) => s.saveAsset(t, cid(req), req.body || {}, p(req).id))));
rentals.post("/rentals/assets/:id/maintenance", W, h(async (req) => tx((t) => s.addMaintenance(t, cid(req), p(req).id, req.body || {}))));
rentals.delete("/rentals/maintenance/:id", W, h(async (req) => tx((t) => s.deleteMaintenance(t, cid(req), p(req).id))));
rentals.post("/rentals/quote", R, h(async (req) => s.quote(db, cid(req), req.body || {})));
rentals.get("/rentals/contracts", R, h(async (req) => s.listContracts(db, cid(req), req.query)));
rentals.get("/rentals/contracts/:id", R, h(async (req) => s.getContract(db, cid(req), p(req).id)));
rentals.post("/rentals/contracts", W, h(async (req) => { const r = await tx(async (t) => { const c = await s.createContract(t, cid(req), actor(req), req.body || {}); return s.getContract(t, cid(req), c.id); }); await audit(req, "CREATE", "rental_contract", r.id, { number: r.number }); return r; }));
rentals.post("/rentals/contracts/:id/reserve", W, h(async (req) => tx(async (t) => { await s.reserve(t, cid(req), actor(req), p(req).id); return s.getContract(t, cid(req), p(req).id); })));
rentals.post("/rentals/contracts/:id/deliver", W, h(async (req) => { const r = await tx((t) => s.deliver(t, req.company, actor(req), p(req).id, req.body || {})); await audit(req, "DELIVER", "rental_contract", r.id, { number: r.number }); return r; }));
rentals.post("/rentals/contracts/:id/extend", W, h(async (req) => tx((t) => s.extend(t, req.company, actor(req), p(req).id, req.body || {}))));
rentals.post("/rentals/contracts/:id/return", W, h(async (req) => { const r = await tx((t) => s.returnContract(t, req.company, actor(req), p(req).id, req.body || {})); await audit(req, "RETURN", "rental_contract", r.id, { number: r.number }); return r; }));
rentals.post("/rentals/contracts/:id/deposit", perm("payments.write"), h(async (req) => tx((t) => s.receiveDeposit(t, cid(req), actor(req), p(req).id, req.body || {}))));
rentals.post("/rentals/contracts/:id/settle", perm("payments.write"), h(async (req) => { const r = await tx((t) => s.settleDeposit(t, cid(req), actor(req), p(req).id, req.body || {})); await audit(req, "SETTLE", "rental_contract", r.id, { number: r.number }); return r; }));
rentals.post("/rentals/contracts/:id/cancel", W, h(async (req) => tx((t) => s.cancelContract(t, cid(req), actor(req), p(req).id, req.body || {}))));
rentals.post("/rentals/contracts/:id/bill", W, h(async (req) => tx(async (t) => { await s.billDue(t, req.company, actor(req), undefined, p(req).id); return s.getContract(t, cid(req), p(req).id); })));
rentals.post("/rentals/bill-due", W, h(async (req) => tx((t) => s.billDue(t, req.company, actor(req)))));
rentals.get("/rentals/calendar", R, h(async (req) => s.calendar(db, cid(req), req.query)));
rentals.get("/rentals/reports", R, h(async (req) => s.reports(db, cid(req), req.query)));
rentals.post("/rentals/example", W, h(async (req) => tx((t) => seedRentalExample(t, req.company, actor(req)))));
