import { verifyDesktopLicense, signDesktopLicense, signRebindKey, isDesktopLocal, currentDeviceId, normalizeDeviceId, validDeviceId, deviceMatches, licenseServer, TRANSFERS_PER_YEAR, DesktopLicense } from "../lib/desktopLicense";
import os from "os";

/** Desktop (local) edition info for the licence screen: this PC's fingerprint and its LAN addresses when shared. */
function desktopInfo() {
  if (!isDesktopLocal()) return null;
  const lan = process.env.HOST === "0.0.0.0";
  const port = process.env.PORT;
  const urls = lan
    ? Object.values(os.networkInterfaces()).flat().filter((i: any) => i && i.family === "IPv4" && !i.internal).map((i: any) => `http://${i.address}:${port}`)
    : [];
  return { deviceId: currentDeviceId(), lan, urls, computer: os.hostname() };
}
import { validTaxId, validPartnerTaxId, TAX_ID_MSG, CFG, IS_EG } from "../lib/country";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { db, tx } from "../db/pool";
import { h, bad, req as need, AppError, conflict, today, addMonths } from "../lib/core";
import { authenticate, signToken, subscriptionState, ROLES, superAdmin, AuthCtx } from "../lib/auth";
import { seedCurrencies } from "../services/currency";
import { seedChartOfAccounts, ensureFiscalYear } from "../accounting/engine";
import { ensureZatcaConfig } from "../zatca/stamp";

export const auth = Router();

const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 14);

export async function bootstrapCompany(t: any, input: { nameAr: string; nameEn?: string; vatNumber?: string; crNumber?: string; city?: string; phone?: string; email?: string }, ownerUserId: string, plan = "TRIAL") {
  const company = await t.insert("companies", {
    nameAr: input.nameAr.trim(), nameEn: input.nameEn || null, vatNumber: input.vatNumber || null, crNumber: input.crNumber || null, city: input.city || null, phone: input.phone || null, email: input.email || null,
    plan, subscriptionEndsAt: plan === "TRIAL" ? new Date(Date.now() + TRIAL_DAYS * 86400000) : null,
    country: CFG.code, currency: CFG.currency, ...(IS_EG ? { vatPeriod: "MONTHLY" } : {}),
  });
  await t.insert("memberships", { companyId: company.id, userId: ownerUserId, role: "OWNER" });
  const branch = await t.insert("branches", { companyId: company.id, code: "MAIN", name: "الفرع الرئيسي", isMain: true, city: input.city || null });
  await t.insert("warehouses", { companyId: company.id, code: "MAIN", name: "المستودع الرئيسي", isDefault: true, branchId: branch.id });
  await seedChartOfAccounts(t, company.id);
  await seedCurrencies(t, company.id);
  await ensureFiscalYear(t, company.id, today());
  if (!IS_EG) await ensureZatcaConfig(t, company.id);
  return company;
}

function publicUser(u: any) {
  return { id: u.id, email: u.email, fullName: u.fullName, phone: u.phone, isSuperAdmin: u.isSuperAdmin };
}

async function companiesOf(userId: string) {
  return db.rows(`SELECT c.id, c.name_ar, c.plan, c.status, c.subscription_ends_at, c.logo, m.role FROM memberships m JOIN companies c ON c.id=m.company_id WHERE m.user_id=$1 AND m.is_active ORDER BY m.created_at`, [userId]);
}

function tokenFor(u: any, companyId: string | null, role: string | null): AuthCtx & { token: string } {
  const ctx: AuthCtx = { userId: u.id, userName: u.fullName, email: u.email, companyId, role, superAdmin: !!u.isSuperAdmin };
  return { ...ctx, token: signToken(ctx) };
}

auth.post(
  "/register",
  h(async (req) => {
    const b = req.body || {};
    const email = String(need(b, "email", "البريد الإلكتروني")).trim().toLowerCase();
    const password = String(need(b, "password", "كلمة المرور"));
    const fullName = String(need(b, "fullName", "الاسم"));
    const companyName = String(need(b, "companyName", "اسم المنشأة"));
    if (password.length < 8) throw bad("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad("البريد الإلكتروني غير صحيح");
    if (b.vatNumber && !validTaxId(b.vatNumber)) throw bad(TAX_ID_MSG);
    const exists = await db.maybe(`SELECT id FROM users WHERE email=$1`, [email]);
    if (exists) throw conflict("البريد الإلكتروني مسجل مسبقاً — سجّل الدخول");
    const passwordHash = await bcrypt.hash(password, 10);
    const first = await db.one(`SELECT COUNT(*)::int c FROM users`);
    const out = await tx(async (t) => {
      const u = await t.insert("users", { email, passwordHash, fullName, phone: b.phone || null, isSuperAdmin: process.env.SUPER_ADMIN_EMAIL ? email === process.env.SUPER_ADMIN_EMAIL.toLowerCase() : first.c === 0 });
      const c = await bootstrapCompany(t, { nameAr: companyName, nameEn: b.companyNameEn, vatNumber: b.vatNumber, crNumber: b.crNumber, city: b.city, phone: b.phone, email }, u.id);
      await t.insert("audit_logs", { companyId: c.id, userId: u.id, userName: fullName, action: "REGISTER", entity: "company", entityId: c.id, details: { nameAr: c.nameAr } });
      return { u, c };
    });
    return { ...tokenFor(out.u, out.c.id, "OWNER"), user: publicUser(out.u), companies: await companiesOf(out.u.id) };
  }),
);

auth.post(
  "/login",
  h(async (req) => {
    const email = String(need(req.body, "email", "البريد الإلكتروني")).trim().toLowerCase();
    const password = String(need(req.body, "password", "كلمة المرور"));
    const attempt = await db.maybe(`SELECT * FROM login_attempts WHERE key=$1`, [email]);
    if (attempt?.lockedUntil && new Date(attempt.lockedUntil) > new Date()) {
      const mins = Math.ceil((new Date(attempt.lockedUntil).getTime() - Date.now()) / 60000);
      throw new AppError(429, `تم إيقاف محاولات الدخول مؤقتاً بعد محاولات فاشلة متكررة — حاول بعد ${mins} دقيقة`, "LOCKED");
    }
    const u = await db.maybe(`SELECT * FROM users WHERE email=$1`, [email]);
    if (!u || !(await bcrypt.compare(password, u.passwordHash))) {
      await db.exec(
        `INSERT INTO login_attempts(key, failures, locked_until) VALUES ($1, 1, NULL)
         ON CONFLICT (key) DO UPDATE SET failures = CASE WHEN login_attempts.updated_at < now() - interval '15 minutes' THEN 1 ELSE login_attempts.failures + 1 END,
           locked_until = CASE WHEN (CASE WHEN login_attempts.updated_at < now() - interval '15 minutes' THEN 1 ELSE login_attempts.failures + 1 END) >= 5 THEN now() + interval '15 minutes' ELSE NULL END,
           updated_at = now()`,
        [email],
      );
      throw new AppError(401, "بيانات الدخول غير صحيحة", "BAD_CREDENTIALS");
    }
    await db.exec(`DELETE FROM login_attempts WHERE key=$1`, [email]);
    if (!u.isActive) throw new AppError(403, "الحساب موقوف", "INACTIVE");
    await db.exec(`UPDATE users SET last_login_at=now() WHERE id=$1`, [u.id]);
    const companies = await companiesOf(u.id);
    const preferred = req.body.companyId && companies.find((c) => c.id === req.body.companyId);
    const c = preferred || companies[0] || null;
    return { ...tokenFor(u, c?.id || null, c?.role || null), user: publicUser(u), companies };
  }),
);

/** Demo login (public showcase) — enabled only when DEMO_EMAIL/DEMO_PASSWORD are configured. */
auth.get(
  "/demo-credentials",
  h(async () => (process.env.DEMO_EMAIL ? { email: process.env.DEMO_EMAIL, password: process.env.DEMO_PASSWORD } : { email: null })),
);

/**
 * Cloud: self-service move of a desktop licence to a new PC (customer restored a backup on new hardware).
 * Needs the original signed key (kept in the customer's database); limited per year; subscription dates are not touched.
 */
auth.post(
  "/license/desktop-transfer",
  h(async (req) => {
    if (isDesktopLocal()) throw bad("هذه الخدمة على خادم التراخيص فقط");
    const b = req.body || {};
    const lic = verifyDesktopLicense(String(b.key || ""));
    if (!lic || lic.type === "rebind") throw bad("مفتاح الترخيص غير صحيح");
    const to = normalizeDeviceId(b.toDevice);
    if (!validDeviceId(to)) throw bad("معرّف الجهاز الجديد غير صحيح");
    return tx(async (t) => {
      const rec = await t.maybe(`SELECT * FROM license_keys WHERE key=$1 AND desktop FOR UPDATE`, [String(b.key).trim()]);
      if (!rec) throw bad("هذا الترخيص غير مسجل لدى خادم التراخيص — تواصل مع مزود النظام لنقله");
      if (!rec.deviceId) throw bad("هذا الترخيص غير مرتبط بجهاز ولا يحتاج إلى نقل");
      const cur = rec.currentDevice || rec.deviceId;
      const log: any[] = rec.transferLog || [];
      const last = log[log.length - 1];
      // already moved here (e.g. the transfer key was lost) → issue it again without counting
      if (deviceMatches(cur, to) && last && deviceMatches(last.to, to)) return { rebindKey: signRebindKey(last.from, to, rec.note), fromDevice: last.from, toDevice: to, remaining: null };
      if (deviceMatches(cur, to)) throw bad("الترخيص يعمل على هذا الجهاز بالفعل — لا حاجة للنقل");
      const yearAgo = Date.now() - 365 * 86400000;
      const used = log.filter((x) => x.by === "self" && new Date(x.at).getTime() > yearAgo).length;
      if (used >= TRANSFERS_PER_YEAR()) throw new AppError(429, `تم استخدام الحد المسموح لنقل الترخيص ذاتياً (${TRANSFERS_PER_YEAR()} مرات في السنة). تواصل مع مزود النظام لنقله.`, "TRANSFER_LIMIT");
      log.push({ at: new Date().toISOString(), from: cur, to, by: "self", computer: String(b.computer || "").slice(0, 80) });
      await t.exec(`UPDATE license_keys SET current_device=$2, transfer_log=$3 WHERE id=$1`, [rec.id, to, JSON.stringify(log)]);
      return { rebindKey: signRebindKey(cur, to, rec.note), fromDevice: cur, toDevice: to, remaining: TRANSFERS_PER_YEAR() - used - 1 };
    });
  }),
);

/** Cloud: is this desktop licence still on the asking PC? (used by online desktops to lock a PC the licence left) */
auth.post(
  "/license/desktop-status",
  h(async (req) => {
    if (isDesktopLocal()) throw bad("هذه الخدمة على خادم التراخيص فقط");
    const lic = verifyDesktopLicense(String(req.body?.key || ""));
    if (!lic || lic.type === "rebind") throw bad("مفتاح الترخيص غير صحيح");
    const rec = await db.maybe(`SELECT device_id, current_device FROM license_keys WHERE key=$1 AND desktop`, [String(req.body.key).trim()]);
    if (!rec || !rec.deviceId) return { state: "unknown" };
    const cur = rec.currentDevice || rec.deviceId;
    return { state: deviceMatches(cur, normalizeDeviceId(req.body.device)) ? "ok" : "moved", currentDevice: cur };
  }),
);

auth.use(authenticate);

auth.get(
  "/me",
  h(async (req) => {
    const u = await db.one(`SELECT * FROM users WHERE id=$1`, [req.auth.userId]);
    const companies = await companiesOf(u.id);
    const company = req.company ? { ...req.company, memberRole: undefined, memberBranchId: undefined, memberRestrict: undefined } : null;
    const branch = req.auth.branchId ? await db.maybe(`SELECT id, code, name FROM branches WHERE id=$1`, [req.auth.branchId]) : null;
    return { user: publicUser(u), companies, company, role: req.auth.role, branch, lockedBranch: req.auth.lockedBranchId ? branch : null, subscription: subscriptionState(req.company), roles: Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, v.ar])), superAdmin: !!u.isSuperAdmin, desktop: desktopInfo() };
  }),
);

auth.post(
  "/switch",
  h(async (req) => {
    const u = await db.one(`SELECT * FROM users WHERE id=$1`, [req.auth.userId]);
    const companies = await companiesOf(u.id);
    const c = companies.find((x) => x.id === req.body.companyId) || (u.isSuperAdmin ? await db.maybe(`SELECT id, 'OWNER' AS role FROM companies WHERE id=$1`, [req.body.companyId]) : null);
    if (!c) throw bad("المنشأة غير متاحة لك");
    return { ...tokenFor(u, c.id, c.role), companies };
  }),
);

auth.post(
  "/companies",
  h(async (req) => {
    const u = await db.one(`SELECT * FROM users WHERE id=$1`, [req.auth.userId]);
    const name = String(need(req.body, "nameAr", "اسم المنشأة"));
    const c = await tx((t) => bootstrapCompany(t, { nameAr: name, nameEn: req.body.nameEn, vatNumber: req.body.vatNumber, crNumber: req.body.crNumber, city: req.body.city }, u.id));
    return { ...tokenFor(u, c.id, "OWNER"), companies: await companiesOf(u.id) };
  }),
);

auth.post(
  "/change-password",
  h(async (req) => {
    const u = await db.one(`SELECT * FROM users WHERE id=$1`, [req.auth.userId]);
    if (!(await bcrypt.compare(String(req.body.current || ""), u.passwordHash))) throw bad("كلمة المرور الحالية غير صحيحة");
    if (String(req.body.next || "").length < 8) throw bad("كلمة المرور الجديدة قصيرة");
    await db.exec(`UPDATE users SET password_hash=$2 WHERE id=$1`, [u.id, await bcrypt.hash(String(req.body.next), 10)]);
    return { ok: true };
  }),
);

auth.post(
  "/activate-license",
  h(async (req) => {
    if (!req.company) throw bad("اختر المنشأة أولاً");
    if (!["OWNER", "ADMIN"].includes(req.auth.role || "") && !req.auth.superAdmin) throw new AppError(403, "المالك فقط يمكنه تفعيل الترخيص");
    const rawKey = String(need(req.body, "key", "مفتاح الترخيص")).trim();
    // desktop licences are self-verifying (signed) — registered locally on first use so they cannot be reused
    const offline = rawKey.startsWith("MZD-") ? verifyDesktopLicense(rawKey) : null;
    if (rawKey.startsWith("MZD-") && !offline) throw bad("مفتاح ترخيص سطح المكتب غير صحيح أو معدَّل");
    if (offline && !isDesktopLocal()) throw bad("هذا مفتاح لنسخة سطح المكتب المحلية — لا يُفعَّل على النسخة السحابية. اطلب مفتاحاً سحابياً MZN-…");
    if (!offline && isDesktopLocal() && rawKey.toUpperCase().startsWith("MZN-")) throw bad("هذا مفتاح للنسخة السحابية — النسخة المحلية تُفعَّل بمفتاح سطح المكتب MZD-…");
    const device = currentDeviceId();
    if (offline?.deviceId && !deviceMatches(offline.deviceId, device)) throw bad(`هذا المفتاح صادر لجهاز آخر (${offline.deviceId}). معرّف هذا الجهاز: ${device || "غير معروف"} — أرسله لمزود النظام لإصدار مفتاح له`);
    if (offline?.type === "rebind") return applyRebind(req, offline);
    const key = offline ? rawKey : rawKey.toUpperCase();
    return tx(async (t) => {
      if (offline && !(await t.maybe(`SELECT id FROM license_keys WHERE key=$1`, [key])))
        await t.insert("license_keys", { key, plan: offline.plan, months: offline.months, maxUsers: offline.maxUsers, deviceId: offline.deviceId || null, desktop: true, note: `ترخيص سطح المكتب ${offline.issuedAt}${offline.note ? " — " + offline.note : ""}` });
      const lic = await t.maybe(`SELECT * FROM license_keys WHERE key=$1 FOR UPDATE`, [key]);
      if (!lic) throw bad("مفتاح الترخيص غير صحيح");
      if (lic.activatedAt) throw conflict("هذا المفتاح مستخدم مسبقاً");
      const c = await t.one(`SELECT * FROM companies WHERE id=$1 FOR UPDATE`, [req.company.id]);
      const base = c.subscriptionEndsAt && new Date(c.subscriptionEndsAt) > new Date() && c.plan !== "TRIAL" ? new Date(c.subscriptionEndsAt) : new Date();
      const ends = new Date(base);
      ends.setMonth(ends.getMonth() + lic.months);
      await t.exec(`UPDATE companies SET plan=$2, max_users=$3, subscription_ends_at=$4, status='ACTIVE', updated_at=now() WHERE id=$1`, [c.id, lic.plan, lic.maxUsers, ends]);
      await t.exec(`UPDATE license_keys SET company_id=$2, activated_at=now() WHERE id=$1`, [lic.id, c.id]);
      // bind the company to this PC so a copied data folder runs read-only elsewhere
      if (offline?.deviceId) await t.exec(`UPDATE companies SET licensed_device=$2 WHERE id=$1`, [c.id, offline.deviceId]);
      await t.insert("audit_logs", { companyId: c.id, userId: req.auth.userId, userName: req.auth.userName, action: "LICENSE_ACTIVATED", entity: "company", entityId: c.id, details: { plan: lic.plan, months: lic.months, ends } });
      return { plan: lic.plan, maxUsers: lic.maxUsers, subscriptionEndsAt: ends };
    });
  }),
);

/** Desktop: apply a transfer key — companies licensed on the old PC continue on this one (dates unchanged). */
async function applyRebind(req: any, k: DesktopLicense) {
  const device = currentDeviceId()!;
  return tx(async (t) => {
    const all = await t.rows(`SELECT id, name_ar, licensed_device FROM companies WHERE licensed_device IS NOT NULL`);
    const moved = all.filter((c: any) => deviceMatches(c.licensedDevice, k.fromDevice) && !deviceMatches(c.licensedDevice, device));
    if (!moved.length) {
      if (req.company?.licensedDevice && deviceMatches(req.company.licensedDevice, device)) return { rebound: 0, message: "الترخيص يعمل على هذا الجهاز بالفعل" };
      throw bad(`مفتاح النقل صادر لترخيص الجهاز ${k.fromDevice} ولا توجد على هذا الجهاز بيانات مرخّصة له — استعد النسخة الاحتياطية من الجهاز القديم أولاً`);
    }
    for (const c of moved) {
      await t.exec(`UPDATE companies SET licensed_device=$2, updated_at=now() WHERE id=$1`, [c.id, device]);
      await t.insert("audit_logs", { companyId: c.id, userId: req.auth.userId, userName: req.auth.userName, action: "LICENSE_TRANSFERRED", entity: "company", entityId: c.id, details: { from: c.licensedDevice, to: device } });
    }
    return { rebound: moved.length, toDevice: device };
  });
}

/** Desktop: move this company's licence to the current PC through the cloud licence server (needs internet once). */
auth.post(
  "/license/transfer-here",
  h(async (req) => {
    if (!isDesktopLocal()) throw bad("متاح في نسخة سطح المكتب فقط");
    if (!req.company) throw bad("اختر المنشأة أولاً");
    if (!["OWNER", "ADMIN"].includes(req.auth.role || "") && !req.auth.superAdmin) throw new AppError(403, "المالك فقط يمكنه نقل الترخيص");
    const device = currentDeviceId();
    if (!device) throw bad("تعذّر قراءة معرّف هذا الجهاز");
    if (!req.company.licensedDevice || deviceMatches(req.company.licensedDevice, device)) throw bad("الترخيص يعمل على هذا الجهاز — لا حاجة للنقل");
    const k = await db.maybe(`SELECT key FROM license_keys WHERE company_id=$1 AND desktop AND activated_at IS NOT NULL ORDER BY activated_at DESC LIMIT 1`, [req.company.id]);
    if (!k) throw bad("لم يُعثر على مفتاح الترخيص الأصلي في البيانات — تواصل مع مزود النظام");
    let r: Response;
    try {
      r = await fetch(licenseServer() + "/api/auth/license/desktop-transfer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: k.key, toDevice: device, fromDevice: req.company.licensedDevice, computer: os.hostname() }), signal: AbortSignal.timeout(20000) });
    } catch {
      throw new AppError(503, `تعذّر الاتصال بخادم التراخيص. تأكد من الإنترنت وأعد المحاولة، أو أرسل لمزود النظام: الجهاز السابق ${req.company.licensedDevice} ← هذا الجهاز ${device} ليرسل لك «مفتاح نقل» تلصقه في خانة التفعيل.`, "OFFLINE");
    }
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new AppError(r.status === 429 ? 429 : 400, j.message || "رفض خادم التراخيص طلب النقل");
    const rk = verifyDesktopLicense(j.rebindKey);
    if (!rk || rk.type !== "rebind" || !deviceMatches(rk.deviceId, device)) throw bad("استجابة غير صحيحة من خادم التراخيص");
    const out = await applyRebind(req, rk);
    return { ...out, remaining: j.remaining };
  }),
);

// ─── super admin ───────────────────────────────────────────────────────────
export const admin = Router();
admin.use(authenticate, superAdmin);

admin.get(
  "/overview",
  h(async () => {
    const companies = await db.rows(`SELECT c.*, (SELECT COUNT(*)::int FROM memberships m WHERE m.company_id=c.id) users, (SELECT COUNT(*)::int FROM invoices i WHERE i.company_id=c.id AND i.status='POSTED') invoices, (SELECT MAX(created_at) FROM audit_logs a WHERE a.company_id=c.id) last_activity FROM companies c ORDER BY c.created_at DESC`);
    const keys = await db.rows(`SELECT k.*, c.name_ar AS company_name FROM license_keys k LEFT JOIN companies c ON c.id=k.company_id ORDER BY k.created_at DESC LIMIT 200`);
    const users = await db.one(`SELECT COUNT(*)::int c FROM users`);
    return { companies, keys, usersCount: users.c };
  }),
);

admin.post(
  "/license-keys",
  h(async (req) => {
    const plan = String(req.body.plan || "PRO").toUpperCase();
    if (!["BASIC", "PRO", "ENTERPRISE"].includes(plan)) throw bad("الخطة غير صحيحة");
    const months = Math.max(1, Math.min(60, Number(req.body.months) || 12));
    const maxUsers = Math.max(1, Math.min(500, Number(req.body.maxUsers) || (plan === "BASIC" ? 3 : plan === "PRO" ? 10 : 100)));
    const deviceId = req.body.desktop && req.body.deviceId ? normalizeDeviceId(req.body.deviceId) : null;
    if (deviceId && !validDeviceId(deviceId)) throw bad("معرّف الجهاز غير صحيح — تأكد من نسخه كما يظهر في شاشة الترخيص لدى العميل (XXXX-XXXX-XXXX-XXXX)");
    const count = deviceId ? 1 : Math.max(1, Math.min(50, Number(req.body.count) || 1));
    const out: any[] = [];
    for (let i = 0; i < count; i++) {
      const raw = randomBytes(10).toString("hex").toUpperCase();
      const key = `MZN-${plan.slice(0, 3)}-${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}`;
      if (req.body.desktop) {
        // signed offline key; a record is kept here for the provider (it cannot be activated on the cloud)
        const k = signDesktopLicense({ plan, months, maxUsers, note: req.body.note || null, deviceId });
        out.push({ ...(await db.insert("license_keys", { key: k, plan, months, maxUsers, note: req.body.note || null, deviceId, desktop: true })), desktop: true });
      } else out.push(await db.insert("license_keys", { key, plan, months, maxUsers, note: req.body.note || null }));
    }
    return out;
  }),
);

/** Provider-side transfer of a desktop licence to a new PC (no yearly limit) — for customers without internet. */
admin.post(
  "/license-keys/:id/transfer",
  h(async (req) => {
    const to = normalizeDeviceId(req.body?.deviceId);
    if (!validDeviceId(to)) throw bad("معرّف الجهاز الجديد غير صحيح");
    return tx(async (t) => {
      const rec = await t.maybe(`SELECT * FROM license_keys WHERE id=$1 AND desktop FOR UPDATE`, [req.params.id]);
      if (!rec) throw bad("المفتاح غير موجود أو ليس مفتاح سطح مكتب");
      if (!rec.deviceId) throw bad("هذا المفتاح غير مرتبط بجهاز");
      const cur = rec.currentDevice || rec.deviceId;
      const log: any[] = rec.transferLog || [];
      log.push({ at: new Date().toISOString(), from: cur, to, by: "admin", user: req.auth.email });
      await t.exec(`UPDATE license_keys SET current_device=$2, transfer_log=$3 WHERE id=$1`, [rec.id, to, JSON.stringify(log)]);
      return { key: signRebindKey(cur, to, rec.note), fromDevice: cur, toDevice: to };
    });
  }),
);

admin.post(
  "/companies/:id/status",
  h(async (req) => {
    const status = req.body.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";
    await db.exec(`UPDATE companies SET status=$2, updated_at=now() WHERE id=$1`, [req.params.id, status]);
    return { ok: true };
  }),
);

admin.post(
  "/companies/:id/extend",
  h(async (req) => {
    const c = await db.one(`SELECT * FROM companies WHERE id=$1`, [req.params.id]);
    const months = Number(req.body.months) || 1;
    const base = c.subscriptionEndsAt && new Date(c.subscriptionEndsAt) > new Date() ? new Date(c.subscriptionEndsAt) : new Date();
    base.setMonth(base.getMonth() + months);
    await db.exec(`UPDATE companies SET subscription_ends_at=$2, plan=COALESCE($3, plan), max_users=COALESCE($4, max_users) WHERE id=$1`, [c.id, base, req.body.plan || null, req.body.maxUsers || null]);
    return { subscriptionEndsAt: base };
  }),
);
