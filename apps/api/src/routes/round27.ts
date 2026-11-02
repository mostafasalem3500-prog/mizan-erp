/** Round 27 routes: final accounts (statements + linkage checks) and the year-end closing checklist. */
import { Router } from "express";
import { db } from "../db/pool";
import { h } from "../lib/core";
import { authenticate, perm, cid } from "../lib/auth";
import * as s from "../services/round27";

export const r27 = Router();
r27.use(authenticate);
r27.get("/reports/final-accounts", perm("reports.read"), h(async (req) => s.finalAccounts(db, cid(req), req.query)));
r27.get("/fiscal-years/:id/close-check", perm("accounting.read"), h(async (req) => s.closeCheck(db, cid(req), String(req.params.id))));
