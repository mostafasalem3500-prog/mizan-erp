/** Round 25 routes: financial analysis and charity governance indicators. */
import { Router } from "express";
import { db } from "../db/pool";
import { h } from "../lib/core";
import { authenticate, perm, cid } from "../lib/auth";
import * as s from "../services/round25";

export const r25 = Router();
r25.use(authenticate);
r25.get("/analysis/financial", perm("reports.read"), h(async (req) => s.financialAnalysis(db, cid(req), req.query)));
r25.get("/charity/indicators", perm("reports.read"), h(async (req) => s.charityIndicators(db, cid(req), req.query)));
