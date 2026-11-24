/** 3.48.0 routes: kitchen stations and performance, ingredient purchase plan. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h } from "../lib/core";
import { authenticate, perm, cid } from "../lib/auth";
import { audit } from "./master";
import * as s from "../services/round348";

export const r348 = Router();
r348.use(authenticate);
r348.get("/pos/stations", perm("pos.use"), h(async (req) => s.stationsOf(db, cid(req))));
r348.put("/pos/stations", perm("settings.write"), h(async (req) => { const r = await tx((t) => s.saveStations(t, cid(req), req.body?.stations)); await audit(req, "UPDATE", "pos_settings", null, { stations: r.map((x) => x.name) }); return r; }));
r348.get("/restaurant/kitchen-performance", perm("reports.read"), h(async (req) => s.kitchenPerformance(db, cid(req), req.query as any)));
r348.get("/inventory/purchase-plan", perm("inventory.read"), h(async (req) => s.purchasePlan(db, cid(req), req.query as any)));
