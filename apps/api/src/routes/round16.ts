/** Round 16 routes: charity / non-profit association interface (/charity). */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h, bad } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import * as ch from "../services/charity";

export const r16 = Router();
r16.use(authenticate);
const R = "payments.read", W = "payments.write";

r16.get("/charity/settings", perm(R), h(async (req) => tx((t) => ch.getSettings(t, cid(req)))));
r16.put("/charity/settings", perm("settings.write"), h(async (req) => { const s = await tx((t) => ch.saveSettings(t, cid(req), req.body || {})); await audit(req, "UPDATE", "charity_settings", null); return s; }));
r16.get("/charity/dashboard", perm(R), h(async (req) => tx((t) => ch.dashboard(t, cid(req), req.query))));
r16.get("/charity/activities", perm("reports.read"), h(async (req) => ch.activities(db, cid(req), req.query)));
r16.get("/charity/archive", perm(R), h(async (req) => ch.archive(db, cid(req), req.query)));

r16.get("/charity/projects", perm(R), h(async (req) => ch.listProjects(db, cid(req))));
r16.post("/charity/projects", perm(W), h(async (req) => tx((t) => ch.saveProject(t, cid(req), req.body || {}))));
r16.put("/charity/projects/:id", perm(W), h(async (req) => tx((t) => ch.saveProject(t, cid(req), req.body || {}, p(req).id))));

for (const [path, role] of [["donors", "DONOR"], ["beneficiaries", "BENEFICIARY"]] as const) {
  r16.get(`/charity/${path}`, perm("partners.read"), h(async (req) => ch.listPeople(db, cid(req), role, req.query)));
  r16.post(`/charity/${path}`, perm("partners.write"), h(async (req) => { const r = await tx((t) => ch.savePerson(t, cid(req), role, req.body || {})); await audit(req, "CREATE", "partner", r.id, { name: r.name, role }); return r; }));
  r16.put(`/charity/${path}/:id`, perm("partners.write"), h(async (req) => tx((t) => ch.savePerson(t, cid(req), role, req.body || {}, p(req).id))));
}
r16.get("/charity/people/:id/history", perm(R), h(async (req) => ch.donorHistory(db, cid(req), p(req).id)));

r16.get("/charity/receipts", perm(R), h(async (req) => ch.listReceipts(db, cid(req), req.query)));
r16.post("/charity/receipts", perm(W), h(async (req) => { const r = await tx((t) => ch.createReceipt(t, cid(req), actor(req), req.body || {})); await audit(req, "CREATE", "charity_receipt", r.id, { number: r.number, amount: r.amount }); return r; }));
r16.post("/charity/receipts/:id/cancel", perm(W), h(async (req) => { const r = await tx((t) => ch.cancelReceipt(t, cid(req), actor(req), p(req).id, req.body?.reason)); await audit(req, "CANCEL", "charity_receipt", p(req).id); return r; }));

r16.get("/charity/disbursements", perm(R), h(async (req) => ch.listDisbursements(db, cid(req), req.query)));
r16.post("/charity/disbursements", perm(W), h(async (req) => { const r = await tx((t) => ch.createDisbursement(t, cid(req), actor(req), req.body || {})); await audit(req, "CREATE", "charity_disbursement", r.id, { number: r.number, amount: r.amount }); return r; }));
r16.post("/charity/disbursements/:id/cancel", perm(W), h(async (req) => { const r = await tx((t) => ch.cancelDisbursement(t, cid(req), actor(req), p(req).id, req.body?.reason)); await audit(req, "CANCEL", "charity_disbursement", p(req).id); return r; }));

r16.get("/charity/requests", perm(R), h(async (req) => ch.listRequests(db, cid(req), req.query)));
r16.post("/charity/requests", perm(W), h(async (req) => { const r = await tx((t) => ch.saveRequest(t, cid(req), actor(req), req.body || {})); await audit(req, "CREATE", "charity_request", r.id, { number: r.number, amount: r.amount }); return r; }));
r16.put("/charity/requests/:id", perm(W), h(async (req) => tx((t) => ch.saveRequest(t, cid(req), actor(req), req.body || {}, p(req).id))));
r16.post("/charity/requests/:id/review", perm(W), h(async (req) => tx((t) => ch.actRequest(t, cid(req), actor(req), p(req).id, "review", req.body || {}))));
r16.post("/charity/requests/:id/:action", perm("accounting.write"), h(async (req) => { if (!["approve", "reject", "reopen"].includes(p(req).action)) throw bad("إجراء غير معروف"); const r = await tx((t) => ch.actRequest(t, cid(req), actor(req), p(req).id, p(req).action, req.body || {})); await audit(req, p(req).action.toUpperCase(), "charity_request", p(req).id); return r; }));
r16.delete("/charity/requests/:id", perm(W), h(async (req) => tx((t) => ch.actRequest(t, cid(req), actor(req), p(req).id, "delete", {}))));

r16.get("/charity/batches", perm(R), h(async (req) => ch.listBatches(db, cid(req))));
r16.post("/charity/batches", perm(W), h(async (req) => tx((t) => ch.saveBatch(t, cid(req), actor(req), req.body || {}))));
r16.put("/charity/batches/:id", perm(W), h(async (req) => tx((t) => ch.saveBatch(t, cid(req), actor(req), req.body || {}, p(req).id))));
r16.post("/charity/batches/:id/post", perm("accounting.write"), h(async (req) => { const r = await tx((t) => ch.postBatch(t, cid(req), actor(req), p(req).id)); await audit(req, "POST", "charity_batch", p(req).id, { number: r?.number, total: r?.total }); return r; }));
r16.post("/charity/batches/:id/cancel", perm("accounting.write"), h(async (req) => tx((t) => ch.cancelBatch(t, cid(req), actor(req), p(req).id))));

r16.get("/charity/budget", perm("reports.read"), h(async (req) => tx((t) => ch.budget(t, cid(req), Number(req.query.year)))));
r16.post("/charity/budget/lines", perm("accounting.write"), h(async (req) => tx((t) => ch.saveBudgetLine(t, cid(req), req.body || {}))));
r16.put("/charity/budget/lines/:id", perm("accounting.write"), h(async (req) => tx((t) => ch.saveBudgetLine(t, cid(req), req.body || {}, p(req).id))));
r16.delete("/charity/budget/lines/:id", perm("accounting.write"), h(async (req) => { await db.exec(`DELETE FROM charity_budget_lines WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]); return { ok: true }; }));
r16.post("/charity/budget/copy", perm("accounting.write"), h(async (req) => tx((t) => ch.copyBudget(t, cid(req), Number(req.body?.from), Number(req.body?.to), Number(req.body?.growthPct) || 0, !!req.body?.fromActual))));

r16.get("/charity/daily", perm(R), h(async (req) => ch.daily(db, cid(req), String(req.query.date || ""))));
r16.post("/charity/daily/close", perm(W), h(async (req) => { const r = await tx((t) => ch.closeDay(t, cid(req), actor(req), req.body || {})); await audit(req, "CLOSE", "charity_day", r.id, { date: r.date, difference: r.difference }); return r; }));

// ─── round 17: custody, purchases & receiving, refunds ───────────────────────
import * as c2 from "../services/charity2";
r16.get("/charity/custody", perm(R), h(async (req) => c2.listCustody(db, cid(req), req.query)));
r16.post("/charity/custody", perm(W), h(async (req) => { const r = await tx((t) => c2.saveCustody(t, cid(req), actor(req), req.body || {})); await audit(req, "CREATE", "charity_custody", r.id, { number: r.number, amount: r.amount }); return r; }));
r16.put("/charity/custody/:id", perm(W), h(async (req) => tx((t) => c2.saveCustody(t, cid(req), actor(req), req.body || {}, p(req).id))));
r16.post("/charity/custody/:id/review", perm(W), h(async (req) => tx((t) => c2.actCustody(t, cid(req), actor(req), p(req).id, "review", req.body || {}))));
r16.post("/charity/custody/:id/disburse", perm(W), h(async (req) => { const r = await tx((t) => c2.disburseCustody(t, cid(req), actor(req), p(req).id, req.body || {})); await audit(req, "DISBURSE", "charity_custody", p(req).id); return r; }));
r16.post("/charity/custody/:id/settle", perm(W), h(async (req) => { const r = await tx((t) => c2.settleCustody(t, cid(req), actor(req), p(req).id, req.body || {})); await audit(req, "SETTLE", "charity_custody", p(req).id); return r; }));
r16.post("/charity/custody/:id/unsettle", perm("accounting.write"), h(async (req) => tx((t) => c2.unsettleCustody(t, cid(req), actor(req), p(req).id))));
r16.post("/charity/custody/:id/:action", perm("accounting.write"), h(async (req) => { if (!["approve", "reject"].includes(p(req).action)) throw bad("إجراء غير معروف"); const r = await tx((t) => c2.actCustody(t, cid(req), actor(req), p(req).id, p(req).action, req.body || {})); await audit(req, p(req).action.toUpperCase(), "charity_custody", p(req).id); return r; }));
r16.delete("/charity/custody/:id", perm(W), h(async (req) => tx((t) => c2.actCustody(t, cid(req), actor(req), p(req).id, "delete", {}))));

const KMAP: Record<string, string> = { purchases: "PURCHASE", receivings: "RECEIVING", refunds: "REFUND" };
const kindOf = (req: any) => { const k = KMAP[String(req.params.kind)]; if (!k) throw bad("نوع النموذج غير معروف"); return k; };
r16.get("/charity/forms/:kind", perm(R), h(async (req) => c2.listForms(db, cid(req), kindOf(req), req.query)));
r16.post("/charity/forms/:kind", perm(W), h(async (req) => { const r = await tx((t) => c2.saveForm(t, cid(req), actor(req), kindOf(req), req.body || {})); await audit(req, "CREATE", "charity_form", r.id, { kind: r.kind, number: r.number }); return r; }));
r16.put("/charity/forms/:kind/:id", perm(W), h(async (req) => tx((t) => c2.saveForm(t, cid(req), actor(req), kindOf(req), req.body || {}, p(req).id))));
r16.post("/charity/forms/refunds/:id/pay", perm(W), h(async (req) => { const r = await tx((t) => c2.payRefund(t, cid(req), actor(req), p(req).id, req.body || {})); await audit(req, "PAY", "charity_refund", p(req).id, { number: r.number }); return r; }));
r16.post("/charity/forms/:kind/:id/:action", perm(W), h(async (req) => {
  const a = p(req).action;
  if (!["review", "approve", "reject", "order"].includes(a)) throw bad("إجراء غير معروف");
  if (["approve", "reject"].includes(a) && !req.auth.superAdmin && !["OWNER", "ADMIN", "ACCOUNTANT"].includes(req.auth.role || "")) throw bad("الاعتماد والرفض لصاحب الصلاحية فقط");
  const r = await tx((t) => c2.actForm(t, cid(req), actor(req), kindOf(req), p(req).id, a, req.body || {}));
  await audit(req, a.toUpperCase(), "charity_form", p(req).id); return r;
}));
r16.delete("/charity/forms/:kind/:id", perm(W), h(async (req) => tx((t) => c2.actForm(t, cid(req), actor(req), kindOf(req), p(req).id, "delete", {}))));
