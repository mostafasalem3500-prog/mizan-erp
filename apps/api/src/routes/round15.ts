/** Round 15 routes: report center (multi-filter detailed reports per module) + company readiness checklist. */
import { Router } from "express";
import { db } from "../db/pool";
import { h } from "../lib/core";
import { authenticate, perm, cid } from "../lib/auth";
import { CATALOG, MODULES, runReport, dimensionValues } from "../services/reportcenter";
import { readiness } from "../services/readiness";

export const r15 = Router();
r15.use(authenticate);

r15.get("/reports/catalog", perm("reports.read"), h(async (req) => {
  const locked = !!req.auth.lockedBranchId;
  const role = req.auth.role || "";
  const hr = ["OWNER", "ADMIN", "ACCOUNTANT", "VIEWER"].includes(role) || req.auth.superAdmin;
  return { modules: MODULES.filter((m) => !(locked && ["hr", "assets", "vat", "estore"].includes(m.key)) && !(m.key === "hr" && !hr)), reports: CATALOG.filter((d) => !(locked && (d.companyOnly || ["hr", "assets", "vat", "estore"].includes(d.module)))).map(({ key, module, title, desc, filters, groupBy, chart }) => ({ key, module, title, desc, filters, groupBy, chart })) };
}));
r15.get("/reports/run/:key", perm("reports.read"), h(async (req) => runReport(db, cid(req), String(req.params.key), req.query, { lockedBranchId: req.auth.lockedBranchId })));
r15.get("/reports/dimension/:key", perm("reports.read"), h(async (req) => dimensionValues(db, cid(req), String(req.params.key))));
r15.get("/readiness", perm("dashboard.read"), h(async (req) => readiness(db, cid(req), req.company)));
