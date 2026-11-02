/** Egypt edition routes: ETA e-invoice/e-receipt, Form 41 withholding, corporate income tax, salary-tax calculator. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h, bad, notFound } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import { IS_EG } from "../lib/country";
import * as eta from "../eta/eta";
import * as eg from "../services/egypt";

export const egr = Router();
egr.use((req, _res, next) => (IS_EG ? next() : next("router")));
egr.use(authenticate);

// ─── ETA ─────────────────────────────────────────────────────────────────
egr.get("/eta/config", perm("settings.read"), h(async (req) => {
  const c = await tx((t) => eta.getConfig(t, cid(req)));
  const stats = await db.rows(`SELECT COALESCE(eta_kind,'—') kind, COALESCE(eta_status,'—') status, COUNT(*)::int c FROM invoices WHERE company_id=$1 AND direction='SALE' AND status='POSTED' AND eta_status IS NOT NULL GROUP BY 1,2`, [cid(req)]);
  return { config: eta.publicConfig(c), issues: eta.configIssues(c, req.company), stats, governates: eta.GOVERNATES, units: eta.ETA_UNITS, taxMap: eta.ETA_TAX };
}));
egr.put("/eta/config", perm("settings.write"), h(async (req) => {
  const b = req.body || {};
  if (b.environment && !["MOCK", "PREPROD", "PROD"].includes(b.environment)) throw bad("بيئة غير صحيحة");
  if (b.rin && !/^\d{9}$/.test(b.rin)) throw bad("رقم التسجيل الضريبي 9 أرقام");
  if (b.activityCode && !/^\d{4}$/.test(b.activityCode)) throw bad("كود النشاط 4 أرقام");
  if (b.documentVersion && !["1.0", "0.9"].includes(b.documentVersion)) throw bad("نسخة المستند 1.0 أو 0.9");
  if (b.documentVersion === "0.9" && b.environment === "PROD") throw bad("النسخة 0.9 (بدون توقيع) غير مقبولة في بيئة الإنتاج");
  const keep = (k: string) => (b[k] === "••••••••" ? undefined : b[k] === "" ? null : b[k]);
  await tx(async (t) => {
    await eta.getConfig(t, cid(req));
    await t.update("eta_configs", { companyId: cid(req) }, {
      environment: b.environment, clientId: b.clientId, clientSecret: keep("clientSecret"), rin: b.rin, activityCode: b.activityCode, branchCode: b.branchCode,
      governate: b.governate, regionCity: b.regionCity, street: b.street, buildingNumber: b.buildingNumber, postalCode: b.postalCode, documentVersion: b.documentVersion,
      signerUrl: b.signerUrl === "" ? null : b.signerUrl, signerSecret: keep("signerSecret"), posSerial: b.posSerial, posOsVersion: b.posOsVersion, posModel: b.posModel,
      posClientId: b.posClientId, posClientSecret: keep("posClientSecret"), posPresharedKey: keep("posPresharedKey"), autoSubmit: b.autoSubmit === undefined ? undefined : !!b.autoSubmit, updatedAt: new Date(),
    });
    // documents that were waiting for configuration become pending once it is complete
    const c = await eta.getConfig(t, cid(req));
    if (!eta.configIssues(c, req.company).length) await t.exec(`UPDATE invoices SET eta_status='PENDING' WHERE company_id=$1 AND eta_status='NOT_CONFIGURED'`, [cid(req)]);
  });
  await audit(req, "UPDATE", "eta_config", cid(req), { environment: b.environment });
  return { ok: true };
}));
egr.post("/eta/test", perm("settings.read"), h(async (req) => tx((t) => eta.testConnection(t, req.company))));
egr.get("/eta/documents", perm("sales.read"), h(async (req) => {
  const q: any = req.query; const params: any[] = [cid(req)]; const where = ["i.company_id=$1", "i.direction='SALE'", "i.status='POSTED'", "i.eta_status IS NOT NULL"];
  if (q.status) { params.push(String(q.status)); where.push(`i.eta_status=$${params.length}`); }
  if (q.kind) { params.push(String(q.kind)); where.push(`i.eta_kind=$${params.length}`); }
  if (q.from) { params.push(String(q.from)); where.push(`i.date >= $${params.length}`); }
  if (q.to) { params.push(String(q.to)); where.push(`i.date <= $${params.length}`); }
  return db.rows(`SELECT i.id, i.number, i.kind, i.channel, i.date, i.partner_name, i.total, i.vat_total, i.eta_kind, i.eta_status, i.eta_uuid, i.eta_long_id, i.eta_errors, i.eta_submitted_at FROM invoices i WHERE ${where.join(" AND ")} ORDER BY i.date DESC, i.number DESC LIMIT 500`, params);
}));
egr.get("/eta/invoices/:id/preview", perm("sales.read"), h(async (req) => tx((t) => eta.previewDocument(t, req.company, p(req).id))));
egr.post("/eta/invoices/:id/submit", perm("sales.write"), h(async (req) => { const r = await eta.submitDocument(req.company, p(req).id); await audit(req, "ETA_SUBMIT", "invoice", p(req).id, r); return r; }));
egr.post("/eta/invoices/:id/refresh", perm("sales.read"), h(async (req) => eta.refreshDocument(req.company, p(req).id)));
egr.post("/eta/invoices/:id/cancel", perm("sales.write"), h(async (req) => { const r = await eta.cancelDocument(req.company, p(req).id, String(req.body?.reason || "")); await audit(req, "ETA_CANCEL", "invoice", p(req).id, { reason: req.body?.reason }); return r; }));
egr.post("/eta/submit-pending", perm("sales.write"), h(async (req) => {
  const ids = await db.rows(`SELECT id FROM invoices WHERE company_id=$1 AND eta_status IN ('PENDING','NEEDS_SIGNATURE','REJECTED','INVALID') AND status='POSTED' ORDER BY date, created_at LIMIT 200`, [cid(req)]);
  const out: Record<string, number> = {};
  for (const r of ids) { try { const x = await eta.submitDocument(req.company, r.id); out[x.status] = (out[x.status] || 0) + 1; } catch { out.FAILED = (out.FAILED || 0) + 1; } }
  return { processed: ids.length, result: out };
}));
egr.get("/eta/log", perm("settings.read"), h(async (req) => db.rows(`SELECT l.*, i.number FROM eta_log l LEFT JOIN invoices i ON i.id=l.invoice_id WHERE l.company_id=$1 ORDER BY l.created_at DESC LIMIT 100`, [cid(req)])));

// ─── Form 41 withholding ─────────────────────────────────────────────────
egr.get("/tax/eg-wht/types", perm("vat.read"), h(async () => ({ types: eg.EG_WHT_TYPES, threshold: eg.EG_WHT_THRESHOLD })));
egr.get("/tax/form41", perm("vat.read"), h(async (req) => eg.form41(db, cid(req), req.query)));
egr.post("/tax/form41/file", perm("accounting.write"), h(async (req) => { const r = await tx((t) => eg.fileForm41(t, cid(req), actor(req), req.body || {})); await audit(req, "FILE_FORM41", "wht_return", r.id, { period: r.period, tax: r.taxTotal }); return r; }));
egr.post("/tax/form41/:id/cancel", perm("accounting.write"), h(async (req) => { const r = await tx((t) => eg.cancelForm41(t, cid(req), actor(req), p(req).id)); await audit(req, "CANCEL_FORM41", "wht_return", p(req).id); return r; }));

// ─── corporate income tax ───────────────────────────────────────────────
egr.get("/tax/income-tax", perm("accounting.read"), h(async (req) => eg.incomeTaxCompute(db, cid(req), req.query)));
egr.post("/tax/income-tax", perm("accounting.write"), h(async (req) => { const r = await tx((t) => eg.incomeTaxPost(t, cid(req), actor(req), req.body || {})); await audit(req, "POST_INCOME_TAX", "income_tax", r.id, { tax: r.tax }); return r; }));
egr.post("/tax/income-tax/:id/cancel", perm("accounting.write"), h(async (req) => tx((t) => eg.incomeTaxCancel(t, cid(req), actor(req), p(req).id))));
egr.post("/tax/income-tax/:id/settle", perm("accounting.write"), h(async (req) => { const r = await tx((t) => eg.incomeTaxSettle(t, cid(req), actor(req), p(req).id, req.body || {})); await audit(req, "SETTLE_INCOME_TAX", "income_tax", p(req).id, r); return r; }));

// ─── payroll helpers ─────────────────────────────────────────────────────
egr.get("/tax/salary-tax", perm("accounting.read"), h(async (req) => {
  const monthly = Number(req.query.monthly || 0);
  if (!(monthly >= 0)) throw notFound();
  const ins = Math.min(eg.EG_PAYROLL.insurance.maxWage, Math.max(eg.EG_PAYROLL.insurance.minWage, monthly)) * eg.EG_PAYROLL.insurance.employee;
  const annual = Math.max(0, (monthly - ins) * 12 - eg.EG_PAYROLL.personalExemption);
  const d = eg.salaryTaxDetail(annual);
  return { monthly, insuranceEmployee: Math.round(ins * 100) / 100, annualTaxable: d.taxable, brackets: d.parts, annualTax: d.tax, monthlyTax: Math.round((d.tax / 12) * 100) / 100, rules: eg.EG_PAYROLL };
}));
