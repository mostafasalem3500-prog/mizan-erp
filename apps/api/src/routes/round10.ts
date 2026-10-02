/** Round 10 routes: branches (accounting dimension) + branch reports, Salla store connector. */
import { Router } from "express";
import { db, tx } from "../db/pool";
import { h, bad, conflict, req as need, AppError } from "../lib/core";
import { authenticate, perm, cid, actor, p } from "../lib/auth";
import { audit } from "./master";
import { branchPnl } from "../services/reports";
import { newSallaToken, getConnection, verifySignature, processEvent, sampleOrder, PLATFORMS } from "../services/salla";
import { createPayout, cancelPayout } from "../services/payouts";

export const r10 = Router();
r10.use(authenticate);

const origin = (req: any) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

// ── branches ────────────────────────────────────────────────────────────────
r10.get("/branches", perm("dashboard.read"), h(async (req) => db.rows(
  `SELECT b.*, (SELECT COUNT(*)::int FROM warehouses w WHERE w.branch_id=b.id) warehouses,
     (SELECT COUNT(*)::int FROM memberships m WHERE m.branch_id=b.id AND m.is_active) users,
     (SELECT COUNT(*)::int FROM journal_entries e WHERE e.branch_id=b.id) entries
   FROM branches b WHERE b.company_id=$1 ${req.auth.lockedBranchId ? "AND b.id=$2" : ""} ORDER BY b.is_main DESC, b.code`, req.auth.lockedBranchId ? [cid(req), req.auth.lockedBranchId] : [cid(req)])));

/** Light list for document / POS selectors (any signed-in member). `mine` marks warehouses of the user's home branch. */
r10.get("/warehouse-options", perm("dashboard.read"), h(async (req) => db.rows(
  `SELECT w.id, w.code, w.name, w.is_default, w.branch_id, b.name AS branch_name, (w.branch_id IS NOT DISTINCT FROM $2::uuid AND $2::uuid IS NOT NULL) mine
   FROM warehouses w LEFT JOIN branches b ON b.id=w.branch_id WHERE w.company_id=$1 AND w.is_active ${req.auth.lockedBranchId ? `AND w.branch_id='${req.auth.lockedBranchId}'::uuid` : ""} ORDER BY mine DESC, w.is_default DESC, w.code`, [cid(req), req.auth.branchId || null])));

r10.post("/branches", perm("settings.write"), h(async (req) => {
  const b = req.body || {};
  const code = String(need(b, "code", "رمز الفرع")).trim().toUpperCase();
  const name = String(need(b, "name", "اسم الفرع")).trim();
  const row = await tx(async (t) => {
    const br = await t.insert("branches", { companyId: cid(req), code, name, phone: b.phone || null, city: b.city || null, address: b.address || null }).catch((e: any) => { if (e.code === "23505") throw conflict("رمز الفرع مستخدم"); throw e; });
    // a branch without a warehouse cannot sell → create one unless the user picked an existing warehouse
    if (b.createWarehouse !== false) {
      const wcode = `W-${code}`.slice(0, 20);
      await t.insert("warehouses", { companyId: cid(req), code: wcode, name: `مستودع ${name}`, branchId: br.id }).catch((e: any) => { if (e.code === "23505") throw conflict(`رمز المستودع ${wcode} مستخدم`); throw e; });
    }
    return br;
  });
  await audit(req, "CREATE", "branch", row.id, { code, name });
  return row;
}));

r10.put("/branches/:id", perm("settings.write"), h(async (req) => {
  const br = await db.one(`SELECT * FROM branches WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)], "الفرع غير موجود");
  const b = req.body || {};
  if (b.isActive === false && br.isMain) throw bad("لا يمكن إيقاف الفرع الرئيسي");
  if (b.isMain === true && !br.isMain) {
    await tx(async (t) => {
      await t.exec(`UPDATE branches SET is_main=false WHERE company_id=$1`, [cid(req)]);
      await t.exec(`UPDATE branches SET is_main=true WHERE id=$1`, [br.id]);
    });
  }
  const r = await db.update("branches", { id: br.id }, { name: b.name, code: b.code ? String(b.code).toUpperCase() : undefined, phone: b.phone, city: b.city, address: b.address, isActive: b.isActive });
  await audit(req, "UPDATE", "branch", br.id, b);
  return r || br;
}));

r10.delete("/branches/:id", perm("settings.write"), h(async (req) => {
  const br = await db.one(`SELECT * FROM branches WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)], "الفرع غير موجود");
  if (br.isMain) throw bad("لا يمكن حذف الفرع الرئيسي");
  const used = await db.one(`SELECT (SELECT COUNT(*) FROM journal_entries WHERE branch_id=$1)::int e, (SELECT COUNT(*) FROM invoices WHERE branch_id=$1)::int i`, [br.id]);
  if (used.e || used.i) throw conflict("الفرع عليه قيود أو مستندات — أوقفه بدلاً من حذفه");
  await tx(async (t) => {
    const main = await t.one(`SELECT id FROM branches WHERE company_id=$1 AND is_main`, [cid(req)]);
    await t.exec(`UPDATE warehouses SET branch_id=$2 WHERE branch_id=$1`, [br.id, main.id]);
    await t.exec(`UPDATE memberships SET branch_id=NULL WHERE branch_id=$1`, [br.id]);
    await t.exec(`UPDATE salla_connections SET branch_id=NULL WHERE branch_id=$1`, [br.id]);
    await t.exec(`DELETE FROM branches WHERE id=$1`, [br.id]);
  });
  await audit(req, "DELETE", "branch", br.id, { code: br.code });
  return { ok: true };
}));

r10.get("/reports/branches", perm("reports.read"), h(async (req) => branchPnl(db, cid(req), req.query)));

// ── e-store connectors: Salla & Zid (management) ───────────────────────────
const plat = (req: any): string => {
  const v = String(req.params.platform || "").toUpperCase();
  if (!PLATFORMS[v]) throw new AppError(404, "المنصة غير مدعومة", "NOT_FOUND");
  return v;
};
const SUPPORTED: Record<string, string[]> = {
  SALLA: ["order.created", "order.updated", "order.status.updated", "order.refunded", "order.cancelled", "product.created", "product.updated"],
  ZID: ["order.create", "order.status.update", "order.payment_status.update", "product.create", "product.update"],
};
const storeView = async (req: any) => {
  const pf = plat(req);
  const conn = await getConnection(cid(req), pf);
  const events = await db.rows(
    `SELECT e.id, e.event, e.salla_id, e.reference, e.status, e.message, e.invoice_id, e.credit_note_id, e.attempts, e.is_test, e.created_at,
       i.number AS invoice_number, i.total AS invoice_total, i.status AS invoice_status, cn.number AS credit_note_number
     FROM salla_events e LEFT JOIN invoices i ON i.id=e.invoice_id LEFT JOIN invoices cn ON cn.id=e.credit_note_id
     WHERE e.company_id=$1 AND e.platform=$2 ORDER BY e.created_at DESC LIMIT 60`, [cid(req), pf]);
  const stats = await db.one(
    `SELECT COUNT(*)::int orders, COALESCE(SUM(total),0) total, COALESCE(SUM(total-amount_paid),0) open
     FROM invoices WHERE company_id=$1 AND channel=$2 AND kind='INVOICE' AND status='POSTED'`, [cid(req), PLATFORMS[pf].channel]);
  const clearing = await db.maybe(
    `SELECT a.id, a.code, a.name_ar, COALESCE((SELECT SUM(l.debit-l.credit) FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED' WHERE l.account_id=a.id),0) balance
     FROM accounts a WHERE a.company_id=$1 AND a.id=COALESCE($2::uuid, (SELECT id FROM accounts WHERE company_id=$1 AND system_key='ESTORE_CLEARING'))`, [cid(req), conn?.depositAccountId || null]);
  const payouts = await db.rows(
    `SELECT p.*, b.name_ar AS bank_name, j.number AS journal_number FROM estore_payouts p JOIN accounts b ON b.id=p.bank_account_id LEFT JOIN journal_entries j ON j.id=p.journal_id
     WHERE p.company_id=$1 AND p.platform=$2 ORDER BY p.date DESC, p.created_at DESC LIMIT 50`, [cid(req), pf]);
  const base = `${origin(req)}/api/hooks/${PLATFORMS[pf].prefix}/`;
  return {
    platform: pf, platformName: PLATFORMS[pf].ar,
    connection: conn ? { ...conn, webhookUrl: base + conn.token } : null,
    events, stats, clearing, payouts, supportedEvents: SUPPORTED[pf],
  };
};

r10.get("/integrations/:platform", perm("settings.read"), h(async (req) => storeView(req)));

r10.post("/integrations/:platform", perm("settings.write"), h(async (req) => {
  const pf = plat(req);
  const b = req.body || {};
  const own = async (table: string, id: any, extra = "") => {
    if (!id) return null;
    const r = await db.maybe(`SELECT id FROM ${table} WHERE id::text=$1 AND company_id=$2 ${extra}`, [String(id), cid(req)]);
    if (!r) throw bad("قيمة غير صحيحة في إعدادات الربط");
    return r.id;
  };
  const vals = {
    storeName: b.storeName ?? undefined,
    secret: b.secret === undefined ? undefined : String(b.secret || "").trim() || null,
    enabled: b.enabled ?? undefined,
    autoPost: b.autoPost ?? undefined,
    postOnStatus: b.postOnStatus === undefined ? undefined : b.postOnStatus === "completed" ? "completed" : "created",
    warehouseId: b.warehouseId === undefined ? undefined : await own("warehouses", b.warehouseId),
    branchId: b.branchId === undefined ? undefined : await own("branches", b.branchId),
    depositAccountId: b.depositAccountId === undefined ? undefined : await own("accounts", b.depositAccountId, "AND is_cash_bank AND NOT is_group"),
    createProducts: b.createProducts ?? undefined,
  };
  const existing = await getConnection(cid(req), pf);
  if (existing) await db.update("salla_connections", { companyId: cid(req), platform: pf }, vals);
  else {
    const wh = vals.warehouseId || (await db.one(`SELECT id FROM warehouses WHERE company_id=$1 ORDER BY is_default DESC, code LIMIT 1`, [cid(req)])).id;
    await db.insert("salla_connections", { companyId: cid(req), platform: pf, token: newSallaToken(), ...vals, warehouseId: wh });
  }
  await audit(req, existing ? "UPDATE" : "CREATE", "estore_connection", cid(req), { platform: pf, ...vals, secret: vals.secret ? "***" : vals.secret });
  return storeView(req);
}));

r10.post("/integrations/:platform/rotate", perm("settings.write"), h(async (req) => {
  await db.exec(`UPDATE salla_connections SET token=$3 WHERE company_id=$1 AND platform=$2`, [cid(req), plat(req), newSallaToken()]);
  await audit(req, "ROTATE", "estore_connection", cid(req), { platform: plat(req) });
  return storeView(req);
}));

r10.delete("/integrations/:platform", perm("settings.write"), h(async (req) => {
  await db.exec(`DELETE FROM salla_connections WHERE company_id=$1 AND platform=$2`, [cid(req), plat(req)]);
  await audit(req, "DELETE", "estore_connection", cid(req), { platform: plat(req) });
  return { ok: true };
}));

/** Feeds a realistic sample order (in the platform's own payload format) through the full pipeline. */
r10.post("/integrations/:platform/test", perm("settings.write"), h(async (req) => {
  const pf = plat(req);
  const conn = await getConnection(cid(req), pf);
  if (!conn) throw bad("فعّل الربط أولاً");
  const body = await sampleOrder(cid(req), { cod: !!req.body?.cod, warehouseId: conn.warehouseId, platform: pf });
  const r = await processEvent(conn, body, { isTest: !req.body?.post, sample: true, eventHint: "order.create" });
  return { result: r, view: await storeView(req) };
}));

r10.post("/integrations/:platform/events/:id/retry", perm("settings.write"), h(async (req) => {
  const conn = await getConnection(cid(req), plat(req));
  if (!conn) throw bad("الربط غير مفعل");
  const ev = await db.one(`SELECT * FROM salla_events WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)], "الحدث غير موجود");
  if (ev.status === "DONE") throw conflict("الحدث معالج بنجاح");
  const r = await processEvent(conn, ev.payload, { eventId: ev.id, sample: ev.isTest });
  await audit(req, "RETRY", "estore_event", ev.id, { result: r.status });
  return r;
}));

// payouts: platform transfers its collected balance to the bank minus commission (+ VAT on the commission)
r10.post("/integrations/:platform/payouts", perm("payments.write"), h(async (req) => {
  const r = await tx((t) => createPayout(t, cid(req), actor(req), { ...req.body, platform: plat(req) }));
  await audit(req, "CREATE", "estore_payout", r.id, { number: r.number, net: r.net });
  return r;
}));
r10.post("/integrations/:platform/payouts/:id/cancel", perm("payments.write"), h(async (req) => {
  const r = await tx((t) => cancelPayout(t, cid(req), actor(req), p(req).id));
  await audit(req, "CANCEL", "estore_payout", p(req).id);
  return r;
}));

// ── webhook receivers (public; authenticated by the secret URL token + optional Salla signature) ──
export const hooks = Router();
const receive = (platform: string) => h(async (req: any) => {
  const token = String(req.params.token || "");
  const conn = token.length >= 16 ? await db.maybe(`SELECT * FROM salla_connections WHERE token=$1 AND platform=$2`, [token, platform]) : null;
  if (!conn) throw new AppError(404, "رابط غير صحيح", "NOT_FOUND");
  if (platform === "SALLA" && !verifySignature(conn, req.rawBody, req.headers)) throw new AppError(401, "توقيع سلة غير صحيح", "BAD_SIGNATURE");
  if (platform === "ZID" && conn.secret && String(req.headers["x-mizan-secret"] || req.query.secret || "") !== conn.secret) throw new AppError(401, "رمز التحقق غير صحيح", "BAD_SIGNATURE");
  const body = req.body || {};
  if (platform === "SALLA" && !body.event) throw bad("event مطلوب");
  const r = await processEvent(conn, body, { eventHint: req.query.event ? String(req.query.event) : null });
  return { ok: true, status: r.status, message: r.message };
});
hooks.post("/salla/:token", receive("SALLA"));
hooks.post("/zid/:token", receive("ZID"));
